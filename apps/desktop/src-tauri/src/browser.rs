// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Phase 93: the Phoenix mini browser host.
//!
//! Layout (two top-level windows per browser, no `unstable` feature): the CHROME window
//! (`phoenix-browser`, loads `browser.html`, tabs and address bar) and one CONTENT window per tab
//! (`phoenix-browser-tab-N`, an undecorated child window of the chrome window placed over its area
//! below the chrome strip). Only the active tab's window is shown. The chrome window is the only
//! caller any command here accepts, and it is the only window with a capability file
//! (`capabilities/browser.json`); content windows have none, so a page cannot invoke a command.
//!
//! Every content webview: incognito (no data directory), devtools off, no initialization script,
//! `on_navigation` driven by the Rust port of `decideNavigation` plus a DNS check on the RESOLVED
//! address, popups refused or reopened as tabs after policy, downloads refused until a Phoenix
//! dialog picked a folder, permissions answered `Allow` only for a granted origin and kind and
//! otherwise `Deny` (never `Default`), and on macOS a WKContentRuleList compiled from the enabled
//! filter lists.
//!
//! NOT verified on a real display or webview by the author: see `docs/mini-browser.md`, which says
//! exactly what was exercised (policy, conversion and the mock-runtime lifecycle) and what is only
//! reasoned.

use crate::browser_core::{
    self as core, clamp_chrome_height, clamp_zoom, parse_tab_id, port_radar_origin,
    same_radar_origin, tab_label, tab_of_label, url_text_ok, History, RateLimit, CHROME_LABEL,
    MAX_TABS,
};
use crate::browser_policy::{
    classify_host, classify_ip, decide_navigation, host_matches_site, registrable_domain, Decision,
    Denial, HostClass, Intent, Policy, SitePermissions,
};
use crate::browser_rules::{
    self, Exemption, Options as RuleOptions, RulesReport, WEBKIT_RULE_LIMIT,
};
use crate::connection::{connection, Locator};
use crate::core_status::{call_capped, Method};
use crate::shortcuts::Refusal;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::net::{IpAddr, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionResponse};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use url::Url;

pub use crate::browser_core::{CHROME_LABEL as CHROME_WINDOW_LABEL, DEFAULT_CHROME_HEIGHT};

pub const TAB_EVENT: &str = "browser://tab";
pub const TAB_CLOSED_EVENT: &str = "browser://tab-closed";
pub const OPEN_REQUEST_EVENT: &str = "browser://open-request";
pub const DOWNLOAD_REFUSED_EVENT: &str = "browser://download-refused";

/// DNS answers are trusted this long (and no longer) before the next navigation asks again.
const DNS_TTL: Duration = Duration::from_secs(60);
/// A name that does not resolve in this time is refused (fail closed).
const DNS_TIMEOUT: Duration = Duration::from_secs(2);
/// A port-radar request waits this long for the person's confirmation.
const RADAR_TTL: Duration = Duration::from_secs(120);
/// Compiled shield rules are rebuilt from Core at most this often (or on a per-site change).
const SHIELDS_TTL: Duration = Duration::from_secs(300);
/// Longest wait for WebKit to compile and attach the rule list before a tab loads anyway.
#[cfg(target_os = "macos")]
const SHIELDS_ATTACH_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_LIST_RESPONSE: u64 = 12 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// What differs between the real app and tests
// ---------------------------------------------------------------------------------------------

/// What Core says about shields (the text of each enabled list and the person's switches).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ShieldsInput {
    /// The text of every enabled, downloaded filter list, in Core's order.
    pub lists: Vec<String>,
    /// The master switch. Off: no list rule is applied (the private-network block stays).
    pub enabled: bool,
    /// Sites (and subdomains) the person turned blocking off for.
    pub off_sites: Vec<String>,
    /// Exact hosts whose ads Phoenix must not block (the music connector policy).
    pub exempt_hosts: Vec<String>,
    /// Core could not be read: only the starter rules apply.
    pub core_unreachable: bool,
}

type Resolver = Arc<dyn Fn(&str) -> Result<Vec<IpAddr>, ()> + Send + Sync>;
/// Asks the person for a folder; the text names the file and the site. Called on the main thread.
type Picker = Arc<dyn Fn(&str) -> Option<PathBuf> + Send + Sync>;
type ShieldsSource = Arc<dyn Fn() -> ShieldsInput + Send + Sync>;

/// Everything that touches the machine; tests replace it with fakes (`Builder::manage(hooks)`).
#[derive(Clone)]
pub struct Hooks {
    /// Resolves a host name to its addresses.
    pub resolve: Resolver,
    /// Shows a Phoenix folder dialog; `None` is cancel or "cannot be shown".
    pub pick_folder: Picker,
    /// Reads the shields settings and list text from Core.
    pub shields: ShieldsSource,
}

impl Hooks {
    /// The real app: system DNS, the native folder dialog, Phoenix Core over loopback.
    pub fn system(locator: Locator) -> Self {
        Hooks {
            resolve: Arc::new(system_resolve),
            pick_folder: Arc::new(crate::browser_native::pick_folder),
            shields: Arc::new(move || read_shields_from_core(&locator)),
        }
    }
}

/// `getaddrinfo` cannot be cancelled, so it runs on its own thread and a late answer is dropped.
fn system_resolve(host: &str) -> Result<Vec<IpAddr>, ()> {
    let (tx, rx) = std::sync::mpsc::channel();
    let name = format!("{host}:443");
    std::thread::spawn(move || {
        let _ = tx.send(
            name.to_socket_addrs()
                .map(|addrs| addrs.map(|a| a.ip()).collect::<Vec<_>>()),
        );
    });
    match rx.recv_timeout(DNS_TIMEOUT) {
        Ok(Ok(addrs)) => Ok(addrs),
        _ => Err(()),
    }
}

#[derive(Deserialize)]
struct ListsPayload {
    #[serde(default)]
    lists: Vec<ListView>,
    shields: Option<ShieldsView>,
}
#[derive(Deserialize)]
struct ListView {
    id: String,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    status: String,
}
#[derive(Deserialize)]
struct ShieldsView {
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default, rename = "offSites")]
    off_sites: Vec<String>,
}
fn yes() -> bool {
    true
}
#[derive(Deserialize)]
struct ListText {
    #[serde(default)]
    text: String,
}
#[derive(Deserialize)]
struct MusicPayload {
    #[serde(default)]
    sites: Vec<MusicSite>,
}
#[derive(Deserialize)]
struct MusicSite {
    #[serde(default)]
    hosts: Vec<String>,
    #[serde(default, rename = "adBlocking")]
    ad_blocking: String,
}

/// Reads shields from Core (`docs/filter-lists.md`): the switches, the text of each enabled and
/// downloaded list, and the music connector policy. Any failure of the first call means "Core
/// unreachable" and only the starter rules apply; a list that cannot be read is skipped.
fn read_shields_from_core(locator: &Locator) -> ShieldsInput {
    let conn = connection(locator);
    let get = |path: &str, cap: u64, wait: Duration| -> Option<String> {
        match call_capped(
            &conn.base_url,
            conn.token.as_deref(),
            Method::Get,
            path,
            wait,
            cap,
        ) {
            Ok((200, body)) => Some(body),
            _ => None,
        }
    };
    let Some(body) = get(
        "/api/browser/filter-lists",
        1024 * 1024,
        Duration::from_secs(5),
    ) else {
        return ShieldsInput {
            enabled: true,
            core_unreachable: true,
            ..ShieldsInput::default()
        };
    };
    let Ok(payload) = serde_json::from_str::<ListsPayload>(&body) else {
        return ShieldsInput {
            enabled: true,
            core_unreachable: true,
            ..ShieldsInput::default()
        };
    };
    let mut input = ShieldsInput {
        enabled: payload.shields.as_ref().is_none_or(|s| s.enabled),
        off_sites: payload.shields.map(|s| s.off_sites).unwrap_or_default(),
        ..ShieldsInput::default()
    };
    for list in payload
        .lists
        .iter()
        .filter(|l| l.enabled && l.status == "ready")
    {
        let path = format!("/api/browser/filter-lists/{}/text", list.id);
        if let Some(text) = get(&path, MAX_LIST_RESPONSE, Duration::from_secs(30))
            .and_then(|b| serde_json::from_str::<ListText>(&b).ok())
        {
            input.lists.push(text.text);
        }
    }
    if let Some(music) = get("/api/music/connectors", 1024 * 1024, Duration::from_secs(5))
        .and_then(|b| serde_json::from_str::<MusicPayload>(&b).ok())
    {
        input.exempt_hosts = music
            .sites
            .into_iter()
            .filter(|s| s.ad_blocking == "exempt")
            .flat_map(|s| s.hosts)
            .collect();
    }
    input
}

// ---------------------------------------------------------------------------------------------
// Host state
// ---------------------------------------------------------------------------------------------

struct Tab {
    url: String,
    title: String,
    loading: bool,
    history: History,
    zoom: f64,
    /// Set for a tab opened from the port radar: the one dev-server origin it may stay on.
    radar: Option<(String, u16)>,
}

/// One compiled rule list and what is known about it.
#[derive(Clone, Debug)]
pub struct Compiled {
    pub id: String,
    pub json: Arc<String>,
    pub report: RulesReport,
    /// `"lists"`, `"starter"` or `"off"` (the master switch).
    pub source: &'static str,
}

#[derive(Default)]
struct ShieldsState {
    compiled: Option<(Instant, Compiled)>,
    /// `set_site_shields` changes not yet visible in Core's list: `true` blocking, `false` off.
    overrides: HashMap<String, bool>,
    /// Why the rules are not active in tabs (set when applying failed or is unavailable).
    attach: Option<String>,
}

struct Inner {
    tabs: BTreeMap<u64, Tab>,
    next_id: u64,
    active: Option<u64>,
    chrome_height: f64,
    permissions: SitePermissions,
    dns: HashMap<(String, bool), (Instant, Result<(), Denial>)>,
    pending_radar: Vec<(String, Instant)>,
    popups: RateLimit,
    downloads: RateLimit,
    shields: ShieldsState,
}

pub struct Host {
    hooks: Hooks,
    /// False under the mock runtime: no native webview exists to attach rules to.
    native: bool,
    core_port: u16,
    inner: Mutex<Inner>,
}

/// One tab as the chrome page sees it. All text is untrusted page data.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub tab_id: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub zoom: f64,
    /// Always 0: no supported webview reports how many requests a content rule list blocked.
    pub blocked: u32,
}

fn info(id: u64, tab: &Tab) -> TabInfo {
    TabInfo {
        tab_id: id.to_string(),
        url: tab.url.chars().take(2048).collect(),
        title: tab.title.chars().take(300).collect(),
        loading: tab.loading,
        can_go_back: tab.history.can_go_back(),
        can_go_forward: tab.history.can_go_forward(),
        zoom: tab.zoom,
        blocked: 0,
    }
}

/// The verdict `on_navigation` acts on.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Nav {
    Allow,
    /// Cancel this load and navigate to the https URL instead.
    Upgrade(String),
    Deny(Denial),
}

fn radar_policy(origin: &(String, u16)) -> Policy {
    Policy {
        private_network_allowed_sites: vec![origin.0.clone()],
        ..Policy::default()
    }
}

impl Host {
    pub fn new(hooks: Hooks, native: bool, core_port: u16) -> Self {
        Host {
            hooks,
            native,
            core_port,
            inner: Mutex::new(Inner {
                tabs: BTreeMap::new(),
                next_id: 1,
                active: None,
                chrome_height: DEFAULT_CHROME_HEIGHT,
                permissions: SitePermissions::default(),
                dns: HashMap::new(),
                pending_radar: Vec::new(),
                popups: RateLimit::new(3, Duration::from_secs(10)),
                downloads: RateLimit::new(3, Duration::from_secs(10)),
                shields: ShieldsState::default(),
            }),
        }
    }

    /// Whether tabs get a native content rule list: macOS with a real webview. Linux and Windows
    /// request blocking is not built (see `browser_native`), so their tabs open unfiltered and the
    /// chrome is told so by `shields_status`.
    fn platform_blocking(&self) -> bool {
        cfg!(target_os = "macos") && self.native
    }

    pub fn tab_count(&self) -> usize {
        self.inner.lock().tabs.len()
    }

    /// The address check: resolve `host` and refuse it if any answer is private (or, for a
    /// loopback dev server, if any answer is NOT loopback). Cached for [`DNS_TTL`].
    fn dns_verdict(&self, host: &str, loopback_ok: bool) -> Result<(), Denial> {
        let key = (host.to_lowercase(), loopback_ok);
        if let Some((at, verdict)) = self.inner.lock().dns.get(&key).copied() {
            if at.elapsed() < DNS_TTL {
                return verdict;
            }
        }
        let verdict = match (self.hooks.resolve)(&key.0) {
            Err(()) => Err(Denial::DnsFailed),
            Ok(addrs) if addrs.is_empty() => Err(Denial::DnsFailed),
            Ok(addrs) => {
                let bad = if loopback_ok {
                    addrs
                        .iter()
                        .any(|ip| !crate::browser_policy::is_loopback_ip(*ip))
                } else {
                    addrs
                        .iter()
                        .any(|ip| matches!(classify_ip(*ip), HostClass::Private(_)))
                };
                if bad {
                    Err(Denial::DnsPrivate)
                } else {
                    Ok(())
                }
            }
        };
        let mut inner = self.inner.lock();
        if inner.dns.len() >= 512 {
            inner.dns.clear();
        }
        inner.dns.insert(key, (Instant::now(), verdict));
        verdict
    }

    /// The decision for one navigation of tab `id` (or of no known tab: default policy).
    pub fn judge(&self, id: Option<u64>, url: &Url) -> Nav {
        let radar = id.and_then(|id| {
            self.inner
                .lock()
                .tabs
                .get(&id)
                .and_then(|t| t.radar.clone())
        });
        self.judge_with(radar.as_ref(), url)
    }

    /// [`Host::judge`] for a tab that may not exist yet. `radar` is the one dev-server origin a
    /// port-radar tab may stay on: only a URL of exactly that origin is judged as typed and listed.
    pub fn judge_with(&self, radar: Option<&(String, u16)>, url: &Url) -> Nav {
        // The two documents a webview creates by itself (the empty first page and `srcdoc`
        // frames). Both carry only content the page already has; every other `about:` is refused.
        if matches!(url.as_str(), "about:blank" | "about:srcdoc") {
            return Nav::Allow;
        }
        let (policy, intent) = match radar {
            Some(origin) if same_radar_origin(url, origin) => (radar_policy(origin), Intent::Typed),
            _ => (Policy::default(), Intent::Link),
        };
        match decide_navigation(url.as_str(), &policy, intent) {
            Decision::Deny { reason, .. } => Nav::Deny(reason),
            Decision::Allow {
                url: target,
                upgraded: true,
            } => Nav::Upgrade(target),
            Decision::Allow {
                upgraded: false, ..
            } => self.check_address(url, &policy),
        }
    }

    /// Step two of every allowed http(s) navigation: the RESOLVED address.
    fn check_address(&self, url: &Url, policy: &Policy) -> Nav {
        if !matches!(url.scheme(), "http" | "https") {
            return Nav::Allow;
        }
        let Some(url::Host::Domain(domain)) = url.host() else {
            // An IP literal was classified by `decide_navigation` itself.
            return Nav::Allow;
        };
        // A private NAME only reaches this point when the policy lists it (a radar tab): it must
        // then really resolve to loopback.
        let loopback_ok = matches!(classify_host(domain), HostClass::Private(_))
            && policy
                .private_network_allowed_sites
                .iter()
                .any(|s| host_matches_site(domain, s));
        match self.dns_verdict(domain, loopback_ok) {
            Ok(()) => Nav::Allow,
            Err(reason) => Nav::Deny(reason),
        }
    }

    fn tab_info(&self, id: u64) -> Option<TabInfo> {
        self.inner.lock().tabs.get(&id).map(|t| info(id, t))
    }

    /// The compiled rules, rebuilt from Core when they are older than [`SHIELDS_TTL`], when
    /// `force` is set, or when none exist. Blocking: call off the main thread.
    fn shields(&self, force: bool) -> Compiled {
        {
            let inner = self.inner.lock();
            if let Some((at, compiled)) = &inner.shields.compiled {
                if !force && at.elapsed() < SHIELDS_TTL {
                    return compiled.clone();
                }
            }
        }
        let mut input = (self.hooks.shields)();
        let overrides = self.inner.lock().shields.overrides.clone();
        for (site, blocking) in &overrides {
            input.off_sites.retain(|s| s != site);
            if !blocking {
                input.off_sites.push(site.clone());
            }
        }
        let compiled = compile_shields(&input, self.core_port);
        self.inner.lock().shields.compiled = Some((Instant::now(), compiled.clone()));
        compiled
    }
}

/// Lists to one compiled rule list. Starter rules apply only when no list contributed a rule,
/// exactly as `Shields` does; the master switch off leaves only the fixed private-network block.
pub fn compile_shields(input: &ShieldsInput, core_port: u16) -> Compiled {
    let mut exemptions: Vec<Exemption> = input
        .off_sites
        .iter()
        .map(|s| Exemption {
            host: s.to_lowercase(),
            subdomains: true,
        })
        .collect();
    exemptions.extend(input.exempt_hosts.iter().map(|h| Exemption {
        host: h.to_lowercase(),
        subdomains: false,
    }));
    let options = RuleOptions {
        exemptions,
        core_port: Some(core_port),
        limit: WEBKIT_RULE_LIMIT,
    };
    let (converted, source) = if !input.enabled {
        (browser_rules::convert(&[], &options), "off")
    } else {
        let texts: Vec<&str> = input.lists.iter().map(String::as_str).collect();
        let converted = browser_rules::convert(&texts, &options);
        if converted.report.converted > 0 {
            (converted, "lists")
        } else {
            (
                browser_rules::convert(&[browser_rules::STARTER_RULES], &options),
                "starter",
            )
        }
    };
    Compiled {
        id: browser_rules::fingerprint(&converted.json),
        json: Arc::new(converted.json),
        report: converted.report,
        source,
    }
}

// ---------------------------------------------------------------------------------------------
// Host operations (state changes; no windows)
// ---------------------------------------------------------------------------------------------

/// Why a tab command was refused or what a policy refusal reports to the chrome page.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum Outcome {
    Opened { ok: bool, tab: TabInfo },
    Denied { ok: bool, reason: &'static str },
}

impl Outcome {
    pub fn opened(tab: TabInfo) -> Self {
        Outcome::Opened { ok: true, tab }
    }
    pub fn denied(reason: &'static str) -> Self {
        Outcome::Denied { ok: false, reason }
    }
}

/// A site the chrome may toggle shields for: a host name, never a URL.
pub fn valid_site(site: &str) -> bool {
    !site.is_empty()
        && site.len() <= 253
        && site.is_ascii()
        && site.split('.').all(|l| {
            !l.is_empty()
                && l.len() <= 63
                && l.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

impl Host {
    /// The decision for a navigation the chrome asked for (typed address, back-end re-validation).
    /// DNS runs here, so call it off the main thread.
    pub fn vet(
        &self,
        radar: Option<&(String, u16)>,
        input: &str,
        typed: bool,
    ) -> Result<Url, Denial> {
        if !url_text_ok(input) {
            return Err(Denial::Unparseable);
        }
        let parsed = Url::parse(input.trim()).ok();
        let (policy, intent) = match (&parsed, radar) {
            (Some(url), Some(origin)) if same_radar_origin(url, origin) => {
                (radar_policy(origin), Intent::Typed)
            }
            _ => (
                Policy::default(),
                if typed { Intent::Typed } else { Intent::Link },
            ),
        };
        match decide_navigation(input, &policy, intent) {
            Decision::Deny { reason, .. } => Err(reason),
            Decision::Allow { url, .. } => {
                let target = Url::parse(&url).map_err(|_| Denial::Unparseable)?;
                match self.check_address(&target, &policy) {
                    Nav::Deny(reason) => Err(reason),
                    _ => Ok(target),
                }
            }
        }
    }

    /// The person asked (through the port radar) to open `url`. Remembered for [`RADAR_TTL`]; only
    /// the chrome page can turn it into a tab, after the person confirmed in the chrome.
    /// Returns the URL to show in the confirmation, or `None` when it is not an acceptable
    /// loopback dev-server URL.
    pub fn request_radar_open(&self, url: &str) -> Option<String> {
        port_radar_origin(url, self.core_port)?;
        let url = url.trim().to_string();
        let mut inner = self.inner.lock();
        inner
            .pending_radar
            .retain(|(_, at)| at.elapsed() < RADAR_TTL);
        if !inner.pending_radar.iter().any(|(u, _)| *u == url) {
            if inner.pending_radar.len() >= 4 {
                inner.pending_radar.remove(0);
            }
            inner.pending_radar.push((url.clone(), Instant::now()));
        }
        Some(url)
    }

    /// Consumes a confirmed request: `true` once per request, within [`RADAR_TTL`].
    fn take_radar_request(&self, url: &str) -> bool {
        let mut inner = self.inner.lock();
        inner
            .pending_radar
            .retain(|(_, at)| at.elapsed() < RADAR_TTL);
        match inner
            .pending_radar
            .iter()
            .position(|(u, _)| u == url.trim())
        {
            Some(i) => {
                inner.pending_radar.remove(i);
                true
            }
            None => false,
        }
    }

    /// A new tab's state; `None` when too many tabs are open.
    fn add_tab(&self, url: &str, radar: Option<(String, u16)>) -> Option<u64> {
        let mut inner = self.inner.lock();
        if inner.tabs.len() >= MAX_TABS {
            return None;
        }
        let id = inner.next_id;
        inner.next_id += 1;
        inner.tabs.insert(
            id,
            Tab {
                url: url.to_string(),
                title: String::new(),
                loading: true,
                history: History::default(),
                zoom: 1.0,
                radar,
            },
        );
        Some(id)
    }

    /// Removes a tab; the next active tab (the previous one, else the next) when it was active.
    fn remove_tab(&self, id: u64) -> Option<Option<u64>> {
        let mut inner = self.inner.lock();
        inner.tabs.remove(&id)?;
        if inner.active == Some(id) {
            let next = inner
                .tabs
                .range(..id)
                .next_back()
                .or_else(|| inner.tabs.range(id..).next())
                .map(|(k, _)| *k);
            inner.active = next;
            return Some(next);
        }
        Some(inner.active)
    }

    fn page_started(&self, id: u64, url: &str) -> Option<TabInfo> {
        let mut inner = self.inner.lock();
        let tab = inner.tabs.get_mut(&id)?;
        // The blank page a macOS tab starts on while its rule list is compiled is not a page.
        if url == "about:blank" {
            return Some(info(id, tab));
        }
        tab.url = url.to_string();
        tab.loading = true;
        tab.title.clear();
        tab.history.committed(url);
        Some(info(id, tab))
    }

    fn page_finished(&self, id: u64) -> Option<TabInfo> {
        let mut inner = self.inner.lock();
        let tab = inner.tabs.get_mut(&id)?;
        tab.loading = false;
        Some(info(id, tab))
    }

    fn set_title(&self, id: u64, title: &str) -> Option<TabInfo> {
        let mut inner = self.inner.lock();
        let tab = inner.tabs.get_mut(&id)?;
        tab.title = title
            .chars()
            .filter(|c| !c.is_control())
            .take(300)
            .collect();
        Some(info(id, tab))
    }

    fn set_zoom(&self, id: u64, factor: f64) -> Option<(f64, TabInfo)> {
        let mut inner = self.inner.lock();
        let tab = inner.tabs.get_mut(&id)?;
        tab.zoom = clamp_zoom(factor);
        Some((tab.zoom, info(id, tab)))
    }

    /// `Allow` only for a granted origin and kind (see `SitePermissions`), else `Deny`: never
    /// `Default`, which on macOS and Windows continues into the system's own prompt. The asking
    /// frame is not given by the webview API, so it is taken to be the top-level page; since no
    /// command grants anything, in practice every request is denied.
    pub fn permission(&self, id: u64, kind: &str) -> PermissionResponse {
        let inner = self.inner.lock();
        let Some(tab) = inner.tabs.get(&id) else {
            return PermissionResponse::Deny;
        };
        let origin = Url::parse(&tab.url)
            .ok()
            .map(|u| u.origin().ascii_serialization())
            .unwrap_or_default();
        match inner.permissions.decide(kind, &origin, &origin) {
            (true, _) => PermissionResponse::Allow,
            (false, _) => PermissionResponse::Deny,
        }
    }

    /// Records a grant the person made in a Phoenix prompt. No Tauri command calls this yet (the
    /// chrome has no permission prompt), so grants are only possible from Rust code and tests.
    pub fn grant_permission(&self, origin: &str, kind: &str) -> bool {
        self.inner.lock().permissions.grant(origin, kind, true).0
    }

    /// The folder a download of `suggested` from `url` goes to, after the person picked it in a
    /// Phoenix dialog; `None` refuses the download. At most 3 dialogs per 10 seconds.
    pub fn download_destination(
        &self,
        id: Option<u64>,
        url: &Url,
        suggested: &str,
    ) -> Result<PathBuf, &'static str> {
        if !matches!(url.scheme(), "http" | "https") {
            return Err("scheme_not_allowed");
        }
        let radar = id.and_then(|id| {
            self.inner
                .lock()
                .tabs
                .get(&id)
                .and_then(|t| t.radar.clone())
        });
        match self.judge_with(radar.as_ref(), url) {
            Nav::Deny(reason) => return Err(reason.as_str()),
            Nav::Upgrade(_) => return Err("insecure_blocked"),
            Nav::Allow => {}
        }
        if !self.inner.lock().downloads.allow(Instant::now()) {
            return Err("too_many_downloads");
        }
        let name = core::safe_file_name(suggested);
        let site = url.host_str().unwrap_or("this site");
        let message = format!(
            "Choose a folder for \"{name}\" from {site}. Nothing is saved until you choose."
        );
        let folder = (self.hooks.pick_folder)(&message).ok_or("cancelled")?;
        core::download_destination(&folder, suggested, |p| p.exists()).ok_or("bad_folder")
    }

    /// A popup request: the URL to open as a new tab, or `None` to deny.
    pub fn popup_target(&self, id: u64, url: &Url) -> Option<Url> {
        let radar = self
            .inner
            .lock()
            .tabs
            .get(&id)
            .and_then(|t| t.radar.clone());
        let target = match decide_navigation(url.as_str(), &Policy::default(), Intent::NewWindow) {
            Decision::Allow { url, .. } => Url::parse(&url).ok()?,
            Decision::Deny { .. } => {
                // A radar tab may open its own dev server in a new tab only through the chrome.
                let _ = radar;
                return None;
            }
        };
        let mut inner = self.inner.lock();
        if inner.tabs.len() >= MAX_TABS || !inner.popups.allow(Instant::now()) {
            return None;
        }
        Some(target)
    }

    /// Every tab id, in order.
    fn tab_ids(&self) -> Vec<u64> {
        self.inner.lock().tabs.keys().copied().collect()
    }

    fn set_override(&self, site: &str, blocking: bool) {
        let mut inner = self.inner.lock();
        inner
            .shields
            .overrides
            .insert(site.to_lowercase(), blocking);
        inner.shields.compiled = None;
    }

    /// Forgets session state when the chrome window is gone: tabs, grants, DNS answers, requests.
    fn reset(&self) {
        let mut inner = self.inner.lock();
        inner.tabs.clear();
        inner.active = None;
        inner.permissions.clear();
        inner.dns.clear();
        inner.pending_radar.clear();
        inner.chrome_height = DEFAULT_CHROME_HEIGHT;
    }
}

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------

fn forbidden() -> Refusal {
    Refusal::new("forbidden", "Only the Phoenix browser window may do that.")
}

fn refusal(code: &'static str, message: &str) -> Refusal {
    Refusal::new(code, message)
}

/// Every browser command starts here: the caller must be the chrome window, nothing else.
fn chrome_only<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), Refusal> {
    if window.label() == CHROME_LABEL {
        Ok(())
    } else {
        Err(forbidden())
    }
}

fn emit_tab<R: Runtime>(app: &AppHandle<R>, tab: &TabInfo) {
    let _ = app.emit_to(CHROME_LABEL, TAB_EVENT, tab);
}

fn emit_closed<R: Runtime>(app: &AppHandle<R>, id: u64) {
    let _ = app.emit_to(
        CHROME_LABEL,
        TAB_CLOSED_EVENT,
        json!({ "tabId": id.to_string() }),
    );
}

/// Opens the chrome window, or brings it forward.
pub fn show<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(CHROME_LABEL) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }
    let handle = app.clone();
    WebviewWindowBuilder::new(app, CHROME_LABEL, WebviewUrl::App("browser.html".into()))
        .title("Phoenix Browser")
        .inner_size(1100.0, 760.0)
        .min_inner_size(480.0, 360.0)
        .on_page_load(move |_, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                // The chrome page registers its listeners after it mounts; replay what is waiting.
                let app = handle.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(1000));
                    replay_radar_requests(&app);
                });
            }
        })
        .build()?;
    Ok(())
}

fn replay_radar_requests<R: Runtime>(app: &AppHandle<R>) {
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    for url in host.pending_radar_urls() {
        let _ = app.emit_to(
            CHROME_LABEL,
            OPEN_REQUEST_EVENT,
            json!({ "url": url, "source": "port_radar" }),
        );
    }
}

impl Host {
    fn pending_radar_urls(&self) -> Vec<String> {
        let mut inner = self.inner.lock();
        inner
            .pending_radar
            .retain(|(_, at)| at.elapsed() < RADAR_TTL);
        inner.pending_radar.iter().map(|(u, _)| u.clone()).collect()
    }

    fn chrome_height(&self) -> f64 {
        self.inner.lock().chrome_height
    }
}

/// Puts every content window over the chrome window's area below the chrome strip.
fn relayout<R: Runtime>(app: &AppHandle<R>) {
    let (Some(chrome), Some(host)) = (
        app.get_webview_window(CHROME_LABEL),
        app.try_state::<Host>(),
    ) else {
        return;
    };
    let (Ok(origin), Ok(size), Ok(scale)) = (
        chrome.inner_position(),
        chrome.inner_size(),
        chrome.scale_factor(),
    ) else {
        return;
    };
    let top = (host.chrome_height() * scale).round() as i32;
    let height = size.height.saturating_sub(top.max(0) as u32).max(1);
    for id in host.tab_ids() {
        if let Some(tab) = app.get_webview_window(&tab_label(id)) {
            let _ = tab.set_position(PhysicalPosition::new(origin.x, origin.y + top));
            let _ = tab.set_size(PhysicalSize::new(size.width.max(1), height));
        }
    }
}

/// Shows the active tab's window and hides every other one.
fn apply_active<R: Runtime>(app: &AppHandle<R>) {
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    let active = host.inner.lock().active;
    for id in host.tab_ids() {
        if let Some(tab) = app.get_webview_window(&tab_label(id)) {
            if Some(id) == active {
                let _ = tab.show();
            } else {
                let _ = tab.hide();
            }
        }
    }
    relayout(app);
}

/// Window events the shell forwards for the chrome and content windows.
pub fn window_event<R: Runtime>(window: &tauri::Window<R>, event: &WindowEvent) {
    let app = window.app_handle();
    let label = window.label();
    if label == CHROME_LABEL {
        match event {
            WindowEvent::Moved(_)
            | WindowEvent::Resized(_)
            | WindowEvent::ScaleFactorChanged { .. } => relayout(app),
            WindowEvent::Focused(true) => relayout(app),
            WindowEvent::Destroyed => {
                // The chrome is gone: close every tab (Linux does not cascade) and forget the session.
                if let Some(host) = app.try_state::<Host>() {
                    for id in host.tab_ids() {
                        if let Some(tab) = app.get_webview_window(&tab_label(id)) {
                            let _ = tab.destroy();
                        }
                    }
                    host.reset();
                }
            }
            _ => {}
        }
    } else if let Some(id) = tab_of_label(label) {
        if matches!(event, WindowEvent::Destroyed) {
            tab_gone(app, id);
        }
    }
}

/// A content window is gone (closed by `close_tab`, or by the system): forget the tab, pick the
/// next active one and tell the chrome. Idempotent, so both paths can call it.
fn tab_gone<R: Runtime>(app: &AppHandle<R>, id: u64) {
    if let Some(host) = app.try_state::<Host>() {
        if host.remove_tab(id).is_some() {
            emit_closed(app, id);
            apply_active(app);
        }
    }
}

/// Builds one content window. Everything that makes a page untrusted is decided here.
fn build_tab_window<R: Runtime>(
    app: &AppHandle<R>,
    id: u64,
    first_url: Url,
) -> tauri::Result<WebviewWindow<R>> {
    let chrome = app
        .get_webview_window(CHROME_LABEL)
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    let label = tab_label(id);
    let (nav, new_win, down, perm, started, title) = (
        app.clone(),
        app.clone(),
        app.clone(),
        app.clone(),
        app.clone(),
        app.clone(),
    );
    let native = app.state::<Host>().native;
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(first_url));
    // The mock runtime has no real window handle to parent to (it would be dereferenced).
    if native {
        builder = builder.parent(&chrome)?;
    }
    let builder = builder
        .title("Phoenix Browser tab")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .shadow(false)
        // Untrusted page: a private store that is dropped with the webview, no folder on disk,
        // no developer tools, and NO initialization script of ours.
        .incognito(true)
        .devtools(false)
        .on_navigation(move |url| {
            let Some(host) = nav.try_state::<Host>() else {
                return false;
            };
            match host.judge(Some(id), url) {
                Nav::Allow => true,
                Nav::Deny(_) => false,
                Nav::Upgrade(target) => {
                    // The webview cannot rewrite a URL: cancel this load and navigate to https. Only
                    // for the page itself (same site as the tab, or a tab with no page yet): the
                    // API does not say which frame asked, and an iframe must not steer the tab.
                    if host.may_upgrade_in_place(id, url) {
                        let app = nav.clone();
                        std::thread::spawn(move || {
                            if let (Some(win), Ok(url)) =
                                (app.get_webview_window(&tab_label(id)), Url::parse(&target))
                            {
                                let _ = win.navigate(url);
                            }
                        });
                    }
                    false
                }
            }
        })
        .on_new_window(move |url, _features| {
            // Never a native popup. A permitted target is reopened as a tab of its own.
            if let Some(host) = new_win.try_state::<Host>() {
                if let Some(target) = host.popup_target(id, &url) {
                    let app = new_win.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = open_url_as_tab(&app, target.to_string(), None, false).await;
                    });
                }
            }
            NewWindowResponse::Deny
        })
        .on_download(move |webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                let Some(host) = down.try_state::<Host>() else {
                    return false;
                };
                let suggested = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let tab = tab_of_label(webview.label());
                match host.download_destination(tab, &url, &suggested) {
                    Ok(path) => {
                        *destination = path;
                        true
                    }
                    Err(reason) => {
                        let _ = down.emit_to(
                            CHROME_LABEL,
                            DOWNLOAD_REFUSED_EVENT,
                            json!({ "reason": reason }),
                        );
                        false
                    }
                }
            }
            _ => true,
        })
        .on_permission_request(move |webview, kind| match perm.try_state::<Host>() {
            Some(host) => match tab_of_label(webview.label()) {
                Some(id) => host.permission(id, &kind.to_string()),
                None => PermissionResponse::Deny,
            },
            None => PermissionResponse::Deny,
        })
        .on_page_load(move |window, payload| {
            let Some(host) = started.try_state::<Host>() else {
                return;
            };
            let updated = match payload.event() {
                PageLoadEvent::Started => host.page_started(id, payload.url().as_str()),
                PageLoadEvent::Finished => host.page_finished(id),
            };
            if let Some(tab) = updated {
                emit_tab(&started, &tab);
            }
            let _ = window;
        })
        .on_document_title_changed(move |_window, text| {
            if let Some(host) = title.try_state::<Host>() {
                if let Some(tab) = host.set_title(id, &text) {
                    emit_tab(&title, &tab);
                }
            }
        });
    builder.build()
}

impl Host {
    /// `url` is the page the tab is on (or would load): an http link may be upgraded in place when
    /// it is the same site, or when the tab has no committed page yet.
    fn may_upgrade_in_place(&self, id: u64, url: &Url) -> bool {
        let inner = self.inner.lock();
        let Some(tab) = inner.tabs.get(&id) else {
            return false;
        };
        let Some(current) = tab.history.current() else {
            return true;
        };
        match (
            Url::parse(current)
                .ok()
                .and_then(|u| u.host_str().map(str::to_string)),
            url.host_str(),
        ) {
            (Some(a), Some(b)) => registrable_domain(&a) == registrable_domain(b),
            _ => false,
        }
    }
}

/// Opens a tab on an already-validated URL: window, shields, first load, activation. Returns the
/// tab, or the reason it was not opened.
async fn open_vetted_tab<R: Runtime>(
    app: &AppHandle<R>,
    url: Url,
    radar: Option<(String, u16)>,
) -> Result<TabInfo, &'static str> {
    let host = app.state::<Host>();
    if app.get_webview_window(CHROME_LABEL).is_none() {
        return Err("no_browser_window");
    }
    let native = host.platform_blocking();
    // Rules are compiled BEFORE the window exists so the first request is already covered.
    let compiled = if native {
        let h = app.clone();
        Some(
            tauri::async_runtime::spawn_blocking(move || h.state::<Host>().shields(false))
                .await
                .map_err(|_| "shields_unavailable")?,
        )
    } else {
        None
    };
    let Some(id) = host.add_tab(url.as_str(), radar) else {
        return Err("too_many_tabs");
    };
    // With native rules the window starts on about:blank and loads `url` after they are attached.
    let first: Url = if native {
        Url::parse("about:blank").map_err(|_| "unparseable")?
    } else {
        url.clone()
    };
    let builder_app = app.clone();
    let (tx, rx) = std::sync::mpsc::channel::<tauri::Result<()>>();
    let _ = app.run_on_main_thread(move || {
        let _ = tx.send(build_tab_window(&builder_app, id, first).map(|_| ()));
    });
    let built =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(10)).ok())
            .await
            .ok()
            .flatten();
    if !matches!(built, Some(Ok(()))) {
        host.remove_tab(id);
        return Err("window_failed");
    }
    if let Some(compiled) = compiled {
        if let Err(reason) = attach_and_load(app, id, &compiled, &url).await {
            if let Some(w) = app.get_webview_window(&tab_label(id)) {
                let _ = w.destroy();
            }
            host.remove_tab(id);
            host.inner.lock().shields.attach = Some(reason);
            return Err("shields_unavailable");
        }
    }
    host.inner.lock().active = Some(id);
    apply_active(app);
    if let Some(w) = app.get_webview_window(&tab_label(id)) {
        let _ = w.set_focus();
    }
    let tab = host.tab_info(id).ok_or("window_failed")?;
    emit_tab(app, &tab);
    Ok(tab)
}

/// macOS: compile and attach the rule list, then navigate to the first URL. Other platforms do
/// not get here (`native` is false there).
#[cfg(target_os = "macos")]
async fn attach_and_load<R: Runtime>(
    app: &AppHandle<R>,
    id: u64,
    compiled: &Compiled,
    url: &Url,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&tab_label(id))
        .ok_or_else(|| "the tab window is gone".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let tx = std::sync::Mutex::new(tx);
    let done: Arc<dyn Fn(Result<(), String>) + Send + Sync> = Arc::new(move |result| {
        if let Ok(tx) = tx.lock() {
            let _ = tx.send(result);
        }
    });
    let json = compiled.json.clone();
    let rule_id = compiled.id.clone();
    window
        .with_webview(move |platform| {
            crate::browser_native::attach_rules(platform.controller(), &rule_id, &json, done);
        })
        .map_err(|e| e.to_string())?;
    let answer =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(SHIELDS_ATTACH_TIMEOUT))
            .await
            .map_err(|e| e.to_string())?;
    match answer {
        Ok(Ok(())) => {}
        Ok(Err(reason)) => return Err(reason),
        Err(_) => return Err("WebKit did not finish compiling the rules in time".into()),
    }
    window.navigate(url.clone()).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
async fn attach_and_load<R: Runtime>(
    _app: &AppHandle<R>,
    _id: u64,
    _compiled: &Compiled,
    _url: &Url,
) -> Result<(), String> {
    Err("request blocking is built for macOS only".into())
}

/// The shared path of every tab-opening command: validate (including DNS), then open.
async fn open_url_as_tab<R: Runtime>(
    app: &AppHandle<R>,
    input: String,
    radar: Option<(String, u16)>,
    typed: bool,
) -> Outcome {
    let vetter = app.clone();
    let radar_for_vet = radar.clone();
    let vetted = tauri::async_runtime::spawn_blocking(move || {
        vetter
            .state::<Host>()
            .vet(radar_for_vet.as_ref(), &input, typed)
    })
    .await;
    match vetted {
        Ok(Ok(url)) => match open_vetted_tab(app, url, radar).await {
            Ok(tab) => Outcome::opened(tab),
            Err(reason) => Outcome::denied(reason),
        },
        Ok(Err(denial)) => Outcome::denied(denial.as_str()),
        Err(_) => Outcome::denied("unparseable"),
    }
}

// ---------------------------------------------------------------------------------------------
// Commands (chrome window only)
// ---------------------------------------------------------------------------------------------

/// `typed` is an address the person typed; `port_radar` is a confirmed port-radar request.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpenIntent {
    Typed,
    PortRadar,
}

fn tab_id_arg(text: &str) -> Result<u64, Refusal> {
    parse_tab_id(text).ok_or_else(|| refusal("bad_tab", "That tab does not exist."))
}

fn known_tab<R: Runtime>(
    app: &AppHandle<R>,
    text: &str,
) -> Result<(u64, WebviewWindow<R>), Refusal> {
    let id = tab_id_arg(text)?;
    let host = app.state::<Host>();
    if host.tab_info(id).is_none() {
        return Err(refusal("bad_tab", "That tab does not exist."));
    }
    let window = app
        .get_webview_window(&tab_label(id))
        .ok_or_else(|| refusal("bad_tab", "That tab does not exist."))?;
    Ok((id, window))
}

#[tauri::command]
pub async fn open_tab<R: Runtime>(
    window: WebviewWindow<R>,
    url: String,
    intent: OpenIntent,
) -> Result<Outcome, Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle().clone();
    if !url_text_ok(&url) {
        return Ok(Outcome::denied("unparseable"));
    }
    match intent {
        OpenIntent::Typed => Ok(open_url_as_tab(&app, url, None, true).await),
        OpenIntent::PortRadar => {
            // Only a URL the main Phoenix window asked for, once, after the chrome's confirmation.
            let host = app.state::<Host>();
            let Some(origin) = port_radar_origin(&url, host.core_port) else {
                return Ok(Outcome::denied("private_network"));
            };
            if !host.take_radar_request(&url) {
                return Ok(Outcome::denied("not_requested"));
            }
            Ok(open_url_as_tab(&app, url.trim().to_string(), Some(origin), true).await)
        }
    }
}

#[tauri::command]
pub fn close_tab<R: Runtime>(window: WebviewWindow<R>, tab_id: String) -> Result<(), Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle();
    let (_, tab) = known_tab(app, &tab_id)?;
    tab.destroy()
        .map_err(|_| refusal("failed", "The tab could not be closed."))?;
    // The `Destroyed` window event does the same; the runtime may deliver it late (or, under the
    // mock runtime, not at all), and this call is idempotent.
    tab_gone(app, id_of(&tab_id));
    Ok(())
}

fn id_of(text: &str) -> u64 {
    parse_tab_id(text).unwrap_or(0)
}

#[tauri::command]
pub fn activate_tab<R: Runtime>(window: WebviewWindow<R>, tab_id: String) -> Result<(), Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle();
    let (id, _) = known_tab(app, &tab_id)?;
    app.state::<Host>().inner.lock().active = Some(id);
    apply_active(app);
    Ok(())
}

#[tauri::command]
pub async fn navigate<R: Runtime>(
    window: WebviewWindow<R>,
    tab_id: String,
    url: String,
    intent: OpenIntent,
) -> Result<Outcome, Refusal> {
    chrome_only(&window)?;
    // The chrome navigates a tab only by typed address; a port-radar open always makes a new tab.
    if intent != OpenIntent::Typed {
        return Err(refusal(
            "bad_intent",
            "Only a typed address can be used here.",
        ));
    }
    let app = window.app_handle().clone();
    let (id, tab) = known_tab(&app, &tab_id)?;
    let radar = app
        .state::<Host>()
        .inner
        .lock()
        .tabs
        .get(&id)
        .and_then(|t| t.radar.clone());
    let vetter = app.clone();
    let vetted = tauri::async_runtime::spawn_blocking(move || {
        vetter.state::<Host>().vet(radar.as_ref(), &url, true)
    })
    .await
    .map_err(|_| refusal("failed", "The address could not be checked."))?;
    match vetted {
        Err(denial) => Ok(Outcome::denied(denial.as_str())),
        Ok(target) => {
            tab.navigate(target)
                .map_err(|_| refusal("failed", "The tab could not navigate."))?;
            let info = app.state::<Host>().tab_info(id).ok_or_else(forbidden)?;
            Ok(Outcome::opened(info))
        }
    }
}

fn history_step<R: Runtime>(
    window: &WebviewWindow<R>,
    tab_id: &str,
    back: bool,
) -> Result<TabInfo, Refusal> {
    chrome_only(window)?;
    let app = window.app_handle();
    let (id, tab) = known_tab(app, tab_id)?;
    let host = app.state::<Host>();
    {
        let mut inner = host.inner.lock();
        let Some(t) = inner.tabs.get_mut(&id) else {
            return Err(refusal("bad_tab", "That tab does not exist."));
        };
        let moved = if back {
            t.history.request_back()
        } else {
            t.history.request_forward()
        };
        if !moved {
            return Ok(info(id, t));
        }
    }
    // `history.back()` is the page-visible API; it runs in the content page's own context only
    // to step the session history, with no data in or out.
    let _ = tab.eval(if back {
        "history.back()"
    } else {
        "history.forward()"
    });
    host.tab_info(id)
        .ok_or_else(|| refusal("bad_tab", "That tab does not exist."))
}

#[tauri::command]
pub fn back<R: Runtime>(window: WebviewWindow<R>, tab_id: String) -> Result<TabInfo, Refusal> {
    history_step(&window, &tab_id, true)
}

#[tauri::command]
pub fn forward<R: Runtime>(window: WebviewWindow<R>, tab_id: String) -> Result<TabInfo, Refusal> {
    history_step(&window, &tab_id, false)
}

#[tauri::command]
pub fn reload<R: Runtime>(window: WebviewWindow<R>, tab_id: String) -> Result<TabInfo, Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle();
    let (id, tab) = known_tab(app, &tab_id)?;
    tab.reload()
        .map_err(|_| refusal("failed", "The tab could not reload."))?;
    app.state::<Host>()
        .tab_info(id)
        .ok_or_else(|| refusal("bad_tab", "That tab does not exist."))
}

#[tauri::command]
pub fn zoom<R: Runtime>(
    window: WebviewWindow<R>,
    tab_id: String,
    factor: f64,
) -> Result<f64, Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle();
    let (id, tab) = known_tab(app, &tab_id)?;
    let host = app.state::<Host>();
    let (applied, snapshot) = host
        .set_zoom(id, factor)
        .ok_or_else(|| refusal("bad_tab", "That tab does not exist."))?;
    let _ = tab.set_zoom(applied);
    emit_tab(app, &snapshot);
    Ok(applied)
}

#[tauri::command]
pub fn set_chrome_height<R: Runtime>(window: WebviewWindow<R>, height: f64) -> Result<(), Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle();
    app.state::<Host>().inner.lock().chrome_height = clamp_chrome_height(height);
    relayout(app);
    Ok(())
}

#[tauri::command]
pub async fn set_site_shields<R: Runtime>(
    window: WebviewWindow<R>,
    site: String,
    blocking: bool,
) -> Result<(), Refusal> {
    chrome_only(&window)?;
    let site = site.trim().to_lowercase();
    if !valid_site(&site) {
        return Err(refusal("bad_site", "That is not a site name."));
    }
    let app = window.app_handle().clone();
    app.state::<Host>().set_override(&site, blocking);
    if app.state::<Host>().platform_blocking() {
        reapply_shields(&app).await;
    }
    Ok(())
}

/// Recompiles the rules (from Core, with the local overrides) and attaches them to every open tab.
async fn reapply_shields<R: Runtime>(app: &AppHandle<R>) {
    let h = app.clone();
    let Ok(compiled) =
        tauri::async_runtime::spawn_blocking(move || h.state::<Host>().shields(true)).await
    else {
        return;
    };
    for id in app.state::<Host>().tab_ids() {
        if let Some(win) = app.get_webview_window(&tab_label(id)) {
            let _ = reattach(&win, &compiled);
        }
    }
}

#[cfg(target_os = "macos")]
fn reattach<R: Runtime>(window: &WebviewWindow<R>, compiled: &Compiled) -> tauri::Result<()> {
    let json = compiled.json.clone();
    let id = compiled.id.clone();
    window.with_webview(move |platform| {
        crate::browser_native::attach_rules(platform.controller(), &id, &json, Arc::new(|_| {}));
    })
}

#[cfg(not(target_os = "macos"))]
fn reattach<R: Runtime>(_window: &WebviewWindow<R>, _compiled: &Compiled) -> tauri::Result<()> {
    Ok(())
}

/// What the compiled shields currently are, for the chrome's "why is nothing blocked" text.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShieldsStatus {
    pub platform_blocking: bool,
    pub source: &'static str,
    pub report: Option<RulesReport>,
    pub attach_error: Option<String>,
}

#[tauri::command]
pub fn shields_status<R: Runtime>(window: WebviewWindow<R>) -> Result<ShieldsStatus, Refusal> {
    chrome_only(&window)?;
    let host = window.app_handle().state::<Host>();
    let inner = host.inner.lock();
    let compiled = inner.shields.compiled.as_ref().map(|(_, c)| c);
    Ok(ShieldsStatus {
        platform_blocking: host.platform_blocking(),
        source: compiled.map_or("none", |c| c.source),
        report: compiled.map(|c| c.report.clone()),
        attach_error: inner.shields.attach.clone(),
    })
}

/// Phase 80: the port radar asks the Phoenix browser to open a loopback dev server. It opens
/// nothing: it records the request, shows the chrome window and tells the chrome page, which asks
/// the person; only the chrome's confirmation (`open_tab` with `port_radar`) opens a tab, once.
/// Called for a `phoenix://browser/open?url=…` link (see `lib::open_links`); there is deliberately no
/// Tauri command for it, so no web page and no pet window can ask the browser to open anything.
pub fn request_open_from_port_radar<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
) -> Result<(), Refusal> {
    let host = app.state::<Host>();
    let Some(url) = host.request_radar_open(url) else {
        return Err(refusal(
            "not_allowed",
            "Only a loopback address with a port that is not Phoenix's own can be opened here.",
        ));
    };
    show(app).map_err(|_| refusal("failed", "The Phoenix browser could not be opened."))?;
    let _ = app.emit_to(
        CHROME_LABEL,
        OPEN_REQUEST_EVENT,
        json!({ "url": url, "source": "port_radar" }),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    struct Fakes {
        dns: Arc<Mutex<HashMap<String, Vec<IpAddr>>>>,
        lookups: Arc<AtomicUsize>,
        folder: Arc<Mutex<Option<PathBuf>>>,
        dialogs: Arc<AtomicUsize>,
    }

    fn host() -> (Host, Fakes) {
        let dns: Arc<Mutex<HashMap<String, Vec<IpAddr>>>> = Arc::default();
        let lookups = Arc::new(AtomicUsize::new(0));
        let folder: Arc<Mutex<Option<PathBuf>>> = Arc::default();
        let dialogs = Arc::new(AtomicUsize::new(0));
        let (d, l, f, n) = (
            dns.clone(),
            lookups.clone(),
            folder.clone(),
            dialogs.clone(),
        );
        let hooks = Hooks {
            resolve: Arc::new(move |name| {
                l.fetch_add(1, Ordering::SeqCst);
                d.lock().get(name).cloned().ok_or(())
            }),
            pick_folder: Arc::new(move |_| {
                n.fetch_add(1, Ordering::SeqCst);
                f.lock().clone()
            }),
            shields: Arc::new(ShieldsInput::default),
        };
        (
            Host::new(hooks, false, 4870),
            Fakes {
                dns,
                lookups,
                folder,
                dialogs,
            },
        )
    }

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn a_public_name_that_resolves_to_a_private_address_is_refused() {
        let (h, f) = host();
        f.dns.lock().insert(
            "rebind.test".into(),
            vec![ip("93.184.216.34"), ip("127.0.0.1")],
        );
        f.dns
            .lock()
            .insert("meta.test".into(), vec![ip("169.254.169.254")]);
        f.dns
            .lock()
            .insert("v6.test".into(), vec![ip("::ffff:10.0.0.1")]);
        f.dns.lock().insert(
            "ok.test".into(),
            vec![ip("93.184.216.34"), ip("2606:4700::1111")],
        );
        for name in ["rebind.test", "meta.test", "v6.test"] {
            assert_eq!(
                h.judge(None, &u(&format!("https://{name}/"))),
                Nav::Deny(Denial::DnsPrivate),
                "{name}"
            );
        }
        assert_eq!(h.judge(None, &u("https://ok.test/")), Nav::Allow);
        // A name that does not resolve fails closed instead of letting the webview resolve it.
        assert_eq!(
            h.judge(None, &u("https://nxdomain.test/")),
            Nav::Deny(Denial::DnsFailed)
        );
    }

    #[test]
    fn dns_answers_are_cached_briefly_and_per_loopback_mode() {
        let (h, f) = host();
        f.dns
            .lock()
            .insert("ok.test".into(), vec![ip("93.184.216.34")]);
        h.judge(None, &u("https://ok.test/a"));
        h.judge(None, &u("https://ok.test/b"));
        assert_eq!(f.lookups.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn http_is_upgraded_by_cancel_and_navigate_and_ip_literals_skip_dns() {
        let (h, f) = host();
        assert_eq!(
            h.judge(None, &u("http://example.com:8080/x")),
            Nav::Upgrade("https://example.com:8080/x".into())
        );
        assert_eq!(
            f.lookups.load(Ordering::SeqCst),
            0,
            "an upgrade resolves nothing yet"
        );
        assert_eq!(h.judge(None, &u("https://8.8.8.8/")), Nav::Allow);
        assert_eq!(
            h.judge(None, &u("https://127.0.0.1/")),
            Nav::Deny(Denial::PrivateNetwork)
        );
        assert_eq!(
            h.judge(None, &u("file:///etc/passwd")),
            Nav::Deny(Denial::FileBlocked)
        );
        assert_eq!(h.judge(None, &u("about:blank")), Nav::Allow);
        assert_eq!(
            h.judge(None, &u("about:config")),
            Nav::Deny(Denial::DangerousScheme)
        );
        assert_eq!(
            h.judge(None, &u("javascript:alert(1)")),
            Nav::Deny(Denial::DangerousScheme)
        );
        assert_eq!(f.lookups.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_radar_tab_may_stay_on_its_dev_server_and_nowhere_else_private() {
        let (h, f) = host();
        f.dns
            .lock()
            .insert("localhost".into(), vec![ip("127.0.0.1"), ip("::1")]);
        let origin = ("localhost".to_string(), 3000u16);
        assert_eq!(
            h.judge_with(Some(&origin), &u("http://localhost:3000/app")),
            Nav::Allow
        );
        // Another port, another private host, and Core itself stay refused for the same tab.
        for bad in [
            "http://localhost:3001/",
            "http://127.0.0.1:3000/",
            "http://localhost:4870/",
            "http://192.168.1.1/",
        ] {
            assert_eq!(
                h.judge_with(Some(&origin), &u(bad)),
                Nav::Deny(Denial::PrivateNetwork),
                "{bad}"
            );
        }
        // A tab with no radar origin cannot reach it at all.
        assert_eq!(
            h.judge_with(None, &u("http://localhost:3000/")),
            Nav::Deny(Denial::PrivateNetwork)
        );
        // `localhost` that does not resolve to loopback (hosts file tampering) is refused.
        f.dns
            .lock()
            .insert("localhost".into(), vec![ip("10.0.0.9")]);
        let (h2, f2) = host();
        f2.dns
            .lock()
            .insert("localhost".into(), vec![ip("10.0.0.9")]);
        assert_eq!(
            h2.judge_with(Some(&origin), &u("http://localhost:3000/")),
            Nav::Deny(Denial::DnsPrivate)
        );
    }

    #[test]
    fn a_typed_address_is_validated_with_dns_and_the_same_rules() {
        let (h, f) = host();
        f.dns
            .lock()
            .insert("ok.test".into(), vec![ip("93.184.216.34")]);
        f.dns
            .lock()
            .insert("evil.test".into(), vec![ip("192.168.0.1")]);
        assert_eq!(
            h.vet(None, "https://ok.test/", true).unwrap().as_str(),
            "https://ok.test/"
        );
        assert_eq!(
            h.vet(None, "http://ok.test/", true).unwrap().as_str(),
            "https://ok.test/"
        );
        assert_eq!(
            h.vet(None, "https://evil.test/", true),
            Err(Denial::DnsPrivate)
        );
        assert_eq!(
            h.vet(None, "http://localhost:3000/", true),
            Err(Denial::PrivateNetwork)
        );
        assert_eq!(h.vet(None, "", true), Err(Denial::Unparseable));
        assert_eq!(
            h.vet(None, "https://ok.test/\n", true),
            Err(Denial::Unparseable)
        );
        assert_eq!(
            h.vet(None, &format!("https://ok.test/{}", "a".repeat(3000)), true),
            Err(Denial::Unparseable)
        );
        assert_eq!(
            h.vet(None, "https://user:pw@ok.test/", true),
            Err(Denial::CredentialsInUrl)
        );
    }

    #[test]
    fn permissions_are_allowed_only_for_a_granted_pair_and_never_default() {
        let (h, _) = host();
        let a = h.add_tab("https://example.com/page", None).unwrap();
        for kind in [
            "microphone",
            "camera",
            "geolocation",
            "notifications",
            "midi",
            "sensors",
            "autoplay",
            "pointer-lock",
            "other",
            "display-capture",
        ] {
            assert_eq!(h.permission(a, kind), PermissionResponse::Deny, "{kind}");
        }
        assert_eq!(h.permission(999, "microphone"), PermissionResponse::Deny);
        assert!(h.grant_permission("https://example.com", "microphone"));
        assert_eq!(h.permission(a, "microphone"), PermissionResponse::Allow);
        assert_eq!(h.permission(a, "camera"), PermissionResponse::Deny);
        // A grant for the origin never covers a different origin or a never-grantable kind.
        let b = h.add_tab("https://www.example.com/", None).unwrap();
        assert_eq!(h.permission(b, "microphone"), PermissionResponse::Deny);
        assert!(!h.grant_permission("https://example.com", "display-capture"));
        assert_eq!(h.permission(a, "display-capture"), PermissionResponse::Deny);
        // A grant on a private origin is never recorded.
        let c = h.add_tab("https://localhost/", None).unwrap();
        assert!(!h.grant_permission("https://localhost", "camera"));
        assert_eq!(h.permission(c, "camera"), PermissionResponse::Deny);
        h.reset();
        assert_eq!(h.permission(a, "microphone"), PermissionResponse::Deny);
    }

    #[test]
    fn a_download_is_refused_until_the_person_picks_a_folder() {
        let (h, f) = host();
        f.dns
            .lock()
            .insert("ok.test".into(), vec![ip("93.184.216.34")]);
        let url = u("https://ok.test/file.zip");
        assert_eq!(
            h.download_destination(None, &url, "file.zip"),
            Err("cancelled")
        );
        assert_eq!(f.dialogs.load(Ordering::SeqCst), 1);
        let dir = tempfile::tempdir().unwrap();
        *f.folder.lock() = Some(dir.path().to_path_buf());
        std::fs::write(dir.path().join("file.zip"), b"x").unwrap();
        let chosen = h
            .download_destination(None, &url, "../../file.zip")
            .unwrap();
        assert_eq!(chosen, dir.path().join("file (2).zip"));
        // A relative folder from the dialog is refused; a refused navigation never opens a dialog.
        *f.folder.lock() = Some(PathBuf::from("relative"));
        assert_eq!(
            h.download_destination(None, &url, "a.zip"),
            Err("bad_folder")
        );
        let before = f.dialogs.load(Ordering::SeqCst);
        assert_eq!(
            h.download_destination(None, &u("file:///etc/passwd"), "x"),
            Err("scheme_not_allowed")
        );
        assert_eq!(
            h.download_destination(None, &u("https://127.0.0.1/x"), "x"),
            Err("private_network")
        );
        assert_eq!(f.dialogs.load(Ordering::SeqCst), before);
        // Dialog spam is bounded.
        assert_eq!(
            h.download_destination(None, &url, "a.zip"),
            Err("too_many_downloads")
        );
    }

    #[test]
    fn popups_open_only_as_policy_checked_https_tabs_and_are_rate_limited() {
        let (h, _) = host();
        let a = h.add_tab("https://example.com/", None).unwrap();
        assert_eq!(
            h.popup_target(a, &u("https://other.test/x"))
                .unwrap()
                .as_str(),
            "https://other.test/x"
        );
        assert_eq!(
            h.popup_target(a, &u("http://other.test/x"))
                .unwrap()
                .as_str(),
            "https://other.test/x"
        );
        for bad in [
            "http://localhost:4870/",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://u:p@x.test/",
        ] {
            assert_eq!(h.popup_target(a, &u(bad)), None, "{bad}");
        }
        // Three allowed in ten seconds (refused ones do not count): the third is the last.
        assert!(h.popup_target(a, &u("https://third.test/")).is_some());
        assert_eq!(h.popup_target(a, &u("https://fourth.test/")), None);
    }

    #[test]
    fn tabs_are_numbered_bounded_and_the_next_active_one_is_the_neighbour() {
        let (h, _) = host();
        let ids: Vec<u64> = (0..MAX_TABS)
            .map(|i| h.add_tab(&format!("https://t{i}.test/"), None).unwrap())
            .collect();
        assert_eq!(ids, (1..=MAX_TABS as u64).collect::<Vec<_>>());
        assert_eq!(h.add_tab("https://one.too.many/", None), None);
        h.inner.lock().active = Some(5);
        assert_eq!(h.remove_tab(5), Some(Some(4)));
        assert_eq!(h.remove_tab(5), None);
        h.inner.lock().active = Some(1);
        assert_eq!(h.remove_tab(1), Some(Some(2)));
        assert!(
            h.add_tab("https://again.test/", None).unwrap() > MAX_TABS as u64,
            "ids are never reused"
        );
    }

    #[test]
    fn a_radar_request_is_recorded_once_and_only_for_a_dev_server() {
        let (h, _) = host();
        assert_eq!(
            h.request_radar_open("http://localhost:3000/").as_deref(),
            Some("http://localhost:3000/")
        );
        assert_eq!(
            h.request_radar_open("http://localhost:4870/"),
            None,
            "Core's own port"
        );
        assert_eq!(h.request_radar_open("http://example.com:3000/"), None);
        assert_eq!(h.pending_radar_urls(), ["http://localhost:3000/"]);
        assert!(!h.take_radar_request("http://localhost:3001/"));
        assert!(h.take_radar_request("http://localhost:3000/"));
        assert!(!h.take_radar_request("http://localhost:3000/"), "once");
    }

    #[test]
    fn only_a_host_name_is_a_site() {
        assert!(valid_site("example.com") && valid_site("a-b.example.co.uk"));
        for bad in [
            "",
            "http://x.test",
            "x.test/",
            "x test",
            "*.x.test",
            "x.test:80",
            "[::1]",
            ".x",
            "x..y",
            "é.test",
        ] {
            assert!(!valid_site(bad), "{bad}");
        }
    }

    #[test]
    fn shields_use_lists_else_starter_rules_and_the_switch_keeps_the_private_block() {
        let on = ShieldsInput {
            enabled: true,
            ..ShieldsInput::default()
        };
        let starter = compile_shields(&on, 4870);
        assert_eq!(starter.source, "starter");
        assert!(starter.report.kept_blocking > 0);
        let lists = compile_shields(
            &ShieldsInput {
                enabled: true,
                lists: vec!["||ads.test^\n! c".into()],
                ..ShieldsInput::default()
            },
            4870,
        );
        assert_eq!(lists.source, "lists");
        assert_eq!(lists.report.kept_blocking, 1);
        assert_ne!(lists.id, starter.id);
        let off = compile_shields(
            &ShieldsInput {
                enabled: false,
                lists: vec!["||ads.test^".into()],
                ..ShieldsInput::default()
            },
            4870,
        );
        assert_eq!(off.source, "off");
        assert_eq!(off.report.kept_blocking, 0);
        assert!(
            off.report.fixed_rules > 0,
            "the private-network block never switches off"
        );
        let exempt = compile_shields(
            &ShieldsInput {
                enabled: true,
                lists: vec!["||ads.test^".into()],
                off_sites: vec!["Off.Test".into()],
                exempt_hosts: vec!["www.youtube.com".into()],
                ..ShieldsInput::default()
            },
            4870,
        );
        assert_eq!(exempt.report.site_exemptions, 2);
        assert!(
            exempt.json.contains("\"*off.test\"") && exempt.json.contains("\"www.youtube.com\"")
        );
    }

    #[test]
    fn the_tab_events_carry_only_text_fields_and_cap_their_length() {
        let (h, _) = host();
        let id = h.add_tab("https://example.com/", None).unwrap();
        let tab = h.set_title(id, &"t\u{0}itle".repeat(200)).unwrap();
        assert!(tab.title.chars().count() <= 300 && !tab.title.contains('\u{0}'));
        let json = serde_json::to_value(&tab).unwrap();
        let mut keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "blocked",
                "canGoBack",
                "canGoForward",
                "loading",
                "tabId",
                "title",
                "url",
                "zoom"
            ]
        );
        assert_eq!(json["tabId"], "1");
        let (applied, _) = h.set_zoom(id, 99.0).unwrap();
        assert_eq!(applied, 3.0);
    }
}

#[cfg(test)]
mod capability_tests {
    use serde_json::Value;
    use std::path::Path;

    fn read_json(path: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn capabilities() -> Vec<(String, Value)> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "json") {
                out.push((
                    path.file_name().unwrap().to_string_lossy().into_owned(),
                    read_json(&path),
                ));
            }
        }
        out
    }

    const COMMANDS: [&str; 12] = [
        "open-tab",
        "close-tab",
        "activate-tab",
        "navigate",
        "back",
        "forward",
        "reload",
        "zoom",
        "set-chrome-height",
        "set-site-shields",
        "shields-status",
        "open-in-phoenix-browser",
    ];

    fn windows(cap: &Value) -> Vec<String> {
        cap["windows"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|w| w.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn only_the_chrome_window_is_granted_browser_commands() {
        let caps = capabilities();
        let browser = caps
            .iter()
            .find(|(n, _)| n == "browser.json")
            .expect("browser.json exists");
        assert_eq!(windows(&browser.1), ["phoenix-browser"]);
        assert_eq!(browser.1["local"], true);
        assert!(
            browser.1.get("remote").is_none(),
            "the chrome page is local; no remote origin"
        );
        assert!(browser.1.get("webviews").is_none());
        let perms: Vec<&str> = browser.1["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap())
            .collect();
        for p in &perms {
            assert!(*p == "core:default" || p.starts_with("allow-"), "{p}");
        }
        // No other capability may grant a browser command to anyone.
        for (name, cap) in &caps {
            if name == "browser.json" {
                continue;
            }
            let text = cap.to_string();
            for command in COMMANDS {
                assert!(
                    !text.contains(&format!("allow-{command}")),
                    "{name} grants {command}"
                );
            }
        }
    }

    #[test]
    fn content_webviews_have_no_capability_and_no_web_origin_is_listed_anywhere() {
        for (name, cap) in capabilities() {
            for window in windows(&cap) {
                assert!(
                    !window.starts_with("phoenix-browser-tab") && !window.contains('*'),
                    "{name} lists {window}"
                );
                if name != "browser.json" {
                    assert_ne!(window, "phoenix-browser", "{name}");
                }
            }
            assert!(
                cap.get("webviews").is_none(),
                "{name}: capabilities by webview label are not used"
            );
            if let Some(remote) = cap.get("remote") {
                for url in remote["urls"].as_array().into_iter().flatten() {
                    let url = url.as_str().unwrap();
                    // Only the exact loopback pill page (Core's own origin) is a remote origin.
                    assert!(
                        url.starts_with("http://127.0.0.1:") && url.ends_with("/pill.html"),
                        "{name}: {url}"
                    );
                    assert!(!url.contains('*'), "{name}: {url}");
                }
            }
        }
        // The runtime capability the shell adds names only the pill window.
        let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
            .unwrap();
        assert_eq!(lib.matches("add_capability").count(), 1);
        assert!(!lib.contains("phoenix-browser-tab") || !lib.contains(".window(\"phoenix-browser"));
    }

    #[test]
    fn the_config_adds_no_capability_and_the_chrome_csp_stays_local() {
        let conf = read_json(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"));
        assert!(conf["app"]["security"].get("capabilities").is_none());
        assert!(conf["app"]["security"]
            .get("dangerousDisableAssetCspModification")
            .is_none());
        let csp = conf["app"]["security"]["csp"].as_str().unwrap();
        assert!(!csp.contains("https:") && !csp.contains('*') || csp.contains("127.0.0.1:*"));
    }

    #[test]
    fn every_browser_command_checks_the_caller_as_its_first_statement() {
        let source =
            std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/browser.rs"))
                .unwrap();
        let production = source.split("#[cfg(test)]").next().unwrap();
        let mut seen = Vec::new();
        for (i, _) in production.match_indices("#[tauri::command]") {
            let rest = &production[i..];
            let name = rest
                .split("fn ")
                .nth(1)
                .unwrap()
                .split(['<', '('])
                .next()
                .unwrap()
                .to_string();
            let body = rest.split(" {\n").nth(1).unwrap().trim_start();
            assert!(
                body.starts_with("chrome_only(&window)?;")
                    || body.starts_with("history_step(&window"),
                "{name} does not check its caller first: {}",
                body.lines().next().unwrap()
            );
            seen.push(name);
        }
        assert_eq!(seen.len(), 11, "{seen:?}");
        // The commands registered in lib.rs are exactly these.
        let lib = std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"))
            .unwrap();
        for name in &seen {
            assert!(
                lib.contains(&format!("browser::{name}")),
                "{name} not registered"
            );
        }
    }
}
