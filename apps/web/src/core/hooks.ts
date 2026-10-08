// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";
import type {
  AiStatus,
  CapabilityView,
  Confirmation,
  Meeting,
  MemoryItem,
  MemoryList,
  MemorySearchHit,
  MemorySettings,
  Notification,
  StoredEvent,
  Summary,
  Transcript,
} from "./types";

/** Loads a resource and reloads it whenever `shouldReload` matches a live event. */
function useLiveResource<T>(
  path: string,
  pick: (json: any) => T,
  initial: T,
  shouldReload: (type: string) => boolean,
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
      if (reloadRef.current(event.event_type)) void reload();
    });
    const offCap = client.capabilityChanged.on((event) => {
      if (reloadRef.current(event.event_type)) void reload();
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

/** Runs an API action and tracks busy/error state for a button. */
export function useAction() {
  const client = useClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (method: string, path: string, body: unknown = {}) => {
      setBusy(true);
      setError(null);
      try {
        return await client.request(method, path, body);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Request failed");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [client],
  );
  return { run, busy, error };
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
  return useLiveResource<AiStatus | null>("/api/ai/status", (j) => j, null, () => false);
}
