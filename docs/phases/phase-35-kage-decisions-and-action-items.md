# Phase 35 — Kage Decisions & Action-Item Extraction

| Field | Value |
|---|---|
| Stage | Stage 6 — Meeting → Engineering (v0.6) |
| Release target | v0.6 |
| Priority | High |
| Status | 🟨 Library built; not wired into Core or the web app |
| Depends on | [Phase 33 — AI Evaluation Harness & v0.4 Release](phase-33-ai-evaluation-harness.md), [Phase 16 — Meetings UI & Recording Indicator](phase-16-meetings-ui.md) |
| Unblocks | [Phase 36 — Action Items → Engineering Tasks](phase-36-action-items-to-engineering-tasks.md) |

## Goal

Turn meeting artifacts into reviewable decisions and action items.

## Scope

**In scope**

- Decision + ActionItem entities
- Extraction (from Kage or AI layer)
- Review UI
- Meeting search/Q&A over authorised archive

## Tasks

- [x] Extract decisions, requirements, action items, topics, project references (Kage import + grounded AI extraction)
- [x] Review service: accept / edit / reject / reopen (the web UI is built by the parent, see notes)
- [x] Treat transcripts as untrusted input (prompt-injection tests: 24 adversarial transcripts)
- [x] Search + ask questions over meeting archive

## Deliverables

- Decision/action-item pipeline

## Exit criteria

- [ ] Decisions and action items reviewable inside Phoenix (service done; open until Core routes and the web review panel exist)

## Implementation notes

Package `ai/meetings` (`@phoenix/ai-meetings`), migration version 9 (`meeting_items`).

**Entities.** One table, `meeting_items`, with `kind` = decision | action_item | requirement | topic | project_ref. Each row has text, optional owner/due (action items only), `status`, `extracted_by` (`kage` | `ai:<provider>/<model>` | `manual`), `evidence` (a verbatim quote, `source` transcript or summary, segment indices and character offsets when known), `original` (the extracted wording, kept by the first edit), and created/reviewed times and reviewer. Every review action writes an audit record with ids, kinds, statuses and counts, never text.

**Status transitions** (`STATUS_TRANSITIONS`, tested for all 16 pairs):

| from | to |
|---|---|
| proposed | accepted, edited, rejected |
| edited | accepted, rejected |
| accepted | rejected |
| rejected | proposed (reopen: back in the queue, never straight to accepted) |

`edit` is its own action: proposed/edited -> edited; accepted stays accepted (the new text replaces the memory fact); rejected cannot be edited until reopened. Items typed by the user (`manual`) start accepted. A machine can never create anything but `proposed`: the store hard-codes it and a database trigger refuses any other insert for a non-manual `extracted_by`.

**Extraction.** (a) `importKage` turns `summary.decisions`, `summary.action_items` and `summary.topics` into `proposed` items (`extracted_by: kage`), finding each in the transcript when it can; unreviewed Kage items that a regenerated summary no longer produces are removed, reviewed ones stay. (b) `extractWithAi` calls an injected `GenerateFn` per chunk (6,000 characters, 8 chunks at most, 40 items per meeting). The request is `privacy: "sensitive"` with a purpose that is not in `SENSITIVE_CLOUD_PURPOSES`, so even a user who opted in to cloud AI for sensitive data does not send transcripts to the cloud this way; with AI off, or no allowed provider, extraction reports why and only (a) runs.

**Grounding check.** An item survives only if its `quote` is a whitespace/case/invisible-character/typographic-quote normalised substring of the transcript, is 2+ words and 8..600 characters, and shares at least half of the item text's content words (so a real quote cannot be attached to a made-up claim). Otherwise the item is dropped and counted by reason. An owner is kept only if the quote names them or they are the speaker of the quoted line; a due date only if it is in the quote. Near-duplicates (same kind, word overlap 0.8) and items the meeting already has are skipped; a rejected item is never re-proposed.

**Prompt-injection hardening.** The model has no tools. The reply is parsed as data and rebuilt from the five known fields (anything else is discarded and counted); there is no field that can carry a status, a tool call or a capability action. The transcript sits between `<<<TRANSCRIPT nonce>>>` markers with a fresh random nonce per call, invisible and control characters removed, and the nonce itself removed from the text. `test/injection-corpus.ts` holds 24 attacks, each with the reply of a model that obeyed it; `test/injection.test.ts` runs five properties over every one. A phrase that is only inside an injected "instruction" but is quoted verbatim may be extracted as a *proposed* item (reviewable, and tested to be rejectable); that is allowed by design.

**Memory.** Only `accepted` decisions and action items are memory facts: source `meeting-review`, scope `meeting:<id>`, domain `meeting`, kind `fact`, sensitivity `sensitive`, provenance with the meeting id, item id, who extracted and who reviewed it, and the evidence offsets. After every review action memory is re-derived from the accepted set for that meeting, so an edit replaces the fact, and rejecting or reopening removes it. Deleting the meeting (`MeetingStore.delete` / `deleteBefore`) removes the items and the facts in the database itself, through a trigger in migration 9 (the facts' FTS and vector index rows go through the existing memory triggers).

**Search and ask.** `searchMeetings` and `askAboutMeetings` read memory domain `meeting` through the viewer's grants inside the search, so a meeting the viewer cannot see takes no result slot and shows in no count. Hits say whether a fact is `reviewed` (accepted in Phoenix) or from Kage's summary, and cite meeting id and item id. `ask` keeps stored facts apart from the labelled interpretation.

**Wiring still to do** (parent): construct `MeetingItemService`, subscribe after meeting sync, add routes and the review panel, and add `meeting-review` to the memory policy's enabled sources. See `sharedEditsNeeded` in the phase result.

## Source documents

- Post-MVP Roadmap v1.0 §8
- Fawkes PRD v1.0 §9.2
- AI Evolution v1.0→v2.0 §18

---
Back to [TRACKER](TRACKER.md)
