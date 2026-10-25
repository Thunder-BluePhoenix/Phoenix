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
use crate::browser_extensions::{self, ScriptSource};
use crate::browser_page::{
    self as page, ActionOutcome, ActionReply, ActionRequest, Plan, ScriptFail, SnapshotOutcome,
};
use crate::browser_policy::{
    classify_host, classify_ip, decide_navigation, host_matches_site, registrable_domain, Decision,
    Denial, HostClass, Intent, Policy, SitePermissions,
};
use crate::browser_profiles::{self, StoreError};
use crate::browser_rules::{
    self, Exemption, Options as RuleOptions, RulesReport, WEBKIT_RULE_LIMIT,
};
use crate::connection::{connection, Locator};
use crate::core_status::{call_capped, Method};
use crate::shortcuts::Refusal;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, HashMap, HashSet};
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
pub use crate::browser_profiles::{CoreProfiles, ProfileStore};

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
/// Longest wait for a page to answer one script.
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(page::SCRIPT_TIMEOUT_SECS);
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
/// Runs a script in the content window with this label and returns the raw callback string.
/// `None` means "not faked": the real `eval_with_callback` path runs.
pub type ScriptRunner = Arc<dyn Fn(&str, &str) -> Option<String> + Send + Sync>;

/// Everything that touches the machine; tests replace it with fakes (`Builder::manage(hooks)`).
#[derive(Clone)]
pub struct Hooks {
    /// Resolves a host name to its addresses.
    pub resolve: Resolver,
    /// Shows a Phoenix folder dialog; `None` is cancel or "cannot be shown".
    pub pick_folder: Picker,
    /// Reads the shields settings and list text from Core.
    pub shields: ShieldsSource,
    /// Phase 96: where a profile's web data lives (and is deleted from).
    pub profiles: ProfileStore,
    /// Phase 96: which approved content scripts Core allows for (profile id, origin) right now.
    /// `Err` means "inject nothing".
    pub scripts: ScriptSource,
    /// Phase 96: what Core says about profiles (does it exist, which deletions are pending).
    pub core_profiles: CoreProfiles,
    /// Phase 95 test seam: answers `page_snapshot` / `page_action` scripts (window label, script)
    /// with the raw callback string. `None` (and `Hooks::system`) runs the real eval path.
    pub script_runner: Option<ScriptRunner>,
}

impl Hooks {
    /// The real app: system DNS, the native folder dialog, Phoenix Core over loopback.
    pub fn system(locator: Locator, profiles_root: PathBuf) -> Self {
        Hooks {
            resolve: Arc::new(system_resolve),
            pick_folder: Arc::new(crate::browser_native::pick_folder),
            shields: Arc::new({
                let locator = locator.clone();
                move || read_shields_from_core(&locator)
            }),
            profiles: ProfileStore::new(profiles_root),
            core_profiles: CoreProfiles::from_core(locator.clone()),
            scripts: browser_extensions::core_source(locator),
            script_runner: None,
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
    /// Phase 96: the stored profile this tab belongs to; `None` is a private (incognito) tab.
    profile: Option<String>,
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
    /// Profiles whose data is being deleted right now: no tab may open in them.
    purging: HashSet<String>,
    /// Tabs being opened per profile (counted from `add_tab_in` until the window exists), so a
    /// purge never starts while a window is still being built in that profile.
    opening: HashMap<String, usize>,
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
    /// The stored profile the tab belongs to; `null` for a private tab.
    pub profile_id: Option<String>,
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
        profile_id: tab.profile.clone(),
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
                purging: HashSet::new(),
                opening: HashMap::new(),
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
    #[cfg(test)]
    fn add_tab(&self, url: &str, radar: Option<(String, u16)>) -> Option<u64> {
        self.add_tab_in(url, radar, None).ok()
    }

    /// [`Host::add_tab`] for a tab that may belong to a stored profile. `profile_busy` while that
    /// profile's data is being deleted.
    fn add_tab_in(
        &self,
        url: &str,
        radar: Option<(String, u16)>,
        profile: Option<String>,
    ) -> Result<u64, &'static str> {
        let mut inner = self.inner.lock();
        if profile.as_ref().is_some_and(|p| inner.purging.contains(p)) {
            return Err("profile_busy");
        }
        if inner.tabs.len() >= MAX_TABS {
            return Err("too_many_tabs");
        }
        let id = inner.next_id;
        inner.next_id += 1;
        if let Some(p) = &profile {
            *inner.opening.entry(p.clone()).or_insert(0) += 1;
        }
        inner.tabs.insert(
            id,
            Tab {
                url: url.to_string(),
                title: String::new(),
                loading: true,
                history: History::default(),
                zoom: 1.0,
                radar,
                profile,
            },
        );
        Ok(id)
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
        inner.opening.clear();
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
    profile: Option<(String, PathBuf)>,
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
        .shadow(false);
    // A private tab is untrusted and leaves nothing: a store dropped with the webview, no folder on
    // disk. A profile tab (Phase 96, opened only because the person chose that profile) gets ITS
    // OWN persistent store: `data_directory` on Windows and Linux, a `WKWebsiteDataStore`
    // identifier on macOS 14+ (wry ignores the directory there). Either way no initialization
    // script of ours, and no developer tools.
    let builder = match profile {
        Some((profile_id, dir)) => {
            let mut b = builder.incognito(false).data_directory(dir);
            if let Some(store) = browser_profiles::store_identifier(&profile_id) {
                b = b.data_store_identifier(store);
            }
            b
        }
        None => builder.incognito(true),
    };
    let builder = builder
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
                    // A popup stays in the profile of the tab that opened it.
                    let opener_profile = host.tab_profile(id);
                    tauri::async_runtime::spawn(async move {
                        let _ =
                            open_url_as_tab(&app, target.to_string(), None, false, opener_profile)
                                .await;
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
            if matches!(payload.event(), PageLoadEvent::Finished) {
                inject_content_scripts(&started, id, payload.url());
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
    profile: Option<String>,
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
    // Phase 96: a profile tab is registered FIRST (so a purge that starts later sees it and
    // answers "busy"), then Core is asked whether the profile still exists (a purge only ever
    // starts after Core removed the profile, so a removed profile is refused here), and only then
    // does its directory come into existence, because the person opened a tab in it.
    let id = host.add_tab_in(url.as_str(), radar, profile.clone())?;
    let _opening = OpenGuard::new(app, profile.clone());
    let profile_dir = match &profile {
        Some(profile_id) => match prepare_profile(app, profile_id).await {
            Ok(dir) => Some(dir),
            Err(reason) => {
                host.remove_tab(id);
                return Err(reason);
            }
        },
        None => None,
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
        let _ = tx.send(
            build_tab_window(&builder_app, id, first, profile.clone().zip(profile_dir)).map(|_| ()),
        );
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
    profile: Option<String>,
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
        Ok(Ok(url)) => match open_vetted_tab(app, url, radar, profile).await {
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
    profile_id: Option<String>,
) -> Result<Outcome, Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle().clone();
    if !url_text_ok(&url) {
        return Ok(Outcome::denied("unparseable"));
    }
    // `private` (any case) and no profile both mean an incognito tab; anything else must be a
    // plain profile id. A port-radar tab is always private.
    let profile = match profile_id.as_deref() {
        None => None,
        Some(p) if p.eq_ignore_ascii_case(browser_profiles::PRIVATE) => None,
        Some(p) if browser_profiles::valid_profile_id(p) => Some(p.to_string()),
        Some(_) => return Ok(Outcome::denied("profile_invalid")),
    };
    match intent {
        OpenIntent::Typed => Ok(open_url_as_tab(&app, url, None, true, profile).await),
        OpenIntent::PortRadar => {
            // Only a URL the main Phoenix window asked for, once, after the chrome's confirmation.
            let host = app.state::<Host>();
            let Some(origin) = port_radar_origin(&url, host.core_port) else {
                return Ok(Outcome::denied("private_network"));
            };
            if !host.take_radar_request(&url) {
                return Ok(Outcome::denied("not_requested"));
            }
            if profile.is_some() {
                return Ok(Outcome::denied("profile_invalid"));
            }
            Ok(open_url_as_tab(&app, url.trim().to_string(), Some(origin), true, None).await)
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

// ---------------------------------------------------------------------------------------------
// Phase 95: read the ACTIVE tab and act on it (chrome window only; Core's relay drives these)
// ---------------------------------------------------------------------------------------------

/// The active tab as the host tracks it: id, URL and title are the HOST's values, not the page's.
fn active_tab<R: Runtime>(app: &AppHandle<R>) -> Option<(u64, TabInfo)> {
    let host = app.state::<Host>();
    let inner = host.inner.lock();
    let id = inner.active?;
    inner.tabs.get(&id).map(|t| (id, info(id, t)))
}

/// Runs `script` in tab `id`'s content window and returns what the page answered. Blocks (at most
/// `timeout`): call off the main thread. The test runner answers first; `None` there, and always
/// in the real app, evaluates in the webview and waits on a one-shot channel.
fn run_script<R: Runtime>(
    app: &AppHandle<R>,
    id: u64,
    script: &str,
    timeout: Duration,
) -> Result<String, ScriptFail> {
    let label = tab_label(id);
    if let Some(runner) = &app.state::<Host>().hooks.script_runner {
        if let Some(raw) = runner(&label, script) {
            return Ok(raw);
        }
    }
    let window = app.get_webview_window(&label).ok_or(ScriptFail::Failed)?;
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    // The callback may fire more than once or after we gave up: the sender is taken exactly once.
    let slot = Mutex::new(Some(tx));
    window
        .eval_with_callback(script, move |raw| {
            if let Some(tx) = slot.lock().take() {
                let _ = tx.send(raw);
            }
        })
        .map_err(|_| ScriptFail::Failed)?;
    rx.recv_timeout(timeout).map_err(|_| ScriptFail::Timeout)
}

/// The same tab is still active and still on `url` (compared without the fragment).
fn still_on<R: Runtime>(app: &AppHandle<R>, id: u64, url: &str) -> bool {
    active_tab(app).is_some_and(|(now, tab)| now == id && page::same_page(&tab.url, url))
}

fn snapshot_blocking<R: Runtime>(app: &AppHandle<R>, timeout: Duration) -> SnapshotOutcome {
    let Some((id, start)) = active_tab(app) else {
        return SnapshotOutcome::refused("no_active_tab");
    };
    if !page::is_web_url(&start.url) {
        return SnapshotOutcome::refused("not_a_web_page");
    }
    let raw = match run_script(app, id, page::SNAPSHOT_SCRIPT, timeout) {
        Ok(raw) => raw,
        Err(fail) => return SnapshotOutcome::refused(fail.reason()),
    };
    let reply = match page::parse_snapshot(&raw) {
        Ok(reply) => reply,
        Err(reason) => return SnapshotOutcome::refused(reason),
    };
    drop(raw);
    // The page that answered must be the page the host said was open, before and after.
    let Some((now, end)) = active_tab(app) else {
        return SnapshotOutcome::refused("page_changed");
    };
    if now != id || end.url != start.url || !page::same_page(&reply.href, &start.url) {
        return SnapshotOutcome::refused("page_changed");
    }
    let (html, cut) = page::cap_html(reply.html);
    SnapshotOutcome::Page(page::PageSnapshot {
        ok: true,
        tab_id: end.tab_id,
        url: end.url,
        title: end.title,
        html,
        truncated: reply.truncated || cut,
    })
}

/// The scripted kinds: the page must still be the approved one, asked once more right before the
/// action script (which cannot take the URL as an input), and again by that script itself.
fn script_action_blocking<R: Runtime>(
    app: &AppHandle<R>,
    id: u64,
    expected: &str,
    script: &str,
    timeout: Duration,
) -> ActionOutcome {
    let asked = match run_script(app, id, page::URL_SCRIPT, timeout) {
        Ok(raw) => page::parse_action(&raw),
        Err(fail) => return ActionOutcome::refused(fail.reason()),
    };
    match asked {
        ActionReply::Done { href } if page::same_page(&href, expected) => {}
        ActionReply::Done { .. } => return ActionOutcome::refused("page_changed"),
        ActionReply::Refused(reason) => return ActionOutcome::refused(reason),
    }
    if !still_on(app, id, expected) {
        return ActionOutcome::refused("page_changed");
    }
    let reply = match run_script(app, id, script, timeout) {
        Ok(raw) => page::parse_action(&raw),
        Err(fail) => return ActionOutcome::refused(fail.reason()),
    };
    match reply {
        ActionReply::Done { href } if page::same_page(&href, expected) => {
            let url = active_tab(app)
                .map(|(_, tab)| tab.url)
                .unwrap_or_else(|| expected.to_string());
            ActionOutcome::done(url)
        }
        ActionReply::Done { .. } => ActionOutcome::refused("page_changed"),
        ActionReply::Refused(reason) => ActionOutcome::refused(reason),
    }
}

/// `navigate` kind: the same vetting as the `navigate` command (typed intent, DNS included).
fn navigate_action_blocking<R: Runtime>(
    app: &AppHandle<R>,
    id: u64,
    expected: &str,
    destination: &str,
) -> ActionOutcome {
    let host = app.state::<Host>();
    let radar = host
        .inner
        .lock()
        .tabs
        .get(&id)
        .and_then(|t| t.radar.clone());
    let target = match host.vet(radar.as_ref(), destination, true) {
        Ok(target) => target,
        Err(denial) => return ActionOutcome::refused(denial.as_str()),
    };
    // Vetting waited on DNS: the page the person approved must still be the one open.
    if !still_on(app, id, expected) {
        return ActionOutcome::refused("page_changed");
    }
    let Some(window) = app.get_webview_window(&tab_label(id)) else {
        return ActionOutcome::refused("no_active_tab");
    };
    if window.navigate(target.clone()).is_err() {
        return ActionOutcome::refused("failed");
    }
    ActionOutcome::done(target.as_str().chars().take(2048).collect())
}

fn action_blocking<R: Runtime>(
    app: &AppHandle<R>,
    request: &ActionRequest,
    timeout: Duration,
) -> ActionOutcome {
    // Every field is validated before the tab is touched, and before any script exists.
    let plan = match page::plan(request) {
        Ok(plan) => plan,
        Err(reason) => return ActionOutcome::refused(reason),
    };
    let expected = request.expected_url.as_str();
    let Some((id, tab)) = active_tab(app) else {
        return ActionOutcome::refused("no_active_tab");
    };
    if !page::same_page(&tab.url, expected) {
        return ActionOutcome::refused("page_changed");
    }
    match plan {
        Plan::Script { script } => script_action_blocking(app, id, expected, &script, timeout),
        Plan::Navigate { destination } => navigate_action_blocking(app, id, expected, &destination),
    }
}

async fn snapshot_active<R: Runtime>(app: AppHandle<R>, timeout: Duration) -> SnapshotOutcome {
    tauri::async_runtime::spawn_blocking(move || snapshot_blocking(&app, timeout))
        .await
        .unwrap_or(SnapshotOutcome::refused("failed"))
}

async fn act_on_active<R: Runtime>(
    app: AppHandle<R>,
    request: ActionRequest,
    timeout: Duration,
) -> ActionOutcome {
    tauri::async_runtime::spawn_blocking(move || action_blocking(&app, &request, timeout))
        .await
        .unwrap_or(ActionOutcome::refused("failed"))
}

/// The active tab's page, as markup (at most 4 MiB), for the assistant to read. Resolves with
/// `{ok:false, reason}` for every refusal.
#[tauri::command]
pub async fn page_snapshot<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<SnapshotOutcome, Refusal> {
    chrome_only(&window)?;
    Ok(snapshot_active(window.app_handle().clone(), SCRIPT_TIMEOUT).await)
}

/// One user-approved action on the ACTIVE tab (the approval itself happened in Core). Takes no tab
/// id: `expected_url` says which page the person approved, and a different page refuses.
#[tauri::command]
pub async fn page_action<R: Runtime>(
    window: WebviewWindow<R>,
    kind: String,
    selector: Option<String>,
    text: Option<String>,
    destination: Option<String>,
    expected_url: String,
) -> Result<ActionOutcome, Refusal> {
    chrome_only(&window)?;
    let request = ActionRequest {
        kind,
        selector,
        text,
        destination,
        expected_url,
    };
    Ok(act_on_active(window.app_handle().clone(), request, SCRIPT_TIMEOUT).await)
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

// ---------------------------------------------------------------------------------------------
// Phase 96: profile tabs, content scripts and the purge of a deleted profile's data
// ---------------------------------------------------------------------------------------------

/// Counts a profile tab as "being opened" until its window exists (or failed), so a purge that
/// starts meanwhile answers `busy` instead of deleting a directory a window is about to use.
struct OpenGuard<R: Runtime> {
    app: AppHandle<R>,
    profile: Option<String>,
}

impl<R: Runtime> OpenGuard<R> {
    fn new(app: &AppHandle<R>, profile: Option<String>) -> Self {
        OpenGuard {
            app: app.clone(),
            profile,
        }
    }
}

impl<R: Runtime> Drop for OpenGuard<R> {
    fn drop(&mut self) {
        if let (Some(profile), Some(host)) = (&self.profile, self.app.try_state::<Host>()) {
            host.finish_opening(profile);
        }
    }
}

impl Host {
    /// The stored profile a tab belongs to; `None` for a private tab or an unknown tab.
    fn tab_profile(&self, id: u64) -> Option<String> {
        self.inner
            .lock()
            .tabs
            .get(&id)
            .and_then(|t| t.profile.clone())
    }

    fn finish_opening(&self, profile: &str) {
        let mut inner = self.inner.lock();
        if let Some(n) = inner.opening.get_mut(profile) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                inner.opening.remove(profile);
            }
        }
    }

    /// Marks the profile as being deleted and returns its open tabs. From here `add_tab_in` refuses
    /// the profile (`profile_busy`). `Err` when a purge of it already runs or a window of it is
    /// still being built.
    pub fn begin_purge(&self, profile: &str) -> Result<Vec<u64>, &'static str> {
        let mut inner = self.inner.lock();
        if inner.purging.contains(profile) || inner.opening.get(profile).is_some_and(|n| *n > 0) {
            return Err("busy");
        }
        inner.purging.insert(profile.to_string());
        Ok(inner
            .tabs
            .iter()
            .filter(|(_, t)| t.profile.as_deref() == Some(profile))
            .map(|(id, _)| *id)
            .collect())
    }

    pub fn end_purge(&self, profile: &str) {
        self.inner.lock().purging.remove(profile);
    }
}

/// Core must still have the profile, and must not have it queued for deletion; the answer comes
/// from Core, never from the page. `Err` is the reason code the chrome shows.
async fn prepare_profile<R: Runtime>(
    app: &AppHandle<R>,
    profile: &str,
) -> Result<PathBuf, &'static str> {
    if !browser_profiles::store_supported() {
        return Err("profile_unsupported");
    }
    let worker = app.clone();
    let id = profile.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let host = worker.state::<Host>();
        match (host.hooks.core_profiles.known)(&id) {
            Ok(true) => {}
            Ok(false) => return Err("profile_invalid"),
            Err(()) => return Err("profile_failed"),
        }
        match (host.hooks.core_profiles.pending_purges)() {
            Ok(pending) if !pending.contains(&id) => {}
            Ok(_) => return Err("profile_busy"),
            Err(()) => return Err("profile_failed"),
        }
        host.hooks.profiles.prepare(&id).map_err(|e| match e {
            StoreError::InvalidId => "profile_invalid",
            _ => "profile_failed",
        })
    })
    .await
    .map_err(|_| "profile_failed")?
}

/// After a profile tab's page finished loading: asks Core (see `browser_extensions`) and, only if
/// every check passes, evaluates the approved scripts in that tab. Never blocks the caller.
fn inject_content_scripts<R: Runtime>(app: &AppHandle<R>, id: u64, loaded: &Url) {
    let Some(host) = app.try_state::<Host>() else {
        return;
    };
    let Some(profile) = host.tab_profile(id) else {
        return; // a private tab never gets a script
    };
    let source = host.hooks.scripts.clone();
    let (app, loaded) = (app.clone(), loaded.clone());
    std::thread::spawn(move || {
        let Some(window) = app.get_webview_window(&tab_label(id)) else {
            return;
        };
        let current = || window.url().ok();
        if let Some(program) = browser_extensions::plan(Some(&profile), &loaded, &current, &source)
        {
            let _ = window.eval(program);
        }
    });
}

/// What `purge_profile_data` reports.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PurgeReport {
    pub closed_tabs: usize,
    pub data_removed: bool,
}

/// Phase 96: deletes the web data of a profile Core has removed. Chrome window only. Core must
/// list the id as a pending deletion (so a bug or a hostile chrome page cannot erase a live
/// profile), the profile's tabs are closed first, and the directory goes through
/// [`ProfileStore::purge`] (canonical path strictly inside the profiles root, no symlinks).
#[tauri::command]
pub async fn purge_profile_data<R: Runtime>(
    window: WebviewWindow<R>,
    profile_id: String,
) -> Result<PurgeReport, Refusal> {
    chrome_only(&window)?;
    let app = window.app_handle().clone();
    if !browser_profiles::valid_profile_id(&profile_id) {
        return Err(refusal("bad_profile", "That is not a profile id."));
    }
    purge_profile(&app, &profile_id).await
}

async fn purge_profile<R: Runtime>(
    app: &AppHandle<R>,
    profile: &str,
) -> Result<PurgeReport, Refusal> {
    let host = app.state::<Host>();
    let ask = host.hooks.core_profiles.pending_purges.clone();
    let pending = tauri::async_runtime::spawn_blocking(move || ask())
        .await
        .map_err(|_| refusal("purge_failed", "Phoenix Core could not be asked."))?;
    match pending {
        Ok(list) if list.iter().any(|p| p == profile) => {}
        Ok(_) => {
            return Err(refusal(
                "bad_profile",
                "Phoenix Core has no pending deletion for that profile.",
            ))
        }
        Err(()) => return Err(refusal("purge_failed", "Phoenix Core could not be asked.")),
    }
    let tabs = host
        .begin_purge(profile)
        .map_err(|_| refusal("busy", "That profile is being opened or deleted."))?;
    let result = run_purge(app, profile, tabs).await;
    host.end_purge(profile);
    result
}

async fn run_purge<R: Runtime>(
    app: &AppHandle<R>,
    profile: &str,
    tabs: Vec<u64>,
) -> Result<PurgeReport, Refusal> {
    for id in &tabs {
        if let Some(win) = app.get_webview_window(&tab_label(*id)) {
            let _ = win.destroy();
        }
        tab_gone(app, *id);
    }
    let mut removed = remove_native_store(app, profile).await?;
    let worker = app.clone();
    let id = profile.to_string();
    // A window that was just destroyed may keep its files open for a moment (WebView2 on Windows):
    // try a few times before giving up. The deletion stays pending in Core and is retried later.
    let files = tauri::async_runtime::spawn_blocking(move || {
        let host = worker.state::<Host>();
        let mut last = Err(StoreError::Io(std::io::ErrorKind::Other));
        for attempt in 0..5 {
            last = host.hooks.profiles.purge(&id);
            if last.is_ok() {
                break;
            }
            if attempt < 4 {
                std::thread::sleep(Duration::from_millis(300));
            }
        }
        last
    })
    .await
    .map_err(|_| refusal("purge_failed", "The profile data could not be deleted."))?;
    match files {
        Ok(deleted) => removed |= deleted,
        Err(_) => {
            return Err(refusal(
                "purge_failed",
                "The profile data could not be deleted.",
            ))
        }
    }
    Ok(PurgeReport {
        closed_tabs: tabs.len(),
        data_removed: removed,
    })
}

/// macOS 14+: the profile's `WKWebsiteDataStore`. Deleting it fails while a webview uses it, so a
/// few attempts are made after the tabs were closed. Other platforms keep everything in the
/// profile directory. The mock runtime has no native stores (`native` is false there).
#[cfg(target_vendor = "apple")]
async fn remove_native_store<R: Runtime>(
    app: &AppHandle<R>,
    profile: &str,
) -> Result<bool, Refusal> {
    if !app.state::<Host>().native || !browser_profiles::store_supported() {
        return Ok(false);
    }
    let Some(uuid) = browser_profiles::store_identifier(profile) else {
        return Ok(false);
    };
    let failed = || refusal("purge_failed", "The profile data could not be deleted.");
    let known = app
        .fetch_data_store_identifiers()
        .await
        .map_err(|_| failed())?;
    if !known.contains(&uuid) {
        return Ok(false);
    }
    for attempt in 0..5 {
        match app.remove_data_store(uuid).await {
            Ok(()) => return Ok(true),
            Err(_) if attempt < 4 => {
                let _ = tauri::async_runtime::spawn_blocking(|| {
                    std::thread::sleep(Duration::from_millis(300))
                })
                .await;
            }
            Err(_) => return Err(failed()),
        }
    }
    Err(failed())
}

#[cfg(not(target_vendor = "apple"))]
async fn remove_native_store<R: Runtime>(
    _app: &AppHandle<R>,
    _profile: &str,
) -> Result<bool, Refusal> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    pub(super) fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    pub(super) struct Fakes {
        pub(super) dns: Arc<Mutex<HashMap<String, Vec<IpAddr>>>>,
        lookups: Arc<AtomicUsize>,
        folder: Arc<Mutex<Option<PathBuf>>>,
        dialogs: Arc<AtomicUsize>,
    }

    pub(super) fn host() -> (Host, Fakes) {
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
            profiles: ProfileStore::new(
                std::env::temp_dir().join("phoenix-unit-never-used-profiles"),
            ),
            core_profiles: CoreProfiles::fixed(vec![], Arc::default()),
            scripts: Arc::new(|_, _| Err(())),
            script_runner: None,
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
                "profileId",
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

    #[test]
    fn a_purge_blocks_new_tabs_in_that_profile_only_and_waits_for_a_window_being_built() {
        let (h, _) = host();
        let url = "https://example.com/";
        let a = h.add_tab_in(url, None, Some("alpha".into())).unwrap();
        let b = h.add_tab_in(url, None, Some("beta".into())).unwrap();
        let private = h.add_tab_in(url, None, None).unwrap();
        // The windows of both profile tabs are still being built: a purge says busy.
        assert_eq!(h.begin_purge("alpha"), Err("busy"));
        h.finish_opening("alpha");
        h.finish_opening("beta");
        // Only that profile's tabs are returned; a private tab never is.
        assert_eq!(h.begin_purge("alpha"), Ok(vec![a]));
        assert_eq!(h.begin_purge("alpha"), Err("busy"), "one purge at a time");
        assert_eq!(
            h.add_tab_in(url, None, Some("alpha".into())),
            Err("profile_busy")
        );
        assert!(h.add_tab_in(url, None, Some("beta".into())).is_ok());
        assert!(h.add_tab_in(url, None, None).is_ok());
        h.end_purge("alpha");
        assert!(h.add_tab_in(url, None, Some("alpha".into())).is_ok());
        assert_eq!(h.tab_profile(b).as_deref(), Some("beta"));
        assert_eq!(h.tab_profile(private), None);
        assert_eq!(h.tab_info(a).unwrap().profile_id.as_deref(), Some("alpha"));
        assert_eq!(h.tab_info(private).unwrap().profile_id, None);
    }
}

/// Phase 95: `page_snapshot` and `page_action` against the mock runtime with the script-runner
/// fake. The fake answers instead of a webview, so these prove the host's checks and decoding,
/// NOT what the fixed scripts do on a real page.
#[cfg(test)]
mod page_tests {
    use super::tests::{host, ip};
    use super::*;
    use std::collections::VecDeque;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::App;

    const SHORT: Duration = Duration::from_millis(200);
    const PAGE: &str = "https://example.com/a";

    type Calls = Arc<Mutex<Vec<(String, String)>>>;
    type Replies = Arc<Mutex<VecDeque<Option<String>>>>;
    type Effect = Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>;

    struct Rig {
        app: App<MockRuntime>,
        calls: Calls,
        replies: Replies,
        effect: Effect,
        dns: Arc<Mutex<HashMap<String, Vec<IpAddr>>>>,
    }

    impl Rig {
        fn handle(&self) -> AppHandle<MockRuntime> {
            self.app.handle().clone()
        }
        fn reply(&self, raw: &str) {
            self.replies.lock().push_back(Some(raw.to_string()));
        }
        fn real_path(&self) {
            self.replies.lock().push_back(None);
        }
        fn scripts(&self) -> Vec<String> {
            self.calls.lock().iter().map(|(_, s)| s.clone()).collect()
        }
        /// A tab as the host tracks it (no window), made active.
        fn tab(&self, url: &str) -> u64 {
            let host = self.app.state::<Host>();
            let id = host.add_tab(url, None).unwrap();
            host.inner.lock().active = Some(id);
            id
        }
        /// A tab WITH a (mock) content window, made active.
        fn window_tab(&self, url: &str) -> u64 {
            let id = self.tab(url);
            WebviewWindowBuilder::new(
                &self.app,
                tab_label(id),
                WebviewUrl::External(Url::parse(url).unwrap()),
            )
            .build()
            .unwrap();
            id
        }
    }

    fn rig() -> Rig {
        let calls: Calls = Arc::default();
        let replies: Replies = Arc::default();
        let effect: Effect = Arc::default();
        let (mut host, fakes) = host();
        let (c, r, e) = (calls.clone(), replies.clone(), effect.clone());
        host.hooks.script_runner = Some(Arc::new(move |label: &str, script: &str| {
            c.lock().push((label.to_string(), script.to_string()));
            if let Some(run) = e.lock().take() {
                run();
            }
            r.lock().pop_front().unwrap_or(Some("null".into()))
        }));
        let app = mock_app();
        app.manage(host);
        Rig {
            app,
            calls,
            replies,
            effect,
            dns: fakes.dns,
        }
    }

    fn snapshot_reply(href: &str, html: &str, cut: bool) -> String {
        let inner = serde_json::json!({"u": href, "h": html, "t": cut}).to_string();
        serde_json::to_string(&inner).unwrap()
    }

    fn ok_reply(href: &str) -> String {
        serde_json::to_string(&serde_json::json!({"ok": true, "u": href}).to_string()).unwrap()
    }

    fn fail_reply(reason: &str) -> String {
        serde_json::json!({"ok": false, "reason": reason}).to_string()
    }

    fn refused(reason: &'static str) -> SnapshotOutcome {
        SnapshotOutcome::refused(reason)
    }

    fn request(kind: &str, selector: Option<&str>, text: Option<&str>, url: &str) -> ActionRequest {
        ActionRequest {
            kind: kind.into(),
            selector: selector.map(str::to_string),
            text: text.map(str::to_string),
            destination: None,
            expected_url: url.into(),
        }
    }

    fn act(rig: &Rig, req: &ActionRequest) -> ActionOutcome {
        action_blocking(&rig.handle(), req, SHORT)
    }

    #[test]
    fn a_snapshot_returns_the_hosts_url_and_title_and_the_pages_markup() {
        let rig = rig();
        let id = rig.window_tab(PAGE);
        rig.app.state::<Host>().set_title(id, "Host title").unwrap();
        rig.reply(&snapshot_reply(
            "https://example.com/a#section",
            "<p>hi</p>",
            false,
        ));
        let out = snapshot_blocking(&rig.handle(), SHORT);
        assert_eq!(
            out,
            SnapshotOutcome::Page(page::PageSnapshot {
                ok: true,
                tab_id: "1".into(),
                url: PAGE.into(),
                title: "Host title".into(),
                html: "<p>hi</p>".into(),
                truncated: false,
            })
        );
        assert_eq!(
            *rig.calls.lock(),
            [(
                "phoenix-browser-tab-1".to_string(),
                page::SNAPSHOT_SCRIPT.to_string()
            )]
        );
        let json = serde_json::to_value(&out).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["tabId"], "1");
        assert_eq!(json["truncated"], false);
    }

    #[test]
    fn markup_over_four_mebibytes_is_cut_and_flagged() {
        let rig = rig();
        rig.tab(PAGE);
        let html = "é".repeat(page::MAX_HTML_CHARS + 10);
        rig.reply(&snapshot_reply(PAGE, &html, false));
        let SnapshotOutcome::Page(snap) = snapshot_blocking(&rig.handle(), SHORT) else {
            panic!("refused");
        };
        assert!(snap.truncated, "Rust re-capped what the script did not");
        assert_eq!(snap.html.chars().count(), page::MAX_HTML_CHARS);
        // The script's own flag is passed on.
        rig.reply(&snapshot_reply(PAGE, "<p>cut by the script</p>", true));
        let SnapshotOutcome::Page(snap) = snapshot_blocking(&rig.handle(), SHORT) else {
            panic!("refused");
        };
        assert!(snap.truncated);
        // Exactly 4 MiB is not truncated.
        rig.reply(&snapshot_reply(
            PAGE,
            &"a".repeat(page::MAX_HTML_CHARS),
            false,
        ));
        let SnapshotOutcome::Page(snap) = snapshot_blocking(&rig.handle(), SHORT) else {
            panic!("refused");
        };
        assert!(!snap.truncated);
    }

    #[test]
    fn a_snapshot_is_refused_with_a_reason_and_never_runs_a_script_without_a_web_page() {
        let rig = rig();
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("no_active_tab")
        );
        let id = rig.tab("about:blank");
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("not_a_web_page")
        );
        rig.app
            .state::<Host>()
            .inner
            .lock()
            .tabs
            .get_mut(&id)
            .unwrap()
            .url = "file:///etc/passwd".into();
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("not_a_web_page")
        );
        assert!(rig.calls.lock().is_empty(), "no script ran");
    }

    #[test]
    fn a_snapshot_of_a_page_that_changed_is_refused() {
        let rig = rig();
        let id = rig.tab(PAGE);
        // The page that answered is not the page the host has open.
        rig.reply(&snapshot_reply("https://evil.test/", "<p>x</p>", false));
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("page_changed")
        );
        // Same page, other query: still another page.
        rig.reply(&snapshot_reply(
            "https://example.com/a?q=1",
            "<p>x</p>",
            false,
        ));
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("page_changed")
        );
        // The host's URL moved while the script ran.
        let handle = rig.handle();
        *rig.effect.lock() = Some(Box::new(move || {
            handle
                .state::<Host>()
                .page_started(id, "https://example.com/b")
                .unwrap();
        }));
        rig.reply(&snapshot_reply(PAGE, "<p>x</p>", false));
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("page_changed")
        );
        // The active tab changed while the script ran.
        rig.app
            .state::<Host>()
            .inner
            .lock()
            .tabs
            .get_mut(&id)
            .unwrap()
            .url = PAGE.into();
        let handle = rig.handle();
        *rig.effect.lock() = Some(Box::new(move || {
            let host = handle.state::<Host>();
            let other = host.add_tab(PAGE, None).unwrap();
            host.inner.lock().active = Some(other);
        }));
        rig.reply(&snapshot_reply(PAGE, "<p>x</p>", false));
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("page_changed")
        );
        // A fragment-only difference is the same page.
        rig.app.state::<Host>().inner.lock().active = Some(id);
        rig.reply(&snapshot_reply(
            "https://example.com/a#x",
            "<p>x</p>",
            false,
        ));
        assert!(matches!(
            snapshot_blocking(&rig.handle(), SHORT),
            SnapshotOutcome::Page(_)
        ));
    }

    #[test]
    fn a_bad_or_oversized_snapshot_reply_is_failed_or_too_large() {
        let rig = rig();
        rig.tab(PAGE);
        for junk in [
            "",
            "null",
            "\"oops\"",
            "{}",
            "{\"ok\":false,\"reason\":\"failed\"}",
        ] {
            rig.reply(junk);
            assert_eq!(
                snapshot_blocking(&rig.handle(), SHORT),
                refused("failed"),
                "{junk}"
            );
        }
        rig.reply(&"x".repeat(page::MAX_RAW_REPLY + 1));
        assert_eq!(
            snapshot_blocking(&rig.handle(), SHORT),
            refused("too_large")
        );
    }

    #[test]
    fn a_page_that_never_answers_times_out() {
        let rig = rig();
        rig.window_tab(PAGE);
        // `None` is the real path: the mock webview evaluates and never calls back.
        rig.real_path();
        assert_eq!(snapshot_blocking(&rig.handle(), SHORT), refused("timeout"));
        rig.real_path();
        let req = request("click", Some("button#go"), None, PAGE);
        assert_eq!(act(&rig, &req), ActionOutcome::refused("timeout"));
        // The real path without a window is a plain failure, not a hang.
        let rig = self::rig();
        rig.tab(PAGE);
        rig.real_path();
        assert_eq!(snapshot_blocking(&rig.handle(), SHORT), refused("failed"));
    }

    #[test]
    fn each_scripted_action_runs_its_fixed_script_after_confirming_the_page() {
        let cases = [
            ("click", Some("button#go"), None, page::Kind::Click),
            (
                "download",
                Some("button[name=\"dl\"]"),
                None,
                page::Kind::Download,
            ),
            ("submit", Some("form#f"), None, page::Kind::Submit),
            (
                "type",
                Some("input#q"),
                Some("he said \"hi\" </script>"),
                page::Kind::Type,
            ),
        ];
        for (kind, selector, text, k) in cases {
            let rig = rig();
            rig.window_tab(PAGE);
            rig.reply(&ok_reply(PAGE));
            rig.reply(&ok_reply("https://example.com/a"));
            let out = act(
                &rig,
                &request(kind, selector, text, "https://example.com/a#frag"),
            );
            assert_eq!(out, ActionOutcome::done(PAGE.into()), "{kind}");
            let want = page::action_script(k, selector.unwrap(), text);
            assert_eq!(
                rig.scripts(),
                [page::URL_SCRIPT.to_string(), want],
                "{kind}"
            );
            assert!(rig
                .calls
                .lock()
                .iter()
                .all(|(l, _)| l == "phoenix-browser-tab-1"));
            let json = serde_json::to_string(&out).unwrap();
            assert!(
                !json.contains("hi") && !json.contains("script"),
                "text never echoed"
            );
        }
    }

    #[test]
    fn an_expected_url_that_is_not_the_active_page_is_refused_before_any_script() {
        let rig = rig();
        rig.window_tab(PAGE);
        for expected in [
            "https://example.com/b",
            "https://example.com/a?x=1",
            "http://example.com/a",
            "https://example.org/a",
        ] {
            let out = act(&rig, &request("click", Some("button#go"), None, expected));
            assert_eq!(out, ActionOutcome::refused("page_changed"), "{expected}");
        }
        let mut nav = request("navigate", None, None, "https://example.com/b");
        nav.destination = Some("https://example.org/".into());
        assert_eq!(act(&rig, &nav), ActionOutcome::refused("page_changed"));
        assert!(
            rig.calls.lock().is_empty(),
            "no script ran for a wrong page"
        );
        // The active tab changing makes the old approval stale too.
        let host = rig.app.state::<Host>();
        let other = host.add_tab("https://other.test/", None).unwrap();
        host.inner.lock().active = Some(other);
        let out = act(&rig, &request("click", Some("button#go"), None, PAGE));
        assert_eq!(out, ActionOutcome::refused("page_changed"));
        assert!(rig.calls.lock().is_empty());
    }

    #[test]
    fn a_page_that_moved_before_the_action_script_stops_the_action() {
        let rig = rig();
        rig.window_tab(PAGE);
        // The page's own href is not the approved page: the action script is never sent.
        rig.reply(&ok_reply("https://example.com/other"));
        let out = act(&rig, &request("click", Some("button#go"), None, PAGE));
        assert_eq!(out, ActionOutcome::refused("page_changed"));
        assert_eq!(rig.scripts(), [page::URL_SCRIPT.to_string()]);
        // The action script itself reports the page it started on.
        rig.reply(&ok_reply(PAGE));
        rig.reply(&ok_reply("https://example.com/other"));
        let out = act(&rig, &request("click", Some("button#go"), None, PAGE));
        assert_eq!(out, ActionOutcome::refused("page_changed"));
        // The host's URL moved after the page was asked.
        let handle = rig.handle();
        *rig.effect.lock() = Some(Box::new(move || {
            handle
                .state::<Host>()
                .page_started(1, "https://example.com/moved")
                .unwrap();
        }));
        rig.reply(&ok_reply(PAGE));
        let out = act(&rig, &request("click", Some("button#go"), None, PAGE));
        assert_eq!(out, ActionOutcome::refused("page_changed"));
    }

    #[test]
    fn the_pages_reasons_become_a_fixed_set_and_garbage_is_failed() {
        let rig = rig();
        rig.window_tab(PAGE);
        let req = request("click", Some("button#go"), None, PAGE);
        for (page_says, want) in [
            ("not_found", "not_found"),
            ("ambiguous", "ambiguous"),
            ("protected", "protected"),
            ("unsupported", "unsupported"),
            ("failed", "failed"),
            ("Error: secret text from the page", "failed"),
        ] {
            rig.reply(&ok_reply(PAGE));
            rig.reply(&fail_reply(page_says));
            assert_eq!(act(&rig, &req), ActionOutcome::refused(want), "{page_says}");
        }
        rig.reply(&ok_reply(PAGE));
        rig.reply("not json");
        assert_eq!(act(&rig, &req), ActionOutcome::refused("failed"));
        rig.reply(&ok_reply(PAGE));
        rig.reply("null");
        assert_eq!(act(&rig, &req), ActionOutcome::refused("failed"));
    }

    #[test]
    fn a_bad_request_is_refused_before_the_tab_or_any_script_is_touched() {
        let rig = rig();
        rig.window_tab(PAGE);
        let long = "x".repeat(page::MAX_TEXT_CHARS + 1);
        let hostile = [
            request("tap", Some("button#go"), None, PAGE),
            request("click", None, None, PAGE),
            request("click", Some("button:nth-of-type(2)"), None, PAGE),
            request("click", Some("button#go~1"), None, PAGE),
            request("submit", Some("form#f :unreported-controls"), None, PAGE),
            request("click", Some("button#go\"]"), None, PAGE),
            request("click", Some("button#a b"), None, PAGE),
            request("click", Some("div#go"), None, PAGE),
            request("click", Some("button#é"), None, PAGE),
            request("click", Some("button#go"), Some("x"), PAGE),
            request("type", Some("input#q"), None, PAGE),
            request("type", Some("input#q"), Some(&long), PAGE),
            request("click", Some("button#go"), None, "file:///etc/passwd"),
            request("click", Some("button#go"), None, ""),
        ];
        let want = [
            "bad_kind",
            "bad_selector",
            "bad_selector",
            "bad_selector",
            "bad_selector",
            "bad_selector",
            "bad_selector",
            "bad_selector",
            "bad_selector",
            "bad_text",
            "bad_text",
            "bad_text",
            "bad_url",
            "bad_url",
        ];
        for (req, reason) in hostile.iter().zip(want) {
            assert_eq!(
                act(&rig, req),
                ActionOutcome::refused(reason),
                "{}",
                req.kind
            );
        }
        assert!(
            rig.calls.lock().is_empty(),
            "no script ran for a refused request"
        );
        // No tab at all.
        let empty = self::rig();
        let out = act(&empty, &request("click", Some("button#go"), None, PAGE));
        assert_eq!(out, ActionOutcome::refused("no_active_tab"));
    }

    #[test]
    fn navigate_uses_the_navigate_commands_vetting_and_resolves_denials() {
        let rig = rig();
        rig.dns
            .lock()
            .insert("example.org".into(), vec![ip("93.184.216.34")]);
        rig.dns
            .lock()
            .insert("rebind.test".into(), vec![ip("127.0.0.1")]);
        rig.window_tab(PAGE);
        let go = |destination: &str| {
            let mut r = request("navigate", None, None, PAGE);
            r.destination = Some(destination.into());
            act(&rig, &r)
        };
        for (destination, reason) in [
            ("http://localhost:3000/", "private_network"),
            ("https://127.0.0.1/", "private_network"),
            ("file:///etc/passwd", "file_blocked"),
            ("javascript:alert(1)", "dangerous_scheme"),
            ("https://user:pw@example.org/", "credentials_in_url"),
            ("https://rebind.test/", "dns_private"),
            ("https://nxdomain.test/", "dns_failed"),
            ("ftp://example.org/", "scheme_not_allowed"),
        ] {
            assert_eq!(
                go(destination),
                ActionOutcome::refused(reason),
                "{destination}"
            );
        }
        assert_eq!(
            go("https://example.org/next"),
            ActionOutcome::done("https://example.org/next".into())
        );
        assert!(rig.calls.lock().is_empty(), "navigate runs no script");
        // A denial is a resolved value with the denial id.
        let json = serde_json::to_value(go("http://localhost/")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"ok": false, "reason": "private_network"})
        );
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

    const COMMANDS: [&str; 15] = [
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
        "page-snapshot",
        "page-action",
        "purge-profile-data",
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
        let production = source.split("\n#[cfg(test)]\nmod ").next().unwrap();
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
        assert_eq!(seen.len(), 14, "{seen:?}");
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
