// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! System-audio capture adapter for the botless notetaker (Phase 65), shell side.
//!
//! **Nothing in the app can start this today, on purpose.** [`CaptureSession::start`] needs a
//! [`ConsentGrant`], and no code outside the tests can make one: Core refuses every token-only
//! recording start (403 `CONSENT_CHANNEL_UNAVAILABLE`) because no person-bound consent channel
//! exists, and the shell does not own Core (see the Phase 65 decision in `docs/gaps.md`). There is
//! no Tauri command, no menu item and no web-reachable path to this module. When the owner picks
//! a consent mechanism, only the code that implements it may construct a [`ConsentGrant`], one
//! per recording and consumed by `start`.
//!
//! What it does once started: capture what the computer is playing (macOS: ScreenCaptureKit,
//! audio only, see `system_audio_macos.rs`), turn it into 16 kHz mono 16-bit little-endian PCM
//! (the format of the notetaker's WebSocket frames; this is channel 2, "Others", [`CHANNEL_ID`])
//! and hand fixed 100 ms chunks to an injected [`PcmSink`]. The guarantees mirror the page's
//! microphone path:
//!
//! * **Bounded memory.** Input buffers are validated and capped ([`MAX_INPUT_FRAMES`],
//!   [`MAX_INPUT_CHANNELS`]); audio is converted sample by sample into one preallocated chunk, so
//!   nothing grows with call length. Going over a bound ends the session (fail closed); nothing
//!   is silently cut off or queued.
//! * **No disk.** This module has no file or path code. The sink decides where PCM goes; the
//!   intended sink is Core's single-use WebSocket.
//! * **Zeroing.** The chunk and its byte scratch are overwritten right after the sink returns, on
//!   every end path, and the resampler state is cleared. Best effort: the OS's own sample buffer
//!   (owned by ScreenCaptureKit) and anything the sink copies are outside this module's reach.
//! * **A recording indicator.** An injected [`Indicator`] is shown before the OS is asked to
//!   capture (if it cannot be shown, nothing starts) and hidden only after the OS confirmed the
//!   stop. An unconfirmed stop leaves it shown and the session slot taken: fail towards
//!   "recording" rather than towards silence.
//! * **Stop on drop.** Dropping the session, the sink refusing a chunk, the 4 h limit, a bad
//!   format and the OS ending the stream all stop capture.
//!
//! Elsewhere than macOS [`CaptureSession::start`] returns [`CaptureError::Unsupported`].
//!
//! Not run by the author: no audio was ever captured with this code. The pure parts (format
//! conversion, resampling, bounds, zeroing, lifecycle against a fake backend) are unit-tested
//! with synthetic buffers; ScreenCaptureKit itself needs a display, the Screen Recording
//! permission and a signed app, none of which were available.

// Nothing calls this yet (see above), so on every OS the items look unused outside the tests.
#![allow(dead_code)]

use std::sync::atomic::{compiler_fence, AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, OnceLock, Weak};

/// Sample rate of the PCM handed to the sink.
pub const SAMPLE_RATE: u32 = 16_000;
/// The notetaker frame channel byte for system audio ("Others"); the microphone is 1.
pub const CHANNEL_ID: u8 = 2;
/// Samples per chunk handed to the sink: 100 ms.
pub const CHUNK_SAMPLES: usize = 1_600;
/// Bytes per chunk (16-bit samples). Far below Core's 1 MiB frame limit.
pub const CHUNK_BYTES: usize = CHUNK_SAMPLES * 2;
/// Same wall-clock limit as the notetaker session (4 h), counted in output samples.
pub const MAX_SESSION_SAMPLES: u64 = 4 * 60 * 60 * SAMPLE_RATE as u64;
/// One OS buffer may hold at most one second at 192 kHz.
pub const MAX_INPUT_FRAMES: usize = 192_000;
/// Channels summed over all planes of one OS buffer.
pub const MAX_INPUT_CHANNELS: usize = 8;
/// Accepted input sample rates.
pub const MIN_INPUT_RATE: u32 = 8_000;
pub const MAX_INPUT_RATE: u32 = 384_000;
/// Output samples one input sample can produce (8 kHz in, 16 kHz out gives 2; one spare).
const MAX_ONE_INPUT: usize = 3;

/// Proof that a person agreed to this recording. It cannot be copied, cannot be built outside the
/// tests today, and `start` takes it by value, so one grant starts at most one capture.
#[derive(Debug)]
pub struct ConsentGrant {
    _private: (),
}

impl ConsentGrant {
    /// Tests only. The real constructor belongs to whatever resolves the Phase 65 consent
    /// decision; there is none yet.
    #[cfg(test)]
    pub(crate) fn for_test() -> Self {
        Self { _private: () }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    /// This platform has no system-audio backend.
    Unsupported,
    /// The Screen Recording permission is not granted (macOS).
    PermissionDenied,
    /// The system is older than the first one that can capture audio (macOS 13).
    OsTooOld,
    /// Called on the main thread; the start blocks on the OS and must run on a worker thread.
    WrongThread,
    /// Another capture is running (or could not be confirmed stopped).
    AlreadyActive,
    /// The recording indicator could not be shown, so nothing was started.
    IndicatorFailed(String),
    /// The OS did not answer in time.
    Timeout,
    /// The OS refused or failed.
    Backend(String),
    /// The OS did not confirm the stop. The indicator stays shown and the slot stays taken.
    StopUnconfirmed(String),
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported => {
                f.write_str("system-audio capture is not available on this system")
            }
            Self::PermissionDenied => f.write_str("the Screen Recording permission is not granted"),
            Self::OsTooOld => f.write_str("system-audio capture needs macOS 13 or later"),
            Self::WrongThread => f.write_str("capture must be started off the main thread"),
            Self::AlreadyActive => f.write_str("a system-audio capture is already active"),
            Self::IndicatorFailed(e) => write!(f, "the recording indicator failed: {e}"),
            Self::Timeout => f.write_str("the system did not answer in time"),
            Self::Backend(e) => write!(f, "system-audio capture failed: {e}"),
            Self::StopUnconfirmed(e) => write!(f, "the system did not confirm the stop: {e}"),
        }
    }
}

impl std::error::Error for CaptureError {}

/// Why a session ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndReason {
    /// `stop` was called: the last partial chunk is delivered first.
    Stopped,
    /// The session was dropped without `stop`.
    Dropped,
    /// The sink asked to stop (for example Core ended the recording).
    SinkRefused,
    /// 4 h reached.
    TimeLimit,
    /// A buffer in a format or size the adapter does not accept.
    BadFormat(&'static str),
    /// The OS stopped the stream (the person stopped sharing, permission revoked, ...).
    SystemStopped,
}

/// What the sink answers for each chunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flow {
    Continue,
    /// End the capture now (fail closed). The chunk was not accepted.
    Stop,
}

/// Where PCM goes. `push` must copy what it keeps and must not block (a slow sink backs up the
/// OS queue); when its own bounded queue is full it answers [`Flow::Stop`], as Core ends a
/// session that cannot keep up. The slice is zeroed as soon as `push` returns.
pub trait PcmSink: Send + 'static {
    /// One chunk of 16 kHz mono 16-bit little-endian PCM (at most [`CHUNK_BYTES`]).
    fn push(&mut self, pcm: &[u8]) -> Flow;
    /// No more audio will come, for the given reason. Called exactly once.
    fn ended(&mut self, reason: &EndReason);
}

/// The visible "recording" indicator. The shell's real indicator and Core's `notetaker.recording`
/// event are separate things; Core's stays authoritative for Fawkes.
pub trait Indicator: Send + Sync + 'static {
    /// Must succeed before capture starts.
    fn show(&self) -> Result<(), String>;
    /// Called once the OS confirmed that capture stopped.
    fn hide(&self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleFormat {
    F32,
    I16,
}

impl SampleFormat {
    fn bytes(self) -> usize {
        match self {
            Self::F32 => 4,
            Self::I16 => 2,
        }
    }
}

/// One run of samples of one OS buffer: interleaved when `channels > 1`.
#[derive(Debug, Clone, Copy)]
pub struct Plane<'a> {
    pub data: &'a [u8],
    pub channels: usize,
}

/// One buffer as the OS delivered it. Native-endian samples; several planes mean non-interleaved.
#[derive(Debug, Clone, Copy)]
pub struct RawAudio<'a> {
    pub sample_rate: u32,
    pub format: SampleFormat,
    pub planes: &'a [Plane<'a>],
}

/// Overwrites a buffer in a way the optimiser may not drop.
fn wipe<T: Copy + Default>(buf: &mut [T]) {
    for v in buf.iter_mut() {
        // SAFETY: `v` is a valid, aligned, exclusive reference.
        unsafe { std::ptr::write_volatile(v as *mut T, T::default()) };
    }
    compiler_fence(Ordering::SeqCst);
}

/// Streaming area-average resampler (mono f32). Each output sample is the average of the input
/// over its time span, which low-passes when going down (48 kHz to 16 kHz) and interpolates when
/// going up. Good enough for speech recognition; not a studio filter. State is two numbers.
#[derive(Debug, Clone)]
struct Resampler {
    /// Input samples per output sample.
    ratio: f64,
    sum: f64,
    filled: f64,
}

impl Resampler {
    fn new(in_rate: u32) -> Self {
        Self {
            ratio: f64::from(in_rate) / f64::from(SAMPLE_RATE),
            sum: 0.0,
            filled: 0.0,
        }
    }

    fn push(&mut self, x: f32, mut emit: impl FnMut(f32)) {
        const EPS: f64 = 1e-9;
        let x = if x.is_finite() { f64::from(x) } else { 0.0 };
        let mut left = 1.0_f64;
        while left > EPS {
            let need = self.ratio - self.filled;
            if left + EPS >= need {
                self.sum += x * need;
                emit((self.sum / self.ratio) as f32);
                left -= need;
                self.sum = 0.0;
                self.filled = 0.0;
            } else {
                self.sum += x * left;
                self.filled += left;
                left = 0.0;
            }
        }
    }

    fn wipe(&mut self) {
        self.sum = 0.0;
        self.filled = 0.0;
    }
}

/// f32 in [-1, 1] to i16, clamped; NaN becomes silence.
pub fn f32_to_i16(x: f32) -> i16 {
    if x.is_nan() {
        return 0;
    }
    (x.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

fn read_sample(format: SampleFormat, data: &[u8], index: usize) -> f32 {
    match format {
        SampleFormat::F32 => {
            let o = index * 4;
            f32::from_ne_bytes([data[o], data[o + 1], data[o + 2], data[o + 3]])
        }
        SampleFormat::I16 => {
            let o = index * 2;
            f32::from(i16::from_ne_bytes([data[o], data[o + 1]])) / 32768.0
        }
    }
}

/// Checks a buffer against the bounds and returns its frame count.
fn validate(audio: &RawAudio) -> Result<usize, &'static str> {
    if !(MIN_INPUT_RATE..=MAX_INPUT_RATE).contains(&audio.sample_rate) {
        return Err("sample rate out of range");
    }
    if audio.planes.is_empty() {
        return Err("buffer has no audio planes");
    }
    let mut total_channels = 0usize;
    let mut frames: Option<usize> = None;
    for plane in audio.planes {
        if plane.channels == 0 {
            return Err("plane without channels");
        }
        total_channels += plane.channels;
        let frame_bytes = plane.channels * audio.format.bytes();
        if plane.data.len() % frame_bytes != 0 {
            return Err("plane is not a whole number of frames");
        }
        let n = plane.data.len() / frame_bytes;
        if frames.is_some_and(|f| f != n) {
            return Err("planes differ in length");
        }
        frames = Some(n);
    }
    if total_channels > MAX_INPUT_CHANNELS {
        return Err("too many channels");
    }
    let frames = frames.unwrap_or(0);
    if frames > MAX_INPUT_FRAMES {
        return Err("buffer too large");
    }
    Ok(frames)
}

/// The fixed buffers of one chunk. Never reallocates, so no stale copy is left behind.
struct ChunkBuf {
    samples: Vec<i16>,
    scratch: Vec<u8>,
}

impl ChunkBuf {
    fn new() -> Self {
        Self {
            samples: Vec::with_capacity(CHUNK_SAMPLES),
            scratch: vec![0; CHUNK_BYTES],
        }
    }

    /// Hands `samples` to the sink as bytes, then zeroes both buffers.
    fn deliver(&mut self, sink: &mut dyn PcmSink) -> Flow {
        let n = self.samples.len();
        for (i, s) in self.samples.iter().enumerate() {
            self.scratch[i * 2..i * 2 + 2].copy_from_slice(&s.to_le_bytes());
        }
        let flow = sink.push(&self.scratch[..n * 2]);
        self.wipe();
        flow
    }

    fn wipe(&mut self) {
        // `Vec::clear` keeps stale values in the spare capacity, so wipe the whole capacity first.
        self.samples.resize(CHUNK_SAMPLES, 0);
        wipe(&mut self.samples);
        self.samples.clear();
        wipe(&mut self.scratch);
    }
}

struct Inner {
    sink: Box<dyn PcmSink>,
    chunk: ChunkBuf,
    resampler: Option<(u32, Resampler)>,
    samples_out: u64,
    limit: u64,
    ended: Option<EndReason>,
}

/// Converts what the OS delivers and feeds the sink. Thread-safe: the OS calls `feed` on its own
/// queue while another thread calls `finish`.
pub struct Engine {
    inner: Mutex<Inner>,
    on_end: OnceLock<Box<dyn Fn(EndReason) + Send + Sync>>,
}

impl Engine {
    pub fn new(sink: Box<dyn PcmSink>) -> Arc<Self> {
        Self::with_limit(sink, MAX_SESSION_SAMPLES)
    }

    fn with_limit(sink: Box<dyn PcmSink>, limit: u64) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                sink,
                chunk: ChunkBuf::new(),
                resampler: None,
                samples_out: 0,
                limit,
                ended: None,
            }),
            on_end: OnceLock::new(),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        // A panic while holding the lock must not stop `finish` from wiping.
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Called (once) when the engine ends the session itself rather than being told to.
    pub fn set_on_end(&self, hook: Box<dyn Fn(EndReason) + Send + Sync>) {
        let _ = self.on_end.set(hook);
    }

    pub fn end_reason(&self) -> Option<EndReason> {
        self.lock().ended.clone()
    }

    /// Ends the session: a graceful `Stopped` delivers the last partial chunk first; every reason
    /// then zeroes all buffers and tells the sink. Returns false when it had already ended.
    pub fn finish(&self, reason: EndReason) -> bool {
        let mut guard = self.lock();
        Self::end_locked(&mut guard, reason)
    }

    fn end_locked(inner: &mut Inner, reason: EndReason) -> bool {
        if inner.ended.is_some() {
            return false;
        }
        if reason == EndReason::Stopped && !inner.chunk.samples.is_empty() {
            let Inner { sink, chunk, .. } = inner;
            let _ = chunk.deliver(sink.as_mut());
        }
        inner.chunk.wipe();
        if let Some((_, r)) = inner.resampler.as_mut() {
            r.wipe();
        }
        inner.resampler = None;
        inner.sink.ended(&reason);
        inner.ended = Some(reason);
        true
    }

    /// The OS side ends the session (format problem, stream stopped): same as an internal end,
    /// including the hook that shuts the backend down.
    pub fn fail(&self, reason: EndReason) {
        let guard = self.lock();
        self.end_by_engine(guard, reason);
    }

    fn end_by_engine(&self, mut guard: MutexGuard<'_, Inner>, reason: EndReason) {
        let ended_now = Self::end_locked(&mut guard, reason.clone());
        drop(guard);
        if ended_now {
            if let Some(hook) = self.on_end.get() {
                hook(reason);
            }
        }
    }

    /// One buffer from the OS. Anything wrong ends the session; after it ended this is a no-op.
    pub fn feed(&self, audio: &RawAudio) {
        let mut guard = self.lock();
        if guard.ended.is_some() {
            return;
        }
        let frames = match validate(audio) {
            Ok(f) => f,
            Err(why) => return self.end_by_engine(guard, EndReason::BadFormat(why)),
        };
        let format = audio.format;
        let total_channels: usize = audio.planes.iter().map(|p| p.channels).sum();
        let inner = &mut *guard;
        if inner.resampler.as_ref().map(|(r, _)| *r) != Some(audio.sample_rate) {
            inner.resampler = Some((audio.sample_rate, Resampler::new(audio.sample_rate)));
        }
        let Inner {
            sink,
            chunk,
            resampler,
            samples_out,
            limit,
            ..
        } = inner;
        let resampler = &mut resampler.as_mut().expect("set above").1;
        let mut end: Option<EndReason> = None;
        let mut outs = [0.0_f32; MAX_ONE_INPUT];
        'frames: for i in 0..frames {
            let mut sum = 0.0_f32;
            for plane in audio.planes {
                for c in 0..plane.channels {
                    sum += read_sample(format, plane.data, i * plane.channels + c);
                }
            }
            let mono = sum / total_channels as f32;
            // At most MAX_ONE_INPUT outputs per input sample (the lowest accepted rate is half of
            // 16 kHz), so a fixed array holds them and the chunk never exceeds its capacity.
            let mut n_out = 0usize;
            resampler.push(mono, |s| {
                if n_out < MAX_ONE_INPUT {
                    outs[n_out] = s;
                    n_out += 1;
                }
            });
            for s in &outs[..n_out] {
                chunk.samples.push(f32_to_i16(*s));
                if chunk.samples.len() == CHUNK_SAMPLES {
                    let n = chunk.samples.len() as u64;
                    if chunk.deliver(sink.as_mut()) == Flow::Stop {
                        end = Some(EndReason::SinkRefused);
                        break 'frames;
                    }
                    *samples_out += n;
                    if *samples_out >= *limit {
                        end = Some(EndReason::TimeLimit);
                        break 'frames;
                    }
                }
            }
        }
        wipe(&mut outs);
        if let Some(reason) = end {
            self.end_by_engine(guard, reason);
        }
    }

    /// Tests: every buffer of the engine holds only zeros and the chunk is empty.
    #[cfg(test)]
    pub(crate) fn buffers_are_zero(&self) -> bool {
        let g = self.lock();
        g.chunk.samples.is_empty()
            && g.chunk.scratch.iter().all(|b| *b == 0)
            && g.chunk.samples.capacity() >= CHUNK_SAMPLES
            && g.resampler.is_none()
    }
}

/// What the platform provides. One implementation per OS; tests use a fake.
pub trait CaptureBackend: Send {
    /// Asks the OS to capture and to call `engine.feed` for each buffer. Blocking; worker thread.
    fn start(&mut self, engine: Arc<Engine>) -> Result<(), CaptureError>;
    /// Asks the OS to stop and waits for its confirmation. `Ok` means no more buffers will come.
    fn stop(&mut self) -> Result<(), CaptureError>;
}

/// At most one capture at a time.
#[derive(Debug, Default, Clone)]
pub struct SessionSlot(Arc<AtomicBool>);

impl SessionSlot {
    fn try_take(&self) -> bool {
        self.0
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    fn release(&self) {
        self.0.store(false, Ordering::Release);
    }
}

static SLOT: LazyLock<SessionSlot> = LazyLock::new(SessionSlot::default);

struct Shared {
    engine: Arc<Engine>,
    backend: Mutex<Option<Box<dyn CaptureBackend>>>,
    indicator: Arc<dyn Indicator>,
    slot: SessionSlot,
}

impl Shared {
    /// Idempotent. Order matters: no more data first, then the OS, then the indicator.
    fn shutdown(&self, reason: EndReason) -> Result<(), CaptureError> {
        self.engine.finish(reason);
        let backend = self
            .backend
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        let Some(mut backend) = backend else {
            return Ok(());
        };
        match backend.stop() {
            Ok(()) => {
                self.indicator.hide();
                self.slot.release();
                Ok(())
            }
            Err(e) => {
                // Capture may still be running at the OS: keep the indicator, the slot and the
                // backend (so a later drop tries the stop again instead of forgetting the stream).
                *self.backend.lock().unwrap_or_else(|e| e.into_inner()) = Some(backend);
                Err(match e {
                    CaptureError::StopUnconfirmed(m) => CaptureError::StopUnconfirmed(m),
                    other => CaptureError::StopUnconfirmed(other.to_string()),
                })
            }
        }
    }
}

/// A running system-audio capture. Dropping it stops capture.
pub struct CaptureSession {
    shared: Arc<Shared>,
}

impl std::fmt::Debug for CaptureSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CaptureSession")
            .field("ended", &self.shared.engine.end_reason())
            .finish()
    }
}

impl CaptureSession {
    /// Starts capturing system audio into `sink`. Needs a [`ConsentGrant`] (see the module docs:
    /// none can be made in the shipped app). Blocking; call from a worker thread.
    pub fn start(
        _consent: ConsentGrant,
        sink: Box<dyn PcmSink>,
        indicator: Arc<dyn Indicator>,
    ) -> Result<Self, CaptureError> {
        let slot = SLOT.clone();
        let backend = platform_backend()?;
        Self::start_with(backend, sink, indicator, slot)
    }

    pub(crate) fn start_with(
        mut backend: Box<dyn CaptureBackend>,
        sink: Box<dyn PcmSink>,
        indicator: Arc<dyn Indicator>,
        slot: SessionSlot,
    ) -> Result<Self, CaptureError> {
        if !slot.try_take() {
            return Err(CaptureError::AlreadyActive);
        }
        if let Err(e) = indicator.show() {
            slot.release();
            return Err(CaptureError::IndicatorFailed(e));
        }
        let engine = Engine::new(sink);
        if let Err(e) = backend.start(engine.clone()) {
            // The OS may have half-started: ask it to stop before hiding anything.
            let stopped = backend.stop().is_ok();
            engine.finish(EndReason::SystemStopped);
            if stopped {
                indicator.hide();
                slot.release();
            }
            return Err(e);
        }
        let shared = Arc::new(Shared {
            engine: engine.clone(),
            backend: Mutex::new(Some(backend)),
            indicator,
            slot,
        });
        let weak: Weak<Shared> = Arc::downgrade(&shared);
        engine.set_on_end(Box::new(move |reason| {
            // Stopping waits for the OS, which may be the thread calling us: do it elsewhere.
            if let Some(shared) = weak.upgrade() {
                std::thread::spawn(move || {
                    let _ = shared.shutdown(reason);
                });
            }
        }));
        // The engine may already have ended during `start` (the hook was not set yet).
        if let Some(reason) = engine.end_reason() {
            let _ = shared.shutdown(reason);
        }
        Ok(Self { shared })
    }

    /// True until the session ended for any reason.
    pub fn is_active(&self) -> bool {
        self.shared.engine.end_reason().is_none()
    }

    pub fn end_reason(&self) -> Option<EndReason> {
        self.shared.engine.end_reason()
    }

    /// Stops capture, delivers the last partial chunk and returns once the OS confirmed the stop.
    pub fn stop(self) -> Result<(), CaptureError> {
        self.shared.shutdown(EndReason::Stopped)
    }
}

impl Drop for CaptureSession {
    fn drop(&mut self) {
        let _ = self.shared.shutdown(EndReason::Dropped);
    }
}

#[cfg(target_os = "macos")]
fn platform_backend() -> Result<Box<dyn CaptureBackend>, CaptureError> {
    crate::system_audio_macos::SckBackend::new().map(|b| Box::new(b) as Box<dyn CaptureBackend>)
}

#[cfg(not(target_os = "macos"))]
fn platform_backend() -> Result<Box<dyn CaptureBackend>, CaptureError> {
    Err(CaptureError::Unsupported)
}

/// Whether this build has a system-audio backend at all (not whether permission is granted).
pub fn is_supported() -> bool {
    cfg!(target_os = "macos")
}

#[cfg(test)]
#[path = "system_audio_tests.rs"]
mod tests;
