// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";
import type {
  AgentApproval,
  AgentApprovalRule,
  AgentInstallList,
  AgentSettings,
  AgentTaskDetail,
  AgentTaskSummary,
  AiStatus,
  CapabilityView,
  Confirmation,
  GraphInspection,
  GraphNeighborhood,
  GraphStatus,
  LiveFileOf,
  LiveSessionDetail,
  LiveSessionList,
  LiveSessionView,
  LiveStepOf,
  Meeting,
  MeetingItemList,
  MemoryItem,
  MemoryList,
  MemorySearchHit,
  MemorySettings,
  Notification,
  PlanDetail,
  PlanLink,
  PlanPreview,
  PlanSummary,
  PlanningStatus,
  RetrievalSettings,
  RetrievalStatus,
  StoredEvent,
  Summary,
  Transcript,
  UsageSummary,
  Workflow,
  WorkflowDetail,
  WorkflowMetrics,
  WorkflowRun,
  WorkflowRunSummary,
} from "./types";

/** Loads a resource and reloads it whenever `shouldReload` matches a live event. */
function useLiveResource<T>(
  path: string,
  pick: (json: any) => T,
  initial: T,
  shouldReload: (type: string, source: string) => boolean,
) {
  const client = useClient();
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const reloadRef = useRef(shouldReload);
  reloadRef.current = shouldReload;

  const reload = useCallback(async () => {
    try {
      setData(pickRef.current(await client.request("GET", path)));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
    }
  }, [client, path]);

  useEffect(() => {
    void reload();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (reloadRef.current(event.event_type, event.source)) void reload();
    });
    const offCap = client.capabilityChanged.on((event) => {
      if (reloadRef.current(event.event_type, event.source)) void reload();
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      offEvent();
      offCap();
      offStatus();
    };
  }, [client, reload]);

  return { data, error, reload };
}

export function useConfirmations() {
  return useLiveResource<Confirmation[]>(
    "/api/confirmations",
    (j) => j.confirmations,
    [],
    (t) => t.startsWith("security.confirmation."),
  );
}

export function useCapabilities() {
  return useLiveResource<CapabilityView[]>(
    "/api/capabilities",
    (j) => j.capabilities,
    [],
    (t) => t.startsWith("capability.") && !t.startsWith("capability.command."),
  );
}

export function useKillSwitch() {
  return useLiveResource<boolean>(
    "/api/security/kill-switch",
    (j) => j.engaged,
    false,
    (t) => t.startsWith("security.kill_switch."),
  );
}

const ACTIVITY_LIMIT = 100;

/** Recent durable events, newest first, kept live. */
export function useActivity() {
  const client = useClient();
  const [items, setItems] = useState<StoredEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const merge = (incoming: StoredEvent[]) =>
      setItems((current) => {
        const bySeq = new Map(current.map((i) => [i.seq, i]));
        for (const i of incoming) bySeq.set(i.seq, i);
        return [...bySeq.values()].sort((a, b) => b.seq - a.seq).slice(0, ACTIVITY_LIMIT);
      });
    const load = () =>
      client
        .request<{ events: StoredEvent[] }>("GET", `/api/events?limit=${ACTIVITY_LIMIT}`)
        .then((r) => !cancelled && (merge(r.events), setError(null)))
        .catch(() => !cancelled && setError("Could not load activity"));
    void load();
    const off = client.eventCreated.on((e) => typeof e.seq === "number" && merge([e]));
    return () => {
      cancelled = true;
      off();
    };
  }, [client]);

  return { items, error };
}

export function useNotifications() {
  const client = useClient();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);

  const reload = useCallback(async () => {
    try {
      const r = await client.request<{ notifications: Notification[]; unread: number }>(
        "GET",
        "/api/notifications?limit=30",
      );
      setItems(r.notifications);
      setUnread(r.unread);
    } catch {
      /* offline: keep what we have */
    }
  }, [client]);

  useEffect(() => {
    void reload();
    const off = client.notificationCreated.on((n) => {
      setItems((cur) => (cur.some((c) => c.id === n.id) ? cur : [n, ...cur].slice(0, 30)));
      setUnread((u) => u + 1);
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      off();
      offStatus();
    };
  }, [client, reload]);

  const markRead = useCallback(
    async (id: string) => {
      await client.request("POST", `/api/notifications/${id}/read`, {});
      setItems((cur) => cur.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
    },
    [client],
  );

  const markAllRead = useCallback(async () => {
    await client.request("POST", "/api/notifications/read-all", {});
    setItems((cur) => cur.map((n) => ({ ...n, read: true })));
    setUnread(0);
  }, [client]);

  return { items, unread, markRead, markAllRead };
}

/**
 * Runs an API action and tracks busy/error state for a button. One call at a time: a second call
 * while the first is in flight (a double click) sends nothing and returns undefined.
 */
export function useAction() {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<readonly string[]>([]);
  const inFlight = useRef(false);
  const run = useCallback(
    async <T = unknown>(method: string, path: string, body: unknown = {}) => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      setDetails([]);
      try {
        return await client.request<T>(method, path, method === "GET" ? undefined : body);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Request failed");
        setDetails(err instanceof ApiError ? err.details : []);
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [client],
  );
  return { run, busy, error, details };
}

const isMeetingEvent = (t: string) => t.startsWith("kage.");

export function useMeetings(archived = false) {
  return useLiveResource<Meeting[]>(
    `/api/meetings${archived ? "?archived=true" : ""}`,
    (j) => j.meetings,
    [],
    isMeetingEvent,
  );
}

/** One meeting's decisions and action items (Phase 35), reloaded when Kage's data changes. */
export function useMeetingItems(meetingId: string) {
  return useLiveResource<MeetingItemList | null>(
    `/api/meetings/${encodeURIComponent(meetingId)}/items`,
    (j) => j,
    null,
    isMeetingEvent,
  );
}

export function useRetrievalSettings() {
  return useLiveResource<RetrievalSettings | null>(
    "/api/retrieval/settings",
    (j) => j,
    null,
    () => false,
  );
}

export function useRetrievalStatus() {
  return useLiveResource<RetrievalStatus | null>(
    "/api/retrieval/status",
    (j) => j,
    null,
    () => false,
  );
}

export function useGraphStatus() {
  return useLiveResource<GraphStatus | null>(
    "/api/graph/status",
    (j) => j,
    null,
    () => false,
  );
}

/** Where one graph entity came from. `null` data with an error means unknown or not readable. */
export function useGraphNode(nodeId: string) {
  return useLiveResource<GraphInspection | null>(
    `/api/graph/nodes/${encodeURIComponent(nodeId)}`,
    (j) => j,
    null,
    () => false,
  );
}

/** What is connected to an entity, one or two hops out. */
export function useGraphNeighbors(nodeId: string, depth: 1 | 2) {
  return useLiveResource<GraphNeighborhood | null>(
    `/api/graph/nodes/${encodeURIComponent(nodeId)}/neighbors?depth=${depth}`,
    (j) => j,
    null,
    () => false,
  );
}

interface CommandOperation<T> {
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  result?: T;
  error?: { message: string };
}

const COMMAND_CHECKS = 40;
const COMMAND_CHECK_MS = 150;

/**
 * Runs a capability's read command and keeps its result fresh: again whenever an event whose type
 * matches `refreshOn` arrives. `enabled` is false while the capability is off, so nothing is called.
 */
export function useCommandResult<T>(
  capabilityId: string,
  command: string,
  enabled: boolean,
  refreshOn: (eventType: string) => boolean,
  input: unknown = {},
) {
  const client = useClient();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef(refreshOn);
  refreshRef.current = refreshOn;
  // The caller passes a fresh object each render; only a change of content restarts the load.
  const inputKey = JSON.stringify(input);

  const reload = useCallback(async () => {
    try {
      const started = await client.request<{ id: string }>(
        "POST",
        `/api/capabilities/${encodeURIComponent(capabilityId)}/commands/${encodeURIComponent(command)}`,
        { input: JSON.parse(inputKey) },
      );
      for (let check = 0; check < COMMAND_CHECKS; check++) {
        const op = await client.request<CommandOperation<T>>(
          "GET",
          `/api/operations/${encodeURIComponent(started.id)}`,
        );
        if (op.status === "succeeded") {
          setData(op.result ?? null);
          setError(null);
          return;
        }
        if (op.status === "failed" || op.status === "cancelled") {
          setError(op.error?.message ?? "The request did not finish");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, COMMAND_CHECK_MS));
      }
      setError("The request is taking too long");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
    }
  }, [client, capabilityId, command, inputKey]);

  useEffect(() => {
    if (!enabled) {
      setData(null);
      return;
    }
    void reload();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (refreshRef.current(event.event_type)) void reload();
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void reload());
    return () => {
      offEvent();
      offStatus();
    };
  }, [client, enabled, reload]);

  return { data, error, reload };
}

/** Safety net only: the operation is normally re-read the moment Core announces a change. */
const OPERATION_POLL_MS = 1_000;

export type CommandRunState =
  "idle" | "requesting" | "waiting" | "running" | "succeeded" | "failed";

export interface CommandRun<T> {
  state: CommandRunState;
  result: T | null;
  error: string | null;
}

const IDLE_RUN = { state: "idle", result: null, error: null } as const;

/**
 * Runs one capability command that may need the user's approval and follows it to the end:
 * request, wait for the approval (the Approvals view shows it), run, result. One run at a time:
 * `busy` stays true until the operation is over, so a second click, even while the approval is
 * pending, sends nothing.
 */
export function useCommandAction<T = unknown>(capabilityId: string, command: string) {
  const client = useClient();
  const [current, setCurrent] = useState<CommandRun<T>>(IDLE_RUN);
  const [operationId, setOperationId] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = useCallback(
    async (input: unknown) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setCurrent({ state: "requesting", result: null, error: null });
      try {
        const op = await client.request<{ id: string }>(
          "POST",
          `/api/capabilities/${encodeURIComponent(capabilityId)}/commands/${encodeURIComponent(command)}`,
          { input },
        );
        setCurrent({ state: "waiting", result: null, error: null });
        setOperationId(op.id);
      } catch (err) {
        inFlight.current = false;
        setCurrent({
          state: "failed",
          result: null,
          error: err instanceof ApiError ? err.message : "Request failed",
        });
      }
    },
    [client, capabilityId, command],
  );

  useEffect(() => {
    if (!operationId) return;
    let stopped = false;
    let timer: number | undefined;
    const finish = (next: CommandRun<T>) => {
      inFlight.current = false;
      setOperationId(null);
      setCurrent(next);
    };
    const tick = async () => {
      try {
        const op = await client.request<CommandOperation<T>>(
          "GET",
          `/api/operations/${encodeURIComponent(operationId)}`,
        );
        if (stopped) return;
        if (op.status === "succeeded") {
          return finish({ state: "succeeded", result: op.result ?? null, error: null });
        }
        if (op.status === "failed" || op.status === "cancelled") {
          return finish({
            state: "failed",
            result: null,
            error: op.error?.message ?? "The request did not finish",
          });
        }
        setCurrent({
          state: op.status === "running" ? "running" : "waiting",
          result: null,
          error: null,
        });
      } catch (err) {
        if (stopped) return;
        return finish({
          state: "failed",
          result: null,
          error: err instanceof ApiError ? err.message : "Phoenix Core is unreachable",
        });
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), OPERATION_POLL_MS);
    };
    void tick();
    const off = client.eventCreated.on(({ event }) => {
      if (
        event.correlation_id === operationId ||
        event.event_type.startsWith("security.confirmation.")
      ) {
        void tick();
      }
    });
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      off();
    };
  }, [client, operationId]);

  const reset = useCallback(() => {
    if (!inFlight.current) setCurrent(IDLE_RUN);
  }, []);
  const busy =
    current.state === "requesting" || current.state === "waiting" || current.state === "running";
  return { ...current, busy, submit, reset };
}

const MAX_CONTENT_RETRIES = 5;
const CONTENT_RETRY_MS = 1_000;

/** Whether a finished meeting's transcript has arrived: `fetching` is normal for a second or two. */
export type MeetingContent = "ready" | "fetching" | "unavailable";

/** One meeting with its transcript and summary, kept live. */
export function useMeeting(id: string) {
  const client = useClient();
  const [data, setData] = useState<{
    meeting: Meeting | null;
    transcript: Transcript | null;
    summary: Summary | null;
  }>({ meeting: null, transcript: null, summary: null });
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [content, setContent] = useState<MeetingContent>("ready");

  const reload = useCallback(async () => {
    const path = `/api/meetings/${encodeURIComponent(id)}`;
    const optional = <T>(p: string) => client.request<T>("GET", p).catch(() => null);
    try {
      const meeting = await client.request<Meeting>("GET", path);
      const [transcript, summary] = await Promise.all([
        meeting.has_transcript ? optional<Transcript>(`${path}/transcript`) : null,
        meeting.has_summary ? optional<Summary>(`${path}/summary`) : null,
      ]);
      setData({ meeting, transcript, summary });
      setError(null);
      setMissing(false);
      return meeting;
    } catch (err) {
      if (err instanceof ApiError && err.code === "RESOURCE_NOT_FOUND") setMissing(true);
      else setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
      return null;
    }
  }, [client, id]);

  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const m = await reload();
      if (cancelled) return;
      // Content is fetched from the capability just after the status event; check back until
      // it lands, and say so if it never does.
      const waiting =
        !!m && (m.status === "ready" || m.status === "transcribed") && !m.has_transcript;
      if (waiting && retries < MAX_CONTENT_RETRIES) {
        retries++;
        setContent("fetching");
        timer = setTimeout(() => void load(), CONTENT_RETRY_MS);
      } else {
        setContent(waiting ? "unavailable" : "ready");
      }
    };
    void load();
    const off = client.eventCreated.on(({ event }) => {
      if (isMeetingEvent(event.event_type)) {
        retries = 0;
        void load();
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      off();
    };
  }, [client, reload]);

  return { ...data, error, missing, reload, content };
}

/** Whether engineering plans can be made right now, and the reasons when they cannot. */
export function usePlanningStatus() {
  return useLiveResource<PlanningStatus | null>(
    "/api/plans/status",
    (j) => j,
    null,
    (t) => t === "capability.enabled" || t === "capability.disabled" || t.startsWith("ai."),
  );
}

/** A plan, its task runs and links. Re-read when a confirmation changes (a create is waiting on it). */
export function usePlan(planId: string) {
  return useLiveResource<PlanDetail | null>(
    `/api/plans/${encodeURIComponent(planId)}`,
    (j) => j,
    null,
    (t) => t.startsWith("security.confirmation."),
  );
}

/** The exact calls a plan would make. Re-read with the plan, never on its own. */
export function usePlanPreview(planId: string, contentHash: string | null) {
  // The hash is in the path's query so a changed plan is a new resource, never a stale preview.
  return useLiveResource<PlanPreview | null>(
    `/api/plans/${encodeURIComponent(planId)}/preview${contentHash ? `?v=${contentHash.slice(0, 16)}` : ""}`,
    (j) => j,
    null,
    () => false,
  );
}

export function useMeetingPlans(meetingId: string) {
  return useLiveResource<PlanSummary[]>(
    `/api/meetings/${encodeURIComponent(meetingId)}/plans`,
    (j) => j.plans,
    [],
    (t) => t.startsWith("capability.command."),
  );
}

export function useMeetingLinks(meetingId: string) {
  return useLiveResource<PlanLink[]>(
    `/api/meetings/${encodeURIComponent(meetingId)}/links`,
    (j) => j.links,
    [],
    (t) => t.startsWith("capability.command."),
  );
}

const isWorkflowEvent = (t: string) => t.startsWith("workflow.");

export function useWorkflows() {
  return useLiveResource<Workflow[] | null>(
    "/api/workflows",
    (j) => j.workflows,
    null,
    isWorkflowEvent,
  );
}

export function useWorkflow(id: string) {
  return useLiveResource<WorkflowDetail | null>(
    `/api/workflows/${encodeURIComponent(id)}`,
    (j) => j,
    null,
    isWorkflowEvent,
  );
}

export function useWorkflowRuns(workflowId: string) {
  return useLiveResource<WorkflowRunSummary[]>(
    `/api/workflows/runs?workflow_id=${encodeURIComponent(workflowId)}&limit=20`,
    (j) => j.runs,
    [],
    isWorkflowEvent,
  );
}

export function useWorkflowMetrics() {
  return useLiveResource<Record<string, WorkflowMetrics> | null>(
    "/api/workflows/metrics",
    (j) => j.metrics,
    null,
    isWorkflowEvent,
  );
}

const RUN_POLL_MS = 3_000;

/** One run with its step history, kept fresh by workflow events and, while it runs, a slow poll. */
export function useWorkflowRun(runId: string) {
  const res = useLiveResource<WorkflowRun | null>(
    `/api/workflows/runs/${encodeURIComponent(runId)}`,
    (j) => j,
    null,
    isWorkflowEvent,
  );
  const { reload } = res;
  const active = res.data !== null && !res.data.terminal;
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void reload(), RUN_POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, reload]);
  return res;
}

/** Current hash route without the leading "#" ("/" when empty). */
export function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash.replace(/^#/, "") || "/";
}

export interface PetSettings {
  reduced_motion: "auto" | "on" | "off";
}

const petSettingsChanged = new EventTarget();

/** Fawkes appearance settings, shared by every component that shows Fawkes. */
export function usePetSettings() {
  const res = useLiveResource<PetSettings>(
    "/api/pet/settings",
    (j) => j,
    { reduced_motion: "auto" },
    () => false,
  );
  const { reload } = res;
  useEffect(() => {
    const on = () => void reload();
    petSettingsChanged.addEventListener("change", on);
    return () => petSettingsChanged.removeEventListener("change", on);
  }, [reload]);
  return res;
}

export const announcePetSettings = () => petSettingsChanged.dispatchEvent(new Event("change"));

export interface PrivacyInventory {
  location: string;
  data: { id: string; description: string; count: number; retention_days: number | null }[];
  audit_log: { description: string; count: number };
  credentials: { capability: string; name: string; stored_in: string }[];
  telemetry: string;
  external_ai: string;
}

export function usePrivacy() {
  return useLiveResource<PrivacyInventory | null>(
    "/api/privacy",
    (j) => j,
    null,
    () => false,
  );
}

export interface NotificationPreferences {
  enabled: boolean;
  min_severity: "warning" | "error";
  muted_sources: string[];
}

export function useNotificationPreferences() {
  return useLiveResource<NotificationPreferences | null>(
    "/api/notifications/preferences",
    (j) => j,
    null,
    () => false,
  );
}

export const MEMORY_PAGE_SIZE = 50;

const memoryQuery = (params: Record<string, string | number | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== "") q.set(k, String(v));
  return q.toString();
};

export interface MemoryBrowser {
  items: MemoryItem[];
  total: number;
  counts: Record<string, number>;
  aiEnabled: boolean;
  loaded: boolean;
  error: string | null;
  /** Fetches the next page of the current filter and appends it. */
  loadMore: () => Promise<void>;
  /** Starts over from the first page (after a delete, say). */
  reload: () => Promise<void>;
  /** Drops one forgotten item from view and the counts, without losing the pages already loaded. */
  remove: (item: MemoryItem) => void;
}

/** Pages through GET /api/memory for one domain filter (null = every domain). */
export function useMemoryBrowser(domain: string | null): MemoryBrowser {
  const client = useClient();
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [aiEnabled, setAiEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the newest request may write state: a slow page for an old filter must not land on a new one.
  const latest = useRef(0);
  const lengthRef = useRef(0);
  lengthRef.current = items.length;

  const fetchPage = useCallback(
    async (offset: number) => {
      const ticket = ++latest.current;
      try {
        const query = memoryQuery({
          domain,
          limit: MEMORY_PAGE_SIZE,
          offset,
          include: "live",
        });
        const page = await client.request<MemoryList>("GET", `/api/memory?${query}`);
        if (ticket !== latest.current) return;
        setItems((cur) => (offset === 0 ? page.items : [...cur, ...page.items]));
        setTotal(page.total);
        // Counts cover every domain; a filtered page may only report its own, so merge it in.
        setCounts((cur) => (domain === null ? page.counts : { ...cur, ...page.counts }));
        setAiEnabled(page.ai.enabled);
        setError(null);
        setLoaded(true);
      } catch (err) {
        if (ticket !== latest.current) return;
        setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
      }
    },
    [client, domain],
  );

  useEffect(() => {
    setItems([]);
    setLoaded(false);
    void fetchPage(0);
    return () => {
      latest.current++;
    };
  }, [fetchPage]);

  const loadMore = useCallback(() => fetchPage(lengthRef.current), [fetchPage]);
  const reload = useCallback(() => fetchPage(0), [fetchPage]);
  const remove = useCallback((gone: MemoryItem) => {
    setItems((cur) => cur.filter((item) => item.id !== gone.id));
    setTotal((t) => Math.max(0, t - 1));
    setCounts((cur) => ({ ...cur, [gone.domain]: Math.max(0, (cur[gone.domain] ?? 0) - 1) }));
  }, []);
  return { items, total, counts, aiEnabled, loaded, error, loadMore, reload, remove };
}

export interface MemorySearch {
  /** The submitted query, or null when no search is showing. */
  query: string | null;
  hits: MemorySearchHit[];
  busy: boolean;
  error: string | null;
  search: (q: string, domain: string | null) => Promise<void>;
  clear: () => void;
  remove: (id: string) => void;
}

/** GET /api/memory/search, run on submit (never on a timer). */
export function useMemorySearch(): MemorySearch {
  const client = useClient();
  const [query, setQuery] = useState<string | null>(null);
  const [hits, setHits] = useState<MemorySearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const search = useCallback(
    async (q: string, domain: string | null) => {
      const ticket = ++latest.current;
      setBusy(true);
      setError(null);
      try {
        const res = await client.request<{ items: MemorySearchHit[] }>(
          "GET",
          `/api/memory/search?${memoryQuery({ q, domain, limit: 20 })}`,
        );
        if (ticket !== latest.current) return;
        setHits(res.items);
        setQuery(q);
      } catch (err) {
        if (ticket !== latest.current) return;
        setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
      } finally {
        if (ticket === latest.current) setBusy(false);
      }
    },
    [client],
  );
  const clear = useCallback(() => {
    latest.current++;
    setQuery(null);
    setHits([]);
    setBusy(false);
    setError(null);
  }, []);
  const remove = useCallback((id: string) => setHits((cur) => cur.filter((h) => h.id !== id)), []);
  return { query, hits, busy, error, search, clear, remove };
}

export function useMemorySettings() {
  return useLiveResource<MemorySettings | null>(
    "/api/memory/settings",
    (j) => j,
    null,
    () => false,
  );
}

export function useAiStatus() {
  return useLiveResource<AiStatus | null>(
    "/api/ai/status",
    (j) => j,
    null,
    () => false,
  );
}

const isAgentRunEvent = (t: string) => t.startsWith("agent_run.");
/** A run's detail also changes while an approval it waits for is decided. */
const isAgentTaskEvent = (t: string) =>
  isAgentRunEvent(t) || t.startsWith("security.confirmation.");

/** Automation settings (off by default). Refreshes when a run starts or ends (the active count). */
export function useAgentSettings() {
  return useLiveResource<AgentSettings | null>(
    "/api/agent/settings",
    (j) => j,
    null,
    isAgentRunEvent,
  );
}

/** Newest agent tasks, kept live by `agent_run.*` events (no polling). */
export function useAgentTasks(limit = 5) {
  return useLiveResource<AgentTaskSummary[] | null>(
    `/api/agent/tasks?limit=${limit}`,
    (j) => j.tasks,
    null,
    isAgentRunEvent,
  );
}

/** One task with its steps, evidence and conclusion, kept live by `agent_run.*` and approval events. */
export function useAgentTask(id: string) {
  return useLiveResource<AgentTaskDetail | null>(
    `/api/agent/tasks/${encodeURIComponent(id)}`,
    (j) => j,
    null,
    isAgentTaskEvent,
  );
}

/** Pending coding-agent requests, re-read whenever one is raised or resolved (in any view). */
export function useAgentApprovals() {
  return useLiveResource<AgentApproval[]>(
    "/api/agent-approvals",
    (j) => j.approvals,
    [],
    (t) => t === "agent.approval.requested" || t === "agent.approval.resolved",
  );
}

/** The active "Always allow here" rules, re-read when one is created, used up or revoked. */
export function useAgentApprovalRules() {
  return useLiveResource<AgentApprovalRule[]>(
    "/api/agent-approvals/rules",
    (j) => j.rules,
    [],
    (t) => t === "agent.approval.rule.changed",
  );
}

/** Which coding agents Phoenix can install hooks into, plus the relay's status; re-read after an install. */
export function useAgentInstallers() {
  return useLiveResource<AgentInstallList>(
    "/api/agent-relay/agents",
    (j) => ({ relay: j.relay ?? null, agents: j.agents ?? [] }),
    { relay: null, agents: [] },
    (t) => t === "agent.relay.changed",
  );
}

/** The steps kept per page; Core keeps the same many. */
export const LIVE_STEP_CAP = 500;

const STEP_KINDS: readonly string[] = ["read", "edit", "run", "other"];

interface StepEvent {
  step: LiveStepOf;
  project: string;
  file: { path: string; added: number; removed: number; edits: number } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** An `agent.session.step` payload, checked: ephemeral events cross a trust boundary like any other. */
function readStepEvent(payload: Record<string, unknown>): StepEvent | null {
  const { session_id, n, kind, tool, target, at, project, file } = payload;
  if (
    typeof session_id !== "string" ||
    typeof n !== "number" ||
    typeof tool !== "string" ||
    typeof target !== "string" ||
    typeof at !== "string"
  )
    return null;
  const step: LiveStepOf = {
    session_id,
    n,
    at,
    kind:
      typeof kind === "string" && STEP_KINDS.includes(kind)
        ? (kind as LiveStepOf["kind"])
        : "other",
    tool,
    target,
  };
  const f =
    isRecord(file) &&
    typeof file.path === "string" &&
    typeof file.added === "number" &&
    typeof file.removed === "number" &&
    typeof file.edits === "number"
      ? { path: file.path, added: file.added, removed: file.removed, edits: file.edits }
      : null;
  return { step, project: typeof project === "string" ? project : "", file: f };
}

/** Appends one step: deduplicated, capped (oldest dropped), with the file totals it carries. */
function withStep(detail: LiveSessionDetail, ev: StepEvent): LiveSessionDetail {
  const { step, file } = ev;
  if (detail.steps.some((s) => s.session_id === step.session_id && s.n === step.n)) return detail;
  let steps = [...detail.steps, step];
  let dropped = detail.dropped_steps;
  if (steps.length > LIVE_STEP_CAP) {
    dropped += steps.length - LIVE_STEP_CAP;
    steps = steps.slice(steps.length - LIVE_STEP_CAP);
  }
  const files: LiveFileOf[] = file
    ? [
        { ...file, session_id: step.session_id, last_at: step.at },
        ...detail.files.filter((f) => !(f.session_id === step.session_id && f.path === file.path)),
      ]
    : detail.files;
  const sessions = detail.sessions.map((s) =>
    s.id === step.session_id
      ? { ...s, step_count: s.step_count + 1, last_seen: step.at, active: true }
      : s,
  );
  return { ...detail, steps, files, sessions, dropped_steps: dropped };
}

/**
 * One live session page: `id` is an agent's own session id or one of Phoenix's `ph-` ids. Loads
 * once, then follows `agent.session.step` events in place (no refetch per step). It refetches,
 * coalesced, for a session it has not seen yet and when the socket comes back. `data` is null with
 * an `error` when Core does not know the id.
 */
export function useAgentLive(id: string) {
  const client = useClient();
  const [data, setData] = useState<LiveSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<LiveSessionDetail | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const stale = useRef(false);
  const loadedOnce = useRef(false);
  const asked = useRef(new Set<string>());

  const publish = useCallback((next: LiveSessionDetail | null) => {
    current.current = next;
    setData(next);
  }, []);

  const load = useCallback((): Promise<void> => {
    if (inFlight.current) {
      stale.current = true;
      return inFlight.current;
    }
    const run = (async () => {
      try {
        do {
          stale.current = false;
          try {
            publish(
              await client.request<LiveSessionDetail>(
                "GET",
                `/api/agent/sessions/${encodeURIComponent(id)}`,
              ),
            );
            setError(null);
          } catch (err) {
            setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
            if (err instanceof ApiError && err.status === 404) publish(null);
          }
        } while (stale.current);
      } finally {
        loadedOnce.current = true;
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [client, id, publish]);

  useEffect(() => {
    publish(null);
    setError(null);
    loadedOnce.current = false;
    asked.current = new Set();
    void load();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (event.event_type !== "agent.session.step" || event.source !== "core") return;
      const ev = readStepEvent(event.payload);
      if (!ev) return;
      const detail = current.current;
      if (!detail || inFlight.current) {
        // A load is under way: what it returns may predate this step.
        if (inFlight.current) stale.current = true;
        return;
      }
      const known = detail.sessions.some((s) => s.id === ev.step.session_id);
      if (known) return publish(withStep(detail, ev));
      const related = detail.matched_by === "folder+time" || ev.step.session_id === id;
      if (!related || asked.current.has(ev.step.session_id)) return;
      asked.current.add(ev.step.session_id);
      void load();
    });
    const offStatus = client.statusChanged.on((s) => {
      if (s !== "online") return;
      // The first load is already under way; only a later (re)connection can have missed steps.
      if (inFlight.current && !loadedOnce.current) return;
      asked.current = new Set();
      void load();
    });
    return () => {
      offEvent();
      offStatus();
    };
  }, [client, id, load, publish]);

  return { data, error, reload: load };
}

/** Live sessions on this machine, newest first. Refetches only for a session it has not listed. */
export function useAgentLiveSessions() {
  const client = useClient();
  const [sessions, setSessions] = useState<LiveSessionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const known = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const list = await client.request<LiveSessionList>("GET", "/api/agent/sessions");
      known.current = new Set(list.sessions.map((s) => s.id));
      setSessions(list.sessions);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Phoenix Core is unreachable");
    }
  }, [client]);

  useEffect(() => {
    void load();
    const offEvent = client.eventCreated.on(({ event }) => {
      if (event.event_type !== "agent.session.step" || event.source !== "core") return;
      const sessionId = event.payload.session_id;
      if (typeof sessionId !== "string" || known.current.has(sessionId)) return;
      known.current.add(sessionId);
      void load();
    });
    const offStatus = client.statusChanged.on((s) => s === "online" && void load());
    return () => {
      offEvent();
      offStatus();
    };
  }, [client, load]);

  return { sessions, error };
}

const NO_USAGE: UsageSummary = { usage: [], thresholds: [], unsupported: [] };

/**
 * Plan usage of the coding agents Phoenix can read it from. A Core without the route, or any
 * failure, means "no usage": the error is not shown anywhere.
 */
export function useAgentUsage(): UsageSummary {
  return useLiveResource<UsageSummary>(
    "/api/agent/usage",
    (j) => ({
      usage: j.usage ?? [],
      thresholds: j.thresholds ?? [],
      unsupported: j.unsupported ?? [],
    }),
    NO_USAGE,
    (t, source) =>
      (t === "agent.usage.updated" && source === "core") || t === "agent.usage.warning",
  ).data;
}
