// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PhoenixClient } from "./client";
import type { ActiveTask, ConnectionStatus, PetState } from "./types";

const ClientContext = createContext<PhoenixClient | null>(null);

export function CoreProvider({ client, children }: { client: PhoenixClient; children: ReactNode }) {
  useEffect(() => {
    client.connect();
    return () => client.close();
  }, [client]);
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

export function useClient(): PhoenixClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("useClient must be used inside <CoreProvider>");
  return c;
}

export const INITIAL_STATE: PetState = {
  state: "IDLE",
  explanation: "Connecting to Phoenix Core…",
  since: new Date(0).toISOString(),
  recording: false,
  sleeping: false,
};

export function usePetState(): PetState {
  const client = useClient();
  const [state, setState] = useState<PetState>(INITIAL_STATE);
  useEffect(() => client.stateChanged.on(setState), [client]);
  return state;
}

export function useConnection(): ConnectionStatus {
  const client = useClient();
  const [status, setStatus] = useState<ConnectionStatus>(client.status);
  useEffect(() => {
    setStatus(client.status);
    return client.statusChanged.on(setStatus);
  }, [client]);
  return status;
}

export function useTasks(): ActiveTask[] {
  const client = useClient();
  const [tasks, setTasks] = useState<ActiveTask[]>([]);
  useEffect(() => client.tasksChanged.on(setTasks), [client]);
  return tasks;
}

/** What Fawkes should display, accounting for connectivity (OFFLINE mode, ADR-0019). */
export function useDisplayedState(): PetState {
  const state = usePetState();
  const status = useConnection();
  if (status === "offline")
    return { ...state, state: "OFFLINE", explanation: "Phoenix Core is unreachable" };
  if (status === "unauthenticated") {
    return {
      ...state,
      state: "OFFLINE",
      explanation: "Not connected — open Phoenix from its local address",
    };
  }
  return state;
}
