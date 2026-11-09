// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { PhoenixRuntime } from "./runtime";
import type { DerivedInventory } from "./privacy";
import { ENGINEERING_SIGNALS_ROOTS_KEY } from "./engineering-signals";
import { WEBHOOK_SETTINGS_KEY } from "./team-status/webhooks";
import { CHAT_APPROVALS_CAPABILITY } from "./chat-approvals/service";

// Inventory reads service state on demand; it owns no resources or lifecycle.
type InventorySources = Pick<
  PhoenixRuntime,
  | "db"
  | "retrieval"
  | "graph"
  | "sync"
  | "recap"
  | "phone"
  | "mcp"
  | "agentSafety"
  | "mission"
  | "handoff"
  | "settings"
  | "remoteRelay"
  | "statusLights"
  | "musicConnectors"
  | "filterLists"
  | "browserProfiles"
  | "scheduledAwake"
  | "teamLink"
  | "chatApprovals"
  | "capabilities"
>;

export class RuntimeInventory {
  constructor(private readonly runtime: InventorySources) {}

  private reviewItemCount(): number {
    const row = this.runtime.db.prepare("SELECT COUNT(*) AS n FROM meeting_items").get() as {
      n: number;
    };
    return row.n;
  }

  private tableCount(table: "plans" | "workflow_runs"): number {
    const row = this.runtime.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
      n: number;
    };
    return row.n;
  }

  /** Counts of what Phoenix derived from the data classes above (vectors, graph, review items, plans, workflow runs). */
  derivedCounts() {
    const retrieval = this.runtime.retrieval.status();
    const graph = this.runtime.graph.graph.stats();
    return {
      vectors: retrieval.embedded,
      graph_nodes: graph.nodes,
      graph_edges: graph.edges,
      meeting_items: this.reviewItemCount(),
      plans: this.tableCount("plans"),
      workflow_runs: this.tableCount("workflow_runs"),
    };
  }

  /** What the privacy inventory lists besides the data classes: derived, deleted with its source. */
  derivedInventory(): DerivedInventory[] {
    const retrieval = this.runtime.retrieval.status();
    const graph = this.runtime.graph.visibleInventory();
    return [
      {
        id: "vectors",
        description:
          "Numbers computed from memory text so Fawkes can find a reworded memory. They can reveal what the text was about, live in the same database file as the text and are deleted with it. Search by meaning is off unless AI and retrieval are both on.",
        count: retrieval.embedded,
        deleted_with: "memory",
        enabled: retrieval.active,
      },
      {
        id: "graph",
        description:
          "Visible people, commits, issues, meetings and decisions with their sources; hidden graph facts are not counted. Built from events, memories and meetings and deleted with them.",
        count: graph.nodes,
        edges: graph.edges,
        provenance_rows: graph.provenance,
        deleted_with: "events, memory, meetings",
      },
      {
        id: "meeting_items",
        description:
          "Decisions and action items from meetings, with the quote they came from and whether you accepted them. Deleted with the meeting.",
        count: this.reviewItemCount(),
        deleted_with: "meetings",
      },
      {
        id: "plans",
        description:
          "Engineering plans drafted from accepted meeting items (what you reviewed, approved and which GitHub issues or Frappe tasks were created from them). Deleted with the meeting; what was already created in GitHub or Frappe is not touched.",
        count: this.tableCount("plans"),
        deleted_with: "meetings",
      },
      {
        id: "synced_context",
        description:
          "Explicitly selected preferences and context metadata. Local staged copies live in settings; encrypted copies can be retained by the configured HTTPS relay until replaced with an encrypted deletion marker.",
        count: this.runtime.sync.inspect().items.filter((item) => !item.deleted).length,
        deleted_with:
          "Delete each synced item from Sync and run sync; deleting local data alone does not remove remote ciphertext",
        enabled: this.runtime.sync.status().enabled,
      },
      {
        id: "workflow_runs",
        description:
          "Workflow run snapshots copy redacted trigger events and step inputs/outputs. Deleting events clears terminal unprotected runs, while active and audit-protected runs remain until separately reviewed.",
        count: this.tableCount("workflow_runs"),
        deleted_with: "events (eligible runs); retained protected runs require review",
      },
      {
        id: "recap",
        description:
          'Weekly recap numbers: counts per day (steps, files, lines, commands, sessions, minutes, commits, CI results) and per agent and project name. No file names, commands or text. They outlive the activity history on purpose and are deleted only with "Delete all" for the recap.',
        count: this.runtime.recap.store.count(),
        deleted_with: 'recap (POST /api/privacy/delete {"data":"recap"} or DELETE /api/recap)',
      },
      {
        id: "phone_devices",
        description:
          'Phones paired with the phone link: a name, the phone\'s PUBLIC key and when it last connected. No pairing code and no private key is ever stored. Revoke one in Settings; "Delete all" for phone data also closes the listener and removes the certificate.',
        count: this.runtime.phone.devicesStore.count(),
        deleted_with: 'phone (POST /api/privacy/delete {"data":"phone"}) or revoke a device',
      },
      {
        id: "mcp_clients",
        description:
          'Clients allowed to use the Phoenix MCP server: a name, what you granted and when it last called. Only a SHA-256 of each client token is stored, never the token. Revoke one in Settings; "Delete all" for MCP data also closes the listener.',
        count: this.runtime.mcp.clientStore.count(),
        deleted_with: 'mcp (POST /api/privacy/delete {"data":"mcp"}) or revoke a client',
      },
      {
        id: "agent_checkpoints",
        description:
          "Metadata of the snapshots taken before a coding agent's first edit: the agent, the session id, the project folder and when it expires. The snapshot itself is a commit under refs/phoenix/checkpoints/ in the project's own git repository (it holds the file contents the project had, including untracked files but not ignored ones). \"Delete all\" for agent checkpoints removes the records and those refs; the unreferenced objects are removed by git's own garbage collection.",
        count: this.runtime.agentSafety.store.count(),
        deleted_with:
          'agent_checkpoints (POST /api/privacy/delete {"data":"agent_checkpoints"}) or the retention setting',
      },
      {
        id: "agent_usage",
        description:
          'Token and cost numbers coding agents reported about their own sessions, per day, session, agent and model, with the project folder name. No prompts, outputs, commands or file names. A cost is stored only when the agent reported one or you entered a price for the model. Deleted only with "Delete all" for agent usage.',
        count: this.runtime.mission.store.count(),
        deleted_with:
          'agent_usage (POST /api/privacy/delete {"data":"agent_usage"} or DELETE /api/mission/usage)',
      },
      {
        id: "handoff_notes",
        description:
          "Handoff notes written from what a coding agent reported about a session: the project folder name, changed file names with line counts, redacted commands and open questions, plus an optional model summary. Owner-only files under the Phoenix data folder, newest 50 kept. Nothing is sent anywhere unless you attach a note to a GitHub issue or copy it.",
        count: this.runtime.handoff.store.count(),
        deleted_with: 'handoff (POST /api/privacy/delete {"data":"handoff"}) or delete the note',
      },
      {
        id: "engineering_signals_roots",
        description:
          "Absolute folder paths you chose for engineering signals (Phase 82). Only the paths are stored, in settings; findings are computed on demand and never saved. Nothing is scanned or notified unless you also opt in to engineering notifications.",
        count: this.runtime.settings.get<string[]>(ENGINEERING_SIGNALS_ROOTS_KEY, []).length,
        deleted_with:
          'remove the folders (PUT /api/engineering-signals/watched-roots {"watchedRoots":[]})',
      },
      {
        id: "team_webhook_sources",
        description:
          "Incoming webhook sources you created (Phase 92): each source's id, the event types it may send and its enabled state, in settings. Each source's signing secret is kept only in the OS credential store. Deliveries become local events; nothing is sent anywhere. Off by default.",
        count: Object.keys(
          this.runtime.settings.get<{ sources?: Record<string, unknown> }>(WEBHOOK_SETTINGS_KEY, {})
            .sources ?? {},
        ).length,
        deleted_with: "revoke each source (DELETE /api/team/webhooks/sources/:source)",
      },
      {
        id: "chat_approvals_config",
        description:
          "Chat approvals settings (Phase 86), kept with the capability: the Slack and Discord workspace, channel and approver ids you entered and the projects you switched on for approving from chat. Bot tokens and signing secrets are only in the OS credential store. Off by default; nothing is posted until you enable the capability.",
        count: this.chatApprovalsConfigured(),
        deleted_with:
          "uninstall or reconfigure the capability (POST /api/capabilities/chat-approvals/configure), and delete its secrets",
      },
      {
        id: "remote_relay",
        description:
          "Remote access relay (Phase 87): the relay address you chose, a random route id and Core's relay public key, in settings. Core's relay private key is only in the OS credential store. The relay is untrusted and sees route id, peer address, frame size and timing, never contents. Off by default.",
        count: this.runtime.remoteRelay?.status().enabled ? 1 : 0,
        deleted_with:
          "turn the relay off (DELETE /api/remote-relay), which discards the route and key",
      },
      {
        id: "status_lights_devices",
        description:
          "Status lights (Phase 88): the LAN address and port of each Key Light, LIFX or Luxafor light you added (the serial of each LIFX light, and the bridge and light id of each Hue light), and each paired Hue bridge's address and certificate fingerprint, in settings. Hue application keys and Luxafor tokens are only in the OS credential store. Consent to use a light is a separate setting of the status-lights capability. Nothing is contacted until both exist and the capability is enabled; only fixed colours are ever sent.",
        count: this.runtime.statusLights.lights().length,
        deleted_with: "replace the list with an empty one (PUT /api/status-lights/devices)",
      },
      {
        id: "music_connectors",
        description:
          "Music sites (Phase 94): which of YouTube, SoundCloud, Bandcamp and Spotify Web you allowed, in settings. Nothing is fetched, opened or played from Core, and no listening history is kept.",
        count: this.runtime.musicConnectors.enabledCount(),
        deleted_with: "turn each site off (PUT /api/music/connectors/:site)",
      },
      {
        id: "browser_filter_lists",
        description:
          "Ad and tracker filter lists (Phase 93): the EasyList and EasyPrivacy text you chose to download (the public lists as published, kept as one owner-only file each under the Core data directory), which are switched on, and your blocking settings (the master switch and the sites where you turned blocking off), in settings. Nothing is downloaded until you press Update. The desktop browser host consumes the blocking settings and lists; native filtering still needs verification on a real webview.",
        count:
          this.runtime.filterLists.storedCount() +
          this.runtime.filterLists.shields().offSites.length,
        deleted_with:
          "remove a list (DELETE /api/browser/filter-lists/:id) and turn each site's blocking back on (PUT /api/browser/shields/sites/:site)",
      },
      {
        id: "browser_profiles",
        description:
          "Browser profiles (Phase 96): each profile's name, an isolation name for its web storage, its bookmarks and visit history, and the extensions you installed, in settings. Credentials you save for a profile are only in the OS credential store. Nothing is synced unless account sync is on and you opted that profile in. The desktop browser host uses profile storage; native cookie isolation and data removal still need real-webview verification.",
        count: this.runtime.browserProfiles.counts().profiles,
        deleted_with:
          "delete a profile (DELETE /api/browser/profiles/:id), which also deletes its bookmarks, history, extensions and saved credentials",
      },
      {
        id: "scheduled_awake",
        description:
          "Scheduled keep-awake (Phase 90): the windows you saved (a name, days or a date, start and end times, a time zone, and your battery and charger rules) and the windows you skipped, in settings. Off until you turn it on, and turning it on and saving a window each ask you first. Battery level and Low Power Mode are read on this computer and never stored.",
        count: this.runtime.scheduledAwake.scheduleCount(),
        deleted_with:
          "delete a schedule (DELETE /api/scheduled-awake/schedules/:id); turning scheduling off keeps them but holds nothing",
      },
      {
        id: "team_status",
        description:
          "Team presence (Phase 92): your team relay address and route id, your team id and public key, and the teammates you added (id, the label you chose, their public key), in settings; your sharing choices; and the last state each teammate sent, held in memory only. Your team private key is only in the OS credential store. Off by default; sharing is a second, separate opt-in per item.",
        count: this.runtime.teamLink?.memberCount() ?? 0,
        deleted_with:
          "remove a teammate (DELETE /api/team/members/:id), or leave the team (DELETE /api/team/link), which forgets the identity, route and roster",
      },
    ];
  }

  /** How many chat approval settings are set (projects plus each provider that is switched on). */
  private chatApprovalsConfigured(): number {
    if (!this.runtime.chatApprovals) return 0;
    const config = this.runtime.capabilities.get(CHAT_APPROVALS_CAPABILITY).config;
    const projects = Array.isArray(config.projects) ? config.projects.length : 0;
    const providers = ["slack", "discord", "teams"].filter((p) => {
      const value = config[p];
      return (
        value !== null && typeof value === "object" && "enabled" in value && value.enabled === true
      );
    }).length;
    return projects + providers;
  }
}
