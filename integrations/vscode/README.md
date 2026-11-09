# Phoenix for VS Code

Shows your workspace, task results and error counts to your own local [Phoenix](https://github.com/Thunder-BluePhoenix/Phoenix) so Fawkes, the desktop pet, can react: working while a task runs, happy when it passes, worried when it fails.

Phoenix is local-first. This extension talks only to a Phoenix Core running on **your own machine** (`127.0.0.1`, `localhost` or `[::1]`). It refuses any other address, because the session token it reads authorises everything in Phoenix. It has no telemetry and no network access beyond that loopback connection.

## What it sends to Core

Only when you have enabled the **Editor (VS Code)** capability in Phoenix (Settings → Capabilities). Until then nothing is sent.

| Event                                                     | Payload                                       |
| --------------------------------------------------------- | --------------------------------------------- |
| `editor.workspace.opened`                                 | the workspace's display name                  |
| `editor.task.started` / `passed` / `failed` / `cancelled` | the task's name, exit code                    |
| `editor.diagnostics.changed`                              | number of errors and warnings (debounced)     |
| `editor.files.saved`                                      | a **count** of saves in a burst, nothing else |

Fawkes reacts to task events only: started → working, passed → success, failed → error. Diagnostics counts, saves and workspace events never change Fawkes's state.

## What it never sends

File paths, file names, file contents, which files were saved, diagnostic messages, task command lines or arguments, environment variables, or anything about your Git repositories. The manifest it registers declares exactly four data categories (workspace name, task names and exit codes, error and warning counts, number of files saved) and the permission `filesystem_read` (the closest existing disclosure; Phoenix has no editor-specific permission).

## Setup

1. Install and start Phoenix Core and the desktop app.
2. Install this extension (`Extensions: Install from VSIX…`, or run it from source with `code --extensionDevelopmentPath=<path to integrations/vscode>`).
3. In Phoenix open Settings → Capabilities and enable **Editor (VS Code)**.
4. Run **Phoenix: Show connection status** from the Command Palette to check the connection.

The extension finds Core at the `phoenix.coreUrl` setting, else `$PHOENIX_CORE_URL`, else `http://127.0.0.1:4870`. It reads the session token from `$PHOENIX_SESSION_TOKEN`, `$PHOENIX_DATA_DIR/session.token`, the workspace folder's `.phoenix/<env>/session.token` or `~/.phoenix/<env>/session.token`. In an untrusted workspace it does not read a token from the workspace folder. It is a workspace extension and does not support virtual workspaces.

## Status

This extension has not yet been loaded in a real VS Code; it is tested against a stub of the `vscode` API and a real in-process Core. See the Phoenix gaps register.

## Licence

GPL-3.0-or-later. Copyright (C) 2026 Phoenix contributors. See `LICENSE`.
