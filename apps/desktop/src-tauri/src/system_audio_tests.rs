// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! Tests of the system-audio adapter with synthetic buffers and a fake backend. Nothing here
//! touches ScreenCaptureKit, a display or a permission.

use super::*;
use std::sync::atomic::AtomicUsize;
use std::time::{Duration, Instant};

#[derive(Default)]
struct SinkLog {
    chunks: Vec<Vec<u8>>,
    ended: Vec<EndReason>,
    refuse_after: Option<usize>,
}

#[derive(Clone, Default)]
struct FakeSink(Arc<Mutex<SinkLog>>);

impl PcmSink for FakeSink {
    fn push(&mut self, pcm: &[u8]) -> Flow {
        let mut log = self.0.lock().unwrap();
        if log.refuse_after.is_some_and(|n| log.chunks.len() >= n) {
            return Flow::Stop;
        }
        log.chunks.push(pcm.to_vec());
        Flow::Continue
    }
    fn ended(&mut self, reason: &EndReason) {
        self.0.lock().unwrap().ended.push(reason.clone());
    }
}

impl FakeSink {
    fn samples(&self) -> Vec<i16> {
        self.0
            .lock()
            .unwrap()
            .chunks
            .iter()
            .flat_map(|c| c.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])))
            .collect()
    }
    fn chunk_lens(&self) -> Vec<usize> {
        self.0.lock().unwrap().chunks.iter().map(Vec::len).collect()
    }
    fn ended(&self) -> Vec<EndReason> {
        self.0.lock().unwrap().ended.clone()
    }
}

fn f32_bytes(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_ne_bytes()).collect()
}

fn i16_bytes(v: &[i16]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_ne_bytes()).collect()
}

fn feed_mono_f32(engine: &Engine, rate: u32, v: &[f32]) {
    let data = f32_bytes(v);
    let planes = [Plane {
        data: &data,
        channels: 1,
    }];
    engine.feed(&RawAudio {
        sample_rate: rate,
        format: SampleFormat::F32,
        planes: &planes,
    });
}

// ---- pure conversion ----

#[test]
fn f32_to_i16_clamps_and_survives_nan() {
    assert_eq!(f32_to_i16(0.0), 0);
    assert_eq!(f32_to_i16(1.0), 32767);
    assert_eq!(f32_to_i16(-1.0), -32767);
    assert_eq!(f32_to_i16(7.5), 32767);
    assert_eq!(f32_to_i16(-7.5), -32767);
    assert_eq!(f32_to_i16(f32::NAN), 0);
    assert_eq!(f32_to_i16(f32::INFINITY), 32767);
}

#[test]
fn sixteen_khz_mono_passes_through_unchanged() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    let input: Vec<f32> = (0..CHUNK_SAMPLES)
        .map(|i| (i as f32 / CHUNK_SAMPLES as f32) - 0.5)
        .collect();
    feed_mono_f32(&engine, SAMPLE_RATE, &input);
    let expect: Vec<i16> = input.iter().map(|x| f32_to_i16(*x)).collect();
    assert_eq!(sink.samples(), expect);
    assert_eq!(sink.chunk_lens(), vec![CHUNK_BYTES]);
}

#[test]
fn downsampling_48k_to_16k_keeps_level_and_length() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    // 0.1 s at 48 kHz of a constant: exactly one chunk of 1600 samples, each the constant.
    feed_mono_f32(&engine, 48_000, &vec![0.25; 4_800]);
    let out = sink.samples();
    assert_eq!(out.len(), CHUNK_SAMPLES);
    assert!(
        out.iter().all(|s| (*s - f32_to_i16(0.25)).abs() <= 1),
        "{:?}",
        &out[..4]
    );
}

#[test]
fn downsampling_averages_so_a_tone_above_nyquist_is_attenuated() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    // 24 kHz at 48 kHz sampling alternates +1/-1; averaging in threes cannot keep full scale.
    let input: Vec<f32> = (0..4_800)
        .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
        .collect();
    feed_mono_f32(&engine, 48_000, &input);
    let peak = sink
        .samples()
        .iter()
        .map(|s| s.unsigned_abs())
        .max()
        .unwrap();
    assert!(peak < 16_000, "peak {peak}");
}

#[test]
fn upsampling_8k_doubles_the_sample_count() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    feed_mono_f32(&engine, 8_000, &vec![0.5; 800]);
    let out = sink.samples();
    assert_eq!(out.len(), CHUNK_SAMPLES);
    assert!(out.iter().all(|s| (*s - f32_to_i16(0.5)).abs() <= 1));
}

#[test]
fn output_length_tracks_the_ratio_over_many_odd_buffers() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    // 44.1 kHz in buffers of 441 frames: 100 buffers = 1 s in, 16000 samples out (1600 per chunk).
    for _ in 0..100 {
        feed_mono_f32(&engine, 44_100, &vec![0.1; 441]);
    }
    assert_eq!(sink.samples().len(), 16_000);
    assert!(sink.chunk_lens().iter().all(|l| *l == CHUNK_BYTES));
}

#[test]
fn stereo_interleaved_is_downmixed_by_averaging() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    // Left 0.8, right -0.4 => 0.2.
    let mut frames = Vec::new();
    for _ in 0..CHUNK_SAMPLES {
        frames.extend_from_slice(&[0.8_f32, -0.4]);
    }
    let data = f32_bytes(&frames);
    let planes = [Plane {
        data: &data,
        channels: 2,
    }];
    engine.feed(&RawAudio {
        sample_rate: SAMPLE_RATE,
        format: SampleFormat::F32,
        planes: &planes,
    });
    assert!(sink
        .samples()
        .iter()
        .all(|s| (*s - f32_to_i16(0.2)).abs() <= 1));
}

#[test]
fn non_interleaved_planes_are_downmixed_by_averaging() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    let l = f32_bytes(&vec![0.6; CHUNK_SAMPLES]);
    let r = f32_bytes(&vec![0.2; CHUNK_SAMPLES]);
    let planes = [
        Plane {
            data: &l,
            channels: 1,
        },
        Plane {
            data: &r,
            channels: 1,
        },
    ];
    engine.feed(&RawAudio {
        sample_rate: SAMPLE_RATE,
        format: SampleFormat::F32,
        planes: &planes,
    });
    assert!(sink
        .samples()
        .iter()
        .all(|s| (*s - f32_to_i16(0.4)).abs() <= 1));
}

#[test]
fn sixteen_bit_input_is_read_as_signed_samples() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    let data = i16_bytes(&vec![16_384; CHUNK_SAMPLES]);
    let planes = [Plane {
        data: &data,
        channels: 1,
    }];
    engine.feed(&RawAudio {
        sample_rate: SAMPLE_RATE,
        format: SampleFormat::I16,
        planes: &planes,
    });
    assert!(sink.samples().iter().all(|s| (*s - 16_384).abs() <= 1));
}

#[test]
fn non_finite_input_becomes_silence() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    let mut v = vec![0.0_f32; CHUNK_SAMPLES];
    v[3] = f32::NAN;
    v[4] = f32::INFINITY;
    feed_mono_f32(&engine, SAMPLE_RATE, &v);
    assert!(sink.samples().iter().all(|s| *s == 0));
}

// ---- bounds ----

fn rejects(rate: u32, planes: &[Plane]) -> Option<EndReason> {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    engine.feed(&RawAudio {
        sample_rate: rate,
        format: SampleFormat::F32,
        planes,
    });
    assert!(sink.samples().is_empty());
    engine.end_reason()
}

#[test]
fn malformed_buffers_end_the_session_and_deliver_nothing() {
    let ok = f32_bytes(&[0.0; 16]);
    let good = Plane {
        data: &ok,
        channels: 1,
    };
    assert!(matches!(
        rejects(100, &[good]),
        Some(EndReason::BadFormat(_))
    ));
    assert!(matches!(
        rejects(MAX_INPUT_RATE + 1, &[good]),
        Some(EndReason::BadFormat(_))
    ));
    assert!(matches!(
        rejects(SAMPLE_RATE, &[]),
        Some(EndReason::BadFormat(_))
    ));
    assert!(matches!(
        rejects(
            SAMPLE_RATE,
            &[Plane {
                data: &ok,
                channels: 0
            }]
        ),
        Some(EndReason::BadFormat(_))
    ));
    // 64 bytes is 16 f32 samples: 3 channels do not divide it.
    assert!(matches!(
        rejects(
            SAMPLE_RATE,
            &[Plane {
                data: &ok,
                channels: 3
            }]
        ),
        Some(EndReason::BadFormat(_))
    ));
    let shorter = f32_bytes(&[0.0; 8]);
    assert!(matches!(
        rejects(
            SAMPLE_RATE,
            &[
                good,
                Plane {
                    data: &shorter,
                    channels: 1
                }
            ]
        ),
        Some(EndReason::BadFormat(_))
    ));
    let many: Vec<Plane> = (0..MAX_INPUT_CHANNELS + 1).map(|_| good).collect();
    assert!(matches!(
        rejects(SAMPLE_RATE, &many),
        Some(EndReason::BadFormat(_))
    ));
}

#[test]
fn an_oversized_buffer_ends_the_session() {
    let big = vec![0u8; (MAX_INPUT_FRAMES + 1) * 4];
    assert!(matches!(
        rejects(
            SAMPLE_RATE,
            &[Plane {
                data: &big,
                channels: 1
            }]
        ),
        Some(EndReason::BadFormat("buffer too large"))
    ));
    // Exactly at the cap is accepted.
    let at_cap = vec![0u8; MAX_INPUT_FRAMES * 4];
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    engine.feed(&RawAudio {
        sample_rate: SAMPLE_RATE,
        format: SampleFormat::F32,
        planes: &[Plane {
            data: &at_cap,
            channels: 1,
        }],
    });
    assert_eq!(engine.end_reason(), None);
    assert_eq!(
        sink.samples().len(),
        MAX_INPUT_FRAMES / CHUNK_SAMPLES * CHUNK_SAMPLES
    );
}

#[test]
fn chunks_never_exceed_the_bound_whatever_the_input_size() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    feed_mono_f32(&engine, 8_000, &vec![0.3; 50_000]);
    feed_mono_f32(&engine, 192_000, &vec![0.3; 100_000]);
    assert!(sink.chunk_lens().iter().all(|l| *l <= CHUNK_BYTES));
}

#[test]
fn input_after_the_end_is_ignored() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink.clone()));
    assert!(engine.finish(EndReason::Dropped));
    feed_mono_f32(&engine, SAMPLE_RATE, &vec![0.5; CHUNK_SAMPLES * 2]);
    assert!(sink.samples().is_empty());
    assert!(!engine.finish(EndReason::Stopped));
    assert_eq!(sink.ended(), vec![EndReason::Dropped]);
}

#[test]
fn the_session_time_limit_ends_the_session() {
    let sink = FakeSink::default();
    let engine = Engine::with_limit(Box::new(sink.clone()), (CHUNK_SAMPLES * 3) as u64);
    feed_mono_f32(&engine, SAMPLE_RATE, &vec![0.5; CHUNK_SAMPLES * 10]);
    assert_eq!(engine.end_reason(), Some(EndReason::TimeLimit));
    assert_eq!(sink.chunk_lens().len(), 3);
    assert_eq!(sink.ended(), vec![EndReason::TimeLimit]);
}

#[test]
fn the_real_limit_is_four_hours() {
    assert_eq!(MAX_SESSION_SAMPLES, 4 * 3600 * 16_000);
}

#[test]
fn a_sink_that_refuses_ends_the_session_and_gets_nothing_more() {
    let sink = FakeSink::default();
    sink.0.lock().unwrap().refuse_after = Some(1);
    let engine = Engine::new(Box::new(sink.clone()));
    feed_mono_f32(&engine, SAMPLE_RATE, &vec![0.5; CHUNK_SAMPLES * 5]);
    assert_eq!(engine.end_reason(), Some(EndReason::SinkRefused));
    assert_eq!(sink.chunk_lens().len(), 1);
    feed_mono_f32(&engine, SAMPLE_RATE, &vec![0.5; CHUNK_SAMPLES]);
    assert_eq!(sink.chunk_lens().len(), 1);
    assert!(engine.buffers_are_zero());
}

// ---- zeroing ----

#[test]
fn buffers_are_zeroed_after_every_chunk_and_every_end_path() {
    for reason in [
        EndReason::Stopped,
        EndReason::Dropped,
        EndReason::SystemStopped,
        EndReason::TimeLimit,
    ] {
        let sink = FakeSink::default();
        let engine = Engine::new(Box::new(sink.clone()));
        // One full chunk plus a partial one pending.
        feed_mono_f32(&engine, SAMPLE_RATE, &vec![0.9; CHUNK_SAMPLES + 100]);
        {
            let g = engine.lock();
            assert_eq!(g.chunk.samples.len(), 100);
            assert!(
                g.chunk.scratch.iter().all(|b| *b == 0),
                "scratch zeroed after delivery"
            );
        }
        engine.finish(reason.clone());
        assert!(engine.buffers_are_zero(), "{reason:?}");
        assert_eq!(sink.ended(), vec![reason]);
    }
}

#[test]
fn a_graceful_stop_delivers_the_partial_chunk_but_other_ends_do_not() {
    let stopped = FakeSink::default();
    let e = Engine::new(Box::new(stopped.clone()));
    feed_mono_f32(&e, SAMPLE_RATE, &vec![0.5; 100]);
    e.finish(EndReason::Stopped);
    assert_eq!(stopped.chunk_lens(), vec![200]);

    let dropped = FakeSink::default();
    let e = Engine::new(Box::new(dropped.clone()));
    feed_mono_f32(&e, SAMPLE_RATE, &vec![0.5; 100]);
    e.finish(EndReason::Dropped);
    assert!(dropped.chunk_lens().is_empty());
}

#[test]
fn spare_capacity_of_the_sample_buffer_is_wiped_too() {
    let sink = FakeSink::default();
    let engine = Engine::new(Box::new(sink));
    feed_mono_f32(&engine, SAMPLE_RATE, &vec![0.9; 700]);
    engine.finish(EndReason::Dropped);
    let g = engine.lock();
    // Read the spare capacity directly: nothing from the 700 samples may remain.
    let cap = g.chunk.samples.capacity();
    assert!(cap >= CHUNK_SAMPLES);
    let ptr = g.chunk.samples.as_ptr();
    // SAFETY: the allocation holds `cap` i16 values, all initialised by the wipe (resized to full
    // capacity and overwritten) before the clear; reading them is what this test checks.
    let all = unsafe { std::slice::from_raw_parts(ptr, CHUNK_SAMPLES) };
    assert!(all.iter().all(|s| *s == 0));
}

// ---- lifecycle against a fake backend ----

#[derive(Default)]
struct Calls {
    events: Mutex<Vec<String>>,
    engine: Mutex<Option<Arc<Engine>>>,
}

impl Calls {
    fn log(&self, s: &str) {
        self.events.lock().unwrap().push(s.to_string());
    }
    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
}

struct FakeBackend {
    calls: Arc<Calls>,
    start_error: Option<CaptureError>,
    stop_error: Option<CaptureError>,
}

impl CaptureBackend for FakeBackend {
    fn start(&mut self, engine: Arc<Engine>) -> Result<(), CaptureError> {
        self.calls.log("backend.start");
        *self.calls.engine.lock().unwrap() = Some(engine);
        match self.start_error.take() {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
    fn stop(&mut self) -> Result<(), CaptureError> {
        self.calls.log("backend.stop");
        match self.stop_error.clone() {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

struct FakeIndicator {
    calls: Arc<Calls>,
    fail: bool,
    shown: AtomicUsize,
    hidden: AtomicUsize,
}

impl Indicator for FakeIndicator {
    fn show(&self) -> Result<(), String> {
        self.calls.log("indicator.show");
        if self.fail {
            return Err("no menu bar".into());
        }
        self.shown.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn hide(&self) {
        self.calls.log("indicator.hide");
        self.hidden.fetch_add(1, Ordering::SeqCst);
    }
}

struct Rig {
    calls: Arc<Calls>,
    sink: FakeSink,
    indicator: Arc<FakeIndicator>,
    slot: SessionSlot,
}

impl Rig {
    fn new() -> Self {
        let calls = Arc::new(Calls::default());
        Self {
            indicator: Arc::new(FakeIndicator {
                calls: calls.clone(),
                fail: false,
                shown: AtomicUsize::new(0),
                hidden: AtomicUsize::new(0),
            }),
            calls,
            sink: FakeSink::default(),
            slot: SessionSlot::default(),
        }
    }

    fn backend(&self) -> FakeBackend {
        FakeBackend {
            calls: self.calls.clone(),
            start_error: None,
            stop_error: None,
        }
    }

    fn start(&self, backend: FakeBackend) -> Result<CaptureSession, CaptureError> {
        let _grant = ConsentGrant::for_test();
        CaptureSession::start_with(
            Box::new(backend),
            Box::new(self.sink.clone()),
            self.indicator.clone(),
            self.slot.clone(),
        )
    }
}

fn wait_until(what: &str, f: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !f() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn the_indicator_is_shown_before_the_os_is_asked_and_hidden_after_it_stopped() {
    let rig = Rig::new();
    let session = rig.start(rig.backend()).unwrap();
    assert!(session.is_active());
    session.stop().unwrap();
    assert_eq!(
        rig.calls.events(),
        [
            "indicator.show",
            "backend.start",
            "backend.stop",
            "indicator.hide"
        ]
    );
    assert_eq!(rig.sink.ended(), vec![EndReason::Stopped]);
}

#[test]
fn dropping_the_session_stops_capture_and_hides_the_indicator() {
    let rig = Rig::new();
    let session = rig.start(rig.backend()).unwrap();
    drop(session);
    assert_eq!(
        rig.calls.events(),
        [
            "indicator.show",
            "backend.start",
            "backend.stop",
            "indicator.hide"
        ]
    );
    assert_eq!(rig.sink.ended(), vec![EndReason::Dropped]);
    // The slot is free again.
    assert!(rig.start(rig.backend()).is_ok());
}

#[test]
fn stop_is_idempotent_with_drop() {
    let rig = Rig::new();
    let session = rig.start(rig.backend()).unwrap();
    session.stop().unwrap();
    // `stop` consumed the session, so Drop ran afterwards: the backend was stopped exactly once.
    let stops = rig
        .calls
        .events()
        .iter()
        .filter(|e| *e == "backend.stop")
        .count();
    assert_eq!(stops, 1);
    assert_eq!(rig.indicator.hidden.load(Ordering::SeqCst), 1);
}

#[test]
fn only_one_capture_at_a_time() {
    let rig = Rig::new();
    let first = rig.start(rig.backend()).unwrap();
    assert_eq!(
        rig.start(rig.backend()).unwrap_err(),
        CaptureError::AlreadyActive
    );
    // The refused start did not touch the indicator or the OS.
    assert_eq!(rig.indicator.shown.load(Ordering::SeqCst), 1);
    drop(first);
    assert!(rig.start(rig.backend()).is_ok());
}

#[test]
fn without_an_indicator_nothing_starts() {
    let mut rig = Rig::new();
    rig.indicator = Arc::new(FakeIndicator {
        calls: rig.calls.clone(),
        fail: true,
        shown: AtomicUsize::new(0),
        hidden: AtomicUsize::new(0),
    });
    let err = rig.start(rig.backend()).unwrap_err();
    assert_eq!(err, CaptureError::IndicatorFailed("no menu bar".into()));
    assert_eq!(rig.calls.events(), ["indicator.show"]);
    // The slot was released.
    rig.indicator = Arc::new(FakeIndicator {
        calls: rig.calls.clone(),
        fail: false,
        shown: AtomicUsize::new(0),
        hidden: AtomicUsize::new(0),
    });
    assert!(rig.start(rig.backend()).is_ok());
}

#[test]
fn a_failed_start_stops_the_os_hides_the_indicator_and_frees_the_slot() {
    let rig = Rig::new();
    let mut backend = rig.backend();
    backend.start_error = Some(CaptureError::PermissionDenied);
    let err = rig.start(backend).unwrap_err();
    assert_eq!(err, CaptureError::PermissionDenied);
    assert_eq!(
        rig.calls.events(),
        [
            "indicator.show",
            "backend.start",
            "backend.stop",
            "indicator.hide"
        ]
    );
    assert!(rig.start(rig.backend()).is_ok());
}

#[test]
fn an_unconfirmed_stop_keeps_the_indicator_and_the_slot() {
    let rig = Rig::new();
    let mut backend = rig.backend();
    backend.stop_error = Some(CaptureError::StopUnconfirmed("timeout".into()));
    let session = rig.start(backend).unwrap();
    assert!(matches!(
        session.stop(),
        Err(CaptureError::StopUnconfirmed(_))
    ));
    assert_eq!(rig.indicator.hidden.load(Ordering::SeqCst), 0);
    assert_eq!(
        rig.start(rig.backend()).unwrap_err(),
        CaptureError::AlreadyActive
    );
}

#[test]
fn the_os_ending_the_stream_stops_everything() {
    let rig = Rig::new();
    let session = rig.start(rig.backend()).unwrap();
    let engine = rig.calls.engine.lock().unwrap().clone().unwrap();
    engine.fail(EndReason::SystemStopped);
    wait_until("indicator hide", || {
        rig.indicator.hidden.load(Ordering::SeqCst) == 1
    });
    assert_eq!(session.end_reason(), Some(EndReason::SystemStopped));
    assert!(!session.is_active());
    assert_eq!(rig.sink.ended(), vec![EndReason::SystemStopped]);
    drop(session);
    assert_eq!(
        rig.indicator.hidden.load(Ordering::SeqCst),
        1,
        "hidden once"
    );
}

#[test]
fn a_bad_buffer_from_the_os_ends_the_capture_through_the_session() {
    let rig = Rig::new();
    let session = rig.start(rig.backend()).unwrap();
    let engine = rig.calls.engine.lock().unwrap().clone().unwrap();
    let data = [0u8; 7];
    engine.feed(&RawAudio {
        sample_rate: SAMPLE_RATE,
        format: SampleFormat::F32,
        planes: &[Plane {
            data: &data,
            channels: 1,
        }],
    });
    wait_until("indicator hide", || {
        rig.indicator.hidden.load(Ordering::SeqCst) == 1
    });
    assert!(matches!(
        session.end_reason(),
        Some(EndReason::BadFormat(_))
    ));
    assert!(rig.calls.events().contains(&"backend.stop".to_string()));
}

#[test]
fn audio_fed_through_a_session_reaches_the_sink_and_stop_flushes() {
    let rig = Rig::new();
    let session = rig.start(rig.backend()).unwrap();
    let engine = rig.calls.engine.lock().unwrap().clone().unwrap();
    feed_mono_f32(&engine, 48_000, &vec![0.5; 4_800 + 300]);
    assert_eq!(rig.sink.chunk_lens(), vec![CHUNK_BYTES]);
    session.stop().unwrap();
    assert_eq!(rig.sink.chunk_lens(), vec![CHUNK_BYTES, 200]);
}

// ---- platform gating ----

#[test]
fn the_notetaker_channel_for_system_audio_is_the_others_channel() {
    assert_eq!(CHANNEL_ID, 2);
    assert_eq!(SAMPLE_RATE, 16_000);
    const { assert!(CHUNK_BYTES < 1024 * 1024) };
}

#[cfg(not(target_os = "macos"))]
#[test]
fn elsewhere_than_macos_start_says_unsupported_and_touches_nothing() {
    assert!(!is_supported());
    let calls = Arc::new(Calls::default());
    let indicator = Arc::new(FakeIndicator {
        calls: calls.clone(),
        fail: false,
        shown: AtomicUsize::new(0),
        hidden: AtomicUsize::new(0),
    });
    let err = CaptureSession::start(
        ConsentGrant::for_test(),
        Box::new(FakeSink::default()),
        indicator,
    )
    .unwrap_err();
    assert_eq!(err, CaptureError::Unsupported);
    assert!(calls.events().is_empty(), "no indicator, no capture");
}

#[cfg(target_os = "macos")]
#[test]
fn on_macos_a_backend_exists() {
    // Only the cfg is checked. `start` is NOT called: it would ask macOS for the Screen Recording
    // permission.
    assert!(is_supported());
}
