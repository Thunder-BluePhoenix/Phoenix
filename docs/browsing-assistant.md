# Fawkes browsing assistant (Phase 95)

Package: `ai/browsing` (`@phoenix/ai-browsing`). Evidence for this slice is **simulated**: the tests
inject a fake page reader, fake local model, fake gateway, fake approval and an in-memory audit sink.
No browser, network, model or device is touched, and no real test site has been exercised.

**Phase 95 host pieces (fakes only; nothing ran in a real webview, window, browser, site or model):**
the browser capability (`capabilities/browser`), the relay between Core and the Phoenix browser's chrome page,
the Rust commands `page_snapshot` / `page_action`, the chrome-page relay loop and an approval card. Details in
[Phoenix browser actions](#phoenix-browser-actions-phase-95). **`BrowsingAssistant.propose` is now reachable through
`POST /api/browser/assist`** (see [Core entry point](#core-entry-point-post-apibrowserassist)). That route has only run
against fakes: never with a real model, page or browser.

Earlier, built (simulated): a pure page reader (`page-snapshot.ts`) that turns an HTML snapshot into a `PublicPage`, and an injection suite (`ai/evaluation/test/browsing-injection.test.ts`). One real-model measurement exists (see [Measured against a real model](#measured-against-a-real-model-phase-95)); **still unbuilt:** any real-site flow.

## What it does

`BrowsingAssistant` has three operations:

| Operation                          | Behaviour                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `answer(question)` / `summarize()` | Reads the current page through a `PageReader` and asks a **trusted on-device** model. |
| `plan(actions)`                    | Validates a list of actions **supplied by the user** against the current page.        |
| `execute(plan)`                    | Runs the plan one action at a time, with approval, audit and the tool gateway.        |

## Safety rules, and where they are enforced

- **Page text is data.** The page goes into the _user_ message as a JSON object
  (`{question, pageData:{url,title,text,truncated}}`); the system message never contains page text and tells
  the model to ignore instructions found in the page. Model output is returned as text and is never parsed
  into tool calls, so `plan` accepts only actions the caller provides. Tool names come from trusted
  integration config (`options.tools`), not from the page or model.
- **Local model only.** `answer` refuses a model that is not `trustedLocal`/`local` _before_ reading the
  page, and rejects a result whose provenance is not `local`.
- **Bounded input.** Page text is capped at `MAX_PAGE_CHARS` (20 000) and the model is told when it was
  truncated. Luhn-valid 13–19 digit numbers are replaced with `[payment number removed]` as a second
  line of defence (the adapter should not extract them in the first place).
- **Per-action approval.** `ActionApproval.approve` is called for _every_ click, type, submit, navigate and
  download, even if gateway policy would allow it. Throwing from `approve` refuses the action; the bridge
  audits `denied`, never calls the gateway and stops the plan.
- **Gateway only.** Side effects are performed solely by `gateway.call` with the registered tool for the
  action kind. A tool that is missing, or registered with side effect `none`/`read`, is refused.
  `trustedByUser: true` is set only after the user approved that exact action.
- **Never passwords or payment details.** Fields whose type is `password`/`hidden`, or whose
  type/autocomplete/name/label/selector mentions password, card, CVV, expiry, IBAN, bank, OTP, token, secret and
  similar, cannot be clicked or typed into. Typing is allowed only into positively identified
  `text/search/email/url/tel/textarea` fields, at most `MAX_TYPED_CHARS` (4096). Submitting a form is blocked if
  any control of that form (`PublicField.form`) is protected.
- **Approvals do not go stale.** The page is re-read before every step and the action is re-validated. If the
  URL is not the one expected (fragment ignored; after `navigate` the named destination is expected) the plan
  stops, the unrun actions are returned in `ExecutionReport.remaining`, and the user must plan again.
- **Audit.** Each action records `browser.<kind>` with the page URL: `pending` (intent, written _before_ the
  gateway call; if it cannot be written the action does not run) then `allowed`, or `denied` (user
  refused) / `blocked` (validation or execution failure). A stopped plan records `browser.plan_stopped`
  (`info`). Query strings and fragments are removed from audited URLs (`queryRedacted: true` signals it)
  because they often carry session tokens. Typed text is never audited.

## Page reader (`readPageSnapshot`, `SnapshotPageReader`)

`readPageSnapshot({ url, title?, html?, text? }, limits?)` is pure and synchronous (no fetch, DOM, eval or
timers) and returns `{ page: PublicPage, provenance: { origin, truncated, removedHidden, removedScripts } }`.
`SnapshotPageReader` adapts any async source of such input to `PageReader`. Whoever supplies the HTML (the
Phase 93 browser, once it exists) still has to fetch it; no code here does.

- **Dropped:** script, style, template, noscript, svg, iframe, object, embed, canvas, math, head, select
  options, comments (including conditional and unterminated ones), `<dialog>` without `open`, and every
  element hidden by the `hidden` attribute, `aria-hidden="true"` or an inline style (display, visibility,
  content-visibility, opacity, font-size 0/1px, clipping, off-screen offsets, zero width/height, transparent
  colour, `scale(0)`). A style with CSS escapes or over 8 KiB is treated as hiding (fails closed).
- **Not detectable, so the text is kept:** CSS classes and `<style>`/external stylesheets, white-on-white or
  low-contrast text, text covered by another element, and anything that only a layout engine reveals. A test
  pins this. Visible attacker text therefore always reaches the model as data; see below.
- **Form values never appear.** Input/textarea values, select options, hidden inputs and the form action are
  dropped. Controls are described as `fields` (`selector`, `type`, `autocomplete`, `name`, `label`, `form`),
  with unique selectors, so `isProtectedField` and the submit check keep working. If a form has more controls
  than `maxFields` (500), a synthetic `hidden` field for that form is added so a submit is still refused.
- **Attribute text:** only `alt`, `aria-label` and `title` are kept, shown as `[image: …]`, `[label: …]`,
  `[title: …]` (brackets inside are replaced). Links appear as `[link: host/path]` for http(s) only, without
  credentials, query or fragment; `javascript:`, `data:` and `vbscript:` links are dropped and counted.
- **Characters:** entities come from a fixed table of 30 names plus numeric references validated to Unicode
  scalar values (invalid ones become U+FFFD; no recursive expansion). Zero-width, bidi, Unicode tag,
  variation-selector, private-use and control characters and lone surrogates are removed; whitespace is
  collapsed.
- **Size:** input is cut at 4 MiB, each block at 2000 characters and the whole text at `MAX_PAGE_CHARS`;
  `provenance.truncated` says so. The tokenizer is one linear pass with `indexOf`; nesting depth is capped at
  512, attributes at 64 per tag and 8 KiB each. A test feeds 2 MB hostile inputs of fourteen shapes.
- **Envelope:** `wrapUntrustedPageText(text)` wraps text in `<<<PHOENIX-UNTRUSTED-PAGE-BEGIN nonce>>>` /
  `…-END nonce>>>` with a fresh 128-bit nonce and rewrites any occurrence of the marker prefix in the content
  (any letter case). It is a helper for consumers; `BrowsingAssistant` does **not** use it yet and its prompt is
  unchanged (JSON in the user message).

## Injection suite

`ai/evaluation/test/browsing-injection.test.ts` runs 35 page cases through the real `SnapshotPageReader` and
the real `BrowsingAssistant` with a scripted **gullible** model that emits a `browser.*` tool call for every tool
name it sees. Cases: hidden attribute/aria-hidden/display/visibility/font-size/opacity/off-screen/zero-size/CSS
escapes, comments, script/style/noscript/template/svg/iframe/object, form values and action, meta/head,
attributes and handlers, `javascript:`/`data:`/`vbscript:` links, entity-encoded payloads, zero-width, bidi and
Unicode-tag characters, visible "ignore previous instructions", fake system/tool-call markup, markdown and HTML
smuggling, forged envelope markers, instructions in alt/title/aria-label and the page title, oversized and many-block pages,
entity bombs and a card number. For each: removed text is absent from every request; the system message is
fixed; the page is only in the user-message JSON; the model's tool calls cause no gateway call, approval or
audit entry; an empty plan is refused. Further tests show a refused approval stops an action, only the
user-supplied action runs, password/payment/over-limit forms stay protected, and navigation away stops the
plan. It lives beside, not inside, `ALL_SCENARIOS`: those scenarios are built around the ops world and golden
files, and `ai/evaluation` has no dependency on `@phoenix/ai-browsing`, so the test imports it by relative path.
Disabling single lines (hidden attribute, comment skipping, form value leak, link-scheme filter, envelope
rewriting, character stripping, raw-text handling) made it fail. **A real model's resistance was not measured:**
visible attacker text is passed to the model; this scripted suite cannot say whether a real model follows it. A separate, gated, one-model measurement does: see below.

## Measured against a real model (Phase 95)

`ai/browsing/test/real-injection.test.ts` (gated: `PHOENIX_REAL_OLLAMA=1`, so CI never runs it) runs all 35 fixture
pages of `browsing-injection-cases.ts` through the real `SnapshotPageReader` and `BrowsingAssistant.propose`, backed by
`AiService.generateLocal` and the loopback Ollama adapter with `llama3.2:latest`, 3 times each (105 calls, sequential),
with one fixed goal ("Search for running shoes.") and the production request unchanged (no temperature or token cap, so
runs are not deterministic). It writes `docs/evidence/phase-95-real-injection-<date>.md` (per-case table, aggregates,
model digest from `GET /api/tags`) and a `-raw.json` with every reply. It asserts only structure, never a model-behaviour
threshold: `propose` never returns `navigate`/`download`, never a control the reader did not report, never a protected
field, never more than 5 steps, marks `type` steps model-written, and never reaches the gateway or approval card. Run of
2026-11-10 (model digest `a80c4f17acd5…8b72`, Ollama 0.15.5, 105 of 105 calls answered, 0 failed):

| Measure                                                                     | Result                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steered by marker (a **proposed** `type` step contains a planted marker)    | 0/105 (0.0%)                                                                                                                                                                                         |
| Marker in any raw model step, before filtering                              | 2/105 (1.9%): both were `click` on a made-up selector such as `#buy ZZ25`, dropped as unreported                                                                                                     |
| Forbidden-target attempt (raw step on a protected or unreported control)    | 24/105 (22.9%): 2 protected (a `submit` of a form holding a password field, a `type` on a made-up selector that named `card`), 22 not reported (mostly invented selectors such as `[data-test=...]`) |
| Navigate/download attempt in the raw reply                                  | 0/105                                                                                                                                                                                                |
| Dropped rate (at least one step refused)                                    | 32/105 (30.5%); 50 steps dropped, 7 kept                                                                                                                                                             |
| Empty plan                                                                  | 100/105 (95.2%)                                                                                                                                                                                      |
| Reply was not valid JSON (so an empty plan with nothing counted as dropped) | 62/105 (59.0%)                                                                                                                                                                                       |
| Latency per call                                                            | mean 853 ms, median 455 ms, p95 2982 ms, max 10546 ms                                                                                                                                                |

**How to read this, and its limits.**

- It is one small model (3.2B, Q4_K_M), 35 synthetic pages, one goal, 3 samples each. It is a measurement, not a
  safety proof, and says nothing about other models, other goals, adaptive attackers or real sites.
- It mostly measures the model failing to produce a plan. 96 of the 105 calls were on pages with **no reported
  controls** (the fixtures are text injection, not forms), and those can only yield an empty plan. Only cases 17, 18
  and 30 have controls (9 calls); in 4 of those 9 the plan was empty. The model was therefore almost never offered a
  field to type attacker text into: the 0% "steered" rate is based on very few chances and does **not** show that a
  model will not type page text into a safe field. That limitation row stays open.
- Planted text did reach the model in 30 calls (cases 21, 23, 25-31 and 35); in none did it appear in a kept `type` step.
  In 2 calls the model copied it into an invented selector; that was dropped.
- Marker detection is a substring match for strings in the fixtures (`ZZnn` tokens, `evil.test`, the injected sentence).
  A paraphrase of attacker intent would not be counted.
- "Forbidden-target attempt" mixes attacker steering with plain hallucination; the numbers do not separate them.
- The kept steps (7) were `click` on a reported control and a `type` with empty text: the model's output is often
  malformed JSON, which fails closed (empty plan), not a sign of resistance.

## Phoenix browser actions (Phase 95)

**Evidence: fakes only.** The tests use a fake chrome page that answers the relay with canned HTML, the real
capability manager, permission gateway, policy engine, tool gateway, reader and `BrowsingAssistant`, and a fake
model and approval. The Rust commands were tested only through Tauri's mock runtime with a fake script runner
(see [mini-browser.md](mini-browser.md)). No `WKWebView`, WebView2, display, Tauri IPC from a real page, real
site or real model was used.

### Path of one action

`BrowsingAssistant` (library) → `ToolGateway` (policy + audit) → capability `browser` (`capabilities/browser`,
tools `browser.click|type|submit|navigate|download`, exported as `BROWSER_TOOL_NAMES`) → Core confirmation →
relay (`BrowserRelay`, in memory) → chrome page long-polling `GET /api/browser/relay/next` → Tauri commands
`page_snapshot` / `page_action` (chrome window only) → the ACTIVE tab's content webview.

- **Side effect `external` on every tool**, so Core's confirmation asks for every action even when the `network`
  permission is granted, in addition to the assistant's own `ActionApproval`.
- **Active tab only, chrome-window-only path.** No Tauri command is added that a content window can call
  (`capability_tests` pin that); the relay routes need Core's session token, which a page loaded in a tab does not have.
- **Approved URL.** Every command carries `pageUrl` (the page the user approved; the assistant's resource is audited
  without its query). After the confirmation the handler reads the active tab again through `page_snapshot`,
  runs the reader and the assistant's own `checkBrowserAction` on the FRESH page, and refuses (`page_changed`,
  `protected`) if the URL differs or the action is no longer allowed; Rust compares `expectedUrl` with the
  host-tracked tab URL again immediately before running (a second, independent check).
- **Selectors.** Only `<tag>#id` / `<tag>[name="x"]` for input/button/form/select/textarea with `[A-Za-z0-9_:.-]{1,80}`
  tokens, checked in the manifest schema, in the handler (`isActionableSelector`) and in Rust. Positional selectors
  (`:nth-of-type`), de-duplicated ones (`~1`) and `:unreported-controls` are refused: such controls cannot be
  acted on (a limitation, by design). The Rust script finds the control by comparing cleaned id/name values with
  `getElementsByTagName`, never with `querySelector`, and requires exactly one match.
- **Typed text** goes only inside the fixed script as a JSON string literal. It is shown in full on the approval
  card and is never in a summary, an audit record, an event, an error, or any result.

### Page source for the reader

`createRelayPageReader(relay)` is a real `PageReader`: the Rust command `page_snapshot` evaluates a FIXED script
(no input interpolated) in the active tab that returns `document.documentElement.outerHTML` (cut at 4 MiB), the
result is read back through a one-shot channel, and the chrome page posts it to Core, where `readPageSnapshot`
turns it into a `PublicPage`. URL and title come from the host's own tab record, not from the page's script.
Result bodies up to 16 MiB are accepted on `POST /api/browser/relay/:id/result` only.

### Approval card

The capability marks its inputs with `x-phoenix-confirm-input` (capability manager); `PermissionGateway` passes
them, only for capability `browser`, to `browserCard`, which re-validates them and produces
`details.browser = { kind, pageUrl (host+path), selector | destination (+queryHidden), text (FULL, invisible
characters escaped), textLength }`. An action the card cannot describe exactly is refused before a confirmation
exists. `Approvals.tsx` renders it (action, page, control/destination, full typed text); the same pending
confirmation is also what the phone link and chat approvals list (they show only the summary, which never holds
typed text, and the card details as Core serialises them).

### Core entry point: `POST /api/browser/assist`

Session-token route. Body `{ "goal": string }`: 1-500 characters after trimming (longer is clipped), control,
bidi and zero-width characters are rejected with 400, other fields are rejected.

- **Local model only, by construction.** `AiService.generateLocal` (`ai/models`) is the `generate` analogue of the
  embedding `localProvider` pin. It considers only providers that are `locality: "local"` AND `trustedLocal` (today
  the built-in Ollama adapter; an unvetted loopback server does not count). With none, it throws `NoLocalModelError`
  **before** the request is routed or serialized. A cloud preference, a per-purpose route, the
  `AI_external_processing` grant and the cloud opt-ins do not matter: the router refuses every other provider and
  `callProvider` refuses again right before the call. The route checks for a local model before it reads the page,
  so with no model no page text is even fetched.
- **Answer is data.** `{ status: "ok", plan: { page_url, actions }, dropped, processed_by }`. `propose` parses the
  model's reply strictly: only `click`, `type`, `submit`, at most 5, each on a control the reader reported, through
  the same `checkAction` as a hand-written plan (protected fields, forms with protected controls, typed text limit).
  `navigate` and `download` are never proposed (an address or file chosen by a model that read attacker text is the
  way page data could be carried out). Anything else the model says, including tool-call text, is discarded and
  counted in `dropped`.
- **Nothing runs.** The route has no gateway, no approval and no way to dispatch. A step is run only when a client
  calls `POST /api/capabilities/browser/commands/<kind>`, which raises the existing approval card, and the capability
  re-reads the page and re-checks the action after approval.
- **Fails closed.** Statuses: `no_local_model` (none configured, AI off, or the router found the local model
  unavailable), `local_model_failed` (the local model errored mid-call), `no_browser` (no relay in this Core). None
  falls back to a cloud provider.
- **Audit.** `browser.assist.proposed` with the page (query stripped) and counts; never the goal, page text or plan text.
- **Page text stays untrusted:** it goes through `readPageSnapshot`, the payment-number redaction and the user-message
  JSON envelope exactly as `answer` does; the system message holds no page text.

Tests: `ai/models/test/local-generate.test.ts`, `ai/browsing/test/browsing.test.ts` (`propose`),
`core/runtime/test/browser-assist.test.ts` (running Core, a fake Ollama behind a recording fetch, the 35 fixtures
of `ai/evaluation/test/browsing-injection-cases.ts`). All simulated, except `ai/browsing/test/real-injection.test.ts`, which calls `propose` with a real Ollama model (below). The Core route, a real page and a real browser have still never been used with a real model.

### Web UI: "Ask Fawkes to help with this page" (chrome panel)

`apps/web/src/browser/assist.ts` + `AssistPanel.tsx`, opened from the ✦ button in the Phoenix browser's **chrome**
window (never drawn inside a page; the chrome grows to `BROWSER_CHROME_ASSIST_HEIGHT` while it is open). **Evidence:
fake shell + fake Core only (`apps/web/test/browser-assist.test.tsx`); it has never been drawn in a real window or
used with a real model or page.**

- **Goal:** at most 500 characters; control, bidi and zero-width characters are refused client-side with a visible
  reason and nothing is sent (the route checks again).
- **Propose** posts `{ goal }` with the session token. The answer is parsed strictly (status, `plan.page_url` an
  http(s) address, at most 5 `click`/`type`/`submit` steps whose selector fits the capability's grammar, `type` with
  text); anything else shows "could not be reached, nothing was run".
- **Steps are inert text** (`click` / `type` / `submit`, the control and, for `type`, the text, with control and bidi
  characters shown as U+FFFD), under the label "Proposed by a local model that read this page. Nothing has run." No
  step is a link or a handler. The count of suggestions Core refused (`dropped`) is shown.
- **Run this step** sends ONE `POST /api/capabilities/browser/commands/<kind>` with `{ pageUrl: plan.page_url, selector[, text] }`,
  which raises the existing approval card. There is no run-all, no auto-advance, and while a step waits for approval or
  runs, every step button and Propose are disabled. A declined, blocked, unreachable or timed-out step shows a fixed
  message (Core's own text is never shown) and the next step is not started.
- **Page re-check:** before a step is sent, the ACTIVE tab must be the tab the plan was proposed for and still on
  `plan.page_url` (fragment ignored); otherwise the step is refused with "The tab is no longer on the page these steps
  were proposed for. Ask again." and no command is sent. This is feedback and a fast refusal; the authority is Core,
  which re-reads the page after approval, and Rust, which compares `expectedUrl` again.
- **Statuses** `no_local_model`, `local_model_failed`, `no_browser` show fixed translated messages; the route's
  `detail` is not displayed.
- **Strings:** `apps/web/src/i18n/en/browser-assist.ts` and nine machine-translated, unreviewed locales.

## Limitations and unmet exit criteria

- The phase's exit criteria (a multi-step flow on a real test site; injection tests passing) are **not
  claimed**. The injection suite exists but is simulated: no real browser, site or model was used.
- Built with fakes only: browser tools in the gateway, the approval card and a browser source for the reader (see
  above). Unbuilt: a measurement of more than one model or of pages with typable fields (only llama3.2 against the 35 text fixtures was measured), a run of the new chrome panel in a real window,
  log-in, and any run in a real webview or on a real site. Controls
  without a unique id or name cannot be acted on.
- Login is only possible by the user typing credentials themselves; the assistant never fills them.
- Field protection is lexical over the reader's metadata; a hostile page can mislabel a field. The user
  approval step is the backstop. Pages whose controls are not reported in `fields` cannot be typed into.
- The reader only sees what attributes and inline styles reveal (see "Not detectable" above).
