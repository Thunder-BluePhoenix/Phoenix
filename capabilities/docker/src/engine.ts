// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Read-only client for the Docker Engine HTTP API over its local unix socket.
//
// The Docker API can start, stop and delete containers, so this capability is read-only by
// construction, not by convention: `dockerGet` is the only function in this package that talks to
// the socket, it hard-codes the GET method, and it refuses any path that is not on the short
// allow-list below. There is no code path that can send another method (test/read-only.test.ts
// fails if one is introduced). Docker API traffic never leaves the machine: tcp:// and ssh://
// DOCKER_HOST values are refused (see socketCandidates).
import { statSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";

/** Paths Phoenix may request. Anything else is refused before a connection is made. */
const ALLOWED_PATHS: readonly RegExp[] = [
  /^\/_ping$/,
  /^\/containers\/json\?all=true$/,
  /^\/containers\/[0-9a-f]{12,64}\/json$/,
];

/** Ceiling for a reply. Real container lists are well under 1 MiB per hundred containers. */
export const MAX_LIST_BYTES = 8 * 1024 * 1024;
export const MAX_INSPECT_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 5_000;

export type DockerErrorKind =
  | "not_running"
  | "permission"
  | "timeout"
  | "too_large"
  | "http"
  | "invalid"
  | "refused"
  | "aborted";

export class DockerError extends Error {
  override name = "DockerError";
  constructor(
    readonly kind: DockerErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface DockerGetOptions {
  /** Whole-request deadline, including reading the body (default 5 s). */
  timeoutMs?: number;
  /** Largest body accepted; the connection is dropped once it is exceeded. */
  maxBytes?: number;
  /** Lets the caller cancel (e.g. the capability was disabled). */
  signal?: AbortSignal;
}

/**
 * GET `path` from the Docker socket and return the body as text. The ONLY place that touches the
 * socket; the method is the literal "GET".
 */
export function dockerGet(
  socketPath: string,
  path: string,
  options: DockerGetOptions = {},
): Promise<string> {
  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    return Promise.reject(
      new DockerError("refused", `Phoenix does not request ${path} from Docker`),
    );
  }
  const maxBytes = options.maxBytes ?? MAX_LIST_BYTES;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const done = Promise.withResolvers<string>();

  const req = request(
    {
      socketPath,
      path,
      method: "GET",
      headers: { accept: "application/json" },
      agent: false,
      signal,
    },
    (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        done.reject(new DockerError("http", `Docker answered HTTP ${res.statusCode ?? "?"}`));
        return;
      }
      const declared = Number(res.headers["content-length"] ?? 0);
      if (declared > maxBytes) {
        done.reject(new DockerError("too_large", "Docker's reply is larger than Phoenix accepts"));
        res.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          // Reject before destroying: destroy() also fires the "aborted" handler below.
          done.reject(
            new DockerError("too_large", "Docker's reply is larger than Phoenix accepts"),
          );
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => done.resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", () => done.reject(failure(socketPath, undefined, timeout, signal)));
      res.on("aborted", () => done.reject(failure(socketPath, undefined, timeout, signal)));
    },
  );
  req.on("error", (err: NodeJS.ErrnoException) =>
    done.reject(failure(socketPath, err.code, timeout, signal)),
  );
  req.end();
  return done.promise;
}

/** GET and parse JSON. A body that is not JSON is a DockerError, never an uncaught throw. */
export async function dockerJson(
  socketPath: string,
  path: string,
  options: DockerGetOptions = {},
): Promise<unknown> {
  const text = await dockerGet(socketPath, path, options);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DockerError("invalid", "Docker returned a reply Phoenix could not read");
  }
}

function failure(
  socketPath: string,
  code: string | undefined,
  timeout: AbortSignal,
  signal: AbortSignal,
): DockerError {
  if (timeout.aborted) return new DockerError("timeout", "Docker did not answer in time");
  if (signal.aborted) return new DockerError("aborted", "Request cancelled");
  if (code === "EACCES" || code === "EPERM") {
    return new DockerError(
      "permission",
      `Not allowed to open ${socketPath}. Your user needs access to the Docker socket (e.g. membership of the docker group)`,
    );
  }
  if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ENOTSOCK") {
    return new DockerError(
      "not_running",
      `Docker is not running (nothing is listening on ${socketPath})`,
    );
  }
  return new DockerError("http", `Could not talk to Docker${code ? ` (${code})` : ""}`);
}

export interface SocketCandidates {
  /** Socket paths to try, best first. */
  paths: string[];
  /** Why a source was skipped; shown to the user when nothing is found. */
  notes: string[];
}

/**
 * Where Docker's socket may be, in order: the `socket_path` setting (if set, the only candidate:
 * a typo must not silently watch a different daemon), $DOCKER_HOST (unix:// only), then the
 * locations used by Docker Engine, Docker Desktop, Colima and OrbStack.
 */
export function socketCandidates(
  configured: string | undefined,
  env: NodeJS.ProcessEnv,
  home: string,
): SocketCandidates {
  if (configured) return { paths: [configured], notes: [] };
  const paths: string[] = [];
  const notes: string[] = [];
  const host = env.DOCKER_HOST?.trim();
  if (host) {
    if (host.startsWith("unix://")) {
      const path = host.slice("unix://".length);
      if (path.startsWith("/")) paths.push(path);
      else notes.push("DOCKER_HOST is not an absolute unix:// path, so it was ignored");
    } else {
      const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(host)?.[1] ?? "unknown";
      notes.push(
        `DOCKER_HOST uses ${scheme}://, which was ignored: Phoenix only talks to a local Docker socket and never sends Docker API traffic over the network`,
      );
    }
  }
  paths.push(
    "/var/run/docker.sock",
    join(home, ".docker/run/docker.sock"),
    join(home, ".colima/default/docker.sock"),
    join(home, ".orbstack/run/docker.sock"),
  );
  return { paths, notes };
}

export interface SocketLookup {
  /** The first candidate that exists and is a socket. */
  path?: string;
  tried: string[];
  notes: string[];
}

/** Metadata check only (stat); the socket's contents are not read. */
export function isSocket(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isSocket() === true;
}

export function findSocket(
  candidates: SocketCandidates,
  exists: (path: string) => boolean = isSocket,
): SocketLookup {
  const path = candidates.paths.find((p) => exists(p));
  return { ...(path ? { path } : {}), tried: candidates.paths, notes: candidates.notes };
}
