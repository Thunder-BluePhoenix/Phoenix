# Screen region capture (`screen-region`)

Lets the person drag one region of the screen and returns it as a PNG to the page that asked. macOS only, through the stock
`/usr/sbin/screencapture` (`-i -s -t png`); other platforms report `unsupported`. Full description, rules and verification status:
[docs/focus-and-screenshot.md](../../docs/focus-and-screenshot.md).

| Command          | Side effect | Notes                                                                                                                                |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `capture_region` | `execute`   | Permission `screen_capture`: Core confirms every time. No input. Esc is a clean `cancelled`. Returns base64 PNG, blanked after 60 s. |

Layout: `src/capture.ts` (fixed argv, 0700 temp directory, validation, cleanup; injected `Runner`), `src/real.ts` (the only `execFile`),
`src/index.ts` (manifest, command). Tests inject a fake runner and use a real temporary directory; nothing ran on a real Mac and no
real Screen Recording permission was involved.
