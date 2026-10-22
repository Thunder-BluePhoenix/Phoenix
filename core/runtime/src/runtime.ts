// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Viewer } from "@phoenix/ai-memory";
import type { AgentDefinition } from "@phoenix/ai-orchestrator";
import type { FetchLike } from "@phoenix/ai-models";
import {
  approverFromPermissions,
  enabledManifests,
  ToolGateway,
  ToolRegistry,
} from "@phoenix/ai-tool-gateway";
import {
  LocalOllamaVision,
  WhisperStdinRecognizer,
  type SpeechRecognizer,
} from "@phoenix/ai-multimodal";
import { ApiServer, generateSessionToken, type CoreServices } from "@phoenix/api";
import { CapabilityManager, type CapabilityModule } from "@phoenix/capability-manager";
import type { PhoenixConfig } from "@phoenix/config";
import { EventBus } from "@phoenix/event-bus";
import { createLogger, type Logger } from "@phoenix/logging";
import { NotificationService } from "@phoenix/notifications";
import { PermissionGateway } from "@phoenix/permissions";
import {
  DeadLetterStore,
  EventStore,
  MeetingStore,
  lockDatabaseFile,
  openDatabase,
  schemaVersion,
  SettingsStore,
  type Database,
  type SecretStore,
} from "@phoenix/persistence";
import { createEvent, ErrorCode, PhoenixError, PROTOCOL_VERSION } from "@phoenix/protocol";
import {
  AgentRuleBook,
  AutonomyController,
  PolicyAdmin,
  PolicyEngine,
  PolicyStore,
} from "@phoenix/policy";
import { StateEngine } from "@phoenix/state-engine";
import {
  AGENT_ADAPTERS,
  type ActiveAgent,
  execFocus,
  focuserFor,
  type AgentsServices,
  type GitExec,
  type HookInstaller,
  type SessionDetail,
  type SessionView,
  type TerminalFocuser,
} from "@phoenix/capability-agents";
import { AgentRuntime } from "./agents";
import { AgentApprovals } from "./agent-approvals";
import { AgentLive, displayName } from "./agent-live";
import { RecapRuntime } from "./recap";
import { AgentUsageRuntime } from "./agent-usage";
import { AgentSafety } from "./agent-safety";
import { PhoneLink, type PhoneLinkTuning } from "./phone-link";
import { createMcpBackends, McpServer, type McpTuning } from "./mcp";
import { HandoffNotes, type CreatedIssue } from "./handoff-notes";
import { SecretGuard } from "./secret-guard";
import { AgentRelay } from "./agent-relay";
import { AiRuntime } from "./ai";
import { AutonomyRuntime } from "./autonomy";
import { collectDiagnostics, type Diagnostics } from "./diagnostics";
import { MemoryRuntime } from "./memory";
import { GraphRuntime } from "./graph";
import { MeetingReviewRuntime } from "./meeting-review";
import { PlanningRuntime } from "./planning";
import { MultimodalRuntime } from "./multimodal";
import { DictationRuntime } from "./dictation";
import { VoiceRuntime, type VoiceRuntimeDeps } from "./voice";
import { NotetakerRuntime, type NotetakerConsentChannel } from "./notetaker";
import { AttachmentRuntime } from "./attachments";
import { syncMeetings } from "./meetings";
import { PrivacyService, type DerivedInventory } from "./privacy";
import { AppearanceRuntime, type KnownSource } from "./appearance";
import { UiSettingsRuntime } from "./ui-settings";
import { ProactiveRuntime } from "./proactive";
import { RetrievalRuntime } from "./retrieval";
import { DailyDigestService } from "./daily-digest/service";
import { CalendarService, StoreMeetingPrepQuery } from "./calendar";
import { assertDeployAllowed } from "./calendar/freeze";
import { ENGINEERING_SIGNALS_ROOTS_KEY, EngineeringSignalsRuntime } from "./engineering-signals";
import {
  terminalHistorySource,
  unavailableAdvisoryProvider,
} from "./engineering-signals/providers";
import { ImprovementRuntime } from "./improvement";
import { LocalRegistryRuntime, type LocalRegistryConfig } from "./registry";
import { SyncRuntime, type SyncTransportFactory } from "./sync";
import { DemoRuntime, type DemoTuning } from "./demo";
import { TeamWebhooks, WEBHOOK_SETTINGS_KEY } from "./team-status/webhooks";
import { ChatApprovalsService, CHAT_APPROVALS_CAPABILITY } from "./chat-approvals/service";
import type { HttpTransport } from "@phoenix/capability-chat-approvals";
import { RemoteRelayService, type RemoteRelayServiceDeps } from "./remote-relay/service";
import { TeamLinkService, type TeamLinkDependencies } from "./team-status/link";
import { StatusLightProvisioning } from "./status-lights/provision";
import { FawkesRebirthService } from "./fawkes-rebirth/service";
import { ScheduledAwakeService, type ScheduledAwakeDependencies } from "./scheduled-awake/service";
import { EventSourcePolicy } from "./event-source-policy";
import { WorkflowsRuntime } from "./workflows";

export interface PetSettings {
  /** "auto" follows the OS reduced-motion setting. */
  reduced_motion: "auto" | "on" | "off";
}

export const PHOENIX_VERSION = "0.1.0-dev";
export const SESSION_TOKEN_FILE = "session.token";

export interface RuntimeOptions {
  config: PhoenixConfig;
  logger?: Logger;
  /** Override the database path (":memory:" in tests). */
  databasePath?: string;
  /** Interval for expiring transient states. */
  tickMs?: number;
  /** Fixed session token (tests). A random one is generated otherwise. */
  token?: string;
  /** Write the session token to <dataDir>/session.token for local clients (default true). */
  writeTokenFile?: boolean;
  /** First-party capabilities to register at startup. */
  capabilities?: readonly CapabilityModule[];
  /** OS secret storage for capability credentials. Without it, secrets cannot be set. */
  secrets?: SecretStore;
  /** Network used by the AI providers. Tests pass a counting fake; production uses global fetch. */
  fetch?: FetchLike;
  /** Outgoing calls of chat approvals; tests pass a recording fake, production uses a guarded fetch. */
  chatTransport?: HttpTransport;
  /** Relay tuning (tests inject a fetcher, a clock and an instant sleep). */
  relay?: Pick<RemoteRelayServiceDeps, "fetcher" | "clock" | "sleep">;
  /** Team link tuning (tests inject a fetcher, a clock, an instant sleep and a hand-driven heartbeat). */
  teamLink?: Pick<TeamLinkDependencies, "fetcher" | "clock" | "sleep" | "heartbeat">;
  /** Scheduler tuning (tests inject a clock and a power source; production reads this machine). */
  scheduledAwake?: Pick<ScheduledAwakeDependencies, "clock" | "power" | "env">;
  /** Ollama base URL (loopback only). Defaults to http://127.0.0.1:11434. */
  ollamaUrl?: string;
  /** Anthropic base URL; tests only. */
  anthropicUrl?: string;
  /** Host-selected local Whisper model file; no capture is started by Core. */
  whisperModelPath?: string;
  /** Host-selected local Ollama vision model; no remote/cloud selection. */
  visionModel?: string;
  /**
   * Who the memory browser, search and ask run as. Defaults to the device owner. Core has one
   * user, so this is the seam for a narrower view (and for the permission-scoping tests).
   */
  memoryViewer?: Viewer;
  /** Further agent kinds (embedding, tests). Automation is still off until the user enables it. */
  agents?: readonly AgentDefinition[];
  /** Local catalogue files selected by the Core host; no configured trust by default. */
  registry?: LocalRegistryConfig;
  /**
   * Hook installer behind the agent-relay routes. Tests inject one over a temp home; by default
   * the real one (the user's home directory) is built on first use, never at construction.
   */
  installer?: HookInstaller;
  /** Runs the terminal-window focus for "jump to terminal" (tests inject a fake; default: this OS). */
  terminalFocuser?: TerminalFocuser;
  /** Runs `git` for on-demand diffs (tests inject a fake). */
  gitExec?: GitExec;
  /** Speech recogniser for dictation (tests inject a fake). Default: whisper.cpp over stdin when a Whisper model is set, else none. */
  dictationRecognizer?: SpeechRecognizer;
  /** Speech recogniser for the voice assistant (tests inject a fake). Default: the dictation one. */
  voiceRecognizer?: SpeechRecognizer;
  /** Voice timing and gate overrides (tests inject timers and a small utterance gate). */
  voice?: Pick<VoiceRuntimeDeps, "timers" | "now" | "utterance" | "limits">;
  /** Speech recogniser for the notetaker (tests inject a fake). Default: the dictation one. */
  notetakerRecognizer?: SpeechRecognizer;
  /** Samples per notetaker transcription window (tests make it small). Default: 30 s. */
  notetakerWindowSamples?: number;
  /**
   * A person-bound consent surface for recording (the desktop shell's dialog; tests inject a fake).
   * Code-only: no HTTP route, setting or event can set it. Absent = recording is refused.
   */
  notetakerConsent?: NotetakerConsentChannel;
  /** Clock for attachment expiry (tests inject one). */
  attachmentClock?: () => number;
  /** Delimiter nonce for attachment questions (tests inject a known one to prove a forged delimiter fails). */
  attachmentNonce?: () => string;
  /** Clock and IANA time zone of the weekly recap (tests inject them). */
  recapClock?: () => number;
  recapTimeZone?: string;
  /** Phone link (Phase 71) tuning: tests inject the clock, the LAN addresses and a free port. */
  phone?: PhoneLinkTuning;
  /** MCP server (Phase 76) tuning: tests inject the clock, rate limits and a free port. */
  mcp?: McpTuning;
  /**
   * Demo mode (Phase 70) tuning (tests inject the idle timer). `false` builds no demo service: the
   * demo's own runtime is built that way, so a demo can never start another demo.
   */
  demo?: DemoTuning | false;
  /** Start the owner-only agent relay socket (default true). The demo runtime never opens one. */
  startAgentRelay?: boolean;
  /** Builds the sync relay transport (tests and the demo inject one; default: HTTPS with global fetch). */
  syncTransport?: SyncTransportFactory;
}

/**
 * Phoenix Core process: owns persistence, the event bus, the state engine and
 * the permission gateway, and serves the HTTP/WebSocket API.
 */
export class PhoenixRuntime implements CoreServices {
  readonly config: PhoenixConfig;
  readonly logger: Logger;
  readonly db: Database;
  readonly events: EventStore;
  readonly settings: SettingsStore;
  readonly deadLetters: DeadLetterStore;
  readonly bus: EventBus;
  readonly state: StateEngine;
  readonly permissions: PermissionGateway;
  readonly capabilities: CapabilityManager;
  readonly notifications: NotificationService;
  readonly meetings: MeetingStore;
  readonly privacy: PrivacyService;
  readonly ai: AiRuntime;
  readonly memory: MemoryRuntime;
  /** Hybrid retrieval (Phase 37). Off until the user turns it on; needs AI on too. */
  readonly retrieval: RetrievalRuntime;
  /** Review of meeting decisions and action items (Phase 35). */
  readonly meetingReview: MeetingReviewRuntime;
  readonly proactive: ProactiveRuntime;
  readonly calendar: CalendarService;
  readonly engineeringSignals: EngineeringSignalsRuntime;
  /** Chat approvals (Phase 86): off by default; absent inside the demo runtime. */
  readonly chatApprovals: ChatApprovalsService | undefined;
  /** Incoming webhooks (Phase 92): off by default; absent without an OS secret store. */
  readonly teamWebhooks: TeamWebhooks | undefined;
  readonly digest: DailyDigestService;
  /** Knowledge graph and provenance (Phase 38). */
  readonly graph: GraphRuntime;
  readonly sync: SyncRuntime;
  readonly registry: LocalRegistryRuntime;
  readonly multimodal: MultimodalRuntime;
  /** Dictation (Phase 64): off by default, audio in memory only, text pipeline, aggregate stats. */
  readonly dictation: DictationRuntime;
  /** « OK Fawkes » voice assistant (Phase 66): off by default, VAD first, audio in memory only, may deny but never approve. */
  readonly voice: VoiceRuntime;
  /** Botless notetaker (Phase 65): off by default, consent every time, audio in memory only. */
  readonly notetaker: NotetakerRuntime;
  /** Files, images, folders and windows given to Fawkes as context (Phase 62): memory only, local-only ask. */
  readonly attachments: AttachmentRuntime;
  /** Governed improvement history; no trusted task reader/baseline/apply configured by default. */
  readonly improvement: ImprovementRuntime;
  /** Fawkes outfit, user packs and per-source pills (Phase 61); session-token routes only. */
  readonly appearance: AppearanceRuntime;
  /** The interface language (Phase 70, `ui.locale`); session-token routes only. */
  readonly uiSettings: UiSettingsRuntime;
  /** Whether the session-token event route refuses the `terminal` source (user's choice, off). */
  readonly eventSourcePolicy: EventSourcePolicy;
  /**
   * The only path from an agent to a capability (Phase 30). Phase 31 hands this, and nothing
   * else, to the agent runtime.
   */
  readonly toolGateway: ToolGateway;
  /**
   * Agent automation (Phase 31): off until the user turns it on. Holds the tool gateway and
   * nothing else that can reach a capability.
   */
  readonly agents: AgentRuntime;
  /**
   * Engineering plans and user-approved task creation (Phase 36). Agent access is limited to
   * the separate opted-in, text-free `plans.review_context` aggregate; no capability reaches
   * preview, approval or creation.
   */
  readonly planning: PlanningRuntime;
  /**
   * Event-driven workflows (Phases 39-40). The engine calls tools only through `toolGateway`, as
   * the workflow system actor; changing or authorising a workflow is reachable only from the
   * session-token routes. Stopped by `stop()`; interrupted runs are reconciled at `start()`.
   */
  readonly workflows: WorkflowsRuntime;
  /** User-configured autonomy ceiling; executable autonomous runs still refuse without an OS sandbox. */
  readonly autonomy: AutonomyController;
  /** Authenticated HTTP view: settings and stop only, never run creation. */
  readonly autonomyApi: AutonomyRuntime;
  /** Coding-agent permission requests and questions (Phase 56); session-token routes only. */
  readonly agentApprovals: AgentApprovals;
  /** The owner-only relay socket for coding-agent hooks and their hook installers (Phase 57). */
  readonly agentRelay: AgentRelay;
  /** Live agent sessions: steps, changed files, diffs, plan usage (Phase 58); session-token routes only. */
  readonly agentLive: AgentLive;
  /** Weekly recap (Phase 69): day counts only, kept past the events cap; local, no AI. */
  readonly recap: RecapRuntime;
  /** Agent cost meter and mission control (Phase 78): reported tokens/cost, budgets, the board. */
  readonly mission: AgentUsageRuntime;
  /** Agent safety net (Phase 77): checkpoints, rollback with approval, loop and stall warnings. */
  readonly agentSafety: AgentSafety;
  /** Phone link (Phase 71): off by default; a separate pinned-TLS LAN listener with device keys. */
  readonly phone: PhoneLink;
  /** Remote access relay (Phase 87): off by default; absent without an OS secret store. */
  readonly remoteRelay: RemoteRelayService | undefined;
  /** Team presence (Phase 92): off by default; absent without an OS secret store or in the demo. */
  readonly teamLink: TeamLinkService | undefined;
  /** Status lights (Phase 88): the lights Core can reach. Contacting one still needs capability consent. */
  readonly statusLights: StatusLightProvisioning;
  /** Scheduled awake windows (Phase 90): off by default; holds Phase 72's one session. */
  readonly scheduledAwake: ScheduledAwakeService;
  /** Fawkes rebirth (Phase 91): turns a fixed build into a cosmetic celebration. Stores two switches. */
  readonly fawkesRebirth: FawkesRebirthService;
  /** The sharing choices and teammate view of {@link teamLink}, as the routes see them. */
  readonly teamStatus: TeamLinkService | undefined;
  /** Phoenix MCP server (Phase 76): off by default; a separate loopback listener with per-client tokens. */
  readonly mcp: McpServer;
  /** Session handoff notes (Phase 79): deterministic notes, optional local summary, attach with preview. */
  readonly handoff: HandoffNotes;
  /** Secret guard results (Phase 79): what the guard hook reports, kinds and locations only. */
  readonly secretGuard: SecretGuard;
  /** Demo mode (Phase 70): a second, isolated in-memory runtime; absent inside the demo itself. */
  readonly demo: DemoRuntime | undefined;
  /**
   * Changes policy. Deliberately private and unused by any route: only code that holds the
   * runtime (never an agent, never a tool result) could reach it, and every method also refuses
   * any actor that is not a trusted user.
   */
  private readonly policyAdmin: PolicyAdmin;
  readonly token: string;
  private pruner: NodeJS.Timeout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private readonly stopMeetingSync: () => void;
  /** Gives up the claim on the data directory (see lockDatabaseFile). */
  private readonly releaseDatabase: () => void;
  private api: ApiServer | null = null;
  private ticker: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private stopping: Promise<void> | null = null;

  constructor(private readonly options: RuntimeOptions) {
    this.config = options.config;
    this.logger = options.logger ?? createLogger({ level: options.config.logLevel });
    const databasePath = options.databasePath ?? join(this.config.dataDir, "phoenix.sqlite");
    this.releaseDatabase = lockDatabaseFile(databasePath);
    try {
      this.db = openDatabase(databasePath);
    } catch (err) {
      this.releaseDatabase();
      throw err;
    }
    this.events = new EventStore(this.db, this.config.eventHistoryLimit);
    this.settings = new SettingsStore(this.db);
    this.deadLetters = new DeadLetterStore(this.db);
    this.bus = new EventBus({
      store: this.events,
      deadLetters: this.deadLetters,
      logger: this.logger,
      dedupWindow: this.config.dedupWindow,
    });
    this.state = new StateEngine();
    this.permissions = new PermissionGateway({
      db: this.db,
      logger: this.logger,
      publish: (event) => {
        const result = this.bus.publish(event);
        if (!result.ok) this.logger.warn("security event rejected", { code: result.error.code });
      },
    });
    this.token = options.token ?? generateSessionToken();
    this.capabilities = new CapabilityManager({
      db: this.db,
      bus: this.bus,
      events: this.events,
      permissions: this.permissions,
      state: this.state,
      logger: this.logger,
      ...(options.secrets ? { secrets: options.secrets } : {}),
      // A calendar deploy freeze (owner opt-in) holds production commands and Vercel redeploys.
      preflight: async ({ capabilityId, command, sideEffect }) => {
        if (sideEffect !== "production" && !(capabilityId === "vercel" && command === "redeploy"))
          return;
        assertDeployAllowed(await this.calendar.freezeSnapshot(), Date.now());
      },
    });
    for (const [id, name, permission] of [
      ["capture-microphone", "Microphone capture", "microphone"],
      ["capture-screen", "Screen capture", "screen_capture"],
    ] as const) {
      this.capabilities.registerBuiltin({
        manifest: {
          id,
          name,
          version: "0.1.0",
          description: `Allow user-selected ${name.toLowerCase()} for local-only AI processing after each-use approval`,
          license: "GPL-3.0-or-later",
          events: [],
          permissions: [permission],
          data_categories: [],
          commands: [],
        },
      });
    }
    for (const module of options.capabilities ?? []) this.capabilities.registerBuiltin(module);
    this.notifications = new NotificationService({
      db: this.db,
      bus: this.bus,
      state: this.state,
      logger: this.logger,
    });

    this.meetings = new MeetingStore(this.db);
    this.stopMeetingSync = syncMeetings({
      bus: this.bus,
      store: this.meetings,
      capabilities: this.capabilities,
      logger: this.logger,
    });

    this.ai = new AiRuntime({
      settings: this.settings,
      permissions: this.permissions,
      logger: this.logger,
      ...(options.secrets ? { secrets: options.secrets } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.ollamaUrl ? { ollamaUrl: options.ollamaUrl } : {}),
      ...(options.anthropicUrl ? { anthropicUrl: options.anthropicUrl } : {}),
    });
    this.multimodal = new MultimodalRuntime(this.permissions, this.capabilities, {
      ...(options.whisperModelPath ? { whisperModelPath: options.whisperModelPath } : {}),
      ...(options.visionModel ? { visionModel: options.visionModel } : {}),
      ...(options.ollamaUrl ? { ollamaUrl: options.ollamaUrl } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.dictation = new DictationRuntime({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      state: this.state,
      permissions: this.permissions,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      recognizer:
        options.dictationRecognizer ??
        (options.whisperModelPath
          ? new WhisperStdinRecognizer({ modelPath: options.whisperModelPath })
          : null),
      logger: this.logger.child("dictation"),
    });
    this.notetaker = new NotetakerRuntime({
      settings: this.settings,
      bus: this.bus,
      state: this.state,
      permissions: this.permissions,
      meetings: this.meetings,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      recognizer:
        options.notetakerRecognizer ??
        options.dictationRecognizer ??
        (options.whisperModelPath
          ? new WhisperStdinRecognizer({ modelPath: options.whisperModelPath })
          : null),
      logger: this.logger.child("notetaker"),
      consent: options.notetakerConsent ?? null,
      ...(options.notetakerWindowSamples ? { windowSamples: options.notetakerWindowSamples } : {}),
    });
    this.attachments = new AttachmentRuntime({
      bus: this.bus,
      permissions: this.permissions,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      vision: options.visionModel
        ? new LocalOllamaVision(options.visionModel, {
            ...(options.ollamaUrl ? { baseUrl: options.ollamaUrl } : {}),
            ...(options.fetch ? { fetch: options.fetch } : {}),
          })
        : null,
      logger: this.logger.child("attachments"),
      ...(options.attachmentClock ? { now: options.attachmentClock } : {}),
      ...(options.attachmentNonce ? { nonce: options.attachmentNonce } : {}),
    });
    this.memory = new MemoryRuntime({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      meetings: this.meetings,
      capabilities: this.capabilities,
      audit: this.permissions.audit,
      ai: this.ai.service,
      logger: this.logger,
      ...(options.memoryViewer ? { viewer: options.memoryViewer } : {}),
    });

    this.retrieval = new RetrievalRuntime({
      db: this.db,
      store: this.memory.store,
      settings: this.settings,
      ai: this.ai.service,
      embeddingProviders: () => this.ai.embeddingProviders(),
      aiEnabled: () => this.ai.aiSettings().enabled,
      killSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      audit: this.permissions.audit,
      logger: this.logger,
    });
    this.meetingReview = new MeetingReviewRuntime({
      db: this.db,
      meetings: this.meetings,
      memory: this.memory,
      retrieval: this.retrieval,
      audit: this.permissions.audit,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      logger: this.logger,
      onItemsChanged: () => this.graph.syncMeetings(),
    });
    this.graph = new GraphRuntime({
      db: this.db,
      bus: this.bus,
      capabilities: this.capabilities,
      store: this.memory.store,
      meetings: this.meetings,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      retrieval: this.retrieval,
      viewer: () => this.memory.agentContext().viewer,
      audit: this.permissions.audit,
      logger: this.logger,
      itemsOf: (meetingId) => this.meetingReview.service.items.list(meetingId),
      meetingsAllowed: () => this.memory.settings().allow_sensitive_meetings,
    });
    this.memory.attach({
      retrieval: this.retrieval,
      hooks: {
        rejectItems: (ids) => this.meetingReview.rejectForgotten(ids),
        meetingsAllowed: () => {
          this.meetingReview.resyncMemory();
          this.graph.syncMeetings();
        },
        meetingsRevoked: () => this.graph.removeMeetingData(),
      },
    });
    this.engineeringSignals = new EngineeringSignalsRuntime({
      settings: this.settings,
      notifications: this.notifications,
      bus: this.bus,
      userId: () => this.memory.agentContext().viewer.id,
      killSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      // No capability manifest backs this source: the explicit Phase 52 opt-in is the gate.
      capabilityEnabled: () => true,
      advisories: unavailableAdvisoryProvider(),
      history: terminalHistorySource(this.events),
    });
    this.proactive = new ProactiveRuntime({
      meetings: this.meetings,
      review: this.meetingReview,
      memory: this.memory,
      capabilities: this.capabilities,
      notifications: this.notifications,
      bus: this.bus,
      killSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      onPreferencesChanged: () => this.engineeringSignals.consentChanged(),
    });
    this.calendar = new CalendarService({
      capabilities: this.capabilities,
      prep: new StoreMeetingPrepQuery(
        this.meetings,
        this.meetingReview.service.items,
        () => this.memory.settings().allow_sensitive_meetings,
      ),
    });
    // Per-source secrets must live in the OS credential store; without one nothing can be signed.
    this.teamWebhooks = options.secrets
      ? new TeamWebhooks({
          settings: this.settings,
          secrets: options.secrets,
          bus: this.bus,
          audit: this.permissions.audit,
          clock: { now: Date.now },
        })
      : undefined;
    this.digest = new DailyDigestService({
      now: Date.now,
      repositories: () => {
        try {
          const config = this.capabilities.get("git").config.repositories;
          return Array.isArray(config)
            ? config.filter((path): path is string => typeof path === "string" && isAbsolute(path))
            : [];
        } catch {
          return [];
        }
      },
      events: () => this.events.recent({ limit: 1_000 }).map((row) => row.event),
      sessions: () => this.agentLive.sessions(),
      meetingsAllowed: () => this.memory.settings().allow_sensitive_meetings,
      meetings: () => this.meetings.list({ limit: 500 }),
    });

    const policyStore = new PolicyStore(this.db);
    this.autonomy = new AutonomyController(policyStore, this.permissions.audit, () =>
      this.permissions.isKillSwitchEngaged(),
    );
    this.autonomyApi = new AutonomyRuntime(this.autonomy);
    const registry = new ToolRegistry({ manifests: enabledManifests(this.capabilities, this.db) });
    const policy = new PolicyEngine({
      store: policyStore,
      audit: this.permissions.audit,
      isKillSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      isKnownTool: (tool) => registry.has(tool),
      autonomy: this.autonomy,
    });
    this.policyAdmin = new PolicyAdmin({ store: policyStore, audit: this.permissions.audit });
    this.agentApprovals = new AgentApprovals({
      db: this.db,
      bus: this.bus,
      audit: this.permissions.audit,
      policy,
      rules: new AgentRuleBook({ db: this.db, audit: this.permissions.audit }),
      isKillSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      logger: this.logger.child("agent-approvals"),
    });
    // Chat approvals (Phase 86): the capability is registered but OFF; nothing is posted or
    // answered until the user enables it and switches a provider and a project on. The demo
    // runtime never gets it (it opens no sockets).
    this.chatApprovals =
      options.demo === false
        ? undefined
        : new ChatApprovalsService({
            permissions: this.permissions,
            agentApprovals: this.agentApprovals,
            audit: this.permissions.audit,
            bus: this.bus,
            config: () => this.capabilities.get(CHAT_APPROVALS_CAPABILITY).config,
            enabled: () => this.capabilities.get(CHAT_APPROVALS_CAPABILITY).status === "enabled",
            killSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
            ...(options.chatTransport ? { transport: options.chatTransport } : {}),
          });
    if (this.chatApprovals) this.capabilities.registerBuiltin(this.chatApprovals.module);
    this.agentRelay = new AgentRelay({
      dataDir: this.config.dataDir,
      bus: this.bus,
      audit: this.permissions.audit,
      logger: this.logger.child("agent-relay"),
      version: PHOENIX_VERSION,
      approvals: this.agentApprovals,
      invokeReport: (input) => this.capabilities.invoke("agents", "report", input, "relay"),
      ...(options.installer ? { installer: options.installer } : {}),
      live: () => this.agentLive,
    });
    let focuser = options.terminalFocuser;
    if (!focuser) {
      try {
        focuser = focuserFor(process.platform, execFocus);
      } catch {
        focuser = undefined; // an unsupported system: the route says so when asked
      }
    }
    this.recap = new RecapRuntime({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      audit: this.permissions.audit,
      meetingsAllowed: () => this.memory.settings().allow_sensitive_meetings,
      logger: this.logger.child("recap"),
      ...(options.recapClock ? { now: options.recapClock } : {}),
      ...(options.recapTimeZone ? { timeZone: options.recapTimeZone } : {}),
    });
    this.phone = new PhoneLink({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      permissions: this.permissions,
      agentApprovals: this.agentApprovals,
      dataDir: this.config.dataDir,
      logger: this.logger.child("phone-link"),
      unavailable: options.demo === false,
      ...options.phone,
    });
    // Remote relay (Phase 87): off by default. It needs the OS credential store for Core's relay
    // key, and never exists inside the demo runtime (it opens no sockets).
    this.remoteRelay =
      options.secrets && options.demo !== false
        ? new RemoteRelayService({
            settings: this.settings,
            secrets: options.secrets,
            devices: this.phone.devicesStore,
            phone: this.phone,
            audit: this.permissions.audit,
            killSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
            ...(options.relay ?? {}),
          })
        : undefined;
    this.teamLink =
      options.secrets && options.demo !== false
        ? new TeamLinkService({
            settings: this.settings,
            secrets: options.secrets,
            audit: this.permissions.audit,
            bus: this.bus,
            killSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
            ...(options.teamLink ?? {}),
          })
        : undefined;
    this.teamStatus = this.teamLink;
    this.statusLights = new StatusLightProvisioning(this.settings, this.permissions.audit);
    this.scheduledAwake = new ScheduledAwakeService({
      settings: this.settings,
      permissions: this.permissions,
      audit: this.permissions.audit,
      ...(options.scheduledAwake ?? {}),
    });
    this.fawkesRebirth = new FawkesRebirthService({
      bus: this.bus,
      settings: this.settings,
      audit: this.permissions.audit,
    });
    this.bus.subscribe("scheduled-awake", "security.kill_switch.engaged", () => {
      void this.scheduledAwake.stopForKillSwitch();
    });
    this.bus.subscribe("remote-relay", "security.kill_switch.engaged", () => {
      void this.remoteRelay?.disable("kill_switch");
    });
    this.mission = new AgentUsageRuntime({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      audit: this.permissions.audit,
      events: this.events,
      agents: {
        reports: async () => {
          const op = await this.capabilities.invokeAndWait("agents", "list", {}, "mission");
          if (op.status !== "succeeded") throw new Error("agents capability unavailable");
          return (op.result as { agents?: ActiveAgent[] } | undefined)?.agents ?? [];
        },
        orchestrated: async () => {
          const op = await this.capabilities.invokeAndWait("agents", "session.list", {}, "mission");
          if (op.status !== "succeeded") throw new Error("agents capability unavailable");
          return (op.result as { sessions?: SessionView[] } | undefined)?.sessions ?? [];
        },
      },
      liveSessions: () => this.agentLive.sessions(),
      aiPrices: () => this.ai.aiSettings().prices ?? {},
      isKillSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      logger: this.logger.child("agent-usage"),
      ...(options.recapClock ? { now: options.recapClock } : {}),
      ...(options.recapTimeZone ? { timeZone: options.recapTimeZone } : {}),
    });
    this.agentLive = new AgentLive({
      recap: this.recap,
      tokens: this.mission,
      bus: this.bus,
      permissions: this.permissions,
      settings: this.settings,
      logger: this.logger.child("agent-live"),
      orchestrated: {
        list: async () => {
          const op = await this.capabilities.invokeAndWait(
            "agents",
            "session.list",
            {},
            "agent-live",
          );
          return op.status === "succeeded"
            ? ((op.result as { sessions?: SessionView[] } | undefined)?.sessions ?? [])
            : [];
        },
        get: async (id) => {
          const op = await this.capabilities.invokeAndWait(
            "agents",
            "session.get",
            { session_id: id },
            "agent-live",
          );
          if (op.status !== "succeeded") {
            throw new PhoenixError(ErrorCode.RESOURCE_NOT_FOUND, "Session not found");
          }
          return op.result as SessionDetail;
        },
      },
      ...(focuser ? { focuser } : {}),
      ...(options.gitExec ? { git: options.gitExec } : {}),
    });
    this.agentSafety = new AgentSafety({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      permissions: this.permissions,
      notifications: this.notifications,
      state: this.state,
      logger: this.logger.child("agent-safety"),
    });
    this.toolGateway = new ToolGateway({
      host: this.capabilities,
      registry,
      policy,
      audit: this.permissions.audit,
      approver: approverFromPermissions(this.permissions),
      logger: this.logger,
    });
    this.mcp = new McpServer({
      db: this.db,
      settings: this.settings,
      bus: this.bus,
      permissions: this.permissions,
      approvals: this.agentApprovals,
      state: this.state,
      backends: createMcpBackends({
        agentLive: this.agentLive,
        store: this.memory.store,
        graph: this.graph.graph,
        gateway: this.toolGateway,
        meetingsAllowed: () => this.memory.settings().allow_sensitive_meetings,
        now: () => new Date(),
      }),
      logger: this.logger.child("mcp"),
      version: PHOENIX_VERSION,
      unavailable: options.demo === false,
      ...options.mcp,
    });
    this.secretGuard = new SecretGuard({
      db: this.db,
      bus: this.bus,
      audit: this.permissions.audit,
      logger: this.logger.child("secret-guard"),
    });
    this.handoff = new HandoffNotes({
      dataDir: this.config.dataDir,
      settings: this.settings,
      bus: this.bus,
      audit: this.permissions.audit,
      logger: this.logger.child("handoff"),
      live: this.agentLive,
      approvals: this.agentApprovals,
      ai: this.ai.service,
      createIssue: async (input) => {
        // The github capability asks for its own confirmation (side effect `external`).
        const op = await this.capabilities.invokeAndWait(
          "github",
          "issue.create",
          input,
          "handoff",
        );
        if (op.status !== "succeeded") {
          throw new PhoenixError(
            ErrorCode.CAPABILITY_UNAVAILABLE,
            op.error?.message ?? "GitHub did not create the issue",
          );
        }
        return op.result as CreatedIssue;
      },
      isKillSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
    });
    this.voice = new VoiceRuntime({
      settings: this.settings,
      bus: this.bus,
      state: this.state,
      permissions: this.permissions,
      gateway: this.toolGateway,
      recognizer:
        options.voiceRecognizer ??
        options.dictationRecognizer ??
        (options.whisperModelPath
          ? new WhisperStdinRecognizer({ modelPath: options.whisperModelPath })
          : null),
      logger: this.logger.child("voice"),
      ...options.voice,
    });

    this.agents = new AgentRuntime({
      db: this.db,
      settings: this.settings,
      gateway: this.toolGateway,
      permissions: this.permissions,
      bus: this.bus,
      memory: this.memory,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      ...(options.agents ? { extraAgents: options.agents } : {}),
      logger: this.logger,
    });

    this.planning = new PlanningRuntime({
      db: this.db,
      items: this.meetingReview.service,
      meetings: this.meetings,
      gateway: this.toolGateway,
      capabilities: this.capabilities,
      audit: this.permissions.audit,
      ai: this.ai.service,
      aiEnabled: () => this.ai.aiSettings().enabled,
      actor: () => {
        const { viewer } = this.memory.agentContext();
        return { id: viewer.id, viewer };
      },
      logger: this.logger,
    });

    this.workflows = new WorkflowsRuntime({
      db: this.db,
      bus: this.bus,
      gateway: this.toolGateway,
      permissions: this.permissions,
      ai: this.ai.service,
      context: this.memory.agentContext().engine,
      autonomy: this.autonomy,
      logger: this.logger,
    });
    this.improvement = new ImprovementRuntime({ db: this.db });
    this.appearance = new AppearanceRuntime({
      settings: this.settings,
      bus: this.bus,
      known: () => this.knownSources(),
    });
    this.uiSettings = new UiSettingsRuntime(this.settings, this.bus);
    this.eventSourcePolicy = new EventSourcePolicy(this.settings, this.permissions.audit);
    this.sync = new SyncRuntime(this.settings, options.secrets, options.syncTransport);
    this.demo =
      options.demo === false
        ? undefined
        : new DemoRuntime({
            ...options.demo,
            config: this.config,
            logger: this.logger.child("demo"),
            killSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
            bus: this.bus,
            createRuntime: (demoOptions) => new PhoenixRuntime(demoOptions),
          });
    this.registry = new LocalRegistryRuntime(options.registry, {
      sdk: "0.1.0",
      core: "0.1.0",
      protocol: "1",
    });

    this.privacy = new PrivacyService({
      dataDir: this.config.dataDir,
      settings: this.settings,
      events: this.events,
      notifications: this.notifications,
      meetings: this.meetings,
      capabilities: this.capabilities,
      audit: this.permissions.audit,
      memory: this.memory,
      workflowHistory: this.workflows,
      recap: this.recap,
      phone: this.phone,
      mcp: this.mcp,
      agentUsage: this.mission,
      agentCheckpoints: this.agentSafety,
      handoff: this.handoff,
      derived: () => this.derivedInventory(),
      externalAi: () => this.ai.describeExternalProcessing(),
    });

    this.bus.subscribe("state-engine", "*", (event) => {
      this.state.handle(event);
    });
    this.state.onChange((snapshot) => {
      this.bus.publish(
        createEvent({
          event_type: "pet.state.changed",
          source: "core",
          severity: "info",
          payload: {
            state: snapshot.state,
            explanation: snapshot.explanation,
            recording: snapshot.recording,
            since: snapshot.since,
          },
        }),
        { ephemeral: true },
      );
    });
    this.state.setSleeping(this.settings.get("pet.sleeping", false));
    if (this.permissions.isKillSwitchEngaged()) {
      // Re-raise the warning so an engaged emergency stop is visible after restart.
      this.state.handle(
        createEvent({
          event_type: "security.kill_switch.engaged",
          source: "core",
          severity: "warning",
        }),
      );
    }
  }

  /**
   * What the agents capability needs from Core to orchestrate coding-agent sessions. The context
   * read goes through the tool gateway as an untrusted agent actor named after the session, so it is
   * policy-checked and audited like every other agent read.
   */
  agentsServices(): AgentsServices {
    return {
      db: this.db,
      events: this.bus,
      audit: (record) => void this.permissions.audit.record(record),
      isKillSwitchEngaged: () => this.permissions.isKillSwitchEngaged(),
      context: {
        assembler: this.memory.agentContext().engine,
        fetch: async (request) =>
          (
            await this.toolGateway.call({
              actor: { kind: "agent", id: `session:${request.session_id}`, trustedByUser: false },
              tool: "agents.context.fetch",
              input: request,
              environment: "local",
              dataClass: "internal",
            })
          ).output,
      },
    };
  }

  async start(): Promise<{ host: string; port: number }> {
    this.api = new ApiServer({
      services: this,
      token: this.token,
      ...(this.config.webRoot ? { webRoot: this.config.webRoot } : {}),
    });
    const address = await this.api.listen(this.config.port, this.config.host);
    if (this.options.startAgentRelay ?? true) await this.agentRelay.start();
    await this.phone.start();
    await this.remoteRelay?.start();
    await this.teamLink?.start();
    await this.scheduledAwake.start();
    await this.mcp.start();
    if (this.options.writeTokenFile ?? true) this.writeTokenFile();

    this.ticker = setInterval(() => {
      this.state.tick();
      this.agentSafety.tick();
      this.attachments.purgeExpired();
    }, this.options.tickMs ?? 1_000);
    this.ticker.unref();
    this.privacy.prune();
    this.recap.maintain();
    void this.agentSafety.maintain();
    // Not awaited: reading a large docs folder must not delay the API coming up.
    void this.memory.maintain().then(() => {
      this.graph.ingestMemory();
      this.graph.syncMeetings();
      this.meetingReview.importAll();
    });
    this.pruner = setInterval(() => {
      this.privacy.prune();
      this.recap.maintain();
      void this.agentSafety.maintain();
      void this.memory.maintain().then(() => this.graph.ingestMemory());
    }, 3_600_000);
    this.pruner.unref();
    this.syncTimer = setInterval(() => {
      if (this.sync.status().enabled)
        void this.sync.sync().catch((error: unknown) =>
          this.logger.warn("Encrypted sync unavailable; queue retained", {
            error: String(error),
          }),
        );
    }, 60_000);
    this.syncTimer.unref();
    await this.capabilities.restore();
    this.proactive.startScheduler();
    await this.engineeringSignals.startScheduler();
    // After the capabilities are back, so the tool catalog is complete when triggers arrive.
    this.workflows.start();

    this.bus.publish(
      createEvent({
        event_type: "system.online",
        source: "core",
        severity: "info",
        payload: { version: PHOENIX_VERSION },
      }),
    );
    this.logger.info("Phoenix Core started", {
      url: `http://${address.address}:${address.port}`,
      env: this.config.env,
      dataDir: this.config.dataDir,
    });
    return { host: address.address, port: address.port };
  }

  private reviewItemCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM meeting_items").get() as { n: number };
    return row.n;
  }

  private tableCount(table: "plans" | "workflow_runs"): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
    return row.n;
  }

  /** Counts of what Phoenix derived from the data classes above (vectors, graph, review items, plans, workflow runs). */
  private derivedCounts() {
    const retrieval = this.retrieval.status();
    const graph = this.graph.graph.stats();
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
  private derivedInventory(): DerivedInventory[] {
    const retrieval = this.retrieval.status();
    const graph = this.graph.visibleInventory();
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
        count: this.sync.inspect().items.filter((item) => !item.deleted).length,
        deleted_with:
          "Delete each synced item from Sync and run sync; deleting local data alone does not remove remote ciphertext",
        enabled: this.sync.status().enabled,
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
        count: this.recap.store.count(),
        deleted_with: 'recap (POST /api/privacy/delete {"data":"recap"} or DELETE /api/recap)',
      },
      {
        id: "phone_devices",
        description:
          'Phones paired with the phone link: a name, the phone\'s PUBLIC key and when it last connected. No pairing code and no private key is ever stored. Revoke one in Settings; "Delete all" for phone data also closes the listener and removes the certificate.',
        count: this.phone.devicesStore.count(),
        deleted_with: 'phone (POST /api/privacy/delete {"data":"phone"}) or revoke a device',
      },
      {
        id: "mcp_clients",
        description:
          'Clients allowed to use the Phoenix MCP server: a name, what you granted and when it last called. Only a SHA-256 of each client token is stored, never the token. Revoke one in Settings; "Delete all" for MCP data also closes the listener.',
        count: this.mcp.clientStore.count(),
        deleted_with: 'mcp (POST /api/privacy/delete {"data":"mcp"}) or revoke a client',
      },
      {
        id: "agent_checkpoints",
        description:
          "Metadata of the snapshots taken before a coding agent's first edit: the agent, the session id, the project folder and when it expires. The snapshot itself is a commit under refs/phoenix/checkpoints/ in the project's own git repository (it holds the file contents the project had, including untracked files but not ignored ones). \"Delete all\" for agent checkpoints removes the records and those refs; the unreferenced objects are removed by git's own garbage collection.",
        count: this.agentSafety.store.count(),
        deleted_with:
          'agent_checkpoints (POST /api/privacy/delete {"data":"agent_checkpoints"}) or the retention setting',
      },
      {
        id: "agent_usage",
        description:
          'Token and cost numbers coding agents reported about their own sessions, per day, session, agent and model, with the project folder name. No prompts, outputs, commands or file names. A cost is stored only when the agent reported one or you entered a price for the model. Deleted only with "Delete all" for agent usage.',
        count: this.mission.store.count(),
        deleted_with:
          'agent_usage (POST /api/privacy/delete {"data":"agent_usage"} or DELETE /api/mission/usage)',
      },
      {
        id: "handoff_notes",
        description:
          "Handoff notes written from what a coding agent reported about a session: the project folder name, changed file names with line counts, redacted commands and open questions, plus an optional model summary. Owner-only files under the Phoenix data folder, newest 50 kept. Nothing is sent anywhere unless you attach a note to a GitHub issue or copy it.",
        count: this.handoff.store.count(),
        deleted_with: 'handoff (POST /api/privacy/delete {"data":"handoff"}) or delete the note',
      },
      {
        id: "engineering_signals_roots",
        description:
          "Absolute folder paths you chose for engineering signals (Phase 82). Only the paths are stored, in settings; findings are computed on demand and never saved. Nothing is scanned or notified unless you also opt in to engineering notifications.",
        count: this.settings.get<string[]>(ENGINEERING_SIGNALS_ROOTS_KEY, []).length,
        deleted_with:
          'remove the folders (PUT /api/engineering-signals/watched-roots {"watchedRoots":[]})',
      },
      {
        id: "team_webhook_sources",
        description:
          "Incoming webhook sources you created (Phase 92): each source's id, the event types it may send and its enabled state, in settings. Each source's signing secret is kept only in the OS credential store. Deliveries become local events; nothing is sent anywhere. Off by default.",
        count: Object.keys(
          this.settings.get<{ sources?: Record<string, unknown> }>(WEBHOOK_SETTINGS_KEY, {})
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
        count: this.remoteRelay?.status().enabled ? 1 : 0,
        deleted_with:
          "turn the relay off (DELETE /api/remote-relay), which discards the route and key",
      },
      {
        id: "status_lights_devices",
        description:
          "Status lights (Phase 88): the LAN address and port of each Key Light you added, in settings. Consent to use a light is a separate setting of the status-lights capability. Nothing is contacted until both exist and the capability is enabled; only fixed colours are ever sent.",
        count: this.statusLights.lights().length,
        deleted_with: "replace the list with an empty one (PUT /api/status-lights/devices)",
      },
      {
        id: "scheduled_awake",
        description:
          "Scheduled keep-awake (Phase 90): the windows you saved (a name, days or a date, start and end times, a time zone, and your battery and charger rules) and the windows you skipped, in settings. Off until you turn it on, and turning it on and saving a window each ask you first. Battery level and Low Power Mode are read on this computer and never stored.",
        count: this.scheduledAwake.scheduleCount(),
        deleted_with:
          "delete a schedule (DELETE /api/scheduled-awake/schedules/:id); turning scheduling off keeps them but holds nothing",
      },
      {
        id: "team_status",
        description:
          "Team presence (Phase 92): your team relay address and route id, your team id and public key, and the teammates you added (id, the label you chose, their public key), in settings; your sharing choices; and the last state each teammate sent, held in memory only. Your team private key is only in the OS credential store. Off by default; sharing is a second, separate opt-in per item.",
        count: this.teamLink?.memberCount() ?? 0,
        deleted_with:
          "remove a teammate (DELETE /api/team/members/:id), or leave the team (DELETE /api/team/link), which forgets the identity, route and roster",
      },
    ];
  }

  /** How many chat approval settings are set (projects plus each provider that is switched on). */
  private chatApprovalsConfigured(): number {
    if (!this.chatApprovals) return 0;
    const config = this.capabilities.get(CHAT_APPROVALS_CAPABILITY).config;
    const projects = Array.isArray(config.projects) ? config.projects.length : 0;
    const providers = ["slack", "discord", "teams"].filter((p) => {
      const value = config[p];
      return (
        value !== null && typeof value === "object" && "enabled" in value && value.enabled === true
      );
    }).length;
    return projects + providers;
  }

  /** Capabilities, and the coding agents Phoenix can see, that may get a Fawkes pill. */
  private knownSources(): KnownSource[] {
    const out: KnownSource[] = this.capabilities
      .list()
      .map((c) => ({ id: `capability:${c.id}`, label: c.name, kind: "capability" as const }));
    const agents: Record<string, string> = {};
    for (const a of AGENT_ADAPTERS) agents[a.id] = a.label;
    for (const s of this.agentLive.sessions()) agents[s.agent] ??= s.agent;
    for (const [slug, label] of Object.entries(agents)) {
      out.push({ id: `agent:${slug}`, label: displayName(label), kind: "agent" });
    }
    return out;
  }

  /** Fawkes appearance, shared by every Fawkes view (web, desktop). */
  petSettings(): PetSettings {
    return {
      reduced_motion: "auto",
      ...this.settings.get<Partial<PetSettings>>("pet.settings", {}),
    };
  }

  setPetSettings(input: unknown): PetSettings {
    const motion = (input as { reduced_motion?: unknown } | null)?.reduced_motion;
    if (motion !== "auto" && motion !== "on" && motion !== "off") {
      throw new PhoenixError(
        ErrorCode.INVALID_REQUEST,
        '"reduced_motion" must be "auto", "on" or "off"',
      );
    }
    const next: PetSettings = { ...this.petSettings(), reduced_motion: motion };
    this.settings.set("pet.settings", next);
    return next;
  }

  setSleeping(sleeping: boolean): void {
    this.settings.set("pet.sleeping", sleeping);
    this.state.setSleeping(sleeping);
  }

  viewersChanged(count: number): void {
    this.capabilities.presence.setClients(count);
  }

  health() {
    const snapshot = this.state.snapshot();
    return {
      status: "ok" as const,
      version: PHOENIX_VERSION,
      protocol: PROTOCOL_VERSION,
      env: this.config.env,
      uptime_ms: Date.now() - this.startedAt,
      schema_version: schemaVersion(this.db),
      pet: { state: snapshot.state, recording: snapshot.recording },
      kill_switch: this.permissions.isKillSwitchEngaged(),
      active_tasks: this.state.tasks().length,
      capabilities: this.capabilities
        .list()
        .map((c) => ({ id: c.id, status: c.status, health: c.health.status })),
      bus: this.bus.metrics(),
      websocket: this.api?.hub.metrics() ?? null,
    };
  }

  /** A report safe to attach to a bug report: how Phoenix behaves, not what you were doing. */
  diagnostics(): Diagnostics {
    return collectDiagnostics({
      health: this.health(),
      capabilities: this.capabilities,
      events: this.events,
      deadLetters: this.deadLetters,
      audit: this.permissions.audit,
      counts: {
        events: this.events.count(),
        notifications: this.notifications.count(),
        meetings: this.meetings.count(),
        audit_entries: this.permissions.audit.count(),
      },
      derived: this.derivedCounts(),
    });
  }

  /** Graceful shutdown: stop accepting requests, flush the bus, close the database. Idempotent. */
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      await this.demo?.stop();
      this.proactive.stopScheduler();
      this.engineeringSignals.stopScheduler();
      this.dictation.close();
      this.voice.close();
      this.recap.close();
      this.mission.close();
      this.agentSafety.close();
      this.handoff.close();
      this.notetaker.close();
      this.attachments.close();
      this.agentApprovals.close();
      this.chatApprovals?.close();
      clearInterval(this.syncTimer ?? undefined);
      if (this.ticker) clearInterval(this.ticker);
      if (this.pruner) clearInterval(this.pruner);
      await this.agentRelay.stop();
      await this.phone.close();
      this.fawkesRebirth.close();
      await this.scheduledAwake.close();
      await this.teamLink?.close();
      await this.remoteRelay?.close();
      await this.mcp.close();
      await this.api?.close();
      await this.agents.close();
      await this.workflows.close();
      await this.graph.close();
      this.meetingReview.close();
      await this.retrieval.close();
      await this.capabilities.close();
      this.stopMeetingSync();
      await this.memory.close();
      this.notifications.close();
      this.permissions.close();
      await this.bus.drain();
      this.bus.close();
      if (this.options.writeTokenFile ?? true) {
        rmSync(join(this.config.dataDir, SESSION_TOKEN_FILE), { force: true });
      }
      this.db.close();
      this.releaseDatabase();
      this.logger.info("Phoenix Core stopped");
    })();
    return this.stopping;
  }

  private writeTokenFile(): void {
    mkdirSync(this.config.dataDir, { recursive: true });
    const path = join(this.config.dataDir, SESSION_TOKEN_FILE);
    writeFileSync(path, this.token + "\n", { mode: 0o600 });
    chmodSync(path, 0o600);
  }
}
