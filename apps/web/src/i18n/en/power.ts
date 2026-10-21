// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** English text for the power screens. */
export const power = {
  "power.awake.duration.minutes": "{minutes, plural, one {# minute} other {# minutes}}",
  "power.awake.duration.hours": "{hours, plural, one {# hour} other {# hours}}",
  "power.awake.heading": "Keep awake",
  "power.awake.disabled": "Keep awake is turned off. Enable the Keep awake capability to use it.",
  "power.awake.waiting": "Waiting for your approval…",
  "power.awake.idle": "The computer sleeps as usual. Start a timed session to keep it awake.",
  "power.awake.start.heading": "Keep awake for",
  "power.awake.custom.label": "Minutes",
  "power.awake.reason.label": "Reason (optional)",
  "power.awake.custom.start": "Start",
  "power.awake.custom.invalid": "Enter a whole number of minutes from {min} to {max}.",
  "power.awake.agents.start": "While agents work",
  "power.awake.agents.help":
    "Stays awake while any coding agent is working, and ends a few minutes after the last one finishes (uses the minutes above).",
  "power.awake.agents.working": "{count, plural, one {# agent working} other {# agents working}}",
  "power.awake.agents.grace":
    "Ends {minutes, plural, one {# minute} other {# minutes}} after the last agent finishes.",
  "power.awake.running": "Keeping the computer awake",
  "power.awake.remaining": "Time left: {time}",
  "power.awake.endsAt": "Ends at {time}",
  "power.awake.extend.label": "Add time",
  "power.awake.extend.button": "+{duration}",
  "power.awake.end.hold": "Hold to end",
  "power.awake.end.holding": "Keep holding…",
  "power.awake.end.hint":
    "Hold the button for 1.5 seconds (or hold Space or Enter) to end the session.",
  "power.awake.battery":
    "A session also ends if the battery falls below {percent}% while unplugged.",
  "power.awake.lid":
    "Closing the lid still puts the computer to sleep; staying awake with the lid closed needs the separate lid-closed mode.",
  "power.awake.indicator": "Awake {time}",
  "power.recovery.heading": "Lid-closed mode and recovery",
  "power.recovery.waiting": "Waiting for your approval…",
  "power.recovery.unreadable": "The recovery status could not be read.",
  "power.recovery.journal.clean": "Nothing is waiting to be undone.",
  "power.recovery.journal.pending":
    "Phoenix could not restore {count, plural, one {# system change} other {# system changes}}. Sleep settings may still be changed.",
  "power.recovery.journal.kind.disablesleep": "Sleep with lid closed",
  "power.recovery.journal.kind.lowpowermode": "Low Power Mode",
  "power.recovery.journal.kind.other": "Other change",
  "power.recovery.journal.at": "since {time}",
  "power.recovery.journal.undo": "Undo now",
  "power.recovery.journal.untrusted":
    "{count, plural, one {# unreadable journal line was} other {# unreadable journal lines were}} ignored, not trusted.",
  "power.recovery.journal.cannotQuit": "Quitting Phoenix is refused until these are undone.",
  "power.recovery.lid.open": "The lid is open.",
  "power.recovery.lid.closed": "The lid is closed.",
  "power.recovery.lid.unknown": "The lid state is unknown.",
  "power.recovery.lid.unsupported":
    "This computer has no lid sensor, so lid-closed mode is not available.",
  "power.recovery.helper.installed": "Privileged helper installed",
  "power.recovery.helper.missing":
    "Privileged helper not installed (lid-closed mode unavailable). See docs/awake-helper.md.",
  "power.recovery.helper.unknown": "Whether the privileged helper is installed is unknown.",
  "power.recovery.floors.off": "Floors are off",
  "power.recovery.floors.rule":
    "Low Power Mode below {low} %, end the session below {end} %; heat: Low Power Mode at {heatLow}, end at {heatEnd}.",
  "power.recovery.floors.lowPowerActive": "Low Power Mode is on",
  "power.recovery.floors.battery.none": "Battery: none",
  "power.recovery.floors.battery.unknown": "Battery: unknown",
  "power.recovery.floors.battery.level": "Battery {percent} %",
  "power.recovery.floors.battery.unplugged": "Battery {percent} %, unplugged",
  "power.recovery.floors.battery.plugged": "Battery {percent} %, plugged in",
  "power.recovery.floors.thermal.nominal": "normal",
  "power.recovery.floors.thermal.fair": "warm",
  "power.recovery.floors.thermal.serious": "hot",
  "power.recovery.floors.thermal.critical": "critical",
  "power.recovery.floors.thermal.level": "Heat: {level}",
  "power.recovery.floors.thermal.unsupported": "Heat: not reported",
  "power.recovery.floors.thermal.unknown": "Heat: unknown",
  "power.recovery.safety.warning":
    "Never carry the computer in a bag, case or other closed space while lid-closed mode is on: it can overheat. Keep vents clear.",
  "power.recovery.safety.understand": "I understand",
  "power.recovery.safety.acknowledge": "Acknowledge",
  "power.recovery.safety.done": "You have acknowledged the lid-closed safety warning.",
  "power.recovery.start": "Start lid-closed mode",
  "power.recovery.end": "End lid-closed mode",
  "power.recovery.engaged": "Lid-closed mode is on.",
  "power.recovery.engagedSince": "Lid-closed mode is on since {time}.",
  "power.recovery.needsSession": "Start a keep-awake session first; lid-closed mode needs one.",
  "power.recovery.journal.discard": "Discard this entry",
  "power.recovery.lockBlocked":
    "Another recovery process holds the lock, so nothing was undone yet. The change is still pending.",
  "power.recovery.sleepUnjournaled":
    "Sleep is disabled on this computer, but Phoenix has no record of turning it off. Something else changed it.",
  "power.recovery.journalPath": "Journal: {path}",
  "power.continuity.heading": "Agent continuity",
  "power.continuity.intro":
    "Extras for long agent runs. Each one is off until you turn it on, and none of them chooses a network, a terminal or a program for you.",
  "power.continuity.needsAwake":
    "These settings take effect only while the Keep awake capability is enabled.",
  "power.continuity.saved": "Saved. The changes apply the next time Keep awake starts.",
  "power.continuity.applyNote":
    "Changes are saved to the Keep awake capability and apply the next time it is enabled.",
  "power.continuity.network.title": "Network watch",
  "power.continuity.network.help":
    "Checks every few seconds that a computer you name can be reached, and tells Phoenix when the network goes down and comes back. It only connects; it sends and reads nothing.",
  "power.continuity.hosts.label": "Hosts to check (name or name:port)",
  "power.continuity.hotspot.title": "Hotspot failover",
  "power.continuity.hotspot.help":
    "When the Wi-Fi drops while a keep-awake session runs, join the iPhone hotspot you name. Needs the network watch above and a list of hosts. Works on macOS only and has not been tested on a real Mac.",
  "power.continuity.hotspot.ssid": "Hotspot name (SSID)",
  "power.continuity.hotspot.disclosure":
    "Before you turn this on: macOS can join a network it already knows without any password on a command line, so join your hotspot once by hand first. Only if you also allow the saved password below does Phoenix pass it to the macOS networksetup tool, and then every program on this Mac can read it on that command line for the few seconds the join takes. There is no safer built-in way to do this without asking you. Decline if that is not acceptable.",
  "power.continuity.hotspot.allowPassword":
    "I accept this: use the saved hotspot password on the command line",
  "power.continuity.hotspot.passwordSaved": "A hotspot password is saved in the keychain.",
  "power.continuity.hotspot.passwordMissing":
    "No hotspot password is saved. Save one as the “hotspot_password” secret of the Keep awake capability, or leave this box off and join the hotspot once by hand.",
  "power.continuity.hotspot.join": "Join hotspot now",
  "power.continuity.hotspot.rejoin": "Rejoin my previous network",
  "power.continuity.hotspot.confirmNote":
    "Joining a network changes which Wi-Fi this Mac uses. Phoenix asks you to confirm each time.",
  "power.continuity.hotspot.joined": "Joined.",
  "power.continuity.nudge.title": "Nudge agents",
  "power.continuity.nudge.help":
    "If there is no network for the time below, type “continue” into the terminals you list. Nothing is typed during a meeting or dictation, and each terminal gets it at most once per outage.",
  "power.continuity.nudge.after": "Seconds without network before nudging (30 to 3600)",
  "power.continuity.nudge.panes": "tmux panes (for example %12)",
  "power.continuity.nudge.sessions": "Phoenix agent sessions (ph- and 16 hex digits)",
  "power.continuity.nudge.sessionsNote":
    "Not available yet: Phoenix has no safe way to type into a tracked session, so listed sessions are skipped and reported. Only tmux panes are nudged.",
  "power.continuity.nudge.commands": "Programs a pane may be running (for example claude)",
  "power.continuity.nudge.commandsNote":
    "Phoenix checks the pane still exists and runs one of these programs before typing. With an empty list nothing is ever typed.",
  "power.continuity.nudge.enter": "Also press Enter",
  "power.continuity.nudge.enterHelp":
    "Off by default. Without it “continue” is typed but not sent, so you press Enter yourself.",
  "power.continuity.throttle.title": "Browser throttling check",
  "power.continuity.throttle.help":
    "Chrome, Arc, Comet, Edge and Brave slow down background tabs, which can stall an agent web page. This lists the ones running that way. It never changes a browser unless you choose Relaunch and confirm.",
  "power.continuity.throttle.unsupported": "Checking browsers works on macOS only.",
  "power.continuity.throttle.notRunning": "not running",
  "power.continuity.throttle.throttled": "running with background throttling",
  "power.continuity.throttle.fine": "running unthrottled",
  "power.continuity.throttle.relaunch": "Relaunch {name} unthrottled",
  "power.continuity.throttle.confirm":
    "Relaunch {name} without background throttling? {name} will quit and reopen, its tabs will reload, and anything unsaved on a page may be lost. This is refused during a meeting or dictation.",
  "power.continuity.throttle.confirmYes": "Quit and relaunch",
  "power.continuity.throttle.relaunched": "{name} was relaunched.",
  "power.continuity.outage.title": "Last network outage",
  "power.continuity.outage.none": "No network outage seen yet.",
  "power.continuity.outage.down": "The network is down since {time}.",
  "power.continuity.outage.ended": "The network was down from {from} to {to}.",
  "power.continuity.outage.nudged":
    "{count, plural, one {# terminal nudged} other {# terminals nudged}}",
  "power.continuity.outage.hotspot.joined": "Hotspot joined",
  "power.continuity.outage.hotspot.failed": "Hotspot join failed",
  "power.continuity.outage.hotspot.skipped": "Hotspot not tried (off, or no session running)",
  "power.continuity.outage.hotspot.notTried": "Hotspot not tried yet",
  "power.continuity.list.empty": "Nothing listed.",
  "power.continuity.list.remove": "Remove {item}",
  "power.continuity.invalid.host":
    "Use a host name or address, optionally with :port (1 to 65535).",
  "power.continuity.invalid.pane":
    "Use a tmux pane id such as %12: a percent sign and up to six digits.",
  "power.continuity.invalid.session": "Use a session id such as ph-0123456789abcdef.",
  "power.continuity.invalid.command":
    "Use a program name such as claude: letters, digits and . _ + - only.",
  "power.continuity.invalid.ssid":
    "Use 1 to 32 bytes of visible text that does not start with a hyphen.",
  "power.continuity.invalid.seconds": "Enter a whole number of seconds from {min} to {max}.",
  "power.continuity.problem.duplicate": "That entry is already in the list.",
  "power.continuity.problem.full": "The list is full ({max} entries at most).",
  "power.continuity.reason.unsupported_platform": "This works on macOS only.",
  "power.continuity.reason.no_wifi_device": "Phoenix could not find this Mac’s Wi-Fi device.",
  "power.continuity.reason.no_hotspot_configured":
    "There is no usable hotspot or previous network to join.",
  "power.continuity.reason.bad_password":
    "The saved password cannot be used. Check it in the keychain.",
  "power.continuity.reason.join_failed": "macOS could not join the network.",
  "power.continuity.reason.unknown_browser": "That browser is not one Phoenix manages.",
  "power.continuity.reason.protected": "Not now: a meeting or dictation is in progress.",
  "power.continuity.reason.not_running": "That browser is not running.",
  "power.continuity.reason.already_unthrottled":
    "That browser already runs without background throttling.",
  "power.continuity.reason.unavailable": "This is not available right now.",
  "power.continuity.reason.quit_failed": "The browser did not accept the request to quit.",
  "power.continuity.reason.still_running":
    "The browser is still open, so it was not reopened. Close it yourself, then try again.",
  "power.continuity.reason.open_failed": "The browser quit but could not be reopened.",
  "power.continuity.reason.other": "That did not work.",
  "power.lid.heading": "Lid-close actions",
  "power.lid.intro":
    "While a keep-awake session runs and you close the lid, Phoenix can save power and quiet this computer. Everything is undone when you open the lid, when the session ends, and when Phoenix starts again after a crash.",
  "power.lid.needsAwake": "These actions only run while the Keep awake capability is enabled.",
  "power.lid.master.title": "Run actions when the lid closes",
  "power.lid.master.help": "The master switch. Off means nothing below runs.",
  "power.lid.display.title": "Turn the display off",
  "power.lid.display.help":
    "Puts the display to sleep. Brightness is saved and restored when the free brightness tool is installed.",
  "power.lid.freeze.title": "Freeze chat apps",
  "power.lid.freeze.help":
    "Pauses the chosen chat apps so they stop using power, then resumes them. Never while you are in a meeting, recording or dictating, and never for terminals, editors or running coding agents.",
  "power.lid.freeze.apps": "Apps to freeze",
  "power.lid.mute.title": "Mute the sound",
  "power.lid.mute.help":
    "Mutes the sound output and restores it exactly as it was, even if you switched outputs in between.",
  "power.lid.lowPower.title": "Low Power Mode",
  "power.lid.lowPower.help":
    "Turns on Low Power Mode. Needs the optional privileged helper; without it this is skipped.",
  "power.lid.docker.title": "Freeze Docker Desktop",
  "power.lid.docker.help":
    "Pauses Docker Desktop while no container is running. Never when a container runs or Docker's state is unknown.",
  "power.lid.nap.title": "Keep agent apps out of App Nap",
  "power.lid.nap.help":
    "Stops macOS from slowing the apps you list. Their previous setting is saved and put back exactly.",
  "power.lid.nap.apps": "Apps (bundle ids, for example com.example.App)",
  "power.lid.protected.title": "Never frozen",
  "power.lid.protected.help":
    "These are always left alone. You can add to the list, but the built-in protections cannot be removed.",
  "power.lid.protected.builtIn": "Built in",
  "power.lid.protected.extra": "Add a program or app name",
  "power.lid.list.empty": "Nothing added.",
  "power.lid.list.remove": "Remove {item}",
  "power.lid.list.duplicate": "That is already in the list.",
  "power.lid.list.full": "The list is full ({max} entries).",
  "power.lid.invalid.bundle":
    "Use a bundle id such as com.example.App: letters, digits and hyphens, with at least one dot.",
  "power.lid.invalid.name": "Use a plain program or app name: letters, digits, spaces and . _ + -",
  "power.lid.unsupported": "Not available here: {reason}",
  "power.lid.gapNote":
    "Some of these only partly work on this computer. See README-lid.md for what is and is not supported.",
  "power.lid.last.title": "Last lid event",
  "power.lid.last.closed": "The lid closed at {time}.",
  "power.lid.last.opened": "The lid opened at {time}.",
  "power.lid.last.none": "Nothing has happened yet.",
  "power.lid.last.mismatched":
    "{count, plural, one {# process was not resumed because it no longer matched what Phoenix froze.} other {# processes were not resumed because they no longer matched what Phoenix froze.}}",
  "power.lid.last.stillClosed": "The lid is closed now and the actions above are applied.",
  "power.lid.outcome.applied": "Done",
  "power.lid.outcome.skipped": "Skipped",
  "power.lid.outcome.failed": "Failed",
  "power.lid.outcome.undone": "Undone",
  "power.lid.outcome.undo_failed": "Could not be undone (Phoenix will try again)",
  "power.lid.reason.unsupported_platform": "This is only supported on a Mac.",
  "power.lid.reason.helper_unavailable": "The privileged helper is not installed.",
  "power.lid.reason.tool_missing": "A needed tool is not installed.",
  "power.lid.reason.already_on": "Already on for another reason.",
  "power.lid.reason.state_unknown":
    "Phoenix cannot tell whether you are in a meeting, so it did nothing.",
  "power.lid.reason.protected_state": "A meeting, recording or dictation is in progress.",
  "power.lid.reason.docker_busy": "A container is running.",
  "power.lid.reason.docker_unknown": "Docker's state is unknown.",
  "power.lid.reason.process_list_unavailable": "The list of running programs could not be read.",
  "power.lid.reason.audio_unavailable": "The sound outputs could not be read.",
  "power.lid.reason.no_targets": "There was nothing to change.",
  "power.lid.reason.nothing_to_do": "There was nothing to change.",
  "power.lid.reason.journal_unwritable":
    "The recovery journal could not be written, so nothing was changed.",
  "power.lid.reason.not_applied": "Nothing was changed.",
  "power.lid.reason.apply_failed": "The change could not be made.",
  "power.lid.reason.undo_failed": "The change could not be undone.",
  "power.lid.reason.assertions_unknown":
    "Phoenix cannot tell whether an app is in a call, so it froze nothing.",
  "power.lid.reason.holds_assertion":
    "Every chat app is in use (a call or playback), so none was frozen.",
  "power.lid.reason.output_changed":
    "The sound output was switched while the lid was closed, so Phoenix left the new output alone. The output it muted stays muted until it is the default again.",
  "power.lid.reason.retry_or_alert":
    "A frozen app looks like it was restarted, so Phoenix did not resume it. Check that your chat apps run normally.",
  "power.lid.reason.not_ours":
    "Some processes could not be resumed because they are not Phoenix's to control.",
  "power.lid.limit.output_identity_unknown":
    "Phoenix cannot read the name of the sound output, so it cannot tell whether the output changed.",
  "power.lid.limit.brightness_tool_untrusted":
    "The brightness tool's file is not safe to run (wrong owner, or writable by others), so it was not used.",
  "power.lid.reason.other": "That did not work.",
  "power.lid.limit.brightness_tool_missing":
    "The free brightness tool is not installed, so only the display sleep is used and brightness is not changed.",
  "power.lid.limit.keyboard_backlight_unsupported":
    "The keyboard light cannot be controlled without third-party software.",
  "power.lid.limit.default_output_only": "Only the current default output can be muted.",
  "power.lid.applyNote":
    "Changes take effect the next time a session sees the lid close. Everything is journalled before it is made.",
  "power.lid.saved": "Saved.",
  "power.lid.glance.closed": "The lid is closed: lid-close actions are applied.",
  "power.lid.glance.failed": "A lid-close action could not be undone. Open Keep awake for details.",
} as const;
