// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A stand-in for the Docker Engine API (v1.41+ response shapes) on a unix socket in a temp
// directory. It serves GET /_ping, /containers/json and /containers/<id>/json, records every
// request, and answers anything but GET with 405 so tests can assert that none was ever sent.
// The containers carry secrets in Env, Labels, Command and Mounts on purpose: the capability
// must never let them reach an event.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const SECRET_ENV = "DB_PASSWORD=hunter2-very-secret";
export const SECRET_TOKEN_ENV = "API_TOKEN=tok_live_51Habcdefghijklmnop";
export const SECRET_LABEL = "label-secret-value-9f3a";
export const SECRET_COMMAND = "run-app --admin-password=s3cr3t-cmdline";
export const SECRET_MOUNT = "/home/alice/.ssh-private-mount";

export interface MockContainerSpec {
  name: string;
  image?: string;
  /** Engine state: created | running | paused | restarting | removing | exited | dead */
  state?: string;
  /** The human Status column, e.g. "Up 5 minutes (unhealthy)" or "Exited (1) 3 seconds ago". */
  status?: string;
  labels?: Record<string, string>;
  /** State.ExitCode returned by inspect. */
  exitCode?: number;
  oomKilled?: boolean;
}

interface MockContainer extends Required<Omit<MockContainerSpec, "labels">> {
  id: string;
  labels: Record<string, string>;
}

export interface RecordedRequest {
  method: string;
  url: string;
}

export type Override = (req: IncomingMessage, res: ServerResponse) => void;

export interface MockDocker {
  socketPath: string;
  /** Every request received, in order. */
  requests: RecordedRequest[];
  add(spec: MockContainerSpec): string;
  update(name: string, patch: Partial<MockContainerSpec>): void;
  remove(name: string): void;
  /** Connections are dropped until set back to false (the daemon is restarting). */
  setDown(value: boolean): void;
  /** Takes over every GET (hostile / slow replies); null restores normal behaviour. */
  setOverride(fn: Override | null): void;
  close(): Promise<void>;
}

export async function startMockDocker(socketPath?: string): Promise<MockDocker> {
  const dir = mkdtempSync(join(tmpdir(), "pd-"));
  const path = socketPath ?? join(dir, "docker.sock");
  mkdirSync(dirname(path), { recursive: true });
  const containers = new Map<string, MockContainer>();
  const requests: RecordedRequest[] = [];
  let down = false;
  let override: Override | null = null;
  let counter = 0;

  const listItem = (c: MockContainer) => ({
    Id: c.id,
    Names: [`/${c.name}`],
    Image: c.image,
    ImageID: "sha256:" + "ab".repeat(32),
    Command: SECRET_COMMAND,
    Created: 1_700_000_000,
    Ports: [],
    Labels: c.labels,
    State: c.state,
    Status: c.status,
    HostConfig: { NetworkMode: "default" },
    NetworkSettings: { Networks: { bridge: { NetworkID: "n1", IPAddress: "172.17.0.2" } } },
    Mounts: [{ Type: "bind", Source: SECRET_MOUNT, Destination: "/keys", Mode: "ro", RW: false }],
  });

  const inspect = (c: MockContainer) => ({
    Id: c.id,
    Created: "2026-10-01T10:00:00.000000000Z",
    Path: "run-app",
    Args: ["--admin-password=s3cr3t-cmdline"],
    State: {
      Status: c.state,
      Running: c.state === "running",
      Paused: c.state === "paused",
      Restarting: c.state === "restarting",
      OOMKilled: c.oomKilled,
      Dead: c.state === "dead",
      Pid: c.state === "running" ? 4242 : 0,
      ExitCode: c.exitCode,
      Error: "",
      StartedAt: "2026-10-01T10:00:01.000000000Z",
      FinishedAt: "0001-01-01T00:00:00Z",
    },
    Image: "sha256:" + "ab".repeat(32),
    Name: `/${c.name}`,
    Config: {
      Hostname: c.id.slice(0, 12),
      Env: [SECRET_ENV, SECRET_TOKEN_ENV, "PATH=/usr/bin"],
      Cmd: ["run-app", "--admin-password=s3cr3t-cmdline"],
      Image: c.image,
      Labels: c.labels,
    },
    Mounts: [{ Type: "bind", Source: SECRET_MOUNT, Destination: "/keys" }],
  });

  const server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "" });
    if (down) return void req.socket.destroy();
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "mock: only GET is expected from Phoenix" }));
      return;
    }
    if (override) return override(req, res);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", server: "Docker/26.1.0 (mock)" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url ?? "/", "http://docker");
    if (url.pathname === "/_ping") {
      res.writeHead(200, { "content-type": "text/plain" });
      return void res.end("OK");
    }
    if (url.pathname === "/containers/json") {
      const all = url.searchParams.get("all") === "true";
      return send(
        200,
        [...containers.values()].filter((c) => all || c.state === "running").map(listItem),
      );
    }
    const m = /^\/containers\/([0-9a-f]+)\/json$/.exec(url.pathname);
    const found = m && [...containers.values()].find((c) => c.id.startsWith(m[1]!));
    if (found) return send(200, inspect(found));
    send(404, { message: "page not found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolve());
  });

  const byName = (name: string): MockContainer => {
    const c = containers.get(name);
    if (!c) throw new Error(`mock container ${name} does not exist`);
    return c;
  };

  return {
    socketPath: path,
    requests,
    add(spec: MockContainerSpec): string {
      counter++;
      const state = spec.state ?? "running";
      const c: MockContainer = {
        id: counter.toString(16).padStart(2, "0").repeat(32).slice(0, 64),
        name: spec.name,
        image: spec.image ?? "nginx:1.27",
        state,
        status: spec.status ?? (state === "running" ? "Up 5 minutes" : "Exited (0) 1 minute ago"),
        labels: { "secret.label": SECRET_LABEL, ...spec.labels },
        exitCode: spec.exitCode ?? 0,
        oomKilled: spec.oomKilled ?? false,
      };
      containers.set(spec.name, c);
      return c.id;
    },
    update(name: string, patch: Partial<MockContainerSpec>): void {
      const { labels, ...rest } = patch;
      Object.assign(byName(name), rest, labels ? { labels } : {});
    },
    remove(name: string): void {
      containers.delete(name);
    },
    setDown(value: boolean): void {
      down = value;
    },
    setOverride(fn: Override | null): void {
      override = fn;
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
