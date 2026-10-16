# Phase 62 — Drop Files & Attach Windows as Context

| Field | Value |
|---|---|
| Stage | Stage 12 — Coucou parity and beyond |
| Release target | Post-v2.0 track |
| Priority | Medium |
| Status | 🟨 Attachments (files, folders, images) in the web chat and Pet Panel, local-only Ask and a mailto draft built and tested with fakes; desktop native file drop and window capture not built; no real Finder drag, no real local model answer, no local vision model run |
| Depends on | [Phase 32 — Fawkes Chat & Approval UX](phase-32-fawkes-chat-and-approval-ux.md), [Phase 63 — More AI Providers & Model Switcher](phase-63-more-ai-providers.md) |
| Unblocks | — |

## Goal

Give Fawkes context by dropping a file on it or dragging it onto a window.

## Tasks — parity with Coucou

- [x] Drop a file on Fawkes, then ask a question about it: drop on the chat box or on the Pet Panel overview's "Drop files on Fawkes" target, plus an "Attach files…" picker; held in Core's memory (`core/runtime/src/attachments.ts`, `core/api/src/attachment-routes.ts`), asked through `POST /api/attachments/ask` with the prompt from `ai/context/src/attachments.ts`. Tests: `core/runtime/test/attachments.test.ts`, `core/runtime/test/attachments-prompt.test.ts`, `apps/web/test/attachments.test.tsx` ("dropping on the chat box", "Ask about attachments", "the Pet Panel drop target"). Limits of "drop on Fawkes": the drop is handled by web pages (chat box, Pet Panel overview); there is no drop on the floating or island Fawkes window itself, because the desktop shell has no file-drop handling (see below). The drags in the tests are synthetic events built by the test; no real Finder drag was made.
- [x] Send it by email (draft only, the user sends): `buildMailto` / `openMailto` (`apps/web/src/core/attachments.ts`, form in `Attachments.tsx`) and the `open_mailto` Tauri command (`apps/desktop/src-tauri/src/mailto.rs`, `lib.rs`). No recipient by default, nothing is sent by Phoenix, the user edits and sends from their mail app. Tests: `apps/web/test/attachments.test.tsx` ("draft email"), seven Rust unit tests in `mailto.rs` (scheme, length, control and bidi characters). No mail app was opened for real, and `open_mailto` is not covered by `tests/lifecycle.rs`.
- [ ] Drag Fawkes onto a window to attach that window as context (macOS). Not built: no Accessibility window capture and no drag handling exist in `apps/desktop`. Core accepts the attachment origin `window` (`attachments.test.ts` "bounds each origin: 3 windows, 5 pastes"), which is the only part present.

## Tasks — Phoenix improvements

- [x] Folders and images with local vision when available: a dropped folder is walked in the browser (entry API, dot-directories, `node_modules` and `.git` skipped, 200 files at most) and sent as a listing with text; an image is described by a local Ollama vision model and the description is what is asked about. Tests: `attachments.test.tsx` ("a folder: walked with the entry API…", "an image: read with FileReader…"), `attachments.test.ts` ("folder listings", "images need a local vision model", driven by a fake network). The local vision path was only run against a fake Ollama: no vision model was installed or run. Phoenix does not capture screenshots; a screenshot only counts if it is dropped as an image file. Core accepts the origin `paste`, but no page sends it (the web code always posts origin `drop`).
- [x] Context stays local unless an external AI purpose is opted in. Built stricter than written: the Ask purpose is fixed and deliberately outside the sensitive-cloud allow-list, so no cloud provider is used even with every opt-in (`attachments.test.ts` "asking is local only": with every opt-in on and Ollama down no cloud request is made, and a cloud route chosen by the user is still refused by the gate). Whether a user may ever opt attached files into cloud AI is an owner decision ([gap register](../gaps.md)).
- [x] Attached context is visible and removable before anything is sent: the tray lists each attachment with a "Local only" badge and a Preview, Remove and Clear all, and the Ask button names how much will be sent and where (`attachments.test.tsx` "the tray", "removal before anything is asked", "shows how much will be sent and where").

## Deliverables

- Drop target in web (built: chat box and Pet Panel overview) and desktop (not built: no native drop on the floating or island window)
- Window-context capture (macOS Accessibility): not built

## Exit criteria

- [ ] A dropped file answers a question with a local model. Not demonstrated. `attachments.test.ts` gets an answer through Core with a fake Ollama network, and `attachments.test.tsx` drives the drop with synthetic events; no real Finder drag was made and no real local model answered a question about a real dropped file.

## Implementation notes

- **Storage.** In memory only: at most 10 attachments, 8 MiB in total, 200,000 characters of text, 5 MiB per decoded image, a one-hour lifetime judged by an injected clock, cleared by the emergency stop; no event, audit row, log line or database table holds content (`attachments.test.ts` "content is held in memory only"). `POST /api/attachments` accepts a body up to `ATTACHMENT_BODY_MAX_BYTES` (7 MiB); every other route keeps 256 KiB (`attachments-body-limit.test.ts`).
- **Prompt.** Attached content is data between per-call nonce delimiters, stripped of control, bidi and zero-width characters; the reply is cleaned and refused when empty or too long (`attachments-prompt.test.ts`).
- **Mailto.** The page builds the `mailto:` URL (subject, body and an optional typed recipient, percent-encoded, 1,900 characters at most) and the shell checks only that it starts with lowercase `mailto:`, is at most 2,000 characters and contains no control, bidi or zero-width character. It does not check the recipients or headers, so a window page that builds `bcc=` can put an address in the draft; the user still has to press send.

What was not done or not run: native file drop on the floating and island windows (Tauri `DragDropEvent`), macOS Accessibility window capture, a real Finder drag, a real local model answer, any local vision model, a real mail app opened by `open_mailto`. Open items are in the [gap register](../gaps.md).

## Notes & risks

- Phoenix uses its own assets; nothing from Coucou's asset list (names, Mochi, sounds, icons, media).
- Any copied or closely translated MIT code keeps its notice and goes in the licence inventory.
- Side effects go through the permission/tool gateway and the audit log; untrusted content is data, never instructions.

## Source documents

- Coucou & Insomnia audit: [coucou-insomnia-audit.md](../audits/coucou-insomnia-audit.md)
- Full System PRD v2.0 §3.1 (principles), §18 (threat model); Tech Spec Suite §09 (security)

---
Back to [TRACKER](TRACKER.md)
