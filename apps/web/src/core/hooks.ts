// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./client";
import { useClient } from "./context";
import type { CapabilityView, Confirmation, Notification, StoredEvent } from "./types";

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
