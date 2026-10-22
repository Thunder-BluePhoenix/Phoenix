# Fawkes browsing assistant (Phase 95)

Package: `ai/browsing` (`@phoenix/ai-browsing`). Evidence for this slice is **simulated**: the tests
inject a fake page reader, fake local model, fake gateway, fake approval and an in-memory audit sink.
No browser, network, model or device is touched, and no real test site has been exercised.

This slice was reviewed again after the Core wiring of Phases 86 to 96 and was deliberately not wired: it needs a `PageReader` from a browser, registered browser tools and an approval UI, none of which exist, so no Core piece would be real without them. The injection suite is also not in `ai/evaluation`.

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

## Integration hooks (for the parent)

1. Implement `PageReader` in the Phoenix mini browser (phase 93) returning visible text and field
   _descriptions_ only (never DOM HTML, scripts or field values).
2. Register browser capability commands (`click`, `type`, `submit`, `navigate`, `download`) with a
   side effect of `external`/`write` or stronger, and pass their tool names as `tools`.
3. Provide a `BrowserGateway` (a `ToolGateway` plus `registry.list()` fits) and a `PolicyAuditSink`.
4. Provide an `ActionApproval` backed by the approval UI that shows the action and page URL.
5. Provide a `LocalPageModel` wrapping an on-device provider from `@phoenix/ai-models`.
6. The package's three workspace dependencies (`ai-models`, `ai-tool-gateway`, `policy`) are all used;
   `ai/browsing/node_modules/@phoenix` needs `pnpm install` on a clean checkout.

## Limitations and unmet exit criteria

- The phase's exit criteria (a multi-step flow on a real test site; injection suite in `ai/evaluation`) are
  **not claimed**: only simulated multi-step and injection-style tests exist in `ai/browsing/test`.
- Login is only possible by the user typing credentials themselves; the assistant never fills them.
- Field protection is lexical over adapter-provided metadata; a hostile page can mislabel a field. The
  user approval step is the backstop. Pages whose controls are not reported in `fields` cannot be typed into.
- No browser tools are registered in the gateway yet, and the injection tests are not yet added to
  `ai/evaluation`.
