// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 57: the owner-only local relay server. It lives in Phoenix Core's process and answers one
// newline-delimited JSON request per connection on a Unix domain socket (see ./protocol.ts for the
// contract). The server only transports: it parses, checks the allow-list, and hands the body to
// the handler Core registered for that operation.
//
// Who may connect: Node does not expose SO_PEERCRED, so there is NO per-connection peer-uid check.
// Access control is the filesystem alone: the relay directory must be a real directory owned by
// this user with mode 0700 (checked on every start, never trusted), and the socket is chmod 0600.
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { ErrorCode, PhoenixError } from "@phoenix/protocol";
import { isRecord } from "../guards";
import {
  IDLE_TIMEOUT_MS,
  isRelayOp,
  MAX_REQUEST_BYTES,
  relayDir,
  relaySocketPath,
  RELAY_VERSION,
  type RelayErrorCode,
  type RelayOp,
  type RelayResponse,
} from "./protocol";

/** The relay could not start: the message says why and is safe to show the user. */
export class RelayStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayStartError";
  }
}

export type RelayHandler = (body: unknown) => unknown;
export type RelayHandlers = Partial<Record<Exclude<RelayOp, "ping">, RelayHandler>>;

export interface RelayTimers {
  /** Runs `fn` after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export interface RelayLogger {
  warn(message: string, context?: Record<string, unknown>): void;
}

export interface RelayServerOptions {
  dataDir: string;
  handlers: RelayHandlers;
  coreVersion?: string;
  platform?: NodeJS.Platform;
  /** Expected owner of the relay directory. Default: the current user (process.getuid). */
  uid?: number;
  logger?: RelayLogger;
  idleTimeoutMs?: number;
  maxRequestBytes?: number;
  timers?: RelayTimers;
}

const MAX_CONNECTIONS = 64;

const defaultTimers: RelayTimers = {
  after(ms, fn) {
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

const stderrLogger: RelayLogger = {
  warn(message, context) {
    process.stderr.write(`phoenix relay: ${message} ${JSON.stringify(context ?? {})}\n`);
  },
};

const fail = (code: RelayErrorCode | string, message: string): RelayResponse => ({
  v: RELAY_VERSION,
  ok: false,
  error: { code, message },
});

const isErrno = (err: unknown): err is NodeJS.ErrnoException => err instanceof Error;

/** True when something accepts connections on `path`; false for a leftover socket file. */
async function isServing(path: string): Promise<boolean> {
  const outcome = Promise.withResolvers<boolean>();
  const probe = connect(path);
  probe.once("connect", () => {
    probe.destroy();
    outcome.resolve(true);
  });
  probe.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ECONNREFUSED" || err.code === "ENOENT") outcome.resolve(false);
    else outcome.reject(err);
  });
  return outcome.promise;
}

export class RelayServer {
  readonly #dataDir: string;
  readonly #handlers: RelayHandlers;
  readonly #coreVersion: string | undefined;
  readonly #platform: NodeJS.Platform;
  readonly #uid: number | undefined;
  readonly #logger: RelayLogger;
  readonly #idleTimeoutMs: number;
  readonly #maxRequestBytes: number;
  readonly #timers: RelayTimers;
  readonly #path: string;
  readonly #sockets = new Set<Socket>();
  #server: Server | undefined;
  #stopping: Promise<void> | undefined;

  constructor(options: RelayServerOptions) {
    this.#dataDir = options.dataDir;
    this.#handlers = { ...options.handlers };
    this.#coreVersion = options.coreVersion;
    this.#platform = options.platform ?? process.platform;
    this.#uid = options.uid ?? process.getuid?.();
    this.#logger = options.logger ?? stderrLogger;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.#maxRequestBytes = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
    this.#timers = options.timers ?? defaultTimers;
    this.#path = relaySocketPath(this.#dataDir, this.#platform);
  }

  get path(): string {
    return this.#path;
  }

  /** Registers (or replaces) the handler for an operation; effective for the next request. */
  setHandler(op: Exclude<RelayOp, "ping">, fn: RelayHandler): void {
    this.#handlers[op] = fn;
  }

  async start(): Promise<{ path: string }> {
    if (this.#server || this.#stopping) throw new RelayStartError("relay already started");
    // UNVERIFIED (cannot be exercised on this machine): on win32 the relay is a per-user named
    // pipe; there is no directory or file mode to check, so the POSIX preparation is skipped.
    if (this.#platform !== "win32") {
      await this.#prepareDirectory();
      await this.#clearStaleSocket();
    }
    const server = createServer((socket) => this.#onConnection(socket));
    server.maxConnections = MAX_CONNECTIONS;
    const listening = Promise.withResolvers<void>();
    server.once("error", listening.reject);
    server.listen(this.#path, () => listening.resolve());
    try {
      await listening.promise;
      server.off("error", listening.reject);
      server.on("error", (err) => this.#logger.warn("relay server error", { error: err.message }));
      if (this.#platform !== "win32") await chmod(this.#path, 0o600);
    } catch (err) {
      server.close();
      const detail = err instanceof Error ? err.message : String(err);
      throw new RelayStartError(`cannot listen on ${this.#path}: ${detail}`);
    }
    this.#server = server;
    return { path: this.#path };
  }

  /** Idempotent: closes the listener and every open connection, removes the socket file. */
  stop(): Promise<void> {
    this.#stopping ??= this.#shutdown();
    return this.#stopping;
  }

  async #shutdown(): Promise<void> {
    const server = this.#server;
    if (!server) return;
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    for (const socket of this.#sockets) socket.destroy();
    await closed.promise;
    if (this.#platform !== "win32") {
      await unlink(this.#path).catch((err: unknown) => {
        if (!isErrno(err) || err.code !== "ENOENT") throw err;
      });
    }
  }

  async #prepareDirectory(): Promise<void> {
    const dir = relayDir(this.#dataDir);
    const existed = await lstat(dir).then(
      () => true,
      () => false,
    );
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if (!existed) await chmod(dir, 0o700);
    // Whether or not we just made it, never trust it: it is where the socket's access control lives.
    const stat = await lstat(dir);
    if (!stat.isDirectory()) {
      throw new RelayStartError(
        `${dir} is not a real directory (a symlink or file); refusing to start the relay`,
      );
    }
    if (this.#uid !== undefined && stat.uid !== this.#uid) {
      throw new RelayStartError(
        `${dir} is not owned by the current user; refusing to start the relay`,
      );
    }
    if ((stat.mode & 0o077) !== 0) {
      const mode = (stat.mode & 0o777).toString(8);
      throw new RelayStartError(
        `${dir} has mode ${mode}, expected 700; refusing to start the relay`,
      );
    }
  }

  async #clearStaleSocket(): Promise<void> {
    const stat = await lstat(this.#path).catch((err: unknown) => {
      if (isErrno(err) && err.code === "ENOENT") return undefined;
      throw err;
    });
    if (!stat) return;
    if (!stat.isSocket()) {
      throw new RelayStartError(`${this.#path} exists and is not a socket; refusing to remove it`);
    }
    let serving: boolean;
    try {
      serving = await isServing(this.#path);
    } catch (err) {
      throw new RelayStartError(
        `cannot probe ${this.#path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (serving) throw new RelayStartError("another Phoenix Core is already serving this relay");
    await unlink(this.#path);
  }

  #onConnection(socket: Socket): void {
    this.#sockets.add(socket);
    let buffered = Buffer.alloc(0);
    // Set once the request is complete or refused; later bytes are ignored.
    let settled = false;
    let cancelIdle: () => void = () => {};
    const respond = (response: RelayResponse): void => {
      settled = true;
      cancelIdle();
      if (socket.writable) socket.end(`${JSON.stringify(response)}\n`);
    };

    // Runs only until the request line is complete, so a handler that is still working (an
    // approval long-poll) is never cut off by it.
    cancelIdle = this.#timers.after(this.#idleTimeoutMs, () => {
      if (!settled) respond(fail("idle_timeout", "no complete request line arrived in time"));
    });
    // A peer that resets or vanishes is not an error worth surfacing.
    socket.on("error", () => {});
    socket.on("close", () => {
      cancelIdle();
      this.#sockets.delete(socket);
    });
    socket.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffered = Buffer.concat([buffered, chunk]);
      const newline = buffered.indexOf(0x0a);
      if ((newline === -1 ? buffered.length : newline) > this.#maxRequestBytes) {
        respond(fail("too_large", `request line exceeds ${this.#maxRequestBytes} bytes`));
        return;
      }
      if (newline === -1) return;
      settled = true;
      cancelIdle();
      void this.#dispatch(buffered.subarray(0, newline).toString("utf8")).then(respond);
      buffered = Buffer.alloc(0);
    });
  }

  /** Never rejects: every failure becomes an error response. */
  async #dispatch(line: string): Promise<RelayResponse> {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      return fail("invalid_request", "request is not valid JSON");
    }
    if (!isRecord(request)) return fail("invalid_request", "request must be a JSON object");
    const { op } = request;
    if (typeof op !== "string" || op === "") return fail("invalid_request", "request has no op");
    if (request.v !== RELAY_VERSION) {
      return fail(
        "unsupported_version",
        `unsupported relay version; this server speaks v${RELAY_VERSION}`,
      );
    }
    if (!isRelayOp(op)) return fail("op_not_allowed", "operation is not allowed");
    if (op === "ping") {
      return {
        v: RELAY_VERSION,
        ok: true,
        result: { v: RELAY_VERSION, core_version: this.#coreVersion, pid: process.pid },
      };
    }
    const handler = this.#handlers[op];
    if (!handler) return fail("not_available", "operation is not available");
    try {
      const result = await handler(request.body);
      return { v: RELAY_VERSION, ok: true, result: result ?? null };
    } catch (err) {
      if (err instanceof PhoenixError) return fail(err.code, err.message);
      this.#logger.warn("relay handler failed", {
        op,
        code: ErrorCode.INTERNAL_ERROR,
        error: err instanceof Error ? err.message : String(err),
      });
      return fail("internal_error", "relay handler failed");
    }
  }
}
