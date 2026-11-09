// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { chatStoreFor } from "./chat-store";
import { displayedState, type PhoenixClient } from "./client";
import { useDemoView } from "./demo-view";
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
  // Phase 70: in the floating window and the island, a running demo's tasks replace the real ones.
  const demo = useDemoView();
  return demo ? demo.tasks : tasks;
}

/** True while the user is composing a chat message and no request is in flight. */
function useListening(): boolean {
  const store = chatStoreFor(useClient());
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().listening);
}

/**
 * What Fawkes should display, accounting for connectivity (OFFLINE mode, ADR-0019), plus one
 * client-side state: LISTENING while the user is writing a message. It is shown only over IDLE, so
 * it can never hide an error, an approval request, recording or real work, and it is a display
 * of this page only: Core is not told (nothing typed leaves the page before Send).
 */
export function useDisplayedState(): PetState {
  const status = useConnection();
  const shown = displayedState(usePetState(), status);
  const listening = useListening();
  // Phase 70: only while the real Core is reachable, so OFFLINE is never hidden by the demo.
  const demo = useDemoView();
  if (demo && status === "online") return demo.state;
  if (listening && shown.state === "IDLE") {
    return { ...shown, state: "LISTENING", explanation: "Listening: you are writing a message" };
  }
  return shown;
}
