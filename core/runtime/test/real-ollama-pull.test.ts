// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Phase 81 exit criterion "a model is downloaded and removed through Phoenix", against a REAL
// loopback Ollama. It PULLS and then DELETES a model, so it is off unless the owner opts in with
// BOTH variables (the size is the owner's trusted catalog size for the fit check; production has
// no size catalog):
//   PHOENIX_REAL_OLLAMA_PULL=<tiny model name> PHOENIX_REAL_OLLAMA_PULL_BYTES=<its size in bytes> \
//     node_modules/.bin/vitest run core/runtime/test/real-ollama-pull.test.ts
// It refuses to run (and deletes nothing) when the model is already installed, so it can never
// remove a model that was there before, and it refuses `:cloud` / `-cloud` names.
import { createLocalModelClient, createMachineCapability } from "@phoenix/capability-machine";
import { afterEach, describe, expect, it } from "vitest";
import { startCore, type TestCore } from "./helpers";

const MODEL = process.env.PHOENIX_REAL_OLLAMA_PULL;
const BYTES = Number(process.env.PHOENIX_REAL_OLLAMA_PULL_BYTES);

let core: TestCore | undefined;
afterEach(async () => {
  await core?.runtime.stop();
  core = undefined;
});

/** Starts the command, approves the confirmation it raises, and waits for the operation. */
async function runApproved(c: TestCore, command: string, input: unknown): Promise<any> {
  const op = await c.api("POST", `/api/capabilities/machine/commands/${command}`, { input });
  expect(op.status).toBe(202);
  for (let i = 0; i < 4800; i++) {
    const pending = (await c.api("GET", "/api/confirmations")).json.confirmations as {
      id: string;
    }[];
    for (const conf of pending) {
      await c.api("POST", `/api/confirmations/${conf.id}`, { approve: true });
    }
    const polled = (await c.api("GET", `/api/operations/${op.json.id}`)).json;
    if (polled.status !== "pending" && polled.status !== "running") return polled;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("operation did not finish");
}

describe.skipIf(!MODEL)(
  "Phase 81 model download and removal through Phoenix, against a real Ollama",
  { timeout: 1_800_000 },
  () => {
    it("downloads then removes the named model, and the list shows both steps", async () => {
      expect(MODEL).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
      expect(MODEL).not.toMatch(/(^|[:-])cloud$/i);
      expect(Number.isSafeInteger(BYTES) && BYTES > 0).toBe(true);
      core = await startCore(
        {},
        {
          capabilities: [
            createMachineCapability({
              client: createLocalModelClient(),
              catalogSize: async () => BYTES,
            }),
          ],
        },
      );
      await core.api("POST", "/api/capabilities/machine/enable", {});
      const names = async () =>
        (
          (await runApproved(core!, "list_models", { provider: "ollama" })).result as {
            name: string;
          }[]
        ).map((m) => m.name);
      const before = await names();
      // Never delete something that was already there.
      expect(before).not.toContain(MODEL);
      expect(before).not.toContain(`${MODEL}:latest`);
      const target = { provider: "ollama", name: MODEL! };
      const pulled = await runApproved(core, "download_model", target);
      console.log(`RAW download_model ${JSON.stringify(pulled)}`);
      expect(pulled.status).toBe("succeeded");
      const during = await names();
      console.log(`RAW list_after_download ${JSON.stringify(during)}`);
      const installed = during.find((n) => n === MODEL || n === `${MODEL}:latest`);
      expect(installed).toBeDefined();
      const removed = await runApproved(core, "remove_model", { ...target, name: installed! });
      console.log(`RAW remove_model ${JSON.stringify(removed)}`);
      expect(removed.status).toBe("succeeded");
      const after = await names();
      console.log(`RAW list_after_remove ${JSON.stringify(after)}`);
      expect(after).not.toContain(installed);
      expect(after.sort()).toEqual(before.sort());
      const audit = (await core.api("GET", "/api/audit?capability=machine&limit=100")).json.entries;
      console.log(`RAW audit ${JSON.stringify(audit)}`);
      expect(JSON.stringify(audit)).toContain("confirmation.approved");
    });
  },
);
