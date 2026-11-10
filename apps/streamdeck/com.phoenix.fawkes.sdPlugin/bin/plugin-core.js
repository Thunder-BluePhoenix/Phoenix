// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The Stream Deck plugin (Phoenix Phase 88), written against Elgato's documented plugin WebSocket
// protocol (https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin) with no SDK package:
// Stream Deck starts this script with `-port -pluginUUID -registerEvent -info`, the plugin connects
// to ws://127.0.0.1:<port> and sends `{ event: <registerEvent>, uuid: <pluginUUID> }`.
//
// Two actions, both fixed in the manifest:
//   * state      shows Fawkes' coarse display state (one of the existing names) on a key. View-only.
//   * keep-awake asks Core to keep the computer awake for 30 minutes. A press only *requests* it:
//                Core's permission gateway then asks the person on screen, every time. Nothing on a
//                key can approve, deny or resolve an approval.
//
// The plugin never holds Core's session token and never speaks to Core itself: `askHost` runs the
// narrow local host (host.js) that does. Nothing Core sends is shown except a state name the host
// has checked against the fixed list.
import { askHost as defaultAskHost } from "./host-client.js";

export const PLUGIN_ACTIONS = {
  state: "com.phoenix.fawkes.state",
  keepAwake: "com.phoenix.fawkes.keep-awake",
};
export const POLL_MS = 5_000;
/** At most one keep-awake request per this long, so a held or mashed key cannot queue prompts. */
export const KEEP_AWAKE_COOLDOWN_MS = 10_000;
const FEEDBACK_MS = 5_000;

/** Key colours, matching the status lights' colours (capabilities/status-lights/src/devices.ts). */
const FACE_COLORS = {
  ERROR: "#ff2018",
  WAITING: "#ffa000",
  RECORDING: "#ff0000",
  WARNING: "#ffa000",
  DEPLOYING: "#0060ff",
  THINKING: "#0060ff",
  LISTENING: "#0060ff",
  WORKING: "#0060ff",
  SUCCESS: "#20a040",
  IDLE: "#303040",
  SLEEPING: "#202028",
  OFFLINE: "#202028",
};
const UNKNOWN_COLOR = "#505060";

/** A key image for a display state: a flat colour. The state name is the key's title. */
export function stateImage(state) {
  const fill = FACE_COLORS[state] ?? UNKNOWN_COLOR;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="20" fill="${fill}"/></svg>`;
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

/** Reads Stream Deck's launch parameters. Returns null unless every one is present and sane. */
export function parseLaunchArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length - 1; i++) {
    const flag = argv[i];
    if (flag === "-port" || flag === "-pluginUUID" || flag === "-registerEvent") {
      values[flag] = argv[i + 1];
    }
  }
  const port = Number(values["-port"]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  const uuid = values["-pluginUUID"];
  const registerEvent = values["-registerEvent"];
  if (typeof uuid !== "string" || uuid === "") return null;
  if (typeof registerEvent !== "string" || registerEvent === "") return null;
  return { port, uuid, registerEvent };
}

/**
 * Connects, registers and serves the two actions. `deps` makes every outside thing replaceable:
 * `WebSocket` (a class with `send`, `onopen`, `onmessage`, `onclose`), `askHost`, timers.
 * Returns `{ socket, stop }`, or null when the launch parameters are unusable.
 */
export function startPlugin(argv, deps = {}) {
  const launch = parseLaunchArgs(argv);
  if (launch === null) return null;
  const WebSocketClass = deps.WebSocket ?? globalThis.WebSocket;
  const askHost = deps.askHost ?? defaultAskHost;
  const now = deps.now ?? Date.now;
  const every = deps.setInterval ?? setInterval;
  const stopEvery = deps.clearInterval ?? clearInterval;
  const later = deps.setTimeout ?? setTimeout;
  const onClose = deps.onClose ?? (() => {});

  /** context -> manifest action UUID, for the keys currently on screen. */
  const visible = new Map();
  let lastKeepAwake = Number.NEGATIVE_INFINITY;
  let polling = false;
  let timer;

  // Loopback only: Stream Deck's socket is local, and the registration message goes nowhere else.
  const socket = new WebSocketClass(`ws://127.0.0.1:${launch.port}`);
  const send = (message) => socket.send(JSON.stringify(message));

  const showState = (context, reply) => {
    if (reply.ok && typeof reply.state === "string") {
      send({ event: "setImage", context, payload: { image: stateImage(reply.state) } });
      send({ event: "setTitle", context, payload: { title: reply.state } });
    } else {
      send({ event: "setImage", context, payload: { image: stateImage("OFFLINE") } });
      send({ event: "setTitle", context, payload: { title: "OFFLINE" } });
    }
  };

  const poll = async () => {
    const contexts = [...visible].filter(([, action]) => action === PLUGIN_ACTIONS.state);
    if (polling || contexts.length === 0) return;
    polling = true;
    try {
      const reply = await askHost({ kind: "state" });
      for (const [context] of contexts) if (visible.has(context)) showState(context, reply);
    } finally {
      polling = false;
    }
  };

  const keepAwake = async (context) => {
    const at = now();
    if (at - lastKeepAwake < KEEP_AWAKE_COOLDOWN_MS) {
      send({ event: "showAlert", context });
      return;
    }
    lastKeepAwake = at;
    const reply = await askHost({ kind: "keep_awake" });
    if (!reply.ok) {
      send({ event: "showAlert", context });
      return;
    }
    // Core accepted the request and is asking the person on screen; nothing has started yet.
    send({ event: "setTitle", context, payload: { title: "Confirm on screen" } });
    later(() => {
      if (visible.has(context)) send({ event: "setTitle", context, payload: { title: "" } });
    }, FEEDBACK_MS);
  };

  const onMessage = (data) => {
    let message;
    try {
      message = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    const { event, action, context } = message;
    if (typeof context !== "string") return;
    const ours = action === PLUGIN_ACTIONS.state || action === PLUGIN_ACTIONS.keepAwake;
    if (event === "willAppear" && ours) {
      visible.set(context, action);
      if (action === PLUGIN_ACTIONS.state) void poll();
    } else if (event === "willDisappear") {
      visible.delete(context);
    } else if (event === "keyDown" && ours) {
      // A state key's press just refreshes it; only the keep-awake key asks Core for anything.
      if (action === PLUGIN_ACTIONS.keepAwake) void keepAwake(context);
      else void poll();
    }
  };

  socket.onopen = () => {
    send({ event: launch.registerEvent, uuid: launch.uuid });
    timer = every(() => void poll(), POLL_MS);
  };
  socket.onmessage = (ev) => onMessage(ev.data);
  socket.onclose = () => {
    if (timer !== undefined) stopEvery(timer);
    visible.clear();
    onClose();
  };
  socket.onerror = () => {};

  return {
    socket,
    stop: () => {
      if (timer !== undefined) stopEvery(timer);
      socket.close();
    },
  };
}
