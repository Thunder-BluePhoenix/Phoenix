# Real-run checklist (macOS)

Every Phoenix test so far ran against fakes. This is the short list of checks that turn "simulated" into "seen". Do them in order: each one is small, and none of them needs an account except where it says so. Write down what you saw; a result that differs from what the docs claim is the finding.

Nothing here ticks an exit criterion by itself. After a run, record the result in the phase document and update the matching row in [gaps.md](gaps.md) only with what you actually observed.

## 0. Start Phoenix

```sh
pnpm install
pnpm build:web
pnpm dev:core                 # terminal 1: Core on 127.0.0.1:4870
pnpm --filter @phoenix/desktop dev   # terminal 2: the desktop shell
```

Check: the tray icon appears, Fawkes shows, `curl -s http://127.0.0.1:4870/api/health` answers.

The session token is in `<data dir>/session.token` (default `~/.phoenix/dev`). Treat it like a password: do not paste it into chats or issues.

## 0b. Managed Core and the notetaker consent (Phase 65)

The notetaker refuses to start in the normal `pnpm dev:core` workflow, by design. It can only be used when the desktop shell starts Core itself and passes it a private consent secret.

1. Stop `pnpm dev:core`. Set `PHOENIX_MANAGED_CORE=1` and `PHOENIX_MANAGED_CORE_ARGV` to a JSON array that starts Core (see the managed Core section of [apps/desktop/README.md](../apps/desktop/README.md)), then start the desktop shell.
2. Check `GET /api/notetaker/status` reports `consent_channel: available`. In the normal workflow it must say unavailable.
3. Try to start a recording. Expect a native dialog with Cancel as the default button. Choose Cancel: expect nothing recorded. Repeat and choose Record: expect the recording to be allowed.
4. Try answering with only the session token (`curl -H "Authorization: Bearer …" -X POST …/api/notetaker/consent/answer`). Expect 401.
5. Quit the shell. Expect Core to exit too.

Known limit: capture start is not wired to the grant, so a granted consent will not capture system audio yet.

## 1. Web search (Phase 66)

Needs nothing for DuckDuckGo. SearXNG is optional.

1. Settings → Capabilities → enable **Web search**.
2. Run `search` for `linux`. Expect a result from DuckDuckGo with `provider: duckduckgo`.
3. Run `search` for `best pizza near me reviews`. Expect an empty result with the fixed note (DuckDuckGo's Instant Answer API gives topic summaries, not ranked results).
4. Optional, a self-hosted SearXNG with `json` under `search.formats` in its `settings.yml`: set the capability config `searxng_url` to its address and search again. Expect `provider: searxng`.
5. Optional, a SearXNG whose `json` is off: expect the fixed 403 message and a fallback to the next provider (`fallback_from` lists `searxng`).
6. Say "search the web for linux". Expect an approval card showing the exact query, and nothing sent until you approve.

Record: the real DuckDuckGo response shape, and whether the SearXNG shape matches `results[].title|url|content`.

## 2. Phoenix browser (Phase 93)

1. Tray → open the Phoenix browser. Expect a chrome window and a content window lined up under it.
2. Type `example.com`. Expect the page to load.
3. Type `http://127.0.0.1:4870`. Expect it to be **refused** with a reason (typed loopback is not allowed).
4. Open a tab on a page that runs `window.__TAURI__.core.invoke("open_tab", {})` in its console. Expect it to **fail**: a content page must not reach any Phoenix command. This is the most important check in this list.
5. Quit and look in `~/Library/Application Support/` for files the private tab wrote. Expect none for the default private profile.

## 3. Ad and tracker blocking (Phase 93)

1. Settings → Ad and tracker blocking → **Update** for EasyList (this contacts `easylist.to`, once, because you pressed the button). Expect a rule count near 70 000 and a licence line.
2. Enable it, open a news site in the Phoenix browser, and compare with the same page in Safari with no blocker.
3. Expect fewer requests, but remember: only request matching exists. Page elements will still show as empty boxes, because cosmetic filtering is not built.
4. Check the per-site toggle and the blocked count. **`blocked` is always 0** (no webview reports a count yet); that is a known gap, not a bug in your run.

Record: whether WebKit accepted the compiled rule list, and how much the truncation to 150 000 rules mattered.

## 4. Port radar to the browser (Phase 80)

1. Start any dev server, for example `python3 -m http.server 8000`.
2. Open the port radar. Click **Open in Phoenix browser**. Expect the confirmation panel, and the tab to open only after you confirm.
3. Check that Core's own port (4870) has no such button.

## 5. Voice window (Phase 66)

1. Tray → **Open voice assistant (OK Fawkes)**. Expect the macOS microphone prompt with the new wording from `Info.plist`. (That wording only appears in a built bundle, not in `dev`.)
2. Allow it. Expect **LISTENING** in the window title and the tray tooltip.
3. Say "OK Fawkes". Expect the assistant to respond.
4. Tray → **Stop voice listening**. Expect the window to close and the orange microphone dot in the menu bar to go out within a second.

## 6. Second recogniser (Phase 64)

Needs `sherpa-onnx-offline` and a downloaded Parakeet model.

```sh
PHOENIX_SPEECH_ENGINES=parakeet,whisper PHOENIX_PARAKEET_MODEL_DIR=/path/to/model pnpm dev:core
```

1. Dictate a sentence. Expect the text to appear.
2. While it runs, look in the temp directory. Expect a private `0700` folder with a `0600` WAV, and **nothing left** after the transcription ends, after a cancel and after you kill Core mid-run. That last case is the one the tests could not prove.

## 7. Screen and window capture (Phase 62, 85)

1. Settings → choose a screen region. Expect a confirmation first, then the macOS crosshair. Press Esc once: expect "cancelled", not an error.
2. Grant Screen Recording to the host process when asked, drag a region, annotate, redact, and create one issue on a throwaway GitHub repo.
3. Chat → **Attach a window…**. Grant Accessibility when asked. Bring Notes, Safari and a terminal to the front in turn and record what text is read. Revoke the grant and check the denial message.

## 8. Restart recipe (Phase 80)

1. In the `ports` capability config, add a recipe for a throwaway server: `restart_roots`, `restart_recipes` with exact `argv`, `cwd` and `ports`.
2. Press **Restart** in the radar. Expect a confirmation that shows the recipe name, exact argv and folder.
3. After confirming, expect the old process to stop (SIGTERM) and a new one to start. Check the audit rows.

## 9. Things only a second device or an account can show

Do these last; they need setup outside this machine.

- **Phone approval and relay (71, 87):** pair a phone through the relay on mobile data.
- **Slack approval (86):** approve one real request from a real Slack workspace; open a `phoenix://approvals/…` link.
- **Calendar (83):** one real CalDAV account, with an app password in the `caldav_credential` secret.
- **Scheduled wake (90):** not built; needs your decision on a root rule.
- **Real agents (56 to 58):** upgrade Claude Code past 2.1.78, install the hooks, trigger an API error, confirm Fawkes shows ERROR; run `phoenix-agent codex-usage` against a real `codex`.

## What to send back

For each section: what you did, what you saw, and a screenshot of any surprise. Do not include the session token, search keys or recorded audio.
