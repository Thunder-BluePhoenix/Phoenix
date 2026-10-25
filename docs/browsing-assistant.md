# Fawkes browsing assistant (Phase 95)

Package: `ai/browsing` (`@phoenix/ai-browsing`). Evidence for this slice is **simulated**: the tests
inject a fake page reader, fake local model, fake gateway, fake approval and an in-memory audit sink.
No browser, network, model or device is touched, and no real test site has been exercised.

**Phase 95 host pieces (fakes only; nothing ran in a real webview, window, browser, site or model):**
the browser capability (`capabilities/browser`), the relay between Core and the Phoenix browser's chrome page,
the Rust commands `page_snapshot` / `page_action`, the chrome-page relay loop and an approval card. Details in
[Phoenix browser actions](#phoenix-browser-actions-phase-95). **`BrowsingAssistant` itself is still NOT wired into
Core**: it is a library (see [Why the assistant is not wired](#why-the-assistant-is-not-wired-into-core)).

Earlier, built (simulated): a pure page reader (`page-snapshot.ts`) that turns an HTML snapshot into a `PublicPage`, and an injection suite (`ai/evaluation/test/browsing-injection.test.ts`). **Still unbuilt:** any measurement of a real model and any real-site flow.

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
visible attacker text is passed to the model, and whether a real model follows it is untested.

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

### Why the assistant is not wired into Core

A safe seam does not exist yet. `BrowsingAssistant` needs a `LocalPageModel`, and the pieces Core has
(`AiService.run`) restrict an embedding to one local provider but offer **no local-only mode for `generate`**: with
cloud opt-in on, `internal` data (page text) can route to a cloud provider, and the assistant would only notice
afterwards from the result's provenance. Sending the page first and checking later is exactly what the rules forbid.
Wiring needs a local-only task option in `ai/models` (a `generate` analogue of `localProvider`) and a user-facing
entry point (a chat command or route) that builds the plan from the person's own words. Neither was built. Until
then the assistant is a library: an integration builds `new BrowsingAssistant({ page: createRelayPageReader(relay),
gateway: <ToolGateway>, tools: BROWSER_TOOL_NAMES, approval, audit, model, ... })`. The capability and relay ARE
wired into Core (`builtinCapabilities`, `PhoenixRuntime.browserRelay`, `/api/browser/relay/*`), installed and not
enabled like every other built-in.

## Limitations and unmet exit criteria

- The phase's exit criteria (a multi-step flow on a real test site; injection tests passing) are **not
  claimed**. The injection suite exists but is simulated: no real browser, site or model was used.
- Built with fakes only: browser tools in the gateway, the approval card and a browser source for the reader (see
  above). Unbuilt: measurement of a real model against the visible attacker text, a local-only `generate` seam and
  an entry point for the assistant in Core, log-in, and any run in a real webview or on a real site. Controls
  without a unique id or name cannot be acted on.
- Login is only possible by the user typing credentials themselves; the assistant never fills them.
- Field protection is lexical over the reader's metadata; a hostile page can mislabel a field. The user
  approval step is the backstop. Pages whose controls are not reported in `fields` cannot be typed into.
- The reader only sees what attributes and inline styles reveal (see "Not detectable" above).
