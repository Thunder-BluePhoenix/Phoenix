// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Windows media control through one FIXED Windows PowerShell script. NEVER RUN ON WINDOWS: this was
// written from public documentation and tested only with a fake runner on a non-Windows machine.
//
// Shape (the same discipline as playerctl.ts / player.ts):
//   - The script is a constant. No input of any kind is interpolated into it. The two values that
//     vary travel in the environment of the child (`PHOENIX_MEDIA_COMMAND`: a word from a fixed
//     list; `PHOENIX_MEDIA_ARG`: digits, or on/off/one/all), and the script validates them again.
//   - The process is `powershell.exe` (Windows PowerShell 5.1, the only host with the WinRT type
//     projection used here; PowerShell 7 dropped it) from `%SystemRoot%\System32\WindowsPowerShell\v1.0`,
//     started with an argument list and no shell, `-NoProfile -NonInteractive`, the script as
//     `-EncodedCommand`, a 5 s timeout and an output cap. stderr and the exit code are not forwarded.
//   - Only the system's CURRENT media session is addressed (`GetCurrentSession()`); there is no
//     per-app selection on Windows, so a `player` name is refused rather than silently ignored.
//   - There is no volume control: the session API has none (see the method list below).
//
// Sources read on 2026-11-09:
//   - https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession
//     (Try*Async methods: TryTogglePlayPauseAsync, TrySkipNextAsync, TrySkipPreviousAsync,
//     TryChangePlaybackPositionAsync(Int64 ticks), TryChangeShuffleActiveAsync(Boolean),
//     TryChangeAutoRepeatModeAsync(MediaPlaybackAutoRepeatMode), TryGetMediaPropertiesAsync,
//     GetPlaybackInfo, GetTimelineProperties; no volume method; Windows 10 1809+)
//   - https://github.com/DubyaDude/WindowsMediaController/issues/8 (the PowerShell 5.1 recipe:
//     `[...,ContentType=WindowsRuntime]` type loading, `Add-Type -AssemblyName
//     System.Runtime.WindowsRuntime`, and awaiting an IAsyncOperation through the
//     `WindowsRuntimeSystemExtensions.AsTask` generic method found by reflection, from
//     https://superuser.com/a/1342416)
// Nothing in the script, its output format or the enum names was run.
import { execFile } from "node:child_process";
import { int, str } from "@phoenix/service-kit";
import { PlayerError } from "./errors";
import { boundedInt, MAX_SEEK_S } from "./player";
import type { NowPlaying, PlayState } from "./parse";

export const WINDOWS_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_TEXT = 200;
/** One .NET tick is 100 ns. */
const TICKS_PER_SECOND = 10_000_000;
/** ASCII unit separator, between the fields of the `now_playing` line. */
const SEP = "\u001f";
/**
 * Characters the script turns into a space inside Title/Artist/AlbumTitle before joining: every C0
 * and C1 control (U+001F, the separator, is one), U+2028/2029 and the bidi embeddings/isolates.
 * One .NET regex pattern that is also a valid JavaScript one, so a test can run it.
 */
export const WINDOWS_CLEAN_PATTERN =
  "[\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]";

/** The words PHOENIX_MEDIA_COMMAND may hold. The script's `switch` has exactly these arms. */
export const WINDOWS_COMMANDS = [
  "now_playing",
  "play_pause",
  "next",
  "previous",
  "seek",
  "set_shuffle",
  "set_repeat",
] as const;
export type WindowsCommand = (typeof WINDOWS_COMMANDS)[number];

/** The environment names the script reads, and nothing else of the caller's. */
export const COMMAND_VARIABLE = "PHOENIX_MEDIA_COMMAND";
export const ARG_VARIABLE = "PHOENIX_MEDIA_ARG";

/**
 * The whole script, one constant. Output of `now_playing` is one line of eight fields joined by
 * U+001F: status, title, artist, album, length ticks, position ticks, shuffle, repeat. Every control
 * prints `ok` (the session accepted it) or `refused`. No current session prints `none`.
 */
export const WINDOWS_SCRIPT: string = [
  "$ErrorActionPreference = 'Stop'",
  "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
  "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
  "[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null",
  "[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null",
  "[Windows.Media.MediaPlaybackAutoRepeatMode,Windows.Media,ContentType=WindowsRuntime] | Out-Null",
  "$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1",
  "function Await($operation, [Type]$resultType) {",
  "  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))",
  "  if (-not $task.Wait(3000)) { throw 'timeout' }",
  "  $task.Result",
  "}",
  "$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]",
  "$manager = Await ($managerType::RequestAsync()) $managerType",
  "$session = $manager.GetCurrentSession()",
  "if ($null -eq $session) { Write-Output 'none'; exit 0 }",
  `$command = $env:${COMMAND_VARIABLE}`,
  `$arg = $env:${ARG_VARIABLE}`,
  "$ok = $false",
  "switch ($command) {",
  "  'now_playing' {",
  "    $propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]",
  "    $props = Await ($session.TryGetMediaPropertiesAsync()) $propsType",
  "    $info = $session.GetPlaybackInfo()",
  "    $timeline = $session.GetTimelineProperties()",
  "    $sep = [string][char]31",
  `    function Clean($s) { $t = [regex]::Replace([string]$s, '${WINDOWS_CLEAN_PATTERN}', ' '); if ($t.Length -gt ${MAX_TEXT}) { $t.Substring(0, ${MAX_TEXT}) } else { $t } }`,
  "    $fields = @(",
  "      [string]$info.PlaybackStatus,",
  "      (Clean $props.Title),",
  "      (Clean $props.Artist),",
  "      (Clean $props.AlbumTitle),",
  "      [string](($timeline.EndTime - $timeline.StartTime).Ticks),",
  "      [string]$timeline.Position.Ticks,",
  "      [string]$info.IsShuffleActive,",
  "      [string]$info.AutoRepeatMode",
  "    )",
  "    Write-Output ($fields -join $sep)",
  "    exit 0",
  "  }",
  "  'play_pause' { $ok = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }",
  "  'next' { $ok = Await ($session.TrySkipNextAsync()) ([bool]) }",
  "  'previous' { $ok = Await ($session.TrySkipPreviousAsync()) ([bool]) }",
  "  'seek' {",
  "    if ($arg -notmatch '^[0-9]{1,12}$') { throw 'argument' }",
  "    $ok = Await ($session.TryChangePlaybackPositionAsync([int64]$arg)) ([bool])",
  "  }",
  "  'set_shuffle' {",
  "    if ($arg -ne 'on' -and $arg -ne 'off') { throw 'argument' }",
  "    $ok = Await ($session.TryChangeShuffleActiveAsync($arg -eq 'on')) ([bool])",
  "  }",
  "  'set_repeat' {",
  "    switch ($arg) {",
  "      'off' { $mode = [Windows.Media.MediaPlaybackAutoRepeatMode]::None }",
  "      'one' { $mode = [Windows.Media.MediaPlaybackAutoRepeatMode]::Track }",
  "      'all' { $mode = [Windows.Media.MediaPlaybackAutoRepeatMode]::List }",
  "      default { throw 'argument' }",
  "    }",
  "    $ok = Await ($session.TryChangeAutoRepeatModeAsync($mode)) ([bool])",
  "  }",
  "  default { throw 'command' }",
  "}",
  "if ($ok) { Write-Output 'ok' } else { Write-Output 'refused' }",
].join("\n");

/** What the runner is asked: a command word and its (already validated) argument. */
export interface WindowsRequest {
  command: WindowsCommand;
  /** Digits, `on`/`off` or `off`/`one`/`all`; empty when the command takes none. */
  arg: string;
}

/** Runs the fixed script for one request and resolves with its trimmed standard output. */
export type WindowsRunner = (request: WindowsRequest) => Promise<string>;

/** `powershell.exe` under %SystemRoot%, never found through PATH. */
function powershellPath(): string | undefined {
  const root = process.env.SystemRoot;
  return root ? `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : undefined;
}

export const windowsRunner: WindowsRunner = (request) => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const program = powershellPath();
  if (!program) {
    reject(new PlayerError("missing_tool", "Windows PowerShell was not found"));
    return promise;
  }
  execFile(
    program,
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64"),
    ],
    {
      timeout: WINDOWS_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      encoding: "utf8",
      env: { ...process.env, [COMMAND_VARIABLE]: request.command, [ARG_VARIABLE]: request.arg },
    },
    (error, stdout) => {
      if (!error) return resolve(stdout.replace(/^\uFEFF/, "").trim());
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return reject(new PlayerError("missing_tool", "Windows PowerShell was not found"));
      }
      if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        return reject(new PlayerError("too_large", "The player's answer was too large"));
      }
      // stderr and the exit code can carry track names or paths: not forwarded.
      reject(new PlayerError("player", "The player did not answer"));
    },
  );
  return promise;
};

const STATES: Readonly<Record<string, PlayState>> = { playing: "playing", paused: "paused" };
const REPEATS: Readonly<Record<string, "off" | "one" | "all">> = {
  none: "off",
  track: "one",
  list: "all",
};

function ticksToSeconds(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d{1,18}$/.test(raw)) return undefined;
  return int(Math.floor(Number(raw) / TICKS_PER_SECOND));
}

/** Output of the `now_playing` request. `none` means no media session. */
export function parseWindowsNowPlaying(output: string): NowPlaying {
  if (output === "none") return { running: false, state: "not_running" };
  const f = output.split(SEP);
  if (f.length !== 8) throw new PlayerError("player", "The player sent an unexpected answer");
  const title = str(f[1], MAX_TEXT);
  const artist = str(f[2], MAX_TEXT);
  const album = str(f[3], MAX_TEXT);
  const duration = ticksToSeconds(f[4]);
  const position = ticksToSeconds(f[5]);
  const shuffle = f[6]?.trim().toLowerCase();
  const loop = f[7]?.trim().toLowerCase();
  const status = f[0]?.trim().toLowerCase() ?? "";
  return {
    running: true,
    state: Object.hasOwn(STATES, status) ? STATES[status]! : "stopped",
    ...(title ? { title } : {}),
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(position !== undefined ? { position_s: position } : {}),
    ...(duration !== undefined ? { duration_s: duration } : {}),
    ...(shuffle === "true" || shuffle === "false" ? { shuffle: shuffle === "true" } : {}),
    ...(loop !== undefined && Object.hasOwn(REPEATS, loop) ? { repeat: REPEATS[loop]! } : {}),
  };
}

function field(input: unknown, name: string): unknown {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)[name]
    : undefined;
}

/** A `player` name has no meaning on Windows (the current session is used): refuse, never ignore. */
function refusePlayer(player: unknown): void {
  if (player !== undefined) {
    throw new PlayerError(
      "invalid",
      "Windows controls the current media session; choosing a player is not supported",
    );
  }
}

/** The request for a control command from validated input, or throws. */
export function windowsControlRequest(command: string, input: unknown): WindowsRequest {
  refusePlayer(field(input, "player"));
  switch (command) {
    case "play_pause":
    case "next":
    case "previous":
      return { command, arg: "" };
    case "seek": {
      const seconds = boundedInt(field(input, "position_s"), "position_s", 0, MAX_SEEK_S);
      return { command, arg: String(seconds * TICKS_PER_SECOND) };
    }
    case "set_shuffle": {
      const enabled = field(input, "enabled");
      if (typeof enabled !== "boolean") {
        throw new PlayerError("invalid", "enabled must be true or false");
      }
      return { command, arg: enabled ? "on" : "off" };
    }
    case "set_repeat": {
      const mode = field(input, "mode");
      if (mode !== "off" && mode !== "one" && mode !== "all") {
        throw new PlayerError("invalid", 'mode must be "off", "one" or "all"');
      }
      return { command, arg: mode };
    }
    case "set_volume":
      throw new PlayerError("unsupported", "Windows media sessions have no volume control");
    default:
      throw new PlayerError("invalid", "Unknown control");
  }
}

export async function readWindowsNowPlaying(
  run: WindowsRunner,
  configuredPlayer?: string,
): Promise<NowPlaying> {
  refusePlayer(configuredPlayer);
  return parseWindowsNowPlaying(await run({ command: "now_playing", arg: "" }));
}

/** Runs one control. No session is reported ("not running"); the session may also refuse it. */
export async function runWindowsControl(
  run: WindowsRunner,
  command: string,
  input: unknown,
  configuredPlayer?: string,
): Promise<void> {
  refusePlayer(configuredPlayer);
  const request = windowsControlRequest(command, input);
  const answer = await run(request);
  if (answer === "none") throw new PlayerError("not_running", "No media player is running");
  if (answer !== "ok") throw new PlayerError("player", "The player did not accept the command");
}
