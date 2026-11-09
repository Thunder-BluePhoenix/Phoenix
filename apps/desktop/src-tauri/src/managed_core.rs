// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Managed Core (Phase 65, owner decision (1)): an OPT-IN mode in which the shell starts Core as its
//! own child process and hands it a per-launch consent secret over the child's stdin pipe.
//!
//! The separate `pnpm dev:core` workflow is untouched: without the opt-in nothing here runs, Core
//! is not announced as managed, never reads stdin, and keeps refusing token-only recording starts.
//!
//! Opt-in and command (read through the shell's environment lookup, never from the web page):
//!
//! * `PHOENIX_MANAGED_CORE=1` turns the mode on.
//! * `PHOENIX_MANAGED_CORE_ARGV` is the command as a JSON array of strings, for example
//!   `["node","--import","tsx","/path/to/core/runtime/src/main.ts"]`. It is executed directly
//!   (argv only, no shell, no string splitting). `PHOENIX_MANAGED_CORE_CWD` is an optional working
//!   directory (Core reads `config/<env>.json` from it).
//!
//! What the child gets: a CLEANED environment (a short allow-list, see [`PASS_ENV`]; everything
//! else, including cloud credentials and `LD_PRELOAD`/`NODE_OPTIONS`, is dropped) plus
//! `PHOENIX_MANAGED_CORE=stdin`, which only announces that a secret is on stdin. The secret is in
//! neither argv nor the environment nor a file. It is 32 bytes from the OS CSPRNG (`getrandom`),
//! hex encoded, written once to the child's stdin as `PHOENIX-CONSENT-V1 <hex>\n`. The shell keeps
//! the pipe open: if the shell dies, however it dies, the pipe closes and Core stops (Core treats
//! stdin ending as "the shell is gone"). The secret lives only in this process's memory and Core's;
//! it is wiped when dropped.
//!
//! The shell refuses to adopt a Core that is already running: if anything accepts a connection on
//! Core's port, the mode does not start (an adopted Core would not hold the secret).
//!
//! Restart policy (minimal): if the child exits while the shell runs, it is restarted at most
//! [`RestartPolicy::MAX_RESTARTS`] times within [`RestartPolicy::WINDOW`], 2 s apart, each time with
//! a NEW secret. After that the mode stays off until the shell restarts, and recording stays
//! refused. A restart is never silent for a recording: Core ends any recording when its link dies.
//!
//! Known residual risks (documented in the Phase 65 doc): another process of the same OS user can
//! read the secret where the OS exposes a child's pipe or memory (Linux `/proc/<pid>/fd/0` of the
//! child, a debugger, a same-user `ptrace`); the OS gives no protection against a same-user
//! process that can already read this process's memory. The mechanism removes the *token*-holder
//! (web page, script, agent that merely read `session.token`) from the consent path; it does not
//! defend against a full same-user compromise.
//!
//! Not run by the author: no real Core child, pipe or OS process was started by these tests; the
//! spawner is a fake and the pipe is a vector.

use crate::consent_dialog::{self, Ask, ConsentApi, Step};
use std::collections::VecDeque;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{compiler_fence, AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const ENV_OPT_IN: &str = "PHOENIX_MANAGED_CORE";
pub const ENV_ARGV: &str = "PHOENIX_MANAGED_CORE_ARGV";
pub const ENV_CWD: &str = "PHOENIX_MANAGED_CORE_CWD";
/// Set in the CHILD's environment: "the consent secret is on stdin". Carries no secret.
pub const ANNOUNCE_VALUE: &str = "stdin";
/// First token of the line written to the child's stdin.
pub const LINE_PREFIX: &str = "PHOENIX-CONSENT-V1";

/// The only variables the child inherits (when set). Nothing else crosses over.
pub const PASS_ENV: &[&str] = &[
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SYSTEMROOT",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_RUNTIME_DIR",
    "DBUS_SESSION_BUS_ADDRESS",
    "PHOENIX_PORT",
    "PHOENIX_DATA_DIR",
    "PHOENIX_ENV",
    "PHOENIX_LOG_LEVEL",
    "PHOENIX_WEB_ROOT",
    "PHOENIX_WHISPER_MODEL_PATH",
    "PHOENIX_PARAKEET_MODEL_DIR",
    "PHOENIX_SPEECH_ENGINES",
    "PHOENIX_VISION_MODEL",
];

const MAX_ARGV: usize = 32;
const MAX_ARG_BYTES: usize = 4096;
const CAPTURE_BYTES: usize = 8 * 1024;

fn wipe_bytes(buf: &mut [u8]) {
    for b in buf.iter_mut() {
        // SAFETY: `b` is a valid, aligned, exclusive reference to a byte.
        unsafe { std::ptr::write_volatile(b as *mut u8, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}

/// The per-launch consent secret. No `Clone`, no `Display`, redacted `Debug`, wiped on drop.
pub struct ConsentSecret {
    hex: String,
}

impl ConsentSecret {
    /// 32 bytes from the OS CSPRNG. Fails closed: no randomness, no managed mode.
    pub fn generate() -> Result<Self, getrandom::Error> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes)?;
        let secret = Self::from_bytes(&bytes);
        wipe_bytes(&mut bytes);
        Ok(secret)
    }

    fn from_bytes(bytes: &[u8; 32]) -> Self {
        const DIGITS: &[u8; 16] = b"0123456789abcdef";
        let mut hex = String::with_capacity(64);
        for b in bytes {
            hex.push(DIGITS[(b >> 4) as usize] as char);
            hex.push(DIGITS[(b & 15) as usize] as char);
        }
        Self { hex }
    }

    /// The hex text, for the one header the consent routes read. Callers must not log it.
    pub fn expose(&self) -> &str {
        &self.hex
    }

    /// The line for the pipe, itself wiped on drop.
    pub fn line(&self) -> SecretLine {
        SecretLine(format!("{LINE_PREFIX} {}\n", self.hex).into_bytes())
    }
}

impl Drop for ConsentSecret {
    fn drop(&mut self) {
        // SAFETY: only ASCII zero bytes are written, which keeps the string valid UTF-8.
        wipe_bytes(unsafe { self.hex.as_bytes_mut() });
    }
}

impl std::fmt::Debug for ConsentSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ConsentSecret(<redacted>)")
    }
}

/// The bytes written to the child's stdin. Wiped on drop.
pub struct SecretLine(Vec<u8>);

impl SecretLine {
    pub fn bytes(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for SecretLine {
    fn drop(&mut self) {
        wipe_bytes(&mut self.0);
    }
}

impl std::fmt::Debug for SecretLine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretLine(<redacted>)")
    }
}

/// Everything about the child process EXCEPT the secret.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpawnSpec {
    pub argv: Vec<String>,
    pub cwd: Option<PathBuf>,
    /// The complete environment of the child (nothing else is inherited).
    pub env: Vec<(String, String)>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpecError {
    NotRequested,
    NoArgv,
    BadArgv(&'static str),
}

impl SpecError {
    pub fn message(&self) -> &'static str {
        match self {
            SpecError::NotRequested => "managed Core is not requested",
            SpecError::NoArgv => "PHOENIX_MANAGED_CORE_ARGV is not set",
            SpecError::BadArgv(why) => why,
        }
    }
}

/// Builds the spawn spec from the environment lookup. `NotRequested` is the normal case (the
/// separate-Core workflow); anything else means the owner asked for the mode and it is misconfigured.
pub fn spec_from_env(get: impl Fn(&str) -> Option<String>) -> Result<SpawnSpec, SpecError> {
    if get(ENV_OPT_IN).as_deref() != Some("1") {
        return Err(SpecError::NotRequested);
    }
    let raw = get(ENV_ARGV)
        .filter(|a| !a.trim().is_empty())
        .ok_or(SpecError::NoArgv)?;
    let argv: Vec<String> = serde_json::from_str(&raw).map_err(|_| {
        SpecError::BadArgv("PHOENIX_MANAGED_CORE_ARGV must be a JSON array of strings")
    })?;
    if argv.is_empty() || argv.len() > MAX_ARGV {
        return Err(SpecError::BadArgv(
            "the Core command needs 1 to 32 arguments",
        ));
    }
    if argv
        .iter()
        .any(|a| a.is_empty() || a.len() > MAX_ARG_BYTES || a.contains('\0'))
    {
        return Err(SpecError::BadArgv(
            "a Core command argument is empty, too long or has a NUL",
        ));
    }
    let mut env: Vec<(String, String)> = PASS_ENV
        .iter()
        .filter_map(|name| get(name).map(|v| (name.to_string(), v)))
        .filter(|(_, v)| !v.contains('\0'))
        .collect();
    env.push((ENV_OPT_IN.to_string(), ANNOUNCE_VALUE.to_string()));
    Ok(SpawnSpec {
        argv,
        cwd: get(ENV_CWD)
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from),
        env,
    })
}

/// A started child. Dropping it must kill it.
pub trait CoreChild: Send {
    /// True once the process has ended (or can no longer be observed).
    fn exited(&mut self) -> bool;
    fn kill(&mut self);
    /// The most recent output (bounded), for the owner's diagnostics. Never contains the secret:
    /// Core never receives it as anything it logs.
    fn recent_output(&self) -> String;
}

pub trait Spawner: Send + Sync {
    /// Starts the child and writes `line` to its stdin, KEEPING the pipe open afterwards.
    fn spawn(&self, spec: &SpawnSpec, line: &SecretLine) -> io::Result<Box<dyn CoreChild>>;
}

/// A bounded tail of a stream (the last [`CAPTURE_BYTES`] bytes).
#[derive(Default)]
struct Tail(VecDeque<u8>);

impl Tail {
    fn push(&mut self, chunk: &[u8]) {
        self.0.extend(chunk.iter().copied());
        while self.0.len() > CAPTURE_BYTES {
            self.0.pop_front();
        }
    }
}

fn capture(mut stream: impl Read + Send + 'static, tail: Arc<Mutex<Tail>>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 2048];
        while let Ok(n) = stream.read(&mut buf) {
            if n == 0 {
                break;
            }
            if let Ok(mut t) = tail.lock() {
                t.push(&buf[..n]);
            }
        }
    });
}

pub struct SystemSpawner;

struct SystemChild {
    child: Child,
    /// Held open on purpose: closing it tells Core the shell is gone.
    _stdin: ChildStdin,
    out: Arc<Mutex<Tail>>,
    err: Arc<Mutex<Tail>>,
}

impl Spawner for SystemSpawner {
    fn spawn(&self, spec: &SpawnSpec, line: &SecretLine) -> io::Result<Box<dyn CoreChild>> {
        let (program, args) = spec
            .argv
            .split_first()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "empty command"))?;
        let mut command = Command::new(program);
        command
            .args(args)
            .env_clear()
            .envs(spec.env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(dir) = &spec.cwd {
            command.current_dir(dir);
        }
        let mut child = command.spawn()?;
        let (Some(mut stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            let _ = child.kill();
            return Err(io::Error::other("the child has no pipes"));
        };
        if let Err(err) = stdin.write_all(line.bytes()).and_then(|()| stdin.flush()) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(err);
        }
        let (out, err) = (
            Arc::new(Mutex::new(Tail::default())),
            Arc::new(Mutex::new(Tail::default())),
        );
        capture(stdout, out.clone());
        capture(stderr, err.clone());
        Ok(Box::new(SystemChild {
            child,
            _stdin: stdin,
            out,
            err,
        }))
    }
}

impl CoreChild for SystemChild {
    fn exited(&mut self) -> bool {
        !matches!(self.child.try_wait(), Ok(None))
    }
    fn kill(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
    fn recent_output(&self) -> String {
        let text = |tail: &Arc<Mutex<Tail>>| {
            tail.lock()
                .map(|t| {
                    String::from_utf8_lossy(&t.0.iter().copied().collect::<Vec<u8>>()).into_owned()
                })
                .unwrap_or_default()
        };
        format!("{}{}", text(&self.out), text(&self.err))
    }
}

impl Drop for SystemChild {
    fn drop(&mut self) {
        self.kill();
    }
}

/// At most [`Self::MAX_RESTARTS`] restarts within [`Self::WINDOW`].
#[derive(Debug, Default)]
pub struct RestartPolicy {
    restarts: Vec<Instant>,
}

impl RestartPolicy {
    pub const MAX_RESTARTS: usize = 3;
    pub const WINDOW: Duration = Duration::from_secs(10 * 60);
    pub const DELAY: Duration = Duration::from_secs(2);

    /// Records a restart and says whether it is allowed.
    pub fn allow(&mut self, now: Instant) -> bool {
        self.restarts
            .retain(|t| now.saturating_duration_since(*t) < Self::WINDOW);
        if self.restarts.len() >= Self::MAX_RESTARTS {
            return false;
        }
        self.restarts.push(now);
        true
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum State {
    Running,
    /// Waiting to restart.
    Backoff,
    /// Gave up (or never started); recording stays refused. The text is for the owner's console.
    Failed(String),
    Stopped,
}

/// True when something already accepts connections on Core's port.
pub type PortBusy = Box<dyn Fn() -> bool + Send>;

/// How often the consent list is polled (this is also the shell's heartbeat to Core).
pub const POLL_EVERY: Duration = Duration::from_secs(2);

pub struct Runner {
    spec: SpawnSpec,
    spawner: Arc<dyn Spawner>,
    api: Box<dyn ConsentApi>,
    ask: Ask,
    port_busy: PortBusy,
    policy: RestartPolicy,
    child: Option<Box<dyn CoreChild>>,
    secret: Option<ConsentSecret>,
    state: State,
    restart_at: Option<Instant>,
    last_poll: Option<Instant>,
    last_answered: Option<String>,
    started: bool,
    failure_reported: bool,
}

impl Runner {
    pub fn new(
        spec: SpawnSpec,
        spawner: Arc<dyn Spawner>,
        api: Box<dyn ConsentApi>,
        ask: Ask,
        port_busy: PortBusy,
    ) -> Self {
        Self {
            spec,
            spawner,
            api,
            ask,
            port_busy,
            policy: RestartPolicy::default(),
            child: None,
            secret: None,
            state: State::Stopped,
            restart_at: None,
            last_poll: None,
            last_answered: None,
            started: false,
            failure_reported: false,
        }
    }

    #[cfg(test)]
    pub fn state(&self) -> &State {
        &self.state
    }

    /// The reason the mode gave up, once, for the owner's console (never sent to a web page).
    pub fn take_failure(&mut self) -> Option<String> {
        match &self.state {
            State::Failed(why) if !self.failure_reported => {
                self.failure_reported = true;
                Some(why.clone())
            }
            _ => None,
        }
    }

    fn launch(&mut self) {
        if (self.port_busy)() {
            self.state = State::Failed(
                "a Core is already running on this port; managed mode never adopts one (stop it or use PHOENIX_PORT)".into(),
            );
            return;
        }
        let secret = match ConsentSecret::generate() {
            Ok(s) => s,
            Err(_) => {
                self.state = State::Failed("the operating system gave no random bytes".into());
                return;
            }
        };
        let line = secret.line();
        match self.spawner.spawn(&self.spec, &line) {
            Ok(child) => {
                self.child = Some(child);
                self.secret = Some(secret);
                self.state = State::Running;
                self.last_poll = None;
                self.last_answered = None;
            }
            Err(err) => {
                self.state = State::Failed(format!("Core could not be started ({:?})", err.kind()))
            }
        }
    }

    /// One scheduling step; the caller loops on it every few hundred milliseconds. Returns the
    /// outcome of a consent step when one ran.
    pub fn tick(&mut self, now: Instant) -> Option<Step> {
        if !self.started {
            self.started = true;
            self.launch();
            return None;
        }
        match self.state {
            State::Stopped | State::Failed(_) => None,
            State::Backoff => {
                if self.restart_at.is_some_and(|at| now >= at) {
                    self.restart_at = None;
                    self.launch();
                }
                None
            }
            State::Running => {
                if self.child.as_mut().is_none_or(|c| c.exited()) {
                    // The owner's console gets the bounded tail of Core's own output. A web page
                    // never does, and Core never receives the secret as anything it prints.
                    if let Some(child) = &self.child {
                        eprintln!(
                            "Phoenix: managed Core exited. Last output:\n{}",
                            child.recent_output()
                        );
                    }
                    self.child = None;
                    self.secret = None; // a new launch gets a new secret
                    if self.policy.allow(now) {
                        self.state = State::Backoff;
                        self.restart_at = Some(now + RestartPolicy::DELAY);
                    } else {
                        self.state = State::Failed("Core kept exiting; not restarted again".into());
                    }
                    return None;
                }
                if self
                    .last_poll
                    .is_some_and(|t| now.duration_since(t) < POLL_EVERY)
                {
                    return None;
                }
                self.last_poll = Some(now);
                let secret = self.secret.as_ref()?;
                Some(consent_dialog::step(
                    self.api.as_ref(),
                    secret.expose(),
                    self.ask.as_ref(),
                    &mut self.last_answered,
                ))
            }
        }
    }

    /// Kills the child and forgets the secret (shell exit).
    pub fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.kill();
        }
        self.secret = None;
        self.state = State::Stopped;
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// The running supervisor. Dropping or [`Supervisor::stop`] kills Core.
pub struct Supervisor {
    stop: Arc<AtomicBool>,
    runner: Arc<Mutex<Runner>>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Supervisor {
    pub fn start(runner: Runner, on_step: impl Fn(Step) + Send + 'static) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let runner = Arc::new(Mutex::new(runner));
        let (flag, shared) = (stop.clone(), runner.clone());
        let thread = std::thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                // The lock is held through a consent dialog on purpose: `stop` waits for it, and a
                // killed Core makes the answer fail closed.
                let step = shared.lock().ok().and_then(|mut r| {
                    let step = r.tick(Instant::now());
                    if let Some(why) = r.take_failure() {
                        eprintln!("Phoenix: managed Core is off: {why}");
                    }
                    step
                });
                if let Some(step) = step {
                    on_step(step);
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        });
        Self {
            stop,
            runner,
            thread: Mutex::new(Some(thread)),
        }
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Ok(mut r) = self.runner.lock() {
            r.shutdown();
        }
        if let Some(t) = self.thread.lock().ok().and_then(|mut t| t.take()) {
            let _ = t.join();
        }
    }
}

impl Drop for Supervisor {
    fn drop(&mut self) {
        self.stop();
    }
}

/// True when something accepts a connection on `addr` (a Core is already there).
pub fn port_is_busy(addr: std::net::SocketAddr) -> bool {
    std::net::TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| map.get(k).cloned()
    }

    const ARGV: &str = r#"["node","--import","tsx","/work/core/runtime/src/main.ts"]"#;

    #[test]
    fn without_the_opt_in_nothing_is_requested() {
        assert_eq!(spec_from_env(env(&[])), Err(SpecError::NotRequested));
        for off in ["0", "true", "yes", ""] {
            assert_eq!(
                spec_from_env(env(&[(ENV_OPT_IN, off), (ENV_ARGV, ARGV)])),
                Err(SpecError::NotRequested),
                "{off}"
            );
        }
    }

    #[test]
    fn the_command_is_argv_only_never_a_shell_string() {
        assert_eq!(
            spec_from_env(env(&[(ENV_OPT_IN, "1")])),
            Err(SpecError::NoArgv)
        );
        for bad in [
            "node main.js",
            "[]",
            "[1,2]",
            r#"["node",""]"#,
            r#"["a\u0000b"]"#,
            "{}",
        ] {
            assert!(
                matches!(
                    spec_from_env(env(&[(ENV_OPT_IN, "1"), (ENV_ARGV, bad)])),
                    Err(SpecError::BadArgv(_))
                ),
                "{bad}"
            );
        }
        let long = format!("[\"{}\"]", "a".repeat(MAX_ARG_BYTES + 1));
        assert!(spec_from_env(env(&[(ENV_OPT_IN, "1"), (ENV_ARGV, &long)])).is_err());
        let many = format!("[{}]", vec!["\"a\""; MAX_ARGV + 1].join(","));
        assert!(spec_from_env(env(&[(ENV_OPT_IN, "1"), (ENV_ARGV, &many)])).is_err());
        let spec = spec_from_env(env(&[(ENV_OPT_IN, "1"), (ENV_ARGV, ARGV)])).unwrap();
        assert_eq!(
            spec.argv,
            ["node", "--import", "tsx", "/work/core/runtime/src/main.ts"]
        );
    }

    #[test]
    fn the_child_environment_is_cleaned_and_announces_stdin() {
        let spec = spec_from_env(env(&[
            (ENV_OPT_IN, "1"),
            (ENV_ARGV, ARGV),
            (ENV_CWD, "/work"),
            ("PATH", "/usr/bin"),
            ("HOME", "/home/ada"),
            ("PHOENIX_PORT", "4999"),
            ("AWS_SECRET_ACCESS_KEY", "x"),
            ("LD_PRELOAD", "/evil.so"),
            ("NODE_OPTIONS", "--require /evil.js"),
            ("DYLD_INSERT_LIBRARIES", "/evil.dylib"),
            ("PHOENIX_HOST", "0.0.0.0"),
            ("PHOENIX_ALLOW_REMOTE", "true"),
            (ENV_ARGV.replace("ARGV", "TOKEN").as_str(), "t"),
        ]))
        .unwrap();
        let names: Vec<&str> = spec.env.iter().map(|(k, _)| k.as_str()).collect();
        for kept in ["PATH", "HOME", "PHOENIX_PORT", ENV_OPT_IN] {
            assert!(names.contains(&kept), "{kept}");
        }
        for dropped in [
            "AWS_SECRET_ACCESS_KEY",
            "LD_PRELOAD",
            "NODE_OPTIONS",
            "DYLD_INSERT_LIBRARIES",
            "PHOENIX_HOST",
            "PHOENIX_ALLOW_REMOTE",
            ENV_ARGV,
            ENV_CWD,
        ] {
            assert!(!names.contains(&dropped), "{dropped}");
        }
        assert!(spec
            .env
            .contains(&(ENV_OPT_IN.to_string(), ANNOUNCE_VALUE.to_string())));
        assert_eq!(spec.cwd, Some(PathBuf::from("/work")));
    }

    #[test]
    fn secrets_are_64_hex_characters_random_and_redacted() {
        let a = ConsentSecret::generate().unwrap();
        let b = ConsentSecret::generate().unwrap();
        assert_eq!(a.expose().len(), 64);
        assert!(a
            .expose()
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)));
        assert_ne!(a.expose(), b.expose());
        assert!(!format!("{a:?}").contains(a.expose()));
        let line = a.line();
        assert!(!format!("{line:?}").contains(a.expose()));
        assert_eq!(
            line.bytes(),
            format!("{LINE_PREFIX} {}\n", a.expose()).as_bytes()
        );
    }

    #[test]
    fn hex_encoding_is_exact() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0xab;
        bytes[31] = 0x07;
        let s = ConsentSecret::from_bytes(&bytes);
        assert!(s.expose().starts_with("ab00"));
        assert!(s.expose().ends_with("07"));
    }

    #[test]
    fn wiping_zeroes_every_byte() {
        let mut buf = *b"top secret value";
        wipe_bytes(&mut buf);
        assert_eq!(buf, [0u8; 16]);
        let mut line = SecretLine(b"abc".to_vec());
        wipe_bytes(&mut line.0);
        assert_eq!(line.0, [0u8; 3]);
    }

    #[test]
    fn the_restart_policy_allows_three_restarts_per_window() {
        let t0 = Instant::now();
        let mut p = RestartPolicy::default();
        assert!(p.allow(t0));
        assert!(p.allow(t0 + Duration::from_secs(1)));
        assert!(p.allow(t0 + Duration::from_secs(2)));
        assert!(!p.allow(t0 + Duration::from_secs(3)));
        assert!(p.allow(t0 + RestartPolicy::WINDOW + Duration::from_secs(5)));
    }

    // ── The runner against a fake spawner and a fake API ───────────────────

    #[derive(Default)]
    struct Log {
        specs: Vec<SpawnSpec>,
        lines: Vec<Vec<u8>>,
        killed: usize,
    }

    struct FakeSpawner {
        log: Arc<Mutex<Log>>,
        dead: Arc<AtomicBool>,
        fail: bool,
    }

    struct FakeChild {
        log: Arc<Mutex<Log>>,
        dead: Arc<AtomicBool>,
    }

    impl Spawner for FakeSpawner {
        fn spawn(&self, spec: &SpawnSpec, line: &SecretLine) -> io::Result<Box<dyn CoreChild>> {
            if self.fail {
                return Err(io::Error::from(io::ErrorKind::NotFound));
            }
            let mut log = self.log.lock().unwrap();
            log.specs.push(spec.clone());
            log.lines.push(line.bytes().to_vec());
            self.dead.store(false, Ordering::SeqCst);
            Ok(Box::new(FakeChild {
                log: self.log.clone(),
                dead: self.dead.clone(),
            }))
        }
    }

    impl CoreChild for FakeChild {
        fn exited(&mut self) -> bool {
            self.dead.load(Ordering::SeqCst)
        }
        fn kill(&mut self) {
            self.log.lock().unwrap().killed += 1;
        }
        fn recent_output(&self) -> String {
            String::new()
        }
    }

    struct NoApi;
    impl ConsentApi for NoApi {
        fn list(&self, _: &str) -> Result<String, consent_dialog::ApiError> {
            Ok(r#"{"pending":[]}"#.into())
        }
        fn answer(&self, _: &str, _: &str, _: bool) -> Result<bool, consent_dialog::ApiError> {
            Ok(false)
        }
    }

    fn runner(spawner: FakeSpawner, busy: bool) -> (Runner, Arc<Mutex<Log>>, Arc<AtomicBool>) {
        let (log, dead) = (spawner.log.clone(), spawner.dead.clone());
        let spec = spec_from_env(env(&[
            (ENV_OPT_IN, "1"),
            (ENV_ARGV, ARGV),
            ("PATH", "/bin"),
        ]))
        .unwrap();
        let r = Runner::new(
            spec,
            Arc::new(spawner),
            Box::new(NoApi),
            Arc::new(|_| Some(false)),
            Box::new(move || busy),
        );
        (r, log, dead)
    }

    fn fake(fail: bool) -> FakeSpawner {
        FakeSpawner {
            log: Arc::default(),
            dead: Arc::default(),
            fail,
        }
    }

    #[test]
    fn it_spawns_with_the_cleaned_spec_and_delivers_the_secret_only_on_the_pipe() {
        let (mut r, log, _) = runner(fake(false), false);
        assert!(r.tick(Instant::now()).is_none());
        assert_eq!(*r.state(), State::Running);
        let log = log.lock().unwrap();
        assert_eq!(log.specs.len(), 1);
        let line = String::from_utf8(log.lines[0].clone()).unwrap();
        let hex = line.strip_prefix("PHOENIX-CONSENT-V1 ").unwrap().trim_end();
        assert_eq!(hex.len(), 64);
        let spec = &log.specs[0];
        // The secret is in neither argv, nor the environment, nor the cwd.
        assert!(spec.argv.iter().all(|a| !a.contains(hex)));
        assert!(spec
            .env
            .iter()
            .all(|(k, v)| !k.contains(hex) && !v.contains(hex)));
        assert!(spec.cwd.iter().all(|c| !c.to_string_lossy().contains(hex)));
        assert_eq!(spec.argv[0], "node");
    }

    #[test]
    fn it_refuses_to_adopt_a_core_that_is_already_running() {
        let (mut r, log, _) = runner(fake(false), true);
        r.tick(Instant::now());
        assert!(matches!(r.state(), State::Failed(m) if m.contains("never adopts")));
        assert!(log.lock().unwrap().specs.is_empty());
        // And it stays off.
        assert!(r.tick(Instant::now() + Duration::from_secs(60)).is_none());
        assert!(log.lock().unwrap().specs.is_empty());
    }

    #[test]
    fn a_spawn_failure_is_a_failed_state_without_leaking_detail() {
        let (mut r, _, _) = runner(fake(true), false);
        r.tick(Instant::now());
        assert!(matches!(r.state(), State::Failed(m) if m.contains("could not be started")));
    }

    #[test]
    fn a_dead_child_is_restarted_with_a_new_secret_and_then_given_up_on() {
        let (mut r, log, dead) = runner(fake(false), false);
        let mut now = Instant::now();
        r.tick(now);
        let mut seen = vec![log.lock().unwrap().lines[0].clone()];
        for expected in 2..=4 {
            dead.store(true, Ordering::SeqCst);
            now += Duration::from_secs(1);
            r.tick(now);
            assert_eq!(*r.state(), State::Backoff);
            // Not before the delay.
            now += Duration::from_secs(1);
            r.tick(now);
            assert_eq!(*r.state(), State::Backoff);
            now += Duration::from_secs(2);
            r.tick(now);
            assert_eq!(*r.state(), State::Running);
            let lines = log.lock().unwrap().lines.clone();
            assert_eq!(lines.len(), expected);
            assert!(
                !seen.contains(lines.last().unwrap()),
                "a new secret each launch"
            );
            seen.push(lines.last().unwrap().clone());
        }
        dead.store(true, Ordering::SeqCst);
        now += Duration::from_secs(1);
        r.tick(now);
        assert!(matches!(r.state(), State::Failed(_)));
        assert_eq!(log.lock().unwrap().lines.len(), 4);
    }

    #[test]
    fn shutdown_kills_the_child_and_stays_stopped() {
        let (mut r, log, _) = runner(fake(false), false);
        r.tick(Instant::now());
        r.shutdown();
        assert_eq!(*r.state(), State::Stopped);
        assert_eq!(log.lock().unwrap().killed, 1);
        assert!(r.tick(Instant::now()).is_none());
        drop(r);
        // Already stopped: dropping does not kill twice.
        assert_eq!(log.lock().unwrap().killed, 1);
    }

    #[test]
    fn the_consent_list_is_polled_on_a_schedule() {
        struct Counting(Arc<Mutex<usize>>);
        impl ConsentApi for Counting {
            fn list(&self, _: &str) -> Result<String, consent_dialog::ApiError> {
                *self.0.lock().unwrap() += 1;
                Ok(r#"{"pending":[]}"#.into())
            }
            fn answer(&self, _: &str, _: &str, _: bool) -> Result<bool, consent_dialog::ApiError> {
                Ok(false)
            }
        }
        let spawner = fake(false);
        let spec = spec_from_env(env(&[(ENV_OPT_IN, "1"), (ENV_ARGV, ARGV)])).unwrap();
        let count = Arc::new(Mutex::new(0usize));
        let c = count.clone();
        let mut r = Runner::new(
            spec,
            Arc::new(spawner),
            Box::new(Counting(c.clone())),
            Arc::new(|_| Some(false)),
            Box::new(|| false),
        );
        let t0 = Instant::now();
        r.tick(t0); // launch
        r.tick(t0); // first poll
        r.tick(t0 + Duration::from_millis(500));
        r.tick(t0 + Duration::from_millis(1900));
        assert_eq!(*count.lock().unwrap(), 1);
        r.tick(t0 + Duration::from_millis(2100));
        assert_eq!(*count.lock().unwrap(), 2);
    }

    /// A real child (`/bin/sh`), not a fake: the cleaned environment, the line on stdin and the
    /// bounded capture. Unix only; the child is a shell script written here, not user input.
    #[cfg(unix)]
    #[test]
    fn a_real_child_gets_the_secret_on_stdin_and_a_cleaned_environment() {
        let spec = SpawnSpec {
            argv: vec![
                "/bin/sh".into(),
                "-c".into(),
                "read line; echo \"LINE=$line\"; echo \"ANNOUNCE=$PHOENIX_MANAGED_CORE\"; echo \"LEAK=${PHOENIX_TEST_LEAK:-none}\"; echo \"ARGS=$#\"; sleep 30".into(),
            ],
            cwd: None,
            env: vec![
                ("PATH".into(), "/usr/bin:/bin".into()),
                (ENV_OPT_IN.into(), ANNOUNCE_VALUE.into()),
            ],
        };
        std::env::set_var("PHOENIX_TEST_LEAK", "leaked");
        let secret = ConsentSecret::generate().unwrap();
        let mut child = SystemSpawner.spawn(&spec, &secret.line()).unwrap();
        let hex = secret.expose().to_string();
        let mut out = String::new();
        for _ in 0..100 {
            out = child.recent_output();
            if out.contains("ARGS=") {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(out.contains(&format!("LINE={LINE_PREFIX} {hex}")), "{out}");
        assert!(out.contains("ANNOUNCE=stdin"), "{out}");
        assert!(
            out.contains("LEAK=none"),
            "the parent's environment must not cross: {out}"
        );
        assert!(!child.exited());
        child.kill();
        assert!(child.exited());
    }
}
