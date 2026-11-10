// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/**
 * Display text for Phoenix's OWN capabilities and their configuration fields (Phase 70). Used only
 * for a capability Core reports as built in; text from any other capability is shown as it sent it.
 * A field label is looked up as `capabilityLabels.field.<capabilityId>.<field>` first, then
 * `capabilityLabels.field.<field>`. A new built-in capability, or a new field in a built-in
 * schema, must add its entries here (core/runtime/test/capability-labels.test.ts enforces it).
 */
export const capabilityLabels = {
  "capabilityLabels.kage.name": "Kage",
  "capabilityLabels.kage.description":
    "Meeting capture, transcripts and summaries from your Kage server.",
  "capabilityLabels.git.name": "Git",
  "capabilityLabels.git.description":
    "Watches your selected local repositories for commits, branches and conflicts.",
  "capabilityLabels.github.name": "GitHub",
  "capabilityLabels.github.description":
    "Pull requests, review requests, Actions runs and deployments of the repositories you pick.",
  "capabilityLabels.vercel.name": "Vercel",
  "capabilityLabels.vercel.description": "Vercel deployments from your account or team.",
  "capabilityLabels.stripe.name": "Stripe",
  "capabilityLabels.stripe.description":
    "Recent Stripe payments and a read-only summary of counts, amounts and balance.",
  "capabilityLabels.n8n.name": "n8n",
  "capabilityLabels.n8n.description": "Workflow executions of your own n8n.",
  "capabilityLabels.resend.name": "Resend",
  "capabilityLabels.resend.description":
    "Delivery status of the emails your Resend account has sent.",
  "capabilityLabels.notion.name": "Notion",
  "capabilityLabels.notion.description":
    "Tells Fawkes when a Notion page or database you list is edited.",
  "capabilityLabels.calcom.name": "Cal.com",
  "capabilityLabels.calcom.description":
    "Upcoming Cal.com bookings, with a reminder shortly before one starts.",
  "capabilityLabels.calendar.name": "Calendar awareness",
  "capabilityLabels.calendar.description": "Read-only upcoming meetings and deploy-freeze windows.",
  "capabilityLabels.spotify.name": "Spotify",
  "capabilityLabels.spotify.description":
    "What the Spotify desktop app is playing, and playback controls on macOS.",
  "capabilityLabels.apple-music.name": "Apple Music",
  "capabilityLabels.apple-music.description":
    "What the Music app is playing, and playback controls on macOS.",
  "capabilityLabels.mpris.name": "Linux media players (MPRIS)",
  "capabilityLabels.mpris.description":
    "What a local media player is playing, and playback controls on Linux and Windows.",
  "capabilityLabels.portfolio.name": "Portfolio",
  "capabilityLabels.portfolio.description":
    "Read-only crypto portfolio: balances of public addresses and exchanges.",
  "capabilityLabels.terminal.name": "Terminal",
  "capabilityLabels.terminal.description":
    "Shows commands you run with phoenix run as they start and finish.",
  "capabilityLabels.docker.name": "Docker",
  "capabilityLabels.docker.description":
    "Watches local Docker containers for starts, stops, crashes and failing health checks.",
  "capabilityLabels.frappe.name": "Frappe / ERPNext",
  "capabilityLabels.frappe.description":
    "Watches the health of your local Frappe sites and creates a Task when you confirm.",
  "capabilityLabels.machine.name": "Machine health and local models",
  "capabilityLabels.machine.description": "Local resource health and management of local models.",
  "capabilityLabels.agents.name": "Coding agents",
  "capabilityLabels.agents.description":
    "Shows whether coding agents are working, waiting, done or failed, and starts or stops them on your confirmation.",
  "capabilityLabels.awake.name": "Keep awake",
  "capabilityLabels.awake.description":
    "Keeps this computer awake for a set time, with safety floors.",
  "capabilityLabels.issues.name": "Issue trackers",
  "capabilityLabels.issues.description":
    "Tells Fawkes when a GitHub, Linear or Jira issue is assigned to you or changes.",
  "capabilityLabels.plans.name": "Plan review context",
  "capabilityLabels.plans.description":
    "Read-only aggregate context for advisory review of an engineering plan.",
  "capabilityLabels.ports.name": "Port & process radar",
  "capabilityLabels.ports.description":
    "Lists listening TCP ports with their process and flags forgotten or heavy dev servers.",
  "capabilityLabels.screen-region.name": "Screen region capture",
  "capabilityLabels.screen-region.description":
    "Lets you drag one region of the screen and returns it as an image after you confirm.",
  "capabilityLabels.browser.name": "Phoenix browser actions",
  "capabilityLabels.browser.description":
    "Lets Fawkes act in the active tab of the Phoenix browser, one confirmed action at a time.",
  "capabilityLabels.web-search.name": "Web search",
  "capabilityLabels.web-search.description":
    "Sends a short text query to a chain of search providers and returns titles, links and snippets.",
  "capabilityLabels.status-lights.name": "Status lights & Stream Deck",
  "capabilityLabels.status-lights.description":
    "Shows what Fawkes is doing on lights you choose, and lets a Stream Deck answer approvals.",
  "capabilityLabels.chat-approvals.name": "Chat approvals",
  "capabilityLabels.chat-approvals.description":
    "Posts approval cards to Slack and Discord and lets an allow-listed owner answer them.",
  "capabilityLabels.capture-microphone.name": "Microphone capture",
  "capabilityLabels.capture-microphone.description":
    "Lets you choose microphone capture for local AI processing, with approval each time.",
  "capabilityLabels.capture-screen.name": "Screen capture",
  "capabilityLabels.capture-screen.description":
    "Lets you choose screen capture for local AI processing, with approval each time.",
  "capabilityLabels.mock.name": "Mock",
  "capabilityLabels.mock.description":
    "Plays demo scenarios so you can see Fawkes react (development only).",

  "capabilityLabels.field.base_url": "Server address",
  "capabilityLabels.field.poll_ms": "Check every (ms)",
  "capabilityLabels.field.bot_path": "Kage bot path",
  "capabilityLabels.field.bot_name": "Bot display name",
  "capabilityLabels.field.max_duration_min": "Maximum capture length (min)",
  "capabilityLabels.field.git.repositories": "Repositories (one absolute path per line)",
  "capabilityLabels.field.github.repositories": "Repositories (one owner/name per line)",
  "capabilityLabels.field.api_url": "GitHub API address",
  "capabilityLabels.field.team_id": "Team id",
  "capabilityLabels.field.project": "Project (name or id)",
  "capabilityLabels.field.remind_minutes": "Remind this many minutes before a booking (0 = off)",
  "capabilityLabels.field.google": "Google Calendar",
  "capabilityLabels.field.microsoft": "Microsoft Calendar",
  "capabilityLabels.field.caldav": "CalDAV",
  "capabilityLabels.field.macos": "macOS Calendar",
  "capabilityLabels.field.caldav_url": "CalDAV calendar address",
  "capabilityLabels.field.caldav_timezone": "CalDAV time zone",
  "capabilityLabels.field.freeze": "Block deployments during deploy-freeze events",
  "capabilityLabels.field.player": "Media player",
  "capabilityLabels.field.price_url": "Price service address",
  "capabilityLabels.field.socket_path": "Docker socket path",
  "capabilityLabels.field.benches": "Frappe benches (one absolute path per line)",
  "capabilityLabels.field.timeout_ms": "Request timeout (ms)",
  "capabilityLabels.field.include_prompt_title": "Show a short title taken from the prompt",
  "capabilityLabels.field.silent_after_min": "Forget a silent session after (min)",
  "capabilityLabels.field.max_sessions": "Most sessions at once",
  "capabilityLabels.field.max_runtime_min": "Longest session runtime (min)",
  "capabilityLabels.field.grace_ms": "Grace before a stopped agent is killed (ms)",
  "capabilityLabels.field.battery_floor_percent": "Battery floor (%)",
  "capabilityLabels.field.floors_enabled": "Battery and heat floors",
  "capabilityLabels.field.floor_low_power_percent": "Low Power Mode below battery (%)",
  "capabilityLabels.field.floor_end_percent": "End the session below battery (%)",
  "capabilityLabels.field.floor_thermal_low_power": "Low Power Mode at heat level",
  "capabilityLabels.field.floor_thermal_end": "End the session at heat level",
  "capabilityLabels.field.ports.watch": "Refresh the list in the background",
  "capabilityLabels.field.forgotten_after_hours": "Flag a dev server as forgotten after (hours)",
  "capabilityLabels.field.heavy_cpu_percent": "Heavy process CPU (%)",
  "capabilityLabels.field.heavy_memory_mb": "Heavy process memory (MB)",
  "capabilityLabels.field.restart_roots": "Restart folders (one absolute path per line)",
  "capabilityLabels.field.searxng_url": "SearXNG address",
  "capabilityLabels.field.devices": "Lights you consent to (one id per line)",
  "capabilityLabels.field.speed": "Playback speed",
  "capabilityLabels.field.projects": "Projects answerable from chat (one per line)",
  "capabilityLabels.field.phoenix_confirmations": "Answer Phoenix confirmations from chat",
  "capabilityLabels.field.token_ttl_seconds": "Button validity (seconds)",
} as const;
