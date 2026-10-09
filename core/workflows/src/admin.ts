// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The only way to create, change, enable, delete or authorise a workflow. A capability object like
// `PolicyAdmin`: the API layer builds one for requests that arrived on an authenticated user
// channel; the engine, the tool gateway and the agent runtime are never given one, so nothing an
// agent, a model or a tool result says can reach it. Every method also refuses any actor that is
// not `kind: "user"` with `trustedByUser: true` and audits the refusal.
import type { PolicyAuditSink, Actor } from "@phoenix/policy";
import { definitionHash } from "./canonical";
import {
  transaction,
  type Authorisation,
  type StoredDefinition,
  type WorkflowAdminStore,
  type WorkflowStore,
} from "./store";
import { WorkflowError, type ToolCatalog } from "./types";
import { requiresAuthorisation, validateDefinition } from "./validate";

export const MAX_WORKFLOWS = 100;
export const MAX_AUTHORISATION_MS = 90 * 24 * 60 * 60_000;

export interface WorkflowAdminOptions {
  store: WorkflowStore;
  writes: WorkflowAdminStore;
  audit: PolicyAuditSink;
  /** Live tool facts, so a definition is checked against what the registry really says. */
  catalog: ToolCatalog;
  now?: () => number;
}

export interface AuthoriseOptions {
  /** Epoch ms after which the authorisation lapses. Omitted = until revoked or the definition changes. */
  expiresAt?: number;
}

export class WorkflowAdmin {
  private readonly now: () => number;

  constructor(private readonly o: WorkflowAdminOptions) {
    this.now = o.now ?? Date.now;
  }

  /** Validates and stores a definition (create or update). Returns what was stored. */
  save(by: Actor, input: unknown): StoredDefinition {
    this.requireUser(by, "workflow.save");
    const checked = validateDefinition(input, this.o.catalog);
    if (!checked.ok) {
      this.record(
        by,
        "workflow.save.rejected",
        { problems: checked.problems.slice(0, 10) },
        "denied",
      );
      throw new WorkflowError(
        "INVALID_DEFINITION",
        "Invalid workflow definition",
        checked.problems,
      );
    }
    const def = checked.definition;
    const existing = this.o.store.readDefinition(def.id);
    if (!existing && this.o.store.listDefinitions().length >= MAX_WORKFLOWS)
      throw new WorkflowError("LIMIT_REACHED", `At most ${MAX_WORKFLOWS} workflows are allowed`);
    if (
      existing?.ok &&
      def.version <= existing.definition.version &&
      definitionHash(def) !== existing.hash
    )
      throw new WorkflowError("VERSION_CONFLICT", "Raise `version` when the behaviour changes", [
        `stored version is ${existing.definition.version}`,
      ]);
    const need = requiresAuthorisation(def, this.o.catalog);
    const hash = definitionHash(def);
    // A definition that needs authorisation is stored switched off until the user has authorised
    // exactly this content, so saving never starts anything by itself.
    const stored: typeof def =
      need.required && existing?.ok !== true ? { ...def, enabled: false } : def;
    const out = transaction(this.o.store.database, () => {
      this.record(by, existing ? "workflow.updated" : "workflow.created", {
        workflow: def.id,
        version: def.version,
        hash,
        environment: def.environment,
        enabled: stored.enabled,
        authorisationRequired: need.required,
      });
      const saved = this.o.writes.putDefinition(
        stored,
        `${by.kind}:${by.id}`.slice(0, 120),
        this.now(),
      );
      // Editing the behaviour kills every authorisation bound to the old content.
      if (existing?.ok && existing.hash !== saved.hash)
        this.o.writes.revokeAuthorisations(def.id, "system:definition-changed", this.now());
      return saved;
    });
    return out;
  }

  setEnabled(by: Actor, id: string, enabled: boolean): void {
    this.requireUser(by, "workflow.enable");
    const read = this.o.store.readDefinition(id);
    if (!read?.ok) throw new WorkflowError("NOT_FOUND", `No workflow "${id}"`);
    this.record(by, enabled ? "workflow.enabled" : "workflow.disabled", { workflow: id });
    this.o.writes.setEnabled(id, enabled, `${by.kind}:${by.id}`.slice(0, 120), this.now());
  }

  remove(by: Actor, id: string): void {
    this.requireUser(by, "workflow.delete");
    this.record(by, "workflow.deleted", { workflow: id });
    transaction(this.o.store.database, () => {
      this.o.writes.revokeAuthorisations(id, `${by.kind}:${by.id}`.slice(0, 120), this.now());
      if (!this.o.writes.deleteDefinition(id))
        throw new WorkflowError("NOT_FOUND", `No workflow "${id}"`);
    });
  }

  /**
   * Authorises the CURRENT content of a workflow to run (needed for production workflows). The
   * authorisation is bound to the definition hash: editing the definition ends it.
   */
  authorise(by: Actor, id: string, options: AuthoriseOptions = {}): Authorisation {
    this.requireUser(by, "workflow.authorise");
    const read = this.o.store.readDefinition(id);
    if (!read?.ok) throw new WorkflowError("NOT_FOUND", `No workflow "${id}"`);
    const checked = validateDefinition(read.definition, this.o.catalog);
    if (!checked.ok)
      throw new WorkflowError(
        "INVALID_DEFINITION",
        "The workflow cannot be authorised as it is",
        checked.problems,
      );
    const now = this.now();
    const { expiresAt } = options;
    if (
      expiresAt !== undefined &&
      (!Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > MAX_AUTHORISATION_MS)
    )
      throw new WorkflowError(
        "INVALID_REQUEST",
        "expiresAt must be in the future and within 90 days",
      );
    const auth: Authorisation = {
      id: `wfa_${crypto.randomUUID()}`,
      workflowId: id,
      definitionHash: read.hash,
      authorisedBy: `${by.kind}:${by.id}`.slice(0, 120),
      authorisedAt: now,
      expiresAt: expiresAt ?? null,
      revokedAt: null,
      revokedBy: null,
    };
    this.record(by, "workflow.authorised", {
      workflow: id,
      hash: read.hash,
      authorisationId: auth.id,
      expiresAt: expiresAt === undefined ? null : new Date(expiresAt).toISOString(),
      reasons: requiresAuthorisation(read.definition, this.o.catalog).reasons,
    });
    this.o.writes.insertAuthorisation(auth);
    return auth;
  }

  /** Revokes the workflow's live authorisations. Runs already in flight are stopped at their next step. */
  revoke(by: Actor, id: string): number {
    this.requireUser(by, "workflow.revoke");
    this.record(by, "workflow.authorisation.revoked", { workflow: id });
    return this.o.writes.revokeAuthorisations(id, `${by.kind}:${by.id}`.slice(0, 120), this.now());
  }

  private requireUser(by: Actor, action: string): void {
    if (by?.kind === "user" && by.trustedByUser === true && by.id.length > 0) return;
    try {
      this.record(
        by ?? { kind: "agent", id: "unknown", trustedByUser: false },
        `${action}.refused`,
        {
          reason: "Only an authenticated user can change workflows",
          claimedKind: by?.kind,
          trustedByUser: by?.trustedByUser,
        },
        "denied",
      );
    } catch {
      // The refusal stands even if the audit write fails.
    }
    throw new WorkflowError("NOT_USER_ACTOR", "Only an authenticated user can change workflows");
  }

  private record(
    by: Actor,
    action: string,
    details: Record<string, unknown>,
    decision: "info" | "denied" = "info",
  ): void {
    try {
      this.o.audit.record({
        actor: `${by.kind}:${by.id}`.slice(0, 120),
        action,
        decision,
        details,
      });
    } catch (err) {
      throw new WorkflowError("AUDIT_FAILED", "The change could not be recorded", [String(err)]);
    }
  }
}
