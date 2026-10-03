// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Minimal external capability process used by tests. Prints its port, then
// serves the external capability contract on 127.0.0.1.
import { createServer } from "node:http";

let token = process.env.EXPECTED_TOKEN ?? null;
const calls = [];

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  const send = (status, value) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (req.url === "/__set_token" && req.method === "POST") {
    token = body.token;
    return send(200, {});
  }
  if (req.url === "/__calls") return send(200, calls);
  if (token && req.headers["x-phoenix-capability-token"] !== token)
    return send(401, { message: "bad token" });
  calls.push({ method: req.method, url: req.url, body });
  if (req.url === "/health") return send(200, { status: "healthy" });
  if (req.url === "/phoenix/lifecycle") return send(200, { ok: true });
  if (req.url === "/commands/echo") return send(200, { result: { echoed: body.input } });
  if (req.url === "/commands/explode") return send(500, { message: "kaboom" });
  return send(404, { message: "not found" });
});

server.listen(0, "127.0.0.1", () => {
  process.stdout.write(JSON.stringify({ port: server.address().port }) + "\n");
});
