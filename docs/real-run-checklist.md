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
6. Record a real call with a real person and a real microphone (and, once wired, system audio), then read the transcript, the summary and the to-dos, and list the temp dir, the working directory, the data dir and the Core database for audio-like files. Not done by anyone yet. The only run so far (2026-11-11, `core/runtime/test/real-notetaker.test.ts`, [evidence](evidence/phase-65-real-notetaker-2026-11-11.md)) used two synthetic macOS voices, the test answering the consent over the managed-Core routes itself (no human, no native dialog), real whisper-cli tiny.en and a real llama3.2: it is not this step.

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

1. Open the Phoenix browser window. There is **no tray entry** for it (the tray menu has Open Phoenix, Wardrobe, modes, dictation and voice entries only). The one path that opens it is the port radar hand-off in section 4, a `phoenix://browser/open?url=…` link, which needs the built desktop bundle for the `phoenix` scheme (see section 15). Start with section 4, confirm the radar prompt, then continue here. Expect a chrome window and a content window lined up under it.
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

## 10. Mini browser: shields, find, permission prompt, corner Fawkes, assist panel (Phases 93, 95)

Nothing in this section has run in a real webview. Section 2 and 3 above cover navigation refusal and blocking; this one covers the rest of the chrome. Do it in the same session as section 2.

Prerequisites: the desktop shell running (section 0), the browser window open (section 2, step 1), a public https page you control that has a button calling `navigator.geolocation.getCurrentPosition(...)` (devtools are off in content windows, so the page itself must make the call). For step 7, Ollama running on `127.0.0.1:11434` with any small chat model pulled, and AI turned on (Settings → AI providers, or `POST /api/ai/settings {"enabled": true}`).

1. **Shields toggle.** Open any https page. Tick or untick **Block ads and trackers on <site>**. Expect the page to reload or the next load to differ, and the choice to survive a restart of the browser window (it is saved through `PUT /api/browser/shields/sites/:site`).
2. **Find in page.** Press Cmd+F (or the toolbar find button, label "Find in page"). Type a word that is on the page. Expect "Found on this page." and a highlight. Type nonsense: expect "Not found on this page.". Press Escape: expect the bar to close and the highlight to clear. Whether the engine highlights at all in a WKWebView is unknown; record it.
3. **Permission prompt.** On your geolocation page press the button. Expect a prompt "A page is asking for permission" naming the site and "location", with **Allow once** and **Deny** and a 30 second countdown. Let one run out without answering: expect a denial and the page's error callback. Press the button again and choose Deny, then press again within 5 minutes: expect it to be denied **without** a prompt (the cooldown). Choose Allow once on a fresh tab and confirm the page gets a position request once only.
4. **Corner Fawkes.** Look at the small Fawkes in the chrome corner (never inside a page). Expect WAITING while the prompt is up, WARNING after a refused address (type `http://127.0.0.1:4870`), WORKING while a page loads, IDLE otherwise. Untick Settings → Fawkes → "Show Fawkes in the corner of the Phoenix browser": expect it to disappear.
5. **Blocked counter caveat.** The count next to the Shields checkbox and the corner message "N requests were blocked on this page" are driven by `TabInfo.blocked`, which is **always 0** (WebKit gives no count for a content rule list). Seeing 0 on a page that visibly lost ads is the documented state, not a finding. Do not file it as a bug; record that blocking worked or not by comparing with Safari (section 3).
6. **Isolation.** Repeat the `window.__TAURI__` check from section 2 on this session's pages after the chrome was used heavily; it must still fail.
7. **Assist panel with a local Ollama model.** On a page with a plain text field and a button, press the ✦ button ("Ask Fawkes to help with this page"). Type a goal such as "type hello into the search box". Press **Propose steps**. Expect up to 5 inert text steps labelled "Proposed by a local model that read this page. Nothing has run." Press **Run this step** on one step: expect an approval card in the main Phoenix window (Approvals) showing the page, the control and the full text, and nothing to happen on the page until you approve. Approve one step and deny another; expect the page to change only for the approved one, and the next step never to start by itself. Switch tabs between Propose and Run: expect "The tab is no longer on the page these steps were proposed for. Ask again." Turn AI off or stop Ollama and press Propose: expect the fixed "no local model" message, and no page text to be fetched.

Record: in [phase-93-phoenix-mini-browser.md](phases/phase-93-phoenix-mini-browser.md) and [mini-browser.md](mini-browser.md): whether find highlighted, whether the prompt wording matched, whether the 5 minute cooldown held. In [phase 95's doc](browsing-assistant.md): the model name, whether the proposed steps were sensible, and the card text. Update gaps.md rows 93 and 95 only with what you saw.

Do not: use a real shop, bank or login page for the assist test, and never type a password or a payment detail into the goal box. Do not point the assist at a page with private content: the page text goes to the local model.

## 11. Browser extension and native host: send a page (Phase 89)

Driven once in a throwaway Chrome 157 profile with a DevTools trigger (not a person's click; see [the evidence](evidence/phase-89-real-browser-extension-2026-11-11.md)); a real click, Edge and Firefox are still open. Details: [companion-clients.md](companion-clients.md#browser-extension-send-page-to-phoenix).

Prerequisites: Core running (section 0), Chrome (or Chromium or Edge) on this Mac, Node on `PATH`. For the Windows and Firefox parts, a Windows 10 or 11 machine and Firefox 115 or newer.

Chrome on macOS:

1. `chrome://extensions` → turn on Developer mode → **Load unpacked** → choose `apps/extension`. Copy the 32-letter extension id shown on the card.
2. `node apps/extension/scripts/install-host.js install --chrome-id <id> --browser chrome`. Expect `wrote ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.phoenix.companion.json`. Open that file: `allowed_origins` must list exactly `chrome-extension://<id>/` and `path` must point to `apps/extension/host/phoenix-host.sh`.
3. **core.json check.** `ls -l ~/.phoenix/dev/core.json` (or your `PHOENIX_DATA_DIR`). Expect mode `-rw-------`, you as owner, content `{"url":"http://127.0.0.1:<port>"}`. Then `chmod 644` it, click the extension on a page and expect the badge `!` (the host refuses to send the token: `bad_core_url`); `chmod 600` it again. Stop Core: the file must disappear.
4. Open any http or https page, select a few words, click the toolbar button. Expect the badge **OK** and the hover text "Sent to Phoenix. Review it in Phoenix, under Pages." Open Settings → **Pages sent from your browser**: expect one row with the origin and path, no query string, the title and your selection, as plain text (the address is not a link). Delete it there.
5. Failure badges, each should show `!` with its own hover text: click on `chrome://extensions` (only http and https pages), stop Core and click ("Phoenix is not running…"), run `node apps/extension/scripts/install-host.js uninstall --browser chrome` and click ("native-messaging host is not installed").
6. Try a page whose address has `?code=abc123` in it. Expect the stored note to hold origin and path only.

Windows (never run on Windows):

1. Node 22 on `PATH`. Load the extension unpacked in Chrome or Edge as above and copy the id.
2. In a normal (not elevated) PowerShell, from the repo root: `node apps\extension\scripts\install-host.js install --chrome-id <id> --browser chrome,edge`. Use a repo path of plain ASCII letters, digits, spaces and `. _ + -`; otherwise the installer refuses before writing anything, which is the expected behaviour.
3. `reg query HKCU\Software\Google\Chrome\NativeMessagingHosts\dev.phoenix.companion` (and the Edge key `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\…`). Expect the default value to be a manifest path under `%LOCALAPPDATA%\Phoenix\NativeMessagingHosts\<browser>`, next to a `phoenix-host.cmd` launcher.
4. Click the extension on a page; expect OK as above. `uninstall` must remove the keys (`reg query` then answers that it cannot find them).

Firefox:

1. `node apps/extension/scripts/build-firefox.js`. Expect `apps/extension/dist/firefox/` with its own `manifest.json`.
2. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → choose `apps/extension/dist/firefox/manifest.json`.
3. `node apps/extension/scripts/install-host.js install --firefox-id phoenix-send-page@phoenix.invalid --browser firefox`. Expect a file under `~/Library/Application Support/Mozilla/NativeMessagingHosts/` on macOS (the `HKCU\SOFTWARE\Mozilla\NativeMessagingHosts` key on Windows).
4. Click the toolbar button on a page. Expect OK. Record anything that fails: the callback-style `chrome.*` calls, `scripting.executeScript` and `runtime.sendNativeMessage` in Firefox are unverified.

Record: in [phase-89-watch-extension-cli.md](phases/phase-89-watch-extension-cli.md): per browser and OS, what the badge showed and the exact registry or file paths. Update gaps.md rows 89 only with what you saw.

Do not: paste `session.token` or `core.json` contents into an issue, run the installer with `sudo` or as Administrator (it writes per-user locations only), or pass a wildcard id. A temporary Firefox add-on disappears when Firefox quits; that is normal.

## 12. Stream Deck plugin (Phase 88)

Never loaded in the Stream Deck app, never packed or signed, no hardware used. Details: [status-lights.md](status-lights.md#stream-deck-plugin-appsstreamdeck). The plugin has two keys only: a view-only state key and a keep-awake 30 minute key. It has **no approve, deny or record key**; if you expect one, that is a decision row (88), not a bug.

Prerequisites: a Stream Deck with the Stream Deck app 7.1 or newer (the manifest asks for it and for Node 24, which the app supplies itself), Core running (section 0), Settings → **Keep awake** → **Turn on Keep awake** done once (the key calls `awake.start`, which needs that capability on). Elgato's CLI is not a repo dependency; the commands below are from Elgato's own CLI documentation and were not run here: `npm install -g @elgato/cli`.

1. **Link for development.** `streamdeck link apps/streamdeck/com.phoenix.fawkes.sdPlugin`. Restart the Stream Deck app if it does not show the category. Expect a **Phoenix** category with two actions, "Fawkes state" and "Keep awake 30 min". If the link is refused, the manifest is the first suspect: record Elgato's exact message.
2. **Pack (separate run).** `streamdeck pack apps/streamdeck/com.phoenix.fawkes.sdPlugin`. Expect a `.streamDeckPlugin` file. Record whether the CLI validated the manifest without errors (the manifest follows the SDK 2 reference; this was never checked by Elgato's validator). Do not publish or sign it.
3. **State key.** Drag "Fawkes state" onto a key. Expect its title to show the coarse state (IDLE, WORKING, WAITING, ERROR, RECORDING, SLEEPING) within about 5 seconds and the key colour to follow it. Stop Core: expect **OFFLINE** within about 5 seconds. Pressing the key must do nothing except refresh.
4. **Keep-awake key.** Drag "Keep awake 30 min" onto a key and press it. Expect the key to show **Confirm on screen** for a few seconds and an approval card in Phoenix (Approvals) for a 30 minute session. Do nothing: nothing must start. Press the key again within 10 seconds: expect no second card (cooldown).
5. **Answer the on-screen prompt.** Press the key again after 10 seconds, then approve the card in Phoenix. Expect Keep awake status to show a running session (`phoenix awake status`, or Settings → Keep awake), and the key to **never** have shown "started". Deny a second one and expect no session.
6. Run `ps` or Activity Monitor while pressing: the plugin starts `bin/host.js` for one message and it exits. The plugin process itself must not have `PHOENIX_SESSION_TOKEN` in its environment.

Record: in [phase-88-status-lights-and-stream-deck.md](phases/phase-88-status-lights-and-stream-deck.md): Stream Deck app version, whether link and pack worked, key titles seen. Update gaps.md row 88 (Stream Deck) only with what you saw.

Do not: copy a session token into the plugin folder or its environment to make it work (if the host cannot find the token, fix `PHOENIX_DATA_DIR`, not the plugin), sign or upload the plugin, or edit `manifest.json` to add keys that approve things.

## 13. Status lights: Hue, Luxafor, LIFX (Phase 88)

No real Hue bridge, Luxafor app or LIFX bulb was ever contacted. Details: [status-lights.md](status-lights.md). Settings → **Status lights** holds all of it. Do each light you own; skip the rest.

Prerequisites: Core running with an OS credential store (Hue and Luxafor secrets need it; without one the section says so). A coding agent with Phoenix's hooks installed (Settings → Coding agents, see [agents.md](agents.md)), because only events from the `agents` source move a light. `phoenix-simulate` events do not count: they carry another source and are ignored by design. The RECORDING colour cannot be reached yet (Phase 65 capture start is not wired), so it stays unobserved; say so in your notes.

Common first steps: in Settings → Status lights press **Enable** for the capability, add the light, then tick **Allow Fawkes to light this**. Provisioning alone lights nothing; consent is separate.

**Hue**

1. Enter a name and the bridge's private IPv4 address. Press **Read the bridge certificate**. Expect a SHA-256 fingerprint and a certificate subject, and nothing sent to the bridge yet.
2. Compare the fingerprint with the one on your bridge (the Hue app, or `openssl s_client -connect <bridge-ip>:443 </dev/null 2>/dev/null | openssl x509 -noout -fingerprint -sha256`; the colon-separated form is the same value). Do not tick the confirm box unless they match.
3. Press the round link button on the bridge, tick **I compared this fingerprint…**, and press **Pair and pin this fingerprint** within about 30 seconds. Expect the bridge in the list with its fingerprint. A failure shows the fixed "Pairing failed. Press the round link button…" text.
4. **Show lights**, then **Add** one lamp and allow it. Run an agent task: expect blue (WORKING), amber (WAITING for approval), red (ERROR, trigger it with a failing agent run), and off when it ends. Record the real colours next to the table in status-lights.md.
5. Remove the bridge: expect its stored key to be deleted and the lamp never contacted again.

**Luxafor (webhook only)**

1. Run the Luxafor desktop app and enable its local webhook (the app's own setting). Add the machine's address (a private IPv4) in Settings, then set the webhook token in the write-only field (it empties as soon as it is sent).
2. Allow the light and run an agent task. Expect the colour to change. **The app answers success whatever the token is**, so a wrong token will look fine in Phoenix; the only proof is the light itself. Record that.

**LIFX**

1. Press **Find LIFX lights**. Expect your bulb listed with its serial and address; one broadcast is sent, nothing is changed. Press **Add this light**, then allow it.
2. Run an agent task. Expect the bulb to follow IDLE, WORKING, WAITING and ERROR. Record whether the bulb acknowledged (a bulb that does not answer within 2 seconds shows as a failed write and Health shows degraded).

Also check: Settings → Status lights → quiet hours dark the light even during WORKING, and Focus mode (Settings → Focus) darkens it and returns the colour when Focus ends. Disable the capability: expect the light to be switched off.

Record: in [phase-88-status-lights-and-stream-deck.md](phases/phase-88-status-lights-and-stream-deck.md): model of each light, the observed colours, the Hue certificate subject, and any error. Update the Phase 88 gaps.md rows (Hue, Luxafor, LIFX) only with what you saw.

Do not: paste the Hue application key, the Luxafor token or the bridge's fingerprint-plus-address pair into an issue or log (the fingerprint alone is fine to compare, the keys are never shown anyway), tick the confirm box without comparing the fingerprint, use a bridge on a network you do not control, or expect the Hue pin to survive a bridge certificate renewal (re-pair).

## 14. macOS Calendar share and the sounds folder (Phases 83, 59)

Neither was ever run on a real Mac. Details: [calendar-awareness.md](calendar-awareness.md#macos-calendar), [fawkes-sounds.md](fawkes-sounds.md).

**macOS Calendar share (tray item)**

Prerequisites: the built or dev desktop shell (section 0), a Calendar.app with a few events: one recurring, one all-day, one cancelled, one invite, one private, and one titled `[deploy-freeze] test` that you organise. Settings → Capabilities → Calendar: set the capability config `macos: true` and enable it. Use a throwaway or low-stakes calendar.

1. Before touching anything, open `#/calendar`. Expect the feed to say no provider or unavailable, and no macOS prompt yet.
2. Tray → **Share macOS Calendar with Phoenix…**. Expect the macOS calendar permission prompt now (never at startup). Choose full access. The tray item's text then drops the trailing dots. Choose Deny on a second run (reset it with `tccutil reset Calendar dev.phoenix.desktop`) and expect the item to read "(denied in System Settings)" and the feed to say access is not full.
3. Within about a minute open `#/calendar`. Compare every event in the next 7 days with Calendar.app: recurring occurrences each shown once with the right date, the all-day event on the right day, the cancelled one absent or marked, the private one as a busy placeholder only, the freeze event recognised.
4. Turn the tray item off. Expect Core's copy to go stale within 3 minutes and the feed to say unavailable, never an empty calendar.
5. Record what EventKit returned for iCloud, Exchange or Google calendars you actually have, and the time zone of an all-day event.

Record: [phase-83-calendar-and-meeting-prep.md](phases/phase-83-calendar-and-meeting-prep.md). Do not: put real meeting titles from a work calendar in a screenshot you send back, or enable the share on a calendar whose invitees' addresses you must not expose (up to 8 attendee addresses per event reach Core on loopback).

**Sounds folder**

Prerequisites: the desktop shell, Settings → **Fawkes sounds** open, and any short PCM WAV file (at most 5 seconds, 1 MiB; not a stereo-float or compressed WAV).

1. Switch on **Let Fawkes make sounds**, click once on the page (sounds wait for a user gesture), set the volume, and press each **Play:** button (Hello, Poke, Dizzy, Recovered, Task finished, Needs you, Something failed). Record whether each is audible, not clipped and not annoying. This is also the first time the built-in Web Audio backend runs for real.
2. Read the folder path Settings shows (it is the app data directory plus `sounds/`; with the default identifier it is `~/Library/Application Support/dev.phoenix.desktop/sounds`, but trust the path in Settings). Create the folder yourself, copy a WAV to `greet.wav` there, and press **Play: Hello**. Expect your sound. Replace it with a text file renamed `greet.wav`: expect the built-in tone again.
3. Put a symlink named `poke.wav` in the folder pointing at another WAV: expect the built-in tone (symlinks are refused). Do not make a FIFO.
4. With sounds on, trigger real events: let an agent finish (Task finished), cause a failure (Something failed), poke the floating Fawkes. Then turn on quiet mode (Settings → Notifications) and repeat: expect silence. Mute from the tray: expect silence.
5. Repeat in the floating window and the island (section 18).

Record: [phase-59-fawkes-interactions-and-sounds.md](phases/phase-59-fawkes-interactions-and-sounds.md). Do not: put a file you did not make or may not use in the sounds folder, or run this with the volume up in a shared room.

## 15. `phoenix://` approval links, Teams link, chat approvals (Phase 86)

No real Slack, Discord or Teams workspace, and no real macOS URL open, was ever used. Details: [chat-approvals.md](chat-approvals.md).

**Links (macOS only; Windows and Linux have no handler)**

The `phoenix` scheme is declared in `Info.plist`, so it is registered with macOS only for a **built bundle**: `pnpm --filter @phoenix/desktop build`, then open the resulting `Phoenix.app` once so Launch Services learns the scheme (`pnpm … dev` will probably not receive links; if it does not, that is expected, not a finding).

1. Raise a pending approval (a Keep awake start from section 12 or `phoenix awake 30m` is enough). Run `phoenix approvals list` and note its id (a short string of letters, digits, `_` and `-`).
2. `open "phoenix://approvals/<id>"`. Expect the browser to open Core at `#/approvals?id=<id>` and show that one approval's card. Decide nothing from the link: approve on the card.
3. `open "phoenix://approvals/doesnotexist"`. Expect the plain text "Approval request not found." and nothing else. Do the same for an already decided id.
4. `open "phoenix://approvals/abc?x=1"`. Expect nothing at all (the shell drops it).
5. `open "phoenix://browser/open?url=http%3A%2F%2F127.0.0.1%3A8000%2F"` with `python3 -m http.server 8000` running (section 4): expect the Phoenix browser window and a confirmation first. Then try `url=http%3A%2F%2Fexample.com%2F`: expect nothing.
6. **Teams link.** The Teams link carries five signed fields and cannot be typed by hand, so it needs a real Teams incoming-webhook card. Create a throwaway Teams channel with an incoming webhook (the webhook URL is a credential). Store it as the `teams_webhook_url` secret and a random value as `teams_link_key` (Settings → Chat approvals → Credentials), enable Teams (notify), raise an approval for a project you listed, and click **Open in Phoenix** in Teams. Expect Phoenix to show the approval only if Core verifies the signature, and the same text as step 3 for an altered or expired link. Teams has no Allow button, by design.

**Chat approvals Settings with a throwaway Slack workspace**

Prerequisites: a new empty Slack workspace you own with one private channel and a Slack app installed there with only `chat:write`. Find the team id (`T…`), channel id (`C…`) and your member id (`U…`) from Slack's own UI. Never use a work workspace.

1. Settings → **Chat approvals**. Enter the workspace id, channel id and your user id as the only approver. Add one project name (plain text, the project folder name of an agent session). Everything starts off; press Save. Expect a "ready" line for Slack. Saving does not enable the capability; press **Turn on the capability** separately.
2. Credentials: paste the bot token and the signing secret into their fields, one at a time, and save each. Expect the field to empty at once and the mark to read **Stored**; nothing is ever shown back. Reload the page: still Stored, no value in the page.
3. Raise an approval for the listed project. Expect a card in the Slack channel with the tool name and a title only (no arguments). Raise one for an unlisted project: expect no card.
4. **Button press.** Slack delivers buttons by calling a public HTTPS Request URL; Core listens on loopback only and Phoenix hosts no public endpoint (this is the Phase 86 decision about a hosted endpoint). Nothing in the repo provides or documents a tunnel, so the press step needs a prerequisite that is yours to supply: if you use a tunnel, point it only at `/api/chat-approvals/callback/slack`, keep it up for the test only, and treat it as an exposed door (the route is protected by the signature, not by the session token). If you do not set that up, stop after step 3 and record "button press not tested: no public endpoint".
5. If you can press: Deny decides at once. Allow shows Yes and Cancel first; Yes decides. A press by another Slack user, a press after the request expired and a second press of the same button must each be refused. Check Settings → audit (`GET /api/audit`) for `chat.approval.decided` and `chat.approval.refused`.
6. Optional digest: turn on the schedule with the 60 minute minimum interval and look for one counts-only message in the channel. Digest counts reset when Core restarts.
7. Remove each secret afterwards and delete the Slack app.

Record: in [phase-86-chat-app-approvals.md](phases/phase-86-chat-app-approvals.md): what Slack showed, whether `phoenix://` links reached the app, and the exact refusal texts. Update gaps.md rows 86 only with what you saw; the exit criterion "a real agent request is approved from Slack" needs step 5 to have been done.

Do not: paste a bot token, signing secret, webhook URL or link key into a chat, an issue, a log or this repository (Phoenix itself refuses secret-looking config), reuse a production Slack app, list your real work projects, or leave a public tunnel running.

## 16. GitHub writes and tracker attach (Phases 79, 31, 85)

Every one of these was tested with a fake `fetch` only. Each is a write to a real service, always confirmed on screen. Use only a repository and trackers you own and can clean up. Details: [handoff-and-secret-guard.md](handoff-and-secret-guard.md), [focus-and-screenshot.md](focus-and-screenshot.md).

Prerequisites: a private throwaway GitHub repository you own with a pull request (one is enough), a failed Actions run in it (push a workflow that runs `exit 1`), fine-grained tokens limited to that one repository: one with Issues and Pull requests read and write (the capability's `write_token`) and a separate one with Actions read and write (`ci_write_token`). The two secrets are separate on purpose.

Set a secret without it entering shell history or logs: `read -rs V; curl -s -X POST -H "Authorization: Bearer $(cat ~/.phoenix/dev/session.token)" -H 'content-type: application/json' --data "{\"value\":\"$V\"}" http://127.0.0.1:4870/api/capabilities/github/secrets/write_token; unset V` and the same for `ci_write_token` (use `PHOENIX_DATA_DIR` if you set one; adjust the port to `core.json`). Expect `{...}` without the value echoed. Do not `echo` the variable.

**`github.pr.comment` (through a handoff note)**

1. Let a real agent session end with the Phoenix hooks installed (Settings → Handoff notes writes a note when a session ends; "Write a note when an agent session ends" is on by default). Open Settings → Handoff notes → Saved notes and select the note.
2. **Use this note** → target **A pull request description**, enter `owner/name` and the pull request number, press **Preview**. Expect the exact text, the repository, the number, the SHA-256 and the length.
3. Tick the "I confirm: post this text as a new comment…" box and Confirm. Expect a second approval card (github `pr.comment`) with repository, number, hash and length. Approve it.
4. Open the pull request on GitHub: expect exactly one new comment with that text. Record the token permissions that were needed and any GitHub error text. Decline a second attempt and confirm nothing is posted. Confirming twice posts twice; do not do it on a pull request people watch.
5. Enter a number that is an issue, not a pull request: record what GitHub does (the code does not check).

**`github.ci.rerun_failed`**

1. Note the failed run id from the Actions page URL (the number after `/runs/`).
2. Ask Core directly: `curl -s -X POST -H "Authorization: Bearer $(cat ~/.phoenix/dev/session.token)" -H 'content-type: application/json' --data '{"input":{"repository":"owner/name","run_id":1234567890}}' http://127.0.0.1:4870/api/capabilities/github/commands/ci.rerun_failed`. Expect HTTP 202 with an operation id, and an approval card showing the repository and run id. (The `ci_rerun` agent task kind also needs a person-submitted run id and the same approval; the direct command is the simplest observable path.)
3. Approve. Expect `GET /api/operations/<id>` to finish and the run on GitHub to restart only its failed jobs. Deny a second one: expect no re-run. Try a run that is still in progress: expect the fixed 409 message.

**Issue attach (Jira and Linear)**

The attach is the second step of the screenshot flow: Settings → Capture a region for an issue → pick the **Issue tracker**, draft, **Request approval and create issue**, then **Show what would be attached**. macOS only; needs Screen Recording permission (section 7).

1. Configure the Issue trackers capability with a Jira Cloud site and project, or a Linear team, that you own, plus the write secrets (`jira_write_email` and `jira_write_token`, or `linear_write_key`). Use a throwaway project.
2. Capture a harmless region (a blank part of your desktop), annotate, redact, create the issue, approve the create card.
3. **Show what would be attached.** Expect the issue key, a generated file name, the size and the first 12 characters of the SHA-256. Press **Yes, upload this image…** and approve the second card. Open the issue in Jira or Linear: expect the image attached once. Retrying after an unclear outcome can attach twice (no idempotency key); do not mash the button.
4. For Linear, record whether the upload host Phoenix accepted (a `storage.googleapis.com` signed address) matched what Linear really returned: if the attach fails there, the allow-list is the first suspect.

Record: [phase-79](phases/phase-79-handoff-notes-and-secret-guard.md), [phase-31](phases/phase-31-agent-runtime-first-vertical-slice.md), [phase-85](phases/phase-85-focus-mode-and-screenshot-to-issue.md): what GitHub, Jira and Linear showed. Update gaps.md rows 79, 85 and the Phase 31 CI-write row only with what you saw; the exit criterion "a handoff note is attached to a real PR" needs step 4 of the first part.

Do not: use a production repository or tracker, paste any token into a command you keep in history (use `read -rs` as above), re-use the read token for writes, capture a screen with private content for the attach test, or leave the throwaway tokens alive afterwards: revoke them on GitHub, Atlassian and Linear.

## 17. Weekly recap notice and dictation statistics retention (Phases 69, 64)

**Monday recap notice**

The notice is built, off by default, and was only ever run with an injected clock. There is no environment switch or route that moves Core's clock (the clock is a test-only option of `startCore`), and changing the system clock is not a safe substitute: it breaks TLS, tokens and every other timer. So the only honest observation is a wait, and the shortest one is this: **turn the switch on on a Monday before 09:00 local time** (enabling after 09:00 marks that Monday as already handled, by design, so nothing fires until the next Monday).

Prerequisites: real agent activity in the **previous** ISO week recorded by Phoenix (an agent with the hooks installed, run on a few days). `recap_daily` only counts what Phoenix saw; a week with no sessions, steps or commits is marked handled and sends nothing.

1. During the week before, open `#/recap` and check the numbers are plausible against what you did (sessions, steps, commits, granted and denied). Compare with the agent's own history.
2. On Monday at, say, 08:30: Settings → **Weekly recap notice** → turn on. `curl -s -H "Authorization: Bearer $(cat ~/.phoenix/dev/session.token)" http://127.0.0.1:4870/api/recap/notice`. Expect `enabled: true`, `last_week` still the old week or null, and your `time_zone`.
3. Leave Core running through 09:00. On one Monday, also sleep the Mac before 09:00 and wake it after, to see whether the timer (it wakes at least every 24 hours and re-reads the clock) still fires. Expect one notification in the bell with five whole numbers and no names, and `last_week` to equal this week's ISO label (for example `2026-W46`). It must appear once, not again after restarting Core.
4. Put the Mac in notification quiet mode, or inside the Proactive quiet hours, across 09:00 on another Monday: expect no notice until the quiet period ends, then one (retried hourly).

What the fake clock cannot show, and what this run is for: that the real timer survives sleep and wake, that "09:00 local" is right in your real time zone and across a clock change, that the ISO week label and the stored `last_week` agree with the calendar on your wall, that the bell shows the text in your locale, and that no OS notification or network request happens. Weeks of real data (step 1) are not covered by tests at all.

Record: [phase-69-weekly-recap.md](phases/phase-69-weekly-recap.md): the time the notice appeared, the five numbers against `#/recap`, and whether sleep delayed it. Do not: change the system clock, enable the notice on a Monday after 09:00 and wait for it, or paste the recap image or project names you left visible ("show project name" is off by default; leave it off) into anything public.

**Dictation statistics retention**

Dictation itself needs a real microphone (section 5 and the Phase 64 rows); retention can be checked without it, because the table holds only counts per day and app. Use a throwaway data directory so the real statistics are never touched.

1. `PHOENIX_DATA_DIR=/tmp/phoenix-retention PHOENIX_PORT=4871 pnpm dev:core`. Wait for it, then stop it with Ctrl-C.
2. `sqlite3 /tmp/phoenix-retention/phoenix.sqlite "INSERT INTO dictation_stats(day,app,words,speech_ms,sessions) VALUES('2020-01-01','',10,5000,1), (date('now'),'',5,2000,1);"` (columns are `day, app, words, speech_ms, sessions`).
3. Start Core again with the same two variables. With the default (keep until deleted), `GET /api/dictation/stats` with the token from `/tmp/phoenix-retention/session.token` must still count both rows.
4. `POST /api/dictation/stats/retention` with `{"retention_days":30}`. Expect the answer to repeat 30. The old row must still be there (the choice is applied by the next pruning pass, not at once).
5. Stop and start Core again. Expect the 2020 row gone, today's row kept, and an audit row `dictation.stats.retention_prune` with the retention and a row count only (`GET /api/audit`).
6. For the once-a-day timer (the one part a restart does not exercise), insert another old row with `sqlite3` while Core is running, leave Core up for 24 hours, and check the row is gone and a prune audit row exists.
7. Set `{"retention_days":null}` and confirm nothing is pruned afterwards. Delete `/tmp/phoenix-retention` when done.

Record: [phase-64-dictation-anywhere.md](phases/phase-64-dictation-anywhere.md) and the Phase 64 `decision` row on the retention default. Do not run the `INSERT` against your real data directory, or paste the token from the throwaway directory anywhere.

## 18. Demo hand-off to the floating Fawkes and the island (Phase 70)

Built and tested with fakes and happy-dom only; never run in a packaged app or a real window. Details: [demo-mode.md](demo-mode.md).

1. Start the desktop shell (section 0). In the main web app: Settings → **Demo mode** → **Start demo**. Expect a banner and Fawkes in the navbar showing the demo's states.
2. Look at the floating Fawkes. Within about 2 seconds it must show the demo's state and tasks, not your real ones (the poll runs every 1.5 seconds). Step through the demo (**Next step**, **Play this step**) and watch it follow.
3. Tray → **Island (top of the screen)**. Repeat step 2 in the island: hover the top strip to peek, click to expand. Expect the demo's state and tasks, and real agent sessions left out of the pills.
4. Stop the demo (**Stop demo and go back**). Expect both windows to show your real state again within about 2 seconds. Start the demo again, then quit Core: expect OFFLINE to show (the demo must never hide it).
5. Leave a demo idle for 10 minutes: it stops by itself and the windows return to real state.
6. In the packaged app and with the demo running, list the data directory, the keychain entries for Phoenix and `/tmp` before and after (`ls -la ~/.phoenix/dev`, Keychain Access search `phoenix`). Expect no new file or entry. This is the demo isolation criterion that was only tested with a temporary directory.
7. Tray → **Floating Fawkes**, repeat once more, then **Navbar only**.

Record: [phase-70-shortcuts-i18n-demo.md](phases/phase-70-shortcuts-i18n-demo.md) and gaps.md Phase 70 rows: what the windows showed and how long the delay was. Do not run the demo while real approvals you care about are pending without checking the real Approvals page afterwards; the pills show only demo tasks while the demo runs.

## 19. Notch and island versus browser-corner Fawkes: visual comparison (Phases 60, 93)

The island shows Fawkes through `RebirthAvatar` at 32 px (48 px expanded); the Phoenix browser corner shows the same component at 26 px. Both were checked only as rendered text in happy-dom; nobody has looked at either on a real display. This is a look-and-compare step, not a test.

1. With the same outfit worn (Wardrobe) and the same state (for example IDLE, then a pending approval for WAITING), take a screenshot of the island (peeked, then expanded) and of the browser window's corner. On a Retina display use the native screenshot at actual pixel size.
2. If you have a Mac with a notch, do the island on it and on an external display without one (Settings through the tray item **Island display**). Record where the island sits relative to the notch, whether the avatar is cut by the camera housing, and whether the ears show the same state.
3. Compare: the same pose per state, legible at 26 px and 32 px, the same colours in light and dark mode, reduced motion on (System Settings → Accessibility → Display → Reduce motion) showing still poses in both, no flicker on app switches (the Phase 14 flicker row).
4. Record any state where the two disagree, and any state that is unreadable at 26 px.

Record: a screenshot pair and one line per difference in [phase-60-fawkes-island.md](phases/phase-60-fawkes-island.md) and [mini-browser.md](mini-browser.md). Do not crop screenshots in a way that includes other windows or your menu bar clock and accounts, and do not claim the island exit criterion (macOS with notch, one Linux compositor, Windows) from a Mac without a notch.

## Owner decisions that unblock the most work

Every `decision` row of gaps.md for phases 59, 64, 65, 66, 68, 69, 70, 79, 83, 85, 86, 88, 89, 93, 94 and 95, taken from the file as it stood when this table was written (Phase 59 has none). The rows have no id column: the id is the phase plus the line in [gaps.md](gaps.md), which moves when rows are added, so find a row again with `grep -n '^| <phase> | decision' docs/gaps.md`. The question is the row's own "what closes it" text, shortened.

| Phase | gaps.md line | Topic                                   | Question                                                                                                                                                                      |
| ----- | ------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 64    | 393          | OS speech fallback                      | A signed native macOS helper with a reviewed prompt and forced on-device recognition, and what to do on Windows and Linux?                                                    |
| 64    | 399          | Dictating to an agent session           | Extend the confirmation to show the full dictated `message` plus a per-request reference and then build the flow, or keep dictation to the chat box and the user's own paste? |
| 64    | 401          | Dictation statistics retention          | Replace keep-until-deleted with a default period, or confirm keep-until-deleted?                                                                                              |
| 64    | 403          | Dictation start consent                 | Require a person-bound confirmation per start once the Phase 65 consent channel exists?                                                                                       |
| 65    | 409          | Per-person transcript                   | Pick a diarisation model (licence, size, on-device) or accept the two labels "You" and "Others"?                                                                              |
| 65    | 410          | Hand-off to Kage                        | Drop the item, or have Kage publish an ingest endpoint and approve audio leaving Phoenix?                                                                                     |
| 65    | 414          | Review-first call summaries             | Confirm that a summary and its items enter memory only after you accept them in review?                                                                                       |
| 66    | 418          | CPU budget threshold                    | Confirm or change "idle CPU below 1 % while voice is enabled" once a whole-app measurement exists?                                                                            |
| 66    | 427          | Web search needs no setup               | None, accepted; revisit only if Core's approval prompt can show a per-call destination.                                                                                       |
| 68    | 475          | Solana `getBalance` POST exception      | Confirm or reverse the POST exception (and check one real balance against an explorer)?                                                                                       |
| 69    | 487          | Recap notice choices                    | Confirm or change each: 09:00 Monday, empty week sends nothing, mid-week enable waits, catch-up within the week, hourly retry when blocked, no Kage rate limit?               |
| 69    | 491          | `recap_daily` retention (800 days)      | Decide a retention period, or keep-until-deleted as for dictation statistics?                                                                                                 |
| 69    | 492          | Project folder name and agent id stored | Confirm storing them at all, or store a salted hash and show names only live?                                                                                                 |
| 69    | 493          | "Granted" and "Denied" definition       | Confirm the definition, in particular that expired and cancelled prompts count as denied?                                                                                     |
| 70    | 523          | Web CSP `connect-src`                   | Keep the wider `http://127.0.0.1:*`, or proxy the demo through the real Core and narrow the CSP again?                                                                        |
| 79    | 624          | `pr.comment` token                      | Does PR comment need its own write-only secret instead of reusing `write_token`?                                                                                              |
| 79    | 631          | Secret guard failure mode               | Should the guard fail closed on a crash or timeout (which blocks every tool call while the hook is broken)?                                                                   |
| 79    | 632          | Handoff retention numbers               | Confirm or change 50 notes and 64 KiB each?                                                                                                                                   |
| 83    | 663          | Calendar project association            | Add an explicit project association on meetings, so prep may match on projects?                                                                                               |
| 85    | 673          | macOS Focus / Do Not Disturb            | Build a native Tauri shell bridge with `INFocusStatusCenter` and its own authorisation prompt (separate, reviewed work)?                                                      |
| 86    | 690          | Direct-message digests                  | Are DMs wanted, and what per-user consent model do they need?                                                                                                                 |
| 86    | 691          | Teams inbound approval                  | Host a public, signature-verifying endpoint (a new attack surface needing its own security review)?                                                                           |
| 88    | 698          | Stream Deck keys                        | Stay view-only plus keep-awake, add a deny-only key, or add an approve key (needs Core-side person-versus-agent identity first)?                                              |
| 89    | 707          | Page note query strings                 | An allow-list of parameter names per host to keep, or keep storing nothing from a query?                                                                                      |
| 89    | 710          | Firefox store submission                | What to declare for `data_collection_permissions` (probably `none`) and which real gecko id replaces the `phoenix.invalid` placeholder?                                       |
| 93    | 729          | Permission prompt and embedded frames   | Add a "may be from an embedded frame" field to the payload and chrome text, or refuse permission requests while the tab has cross-origin frames?                              |
| 94    | 737          | YouTube player hosting                  | A capability-less player window served by Core, or a top-level content window on the embed URL (no programmatic pause)?                                                       |
| 94    | 739          | Music search link                       | Keep the system-browser link, or add a vetted deep link or confirmation for an allow-listed music search address?                                                             |
| 95    | 747          | Which local servers count as vetted     | May any local server other than the built-in Ollama adapter count as trusted local?                                                                                           |

The answers that settle several rows at once: **retention** (64 line 401, 69 line 491, 79 line 632 are the same kind of question: keep until deleted, or a number), **session-token versus person identity** (64 line 403, 88 line 698 and the session-token limitation noted in `core/api/src/memory-routes.ts`, which affects any feature that lets a device or chat answer an approval), **a public endpoint** (86 line 691 and the hosted-player question 94 line 737), and **recap definitions** (69 lines 487, 492, 493, which are one reviewed read of `recap.ts` and `recap-notice.ts`).

## What to send back

For each section: what you did, what you saw, and a screenshot of any surprise. Do not include the session token, search keys, bot or webhook tokens, a Hue key, `core.json`, recorded audio or screenshots that show real calendar or work content.
