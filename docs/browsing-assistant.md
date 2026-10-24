# Fawkes browsing assistant (Phase 95)

Package: `ai/browsing` (`@phoenix/ai-browsing`). Evidence for this slice is **simulated**: the tests
inject a fake page reader, fake local model, fake gateway, fake approval and an in-memory audit sink.
No browser, network, model or device is touched, and no real test site has been exercised.

This slice was reviewed again after the Core wiring of Phases 86 to 96 and was deliberately not wired: it still needs a browser to supply the document, registered browser tools and an approval UI, none of which exist, so no Core piece would be real without them.

**Built since then (simulated):** a pure page reader (`page-snapshot.ts`) that turns an HTML snapshot into a `PublicPage`, and an injection suite (`ai/evaluation/test/browsing-injection.test.ts`). **Still unbuilt:** gateway browser tools, the approval UI, any real browser (Phase 93) and any measurement of a real model.

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

## Integration hooks (for the parent)

1. Have the Phoenix mini browser (phase 93) hand its loaded document to a `SnapshotPageReader` source.
2. Register browser capability commands (`click`, `type`, `submit`, `navigate`, `download`) with a
   side effect of `external`/`write` or stronger, and pass their tool names as `tools`.
3. Provide a `BrowserGateway` (a `ToolGateway` plus `registry.list()` fits) and a `PolicyAuditSink`.
4. Provide an `ActionApproval` backed by the approval UI that shows the action and page URL.
5. Provide a `LocalPageModel` wrapping an on-device provider from `@phoenix/ai-models`.
6. The package's three workspace dependencies (`ai-models`, `ai-tool-gateway`, `policy`) are all used;
   `ai/browsing/node_modules/@phoenix` needs `pnpm install` on a clean checkout.

## Limitations and unmet exit criteria

- The phase's exit criteria (a multi-step flow on a real test site; injection tests passing) are **not
  claimed**. The injection suite exists but is simulated: no real browser, site or model was used.
- Unbuilt: browser tools in the gateway, the approval UI, a real browser source for the reader (Phase 93),
  measurement of a real model against the visible attacker text, and wiring into Core.
- Login is only possible by the user typing credentials themselves; the assistant never fills them.
- Field protection is lexical over the reader's metadata; a hostile page can mislabel a field. The user
  approval step is the backstop. Pages whose controls are not reported in `fields` cannot be typed into.
- The reader only sees what attributes and inline styles reveal (see "Not detectable" above).
