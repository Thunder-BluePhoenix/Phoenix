// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the port and process radar. */
export const ports = {
  "ports.title": "Port radar",
  "ports.intro":
    "Shows which programs are listening on network ports on this computer, which project they run in and how long they have been running. Scanning only reads; nothing is changed unless you stop a program and approve it.",
  "ports.disabled":
    "The port radar is turned off. Enable the Port & process radar capability to use it.",
  "ports.scan": "Scan now",
  "ports.scanning": "Scanning…",
  "ports.notScanned": "Nothing scanned yet. Choose Scan now.",
  "ports.empty": "No program is listening on a port.",
  "ports.loadError": "The ports could not be read.",
  "ports.scannedAt": "Scanned at {time}",
  "ports.count": "{count, plural, one {# listening port} other {# listening ports}}",
  "ports.table.caption": "Listening ports",
  "ports.col.port": "Port",
  "ports.col.process": "Program",
  "ports.col.project": "Project",
  "ports.col.age": "Running for",
  "ports.col.notes": "Notes",
  "ports.col.actions": "Actions",
  "ports.pid": "process {pid}",
  "ports.age.unknown": "unknown",
  "ports.age.minutes": "{count, plural, one {# minute} other {# minutes}}",
  "ports.age.hours": "{count, plural, one {# hour} other {# hours}}",
  "ports.age.days": "{count, plural, one {# day} other {# days}}",
  "ports.project.none": "no project",
  "ports.exposure.all": "reachable from the network",
  "ports.exposure.loopback": "this computer only",
  "ports.exposure.interface": "one network address",
  "ports.flag.forgotten": "Maybe forgotten",
  "ports.flag.heavy": "Heavy",
  "ports.flag.core": "Phoenix itself",
  "ports.usage": "CPU {percent}%, memory {mb} MB",
  "ports.help.forgotten":
    "Maybe forgotten: it runs in a project folder and has been running for more than {hours, plural, one {# hour} other {# hours}}. Phoenix cannot see whether anyone still uses it.",
  "ports.help.heavy":
    "Heavy: CPU of {cpu}% or more, or memory of {mb} MB or more, as reported by ps (an average, not a live reading).",
  "ports.open": "Open in browser",
  "ports.open.label": "Open {name} on port {port} in your default browser",
  "ports.openPhoenix": "Open in Phoenix browser",
  "ports.openPhoenix.label":
    "Open {name} on port {port} in the Phoenix browser (asks you to confirm first)",
  "ports.openNote":
    "Open in browser opens http://127.0.0.1 in your default browser. Open in Phoenix browser hands the same loopback address to the Phoenix desktop app (macOS only), whose browser asks you to confirm before it opens anything. If the desktop app is not installed, use the plain link.",
  "ports.stop": "Stop…",
  "ports.stop.label": "Stop {name} on port {port}",
  "ports.refusal.self": "This is Phoenix itself, which never stops itself.",
  "ports.refusal.other_user": "It belongs to another user.",
  "ports.refusal.system": "It is a system process.",
  "ports.refusal.not_dev_tool": "It is not a developer tool Phoenix may stop.",
  "ports.refusal.unsupported": "Stopping is not available on this system.",
  "ports.refusal.unknown": "Phoenix could not check this process, so it will not stop it.",
  "ports.confirm.title": "Stop {name} on port {port}?",
  "ports.confirm.body":
    "After you approve it, Phoenix asks {name} (process {pid}) to quit. The program may lose unsaved work.",
  "ports.confirm.go": "Ask to stop",
  "ports.confirm.cancel": "Cancel",
  "ports.stop.waiting": "Waiting for your approval in Approvals…",
  "ports.stop.exited": "{name} stopped.",
  "ports.stop.stillRunning":
    "{name} was asked to quit and is still running. Force stop ends it at once, cannot be undone and may lose data.",
  "ports.force": "Force stop…",
  "ports.force.label": "Force stop {name} on port {port}",
  "ports.force.hint":
    "Phoenix refuses force stop for the first few seconds after the request to quit.",
  "ports.force.confirm": "Force stop",
  "ports.restart": "Restart…",
  "ports.restart.label": "Restart {name} on port {port}",
  "ports.restart.title": "Restart {name} on port {port}?",
  "ports.restart.body":
    "After you approve it, Phoenix asks {name} (process {pid}) to quit and, only if it exits, starts the restart recipe you configured, exactly as shown below. The program may lose unsaved work. If the start fails, the program stays stopped.",
  "ports.restart.recipe": "Recipe",
  "ports.restart.argv": "Program and arguments",
  "ports.restart.cwd": "Folder",
  "ports.restart.go": "Ask to restart",
  "ports.restart.started":
    "{name} was stopped and the recipe {recipe} was started (process {pid}). Phoenix cannot tell whether it listens again yet; scan again.",
  "ports.restart.note":
    "Restart is offered only for a program on a port for which you wrote a restart recipe in the settings of this capability. Phoenix never rebuilds a command from a running program.",
  "ports.watch.label": "Refresh automatically while Phoenix is open",
  "ports.watch.help":
    "Off by default. When on, Phoenix reads the port list every 15 seconds, only while a Phoenix window is open.",
  "ports.noProcessTable":
    "The process list could not be read, so ages and stopping are unavailable.",
  "ports.parseWarnings":
    "Some lines of the system's process or port list were not understood and were left out (a program name can contain line breaks). Programs that are missing or cannot be stopped here may be affected; stopping a listed one still re-checks everything.",
  "ports.windows.note":
    "On Windows the radar shows ports and program names only; ages, projects and stopping are not available.",
} as const;
