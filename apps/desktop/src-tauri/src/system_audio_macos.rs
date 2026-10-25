// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

//! macOS backend of the system-audio adapter: ScreenCaptureKit with audio only (macOS 13+).
//!
//! It filters a whole display (the audio of every application except Phoenix itself), asks for
//! 16 kHz mono, and adds one `SCStreamOutput` of type Audio. No screen output is added, and the
//! video side is set to 2x2 pixels at 1 fps so almost nothing is produced for it; no frame is
//! ever read, stored or sent. Each audio sample buffer is turned into a [`RawAudio`] (format taken
//! from the buffer's own `AudioStreamBasicDescription`, so a different rate or layout than asked
//! for is still converted correctly) and given to the [`Engine`].
//!
//! NOT RUN. Nothing here was ever executed against a real ScreenCaptureKit: that needs a display
//! session, the Screen Recording permission for the host binary and a person-bound consent that
//! does not exist yet. What is only reasoned: that the display filter yields system audio with the
//! current-process exclusion, that the OS honours 16 kHz mono (the conversion does not depend on
//! it), the permission prompt flow, the error codes mapped below, and the queue/threading
//! behaviour. The pure conversion and the lifecycle are tested in `system_audio_tests.rs`; this
//! file only compiles under `cfg(target_os = "macos")` and is checked by clippy there.
//!
//! Limits of zeroing here: the sample buffer, and any copy CoreMedia makes of non-contiguous data,
//! belong to the OS and are read-only for us. We never write to them and cannot wipe them.

use crate::system_audio::{
    CaptureBackend, CaptureError, EndReason, Engine, Plane, RawAudio, SampleFormat,
    MAX_INPUT_CHANNELS, SAMPLE_RATE,
};
use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchQueueAttr, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker};
use objc2_core_audio_types::{
    kAudioFormatFlagIsBigEndian, kAudioFormatFlagIsFloat, kAudioFormatFlagIsSignedInteger,
    kAudioFormatLinearPCM, AudioBufferList,
};
use objc2_core_media::{
    CMAudioFormatDescriptionGetStreamBasicDescription, CMBlockBuffer, CMSampleBuffer, CMTime,
    CMTimeFlags,
};
use objc2_foundation::{
    NSArray, NSError, NSObject, NSObjectProtocol, NSOperatingSystemVersion, NSProcessInfo,
};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCShareableContent, SCStream, SCStreamConfiguration,
    SCStreamDelegate, SCStreamOutput, SCStreamOutputType,
};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr::{null_mut, NonNull};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

/// How long to wait for the OS to answer a start, stop or content query.
const OS_TIMEOUT: Duration = Duration::from_secs(10);
/// `SCStreamErrorCode`: the person declined, and the stream was not running when asked to stop.
const ERR_USER_DECLINED: isize = -3801;
const ERR_STOP_STATE: isize = -3808;

struct OutputIvars {
    engine: Arc<Engine>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and this class has no Drop.
    #[unsafe(super(NSObject))]
    #[ivars = OutputIvars]
    #[name = "PhoenixSystemAudioOutput"]
    struct SckOutput;

    unsafe impl NSObjectProtocol for SckOutput {}

    unsafe impl SCStreamOutput for SckOutput {
        #[unsafe(method(stream:didOutputSampleBuffer:ofType:))]
        #[allow(non_snake_case)]
        unsafe fn stream_didOutputSampleBuffer_ofType(
            &self,
            _stream: &SCStream,
            sample_buffer: &CMSampleBuffer,
            kind: SCStreamOutputType,
        ) {
            if kind != SCStreamOutputType::Audio {
                return;
            }
            let engine = &self.ivars().engine;
            // A panic must never unwind into ScreenCaptureKit.
            let outcome = catch_unwind(AssertUnwindSafe(|| deliver(engine, sample_buffer)));
            match outcome {
                Ok(Ok(())) => {}
                Ok(Err(why)) => engine.fail(EndReason::BadFormat(why)),
                Err(_) => engine.fail(EndReason::BadFormat("internal error")),
            }
        }
    }

    unsafe impl SCStreamDelegate for SckOutput {
        #[unsafe(method(stream:didStopWithError:))]
        #[allow(non_snake_case)]
        unsafe fn stream_didStopWithError(&self, _stream: &SCStream, _error: &NSError) {
            self.ivars().engine.fail(EndReason::SystemStopped);
        }
    }
);

impl SckOutput {
    fn new(engine: Arc<Engine>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(OutputIvars { engine });
        // SAFETY: plain `init` of an NSObject subclass.
        unsafe { msg_send![super(this), init] }
    }
}

/// Reads one audio sample buffer and feeds the engine.
///
/// # Safety
/// `buffer` must be a valid audio `CMSampleBuffer` for the duration of the call (ScreenCaptureKit
/// guarantees this inside the output callback).
unsafe fn deliver(engine: &Engine, buffer: &CMSampleBuffer) -> Result<(), &'static str> {
    let desc = buffer.format_description().ok_or("no format description")?;
    // SAFETY: `desc` is an audio format description; the pointer is read-only and valid while it lives.
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(&desc) };
    let asbd = unsafe { asbd.as_ref() }.ok_or("not an audio format")?;
    if asbd.mFormatID != kAudioFormatLinearPCM {
        return Err("not linear PCM");
    }
    if asbd.mFormatFlags & kAudioFormatFlagIsBigEndian != 0 {
        return Err("big-endian samples");
    }
    let format = if asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0 && asbd.mBitsPerChannel == 32 {
        SampleFormat::F32
    } else if asbd.mFormatFlags & kAudioFormatFlagIsSignedInteger != 0 && asbd.mBitsPerChannel == 16
    {
        SampleFormat::I16
    } else {
        return Err("unsupported sample format");
    };
    let rate = asbd.mSampleRate;
    if !(rate.is_finite() && rate >= 1.0 && rate <= f64::from(u32::MAX)) {
        return Err("bad sample rate");
    }

    // Two calls: the first asks how large the AudioBufferList is, the second fills it. The list is
    // a variable-length struct; a u64 backing store gives it the alignment it needs.
    let mut needed = 0usize;
    // SAFETY: only `needed` is written when no list is given.
    let status = unsafe {
        buffer.audio_buffer_list_with_retained_block_buffer(
            &mut needed,
            null_mut(),
            0,
            None,
            None,
            0,
            null_mut(),
        )
    };
    if status != 0 || needed < std::mem::size_of::<AudioBufferList>() || needed > 4096 {
        return Err("audio buffer list size");
    }
    let mut backing = vec![0u64; needed.div_ceil(8)];
    let list = backing.as_mut_ptr().cast::<AudioBufferList>();
    let mut block: *mut CMBlockBuffer = null_mut();
    // SAFETY: `list` has room for `needed` bytes and is 8-byte aligned.
    let status = unsafe {
        buffer.audio_buffer_list_with_retained_block_buffer(
            null_mut(),
            list,
            needed,
            None,
            None,
            0,
            &mut block,
        )
    };
    // The block buffer owns the memory the list points at; dropping it releases it (also on errors).
    let _block =
        NonNull::new(block).map(|p| unsafe { objc2_core_foundation::CFRetained::from_raw(p) });
    if status != 0 {
        return Err("audio buffer list");
    }
    // SAFETY: filled by CoreMedia just above.
    let count = unsafe { (*list).mNumberBuffers } as usize;
    if count == 0 || count > MAX_INPUT_CHANNELS {
        return Err("buffer count");
    }
    // The flexible array member starts at `mBuffers`; `needed` covers `count` entries.
    let first = unsafe {
        std::ptr::addr_of!((*list).mBuffers).cast::<objc2_core_audio_types::AudioBuffer>()
    };
    let empty: Plane = Plane {
        data: &[],
        channels: 0,
    };
    let mut planes = [empty; MAX_INPUT_CHANNELS];
    for (i, slot) in planes.iter_mut().enumerate().take(count) {
        // SAFETY: i < count and the list holds `count` entries.
        let b = unsafe { &*first.add(i) };
        if b.mData.is_null() {
            return Err("null audio data");
        }
        // SAFETY: CoreMedia guarantees `mDataByteSize` readable bytes while `_block` lives.
        let data =
            unsafe { std::slice::from_raw_parts(b.mData.cast::<u8>(), b.mDataByteSize as usize) };
        *slot = Plane {
            data,
            channels: b.mNumberChannels as usize,
        };
    }
    engine.feed(&RawAudio {
        sample_rate: rate as u32,
        format,
        planes: &planes[..count],
    });
    Ok(())
}

/// Wraps an Objective-C object so it can cross to the thread that waits for a completion handler.
struct SendBox<T>(T);
// SAFETY: the wrapped ScreenCaptureKit objects are only handed over once and used by one thread at
// a time; Apple documents the completion handlers as running on arbitrary queues.
unsafe impl<T> Send for SendBox<T> {}

fn describe(error: *mut NSError) -> (isize, String) {
    // SAFETY: the OS passes either null or a valid NSError for the duration of the handler.
    match unsafe { error.as_ref() } {
        None => (0, String::new()),
        Some(e) => (e.code(), e.localizedDescription().to_string()),
    }
}

fn map_error(code: isize, text: String) -> CaptureError {
    if code == ERR_USER_DECLINED {
        CaptureError::PermissionDenied
    } else {
        CaptureError::Backend(format!("{text} (code {code})"))
    }
}

pub struct SckBackend {
    display: Option<SendBox<Retained<SCDisplay>>>,
    stream: Option<Retained<SCStream>>,
    output: Option<Retained<SckOutput>>,
    queue: Option<DispatchRetained<DispatchQueue>>,
}

// SAFETY: the backend is only used through `&mut self` under a Mutex (one thread at a time); the
// retained objects are thread-safe ScreenCaptureKit objects.
unsafe impl Send for SckBackend {}

impl SckBackend {
    /// Checks what can be checked without asking the OS to capture: system version, thread and
    /// the Screen Recording permission (asking for it if missing, which shows the OS prompt; the
    /// person already consented to this recording, and macOS usually needs a relaunch after
    /// granting it, so this start still fails).
    pub fn new() -> Result<Self, CaptureError> {
        if MainThreadMarker::new().is_some() {
            return Err(CaptureError::WrongThread);
        }
        let v13 = NSOperatingSystemVersion {
            majorVersion: 13,
            minorVersion: 0,
            patchVersion: 0,
        };
        if !NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(v13) {
            return Err(CaptureError::OsTooOld);
        }
        let access = core_graphics::access::ScreenCaptureAccess;
        if !access.preflight() {
            let _ = access.request();
            return Err(CaptureError::PermissionDenied);
        }
        Ok(Self {
            display: None,
            stream: None,
            output: None,
            queue: None,
        })
    }

    fn first_display() -> Result<SendBox<Retained<SCDisplay>>, CaptureError> {
        let (tx, rx) = mpsc::channel::<Result<SendBox<Retained<SCDisplay>>, CaptureError>>();
        let handler = RcBlock::new(
            move |content: *mut SCShareableContent, error: *mut NSError| {
                let answer = match unsafe { content.as_ref() } {
                    Some(content) => unsafe { content.displays() }
                        .firstObject()
                        .map(SendBox)
                        .ok_or_else(|| CaptureError::Backend("no display to capture from".into())),
                    None => {
                        let (code, text) = describe(error);
                        Err(map_error(code, text))
                    }
                };
                let _ = tx.send(answer);
            },
        );
        // SAFETY: the block is valid for the call; the OS copies it.
        unsafe { SCShareableContent::getShareableContentWithCompletionHandler(&handler) };
        rx.recv_timeout(OS_TIMEOUT)
            .map_err(|_| CaptureError::Timeout)?
    }

    fn wait(rx: &mpsc::Receiver<(isize, String)>) -> Result<(), CaptureError> {
        let (code, text) = rx
            .recv_timeout(OS_TIMEOUT)
            .map_err(|_| CaptureError::Timeout)?;
        if code == 0 && text.is_empty() {
            Ok(())
        } else {
            Err(map_error(code, text))
        }
    }
}

impl CaptureBackend for SckBackend {
    fn start(&mut self, engine: Arc<Engine>) -> Result<(), CaptureError> {
        let display = Self::first_display()?;
        self.display = Some(SendBox(display.0.clone()));

        // SAFETY: plain construction and property setters of ScreenCaptureKit objects.
        let (stream, output, queue) = unsafe {
            let filter = SCContentFilter::initWithDisplay_excludingWindows(
                SCContentFilter::alloc(),
                &display.0,
                &NSArray::new(),
            );
            let config = SCStreamConfiguration::new();
            config.setCapturesAudio(true);
            config.setExcludesCurrentProcessAudio(true);
            config.setSampleRate(SAMPLE_RATE as isize);
            config.setChannelCount(1);
            // No screen output is added; keep whatever the OS still renders for it tiny and slow.
            config.setWidth(2);
            config.setHeight(2);
            config.setMinimumFrameInterval(CMTime {
                value: 1,
                timescale: 1,
                flags: CMTimeFlags::Valid,
                epoch: 0,
            });
            config.setQueueDepth(3);
            config.setCaptureMicrophone(false);
            config.setShowsCursor(false);

            let output = SckOutput::new(engine);
            let stream = SCStream::initWithFilter_configuration_delegate(
                SCStream::alloc(),
                &filter,
                &config,
                Some(ProtocolObject::from_ref(&*output)),
            );
            let queue = DispatchQueue::new(
                "dev.phoenix.desktop.system-audio",
                DispatchQueueAttr::SERIAL,
            );
            (stream, output, queue)
        };
        // Keep everything alive from here on so `stop` can undo a half-done start.
        self.output = Some(output);
        self.queue = Some(queue);
        self.stream = Some(stream.clone());
        let output = self.output.as_ref().expect("just set");
        let queue = self.queue.as_ref().expect("just set");
        // SAFETY: the queue is a serial queue owned by this backend for the stream's lifetime.
        unsafe {
            stream
                .addStreamOutput_type_sampleHandlerQueue_error(
                    ProtocolObject::from_ref(&**output),
                    SCStreamOutputType::Audio,
                    Some(queue),
                )
                .map_err(|e| map_error(e.code(), e.localizedDescription().to_string()))?;
        }
        let (tx, rx) = mpsc::channel::<(isize, String)>();
        let done = RcBlock::new(move |error: *mut NSError| {
            let _ = tx.send(describe(error));
        });
        // SAFETY: the block is valid for the call; the OS copies it.
        unsafe { stream.startCaptureWithCompletionHandler(Some(&done)) };
        Self::wait(&rx)
    }

    fn stop(&mut self) -> Result<(), CaptureError> {
        let Some(stream) = self.stream.clone() else {
            return Ok(());
        };
        let (tx, rx) = mpsc::channel::<(isize, String)>();
        let done = RcBlock::new(move |error: *mut NSError| {
            let _ = tx.send(describe(error));
        });
        // SAFETY: the block is valid for the call; the OS copies it.
        unsafe { stream.stopCaptureWithCompletionHandler(Some(&done)) };
        let answer = rx.recv_timeout(OS_TIMEOUT).map_err(|_| {
            CaptureError::StopUnconfirmed("the system did not answer the stop in time".into())
        })?;
        // "Not running" means there is nothing left to stop (for example the OS already ended it).
        if answer.0 != 0 && answer.0 != ERR_STOP_STATE {
            return Err(CaptureError::StopUnconfirmed(format!(
                "{} (code {})",
                answer.1, answer.0
            )));
        }
        if let Some(output) = self.output.as_ref() {
            // SAFETY: the output was added for this type in `start`; a failure here is harmless.
            let _ = unsafe {
                stream.removeStreamOutput_type_error(
                    ProtocolObject::from_ref(&**output),
                    SCStreamOutputType::Audio,
                )
            };
        }
        self.stream = None;
        self.output = None;
        self.queue = None;
        self.display = None;
        Ok(())
    }
}
