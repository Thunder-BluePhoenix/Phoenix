// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** Settings screen for team presence (Phase 92). */
export const teamStatus = {
  "teamStatus.title": "Team presence",
  "teamStatus.intro":
    "Team presence is off by default. When you turn it on, Phoenix sends only the kinds of status you tick (deploying, running an agent, in a meeting) as an encrypted frame to the teammates you added, and it never names a repository, branch or person.",
  "teamStatus.notAvailable":
    "Team presence is not available: this Phoenix Core has no operating system secret store to keep your key in.",
  "teamStatus.loadFailed": "Team presence could not be loaded.",
  "teamStatus.listSeparator": ", ",

  "teamStatus.kind.deploying": "deploying",
  "teamStatus.kind.agentRun": "running an agent",
  "teamStatus.kind.meeting": "in a meeting",

  "teamStatus.relay.label": "Relay address",
  "teamStatus.route.label": "Route (optional)",
  "teamStatus.route.hint":
    "Leave the route empty to start a new team. Paste a route here to join the same team as a teammate.",
  "teamStatus.route.shown": "Relay route",
  "teamStatus.turnOn": "Turn on",
  "teamStatus.resume": "Turn back on",
  "teamStatus.pause": "Pause",
  "teamStatus.leave": "Leave the team",
  "teamStatus.leave.ask": "Leave the team and forget everyone?",

  "teamStatus.state.line": "Connection: {state}",
  "teamStatus.state.connected": "connected",
  "teamStatus.state.connecting": "connecting",
  "teamStatus.state.paused": "paused",
  "teamStatus.lastError": "Last error: {error}",

  "teamStatus.self.id": "Your team id",
  "teamStatus.self.publicKey": "Your public key",
  "teamStatus.self.hint":
    "Give both to a teammate so they can add you. Your private key never leaves this computer.",

  "teamStatus.sharing.title": "What I share",
  "teamStatus.sharing.master": "Share my status with my team",
  "teamStatus.sharing.deploying": "Deploying",
  "teamStatus.sharing.agentRun": "Running an agent for a long time",
  "teamStatus.sharing.meeting": "In a meeting",
  "teamStatus.outgoing.now": "Teammates see right now: {kinds}.",
  "teamStatus.outgoing.none": "Teammates see nothing from you right now.",

  "teamStatus.members.title": "Teammates",
  "teamStatus.members.none": "You have not added any teammates yet.",
  "teamStatus.members.removeLabel": "Remove {label}",
  "teamStatus.members.id": "Teammate's team id",
  "teamStatus.members.label": "Name to show",
  "teamStatus.members.add": "Add teammate",

  "teamStatus.presence.title": "Who is around",
  "teamStatus.presence.none": "No teammates to show.",
  "teamStatus.presence.nothing": "nothing shared",
} as const;
