// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { useSyncExternalStore } from "react";
import { chatStoreFor, type ChatSnapshot, type ChatStore } from "./chat-store";
import { useClient } from "./context";

/** The session conversation: survives switching tabs and closing the panel, not a page reload. */
export function useChat(): { chat: ChatSnapshot; store: ChatStore } {
  const store = chatStoreFor(useClient());
  const chat = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { chat, store };
}
