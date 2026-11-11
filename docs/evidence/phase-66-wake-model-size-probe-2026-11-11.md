# Phase 66: does a larger Whisper model write "Fawkes"? (diagnostic probe)

Date: 2026-11-11 (local), whisper.cpp 1.8.6 (`whisper-cli`), macOS 27.0.1.

This is a small manual probe, not a gated test and not a measurement of the wake matcher. It
was run after the 191-clip wake measurement
([phase-66-real-wake-2026-11-11.md](phase-66-real-wake-2026-11-11.md)) showed that
`ggml-tiny.en` never wrote "Fawkes". Nothing in Phoenix was changed.

## Models (downloaded from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/`)

| Model                             | Bytes       | SHA-1                                      |
| --------------------------------- | ----------- | ------------------------------------------ |
| `ggml-base.en.bin`                | 147,964,211 | `137c40403d78fd54d454da0f9bd998f78703390c` |
| `ggml-small.en.bin`               | 487,614,201 | `db8a495a91d927739e50b3fc1cc4c6b8f6c2d022` |
| `ggml-tiny.en.bin` (earlier runs) | 77,704,715  | `c78c86eb1a8faa21b369bcd33207cc90d64ae9df` |

## Method

Four sentences were rendered with five macOS `say` voices (Samantha, Daniel, Karen, Moira,
Rishi; synthetic voices, not people), converted with `afconvert -f WAVE -d LEI16@16000 -c 1`, and
decoded with `whisper-cli -m <model> -nt -np -f <clip>.wav`. Two sentences are wake phrases and
two are near misses:

1. wake: "OK Fawkes, what is the time"
2. wake: "Okay Fawkes, show me my ports"
3. near miss: "OK folks, what is the time"
4. near miss: "Okay fox, what does the fox say"

20 clips per model. The sentences were fixed before the run. Each clip was run once.

## Result

Wake clips (1 and 2, 10 clips per model): **"Fawkes" was written 0 of 10 times by `base.en` and
0 of 10 times by `small.en`.**

| Model      | Heard in place of "Fawkes" (10 wake clips)               |
| ---------- | -------------------------------------------------------- |
| `base.en`  | "Fox" ×6, "folks" ×1, "forks" ×1, "Forgs" ×1, "forgs" ×1 |
| `small.en` | "Fox" ×3, "folks" ×6, "Forgs" ×1                         |

Near misses (3 and 4): both models wrote "folks" and "Fox" correctly. So the recogniser does
distinguish those words; it simply maps the spoken name "Fawkes" onto "Fox" or "folks".

Other words also drift ("my ports" as "my chords", "my pours", "my cords"), which is ordinary
recognition error and not specific to the name.

## What this does and does not show

- It shows that moving from `tiny.en` to `base.en` or `small.en` does not make Whisper write the
  name. A bigger English model is not a ready fix for the wake decision.
- It does not test multilingual or larger models (`medium`, `large`), a keyword spotter, or a
  recogniser fine-tuned or biased for the name.
- A name-only `--prompt "Fawkes."` was tried earlier on `tiny.en` and changed none of 6 wake
  clips; a prompt containing the whole phrase makes the recogniser echo it, which proves
  nothing. Neither was saved as a test.
- Synthetic system voices, one run per clip, three or five voices, English only, no person, no
  microphone, one machine.
