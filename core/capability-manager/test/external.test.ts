// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ErrorCode } from "@phoenix/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalClient, MAX_RESPONSE_BYTES } from "../src/external";

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});

/** Starts a loopback "capability" that answers every request with `handler`. */
async function capability(handler: (res: ServerResponse) => void): Promise<ExternalClient> {
  const listening = Promise.withResolvers<string>();
  const server = createServer((_req, res) => handler(res));
  servers.push(server);
  server.listen(0, "127.0.0.1", () =>
    listening.resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
  );
  return new ExternalClient(await listening.promise, "token");
}

describe("ExternalClient against a hostile capability", () => {
  it("stops reading, and drops the connection, once a reply passes the size ceiling", async () => {
    const closed = Promise.withResolvers<number>();
    const client = await capability((res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const chunk = Buffer.alloc(256 * 1024, 0x20);
      let sent = 0;
      // Stream far more than the ceiling; stop the moment Core hangs up.
      const pump = () => {
        while (sent < 200 * chunk.length) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end('{"status":"healthy"}');
      };
      res.on("close", () => closed.resolve(sent));
      pump();
    });

    await expect(client.health(5_000)).rejects.toMatchObject({
      code: ErrorCode.CAPABILITY_UNAVAILABLE,
      message: "Capability reply is too large",
    });
    // Core hung up long before the 50 MB the server was willing to send.
    expect(await closed.promise).toBeLessThan(50 * 1024 * 1024);
  });

  it("refuses up front when the declared length is over the ceiling", async () => {
    const client = await capability((res) => {
      res.writeHead(200, { "content-length": String(MAX_RESPONSE_BYTES + 1) });
      res.write("{");
    });
    await expect(client.health(5_000)).rejects.toMatchObject({
      message: "Capability reply is too large",
    });
  });

  it("still reads a reply that is just under the ceiling", async () => {
    const message = "x".repeat(1000);
    const client = await capability((res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "healthy", message }));
    });
    expect(await client.health(5_000)).toMatchObject({ status: "healthy" });
  });

  it("keeps only the start of a very long health message", async () => {
    const client = await capability((res) => {
      res.writeHead(200);
      res.end(JSON.stringify({ status: "degraded", message: "m".repeat(900_000) }));
    });
    const health = await client.health(5_000);
    expect(health.status).toBe("degraded");
    expect(health.message).toHaveLength(300);
  });

  it("times out a body that starts and then stalls, instead of waiting forever", async () => {
    const client = await capability((res) => {
      res.writeHead(200);
      res.write('{"status":'); // headers and a fragment arrive; the rest never does
    });
    await expect(client.health(100)).rejects.toMatchObject({ code: ErrorCode.OPERATION_TIMEOUT });
  });
});
