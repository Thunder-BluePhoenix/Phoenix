// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Append-only. Never edit a migration that has shipped; add a new one. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        severity TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        correlation_id TEXT,
        envelope TEXT NOT NULL,
        received_at TEXT NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE INDEX events_seq ON events (seq);
      CREATE INDEX events_type ON events (event_type);
      CREATE INDEX events_correlation ON events (correlation_id);

      CREATE TABLE dead_letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        subscriber TEXT NOT NULL,
        error TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        envelope TEXT NOT NULL,
        failed_at TEXT NOT NULL
      );

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE capabilities (
        id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        manifest TEXT NOT NULL,
        config TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE credentials (
        id TEXT PRIMARY KEY,
        capability_id TEXT NOT NULL,
        -- Reference into the OS secret store. The secret itself is never stored here.
        secret_ref TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE pet_profile (
        id TEXT PRIMARY KEY,
        character TEXT NOT NULL,
        settings TEXT NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "permissions-and-audit",
    sql: `
      CREATE TABLE permission_grants (
        capability_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (capability_id, permission)
      );

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        capability_id TEXT,
        decision TEXT NOT NULL,
        details TEXT NOT NULL
      );
      CREATE INDEX audit_capability ON audit_log (capability_id);
    `,
  },
  {
    version: 3,
    name: "capability-transport",
    sql: `
      ALTER TABLE capabilities ADD COLUMN kind TEXT NOT NULL DEFAULT 'builtin';
      ALTER TABLE capabilities ADD COLUMN endpoint TEXT;
    `,
  },
  {
    version: 4,
    name: "notification-details",
    sql: `
      ALTER TABLE notifications ADD COLUMN source TEXT;
      ALTER TABLE notifications ADD COLUMN event_type TEXT;
      CREATE INDEX notifications_created ON notifications (created_at);
    `,
  },
  {
    version: 5,
    name: "meetings",
    sql: `
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY,            -- "<capability>:<external id>"
        capability_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT,
        status TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        duration_seconds INTEGER,
        participants TEXT,              -- JSON array
        recording TEXT,                 -- JSON reference {location, retention}; never the media itself
        transcript TEXT,                -- JSON {text, segments}
        summary TEXT,                   -- JSON {text, topics, decisions, action_items, ...}
        archived_at TEXT,
        deleted_at TEXT,                -- tombstone: content purged and never re-imported
        updated_at TEXT NOT NULL
      );
      CREATE INDEX meetings_updated ON meetings (updated_at);
    `,
  },
  {
    version: 6,
    name: "policy",
    sql: `
      CREATE TABLE policy_rules (
        id TEXT PRIMARY KEY,
        rule TEXT NOT NULL,             -- JSON, validated by @phoenix/policy on write and on read
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE policy_approvals (
        id TEXT PRIMARY KEY,
        tool_pattern TEXT NOT NULL,
        environment TEXT NOT NULL,
        resource TEXT NOT NULL,
        actor_id TEXT,                  -- NULL = any agent
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,    -- epoch ms
        expires_at INTEGER NOT NULL,    -- epoch ms; enforced at decision time
        revoked_at INTEGER
      );
      CREATE INDEX policy_approvals_expiry ON policy_approvals (expires_at);
    `,
  },
  {
    version: 7,
    name: "memory",
    sql: `
      CREATE TABLE memory_items (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,   -- FTS rowid; never reused
        id TEXT NOT NULL UNIQUE,
        dedupe_key TEXT NOT NULL UNIQUE,         -- stable identity of the source fact; blocks duplicates
        source TEXT NOT NULL,                    -- capability that produced it ("git", "kage", "project-docs")
        source_ref TEXT NOT NULL,                -- what it came from: event id / meeting id / file path
        owner TEXT NOT NULL,
        scope TEXT NOT NULL,                     -- "repo:<name>", "meeting:<id>", "path:<abs>", "global"
        layer TEXT NOT NULL CHECK (layer IN ('working', 'episodic', 'project', 'preference')),
        domain TEXT NOT NULL,                    -- git | meeting | project | preference | general
        kind TEXT NOT NULL CHECK (kind IN ('fact', 'interpretation')),
        text TEXT NOT NULL,                      -- '' once tombstoned
        created_at TEXT NOT NULL,
        observed_at TEXT NOT NULL,               -- when the thing happened (commit time, meeting start)
        last_confirmed_at TEXT NOT NULL,         -- freshness: last time the source still said this
        freshness_ttl_days INTEGER,              -- NULL = never goes stale
        sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'internal', 'sensitive')),
        provenance TEXT NOT NULL,                -- JSON: event id, meeting id, sha, model + provider ...
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        retention_days INTEGER,
        expires_at TEXT,
        deleted_at TEXT                          -- tombstone: content purged, dedupe_key kept so it is not re-captured
      );
      CREATE INDEX memory_items_domain_observed ON memory_items (domain, observed_at);
      CREATE INDEX memory_items_source_ref ON memory_items (source, source_ref);
      CREATE INDEX memory_items_scope ON memory_items (scope);
      CREATE INDEX memory_items_expires ON memory_items (expires_at);

      -- Lexical index (bm25). Contentless: the text lives only in memory_items, so a delete there
      -- must delete here too; the triggers below make that impossible to forget.
      CREATE VIRTUAL TABLE memory_fts USING fts5(
        text, content = '', contentless_delete = 1, tokenize = 'porter unicode61'
      );
      CREATE TRIGGER memory_items_unindex_delete AFTER DELETE ON memory_items
      BEGIN
        DELETE FROM memory_fts WHERE rowid = old.seq;
      END;
      CREATE TRIGGER memory_items_unindex_update AFTER UPDATE OF text, deleted_at ON memory_items
      BEGIN
        DELETE FROM memory_fts WHERE rowid = old.seq;
      END;

      -- Per-source ingest state (for example the content hash of a project doc).
      CREATE TABLE memory_sources (
        source_key TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        ingested_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 8,
    name: "agent_runtime",
    sql: `
      -- Phase 31: a persisted trace of every agent task, so a finished run can be replayed and
      -- audited after a restart. Prompts, memory text and tool output are NOT stored here: only
      -- ids, counts, tool names, decisions and the (redacted, size-capped) evidence excerpts.
      CREATE TABLE agent_tasks (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        input TEXT NOT NULL,                 -- JSON, validated by the agent on creation
        requested_by TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX agent_tasks_created ON agent_tasks (created_at);

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES agent_tasks (id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        agent_version TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN
          ('CREATED', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED')),
        failure_reason TEXT,
        outcome TEXT,                        -- JSON: diagnosis, proposals, verification, ai_used (no prompts)
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX agent_runs_task ON agent_runs (task_id);
      CREATE INDEX agent_runs_state ON agent_runs (state);

      -- One row per stage and per tool call, in order.
      CREATE TABLE agent_steps (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('stage', 'tool_call')),
        name TEXT NOT NULL,                  -- stage name, or tool name for a tool call
        status TEXT NOT NULL,                -- ok | failed | skipped | rejected | cancelled | denied
        detail TEXT NOT NULL,                -- JSON of ids/counts only
        policy_audit_id INTEGER,             -- audit row of the policy decision (tool calls)
        decision TEXT,                       -- allow | deny | require_approval
        risk TEXT,
        stage_audit_id INTEGER,              -- audit row written for this step (agent.stage.<name>)
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );
      CREATE INDEX agent_steps_run ON agent_steps (run_id, seq);

      CREATE TABLE agent_evidence (
        run_id TEXT NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
        id TEXT NOT NULL,                    -- short per-run id ("E1"); what a diagnosis cites
        kind TEXT NOT NULL CHECK (kind IN ('tool_output', 'memory', 'commit', 'log', 'model')),
        source TEXT NOT NULL,
        excerpt_hash TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, id)
      );

      -- Evidence copied from memory is a derived copy: forgetting (tombstone), editing or deleting
      -- the memory must blank the copy too. The row stays so a diagnosis' citation still resolves
      -- to "this evidence existed and was removed"; only the text goes.
      CREATE TRIGGER agent_evidence_unmemory_update AFTER UPDATE OF text, deleted_at ON memory_items
      BEGIN
        UPDATE agent_evidence SET excerpt = '', truncated = 0
          WHERE kind = 'memory' AND source = old.id;
      END;
      CREATE TRIGGER agent_evidence_unmemory_delete AFTER DELETE ON memory_items
      BEGIN
        UPDATE agent_evidence SET excerpt = '', truncated = 0
          WHERE kind = 'memory' AND source = old.id;
      END;
    `,
  },
  {
    version: 9,
    name: "meeting_items",
    sql: `
      -- Phase 35: decisions, action items, requirements, topics and project references taken from a
      -- meeting, each reviewable. meeting_id is meetings.id ("<capability>:<external id>"). The
      -- meetings row is only tombstoned, never deleted, so there is no foreign key: the trigger
      -- below removes the items when the tombstone is written.
      CREATE TABLE meeting_items (
        id TEXT PRIMARY KEY,
        meeting_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('decision', 'action_item', 'requirement', 'topic', 'project_ref')),
        text TEXT NOT NULL,
        owner TEXT,                       -- action items; kept only when the evidence supports it
        due TEXT,                         -- action items; free text exactly as said ("Friday")
        status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted', 'edited', 'rejected')),
        extracted_by TEXT NOT NULL CHECK (extracted_by IN ('kage', 'manual') OR extracted_by LIKE 'ai:%'),
        evidence TEXT,                    -- JSON {source, quote, segmentStart?, segmentEnd?, charStart?, charEnd?}
        original TEXT,                    -- JSON {text, owner, due} as extracted, set by the first edit
        dedupe_key TEXT NOT NULL,         -- identity of the extracted text; an edit does not change it
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by TEXT,
        UNIQUE (meeting_id, kind, dedupe_key)
      );
      CREATE INDEX meeting_items_meeting ON meeting_items (meeting_id, kind, status);

      -- Defence in depth: nothing a machine extracted can be stored as anything but proposed.
      CREATE TRIGGER meeting_items_machine_proposed BEFORE INSERT ON meeting_items
      WHEN new.extracted_by <> 'manual' AND new.status <> 'proposed'
      BEGIN
        SELECT RAISE(ABORT, 'extracted items must start as proposed');
      END;

      -- Deleting a meeting (MeetingStore.delete writes a tombstone) removes everything derived from it.
      CREATE TRIGGER meeting_items_meeting_deleted AFTER UPDATE OF deleted_at ON meetings
      WHEN new.deleted_at IS NOT NULL
      BEGIN
        DELETE FROM meeting_items WHERE meeting_id = new.id;
        -- The memory facts made from accepted items go too. Deleting the rows fires the memory
        -- index triggers (lexical, and the vector ones), so nothing derived can be found afterwards.
        DELETE FROM memory_items WHERE source = 'meeting-review' AND source_ref = new.id;
      END;
    `,
  },
  {
    version: 10,
    name: "retrieval_vectors",
    sql: `
      -- Phase 37: embeddings for hybrid retrieval, kept in SQLite with no extension. Vectors are
      -- L2-normalised Float32 little-endian blobs, so cosine similarity is a dot product. A row
      -- belongs to exactly one embedding model; a model change never mixes with another's rows.
      -- There is deliberately no foreign key: the triggers below are the single mechanism that
      -- removes a vector when its memory goes away (like the FTS triggers in version 7), and they
      -- keep working if a connection opens with foreign_keys off.
      CREATE TABLE memory_vectors (
        memory_id TEXT NOT NULL,
        model TEXT NOT NULL,                     -- "<provider>/<model>", as the router reported it
        dim INTEGER NOT NULL CHECK (dim > 0),
        vector BLOB NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, model),
        CHECK (length(vector) = dim * 4)
      ) WITHOUT ROWID;
      CREATE INDEX memory_vectors_model ON memory_vectors (model);

      -- Items whose embedding failed: retried with backoff, never dropped, never block capture.
      CREATE TABLE memory_vector_failures (
        memory_id TEXT NOT NULL,
        model TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        last_error TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL,
        PRIMARY KEY (memory_id, model)
      ) WITHOUT ROWID;

      CREATE TRIGGER memory_items_unvector_delete AFTER DELETE ON memory_items
      BEGIN
        DELETE FROM memory_vectors WHERE memory_id = old.id;
        DELETE FROM memory_vector_failures WHERE memory_id = old.id;
      END;
      CREATE TRIGGER memory_items_unvector_update AFTER UPDATE OF text, deleted_at ON memory_items
      BEGIN
        DELETE FROM memory_vectors WHERE memory_id = old.id;
        DELETE FROM memory_vector_failures WHERE memory_id = old.id;
      END;
    `,
  },
  {
    version: 11,
    name: "knowledge_graph",
    sql: `
      -- Phase 38: a property graph in the same database (ADR-0020). Nodes and edges carry no content of
      -- their own beyond their identity: every descriptive fact lives in kg_provenance, one row per
      -- (source, assertor), together with the scope/domain/sensitivity the source had. A node or edge
      -- exists exactly as long as at least one provenance row does, and a viewer sees it only through a
      -- provenance row they may read. Deleting a source therefore deletes what only it supported.
      CREATE TABLE kg_nodes (
        id TEXT PRIMARY KEY,              -- "<Type>:<natural key>"
        type TEXT NOT NULL CHECK (type IN (
          'Person', 'Project', 'Repository', 'Commit', 'Service', 'Deployment', 'Meeting',
          'Decision', 'Feature', 'Issue', 'PullRequest', 'CIRun', 'Document')),
        key TEXT NOT NULL,
        key_lc TEXT NOT NULL,             -- lower-cased key, for exact seed lookup
        created_at TEXT NOT NULL,
        UNIQUE (type, key)
      );
      CREATE INDEX kg_nodes_key_lc ON kg_nodes (key_lc);

      CREATE TABLE kg_edges (
        id TEXT PRIMARY KEY,              -- "<src>|<REL>|<dst>"
        src TEXT NOT NULL REFERENCES kg_nodes (id) ON DELETE CASCADE,
        rel TEXT NOT NULL CHECK (rel IN (
          'AUTHORED', 'TOUCHES', 'PART_OF', 'DECIDED_IN', 'MENTIONS', 'FIXES', 'DEPLOYED_TO',
          'TRIGGERED', 'ASSIGNED_TO', 'REFERENCES', 'PARTICIPATED_IN')),
        dst TEXT NOT NULL REFERENCES kg_nodes (id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE (src, rel, dst)
      );
      CREATE INDEX kg_edges_dst ON kg_edges (dst, rel);

      CREATE TABLE kg_provenance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_kind TEXT NOT NULL CHECK (subject_kind IN ('node', 'edge')),
        subject_id TEXT NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN
          ('event', 'capability', 'memory', 'meeting', 'meeting_item', 'user')),
        source_id TEXT NOT NULL,          -- event id / memory id / meeting id / meeting item id / capability key
        parent_key TEXT,                  -- "meeting:<id>": the record whose deletion also removes this row
        capability TEXT NOT NULL,         -- who produced the source: git, github, kage, project-docs, user ...
        observed_at TEXT NOT NULL,        -- when the thing happened
        recorded_at TEXT NOT NULL,        -- when Phoenix wrote the row
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
        asserted_by TEXT NOT NULL CHECK (asserted_by IN ('rule', 'capability', 'user') OR asserted_by LIKE 'ai:%'),
        scope TEXT NOT NULL,              -- same vocabulary as memory_items.scope
        domain TEXT NOT NULL,
        sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'internal', 'sensitive')),
        detail TEXT NOT NULL,             -- JSON, small: title, state, url ... descriptive, deleted with the row
        UNIQUE (subject_kind, subject_id, source_kind, source_id, asserted_by)
      );
      CREATE INDEX kg_provenance_subject ON kg_provenance (subject_kind, subject_id);
      CREATE INDEX kg_provenance_source ON kg_provenance (source_kind, source_id);
      CREATE INDEX kg_provenance_parent ON kg_provenance (parent_key);

      -- The user rejected a proposed edge: it is not proposed again.
      CREATE TABLE kg_rejected (
        edge_id TEXT PRIMARY KEY,
        rejected_at TEXT NOT NULL
      );

      -- "Forget this person": a hash of the node id, so ingestion skips them without keeping the name.
      CREATE TABLE kg_suppressed (
        id_hash TEXT PRIMARY KEY,
        suppressed_at TEXT NOT NULL
      );

      -- Existence follows provenance. The last provenance row of an edge or node takes it with it ...
      CREATE TRIGGER kg_provenance_edge_orphan AFTER DELETE ON kg_provenance
      WHEN old.subject_kind = 'edge'
      BEGIN
        DELETE FROM kg_edges WHERE id = old.subject_id
          AND NOT EXISTS (SELECT 1 FROM kg_provenance WHERE subject_kind = 'edge' AND subject_id = old.subject_id);
      END;
      CREATE TRIGGER kg_provenance_node_orphan AFTER DELETE ON kg_provenance
      WHEN old.subject_kind = 'node'
      BEGIN
        DELETE FROM kg_nodes WHERE id = old.subject_id
          AND NOT EXISTS (SELECT 1 FROM kg_provenance WHERE subject_kind = 'node' AND subject_id = old.subject_id);
      END;
      -- ... and removing an edge or node removes its provenance (and, by foreign key, a node's edges).
      CREATE TRIGGER kg_edges_unprovenance AFTER DELETE ON kg_edges
      BEGIN
        DELETE FROM kg_provenance WHERE subject_kind = 'edge' AND subject_id = old.id;
      END;
      CREATE TRIGGER kg_nodes_unprovenance AFTER DELETE ON kg_nodes
      BEGIN
        DELETE FROM kg_provenance WHERE subject_kind = 'node' AND subject_id = old.id;
      END;

      -- Deleting a source removes what it supported, whoever deletes it (the memory store knows nothing
      -- about the graph, exactly as it knows nothing about the lexical index triggers).
      CREATE TRIGGER kg_memory_tombstoned AFTER UPDATE OF deleted_at ON memory_items
      WHEN new.deleted_at IS NOT NULL
      BEGIN
        DELETE FROM kg_provenance WHERE source_kind = 'memory' AND source_id = old.id;
      END;
      CREATE TRIGGER kg_memory_deleted AFTER DELETE ON memory_items
      BEGIN
        DELETE FROM kg_provenance WHERE source_kind = 'memory' AND source_id = old.id;
      END;
      CREATE TRIGGER kg_meeting_deleted AFTER UPDATE OF deleted_at ON meetings
      WHEN new.deleted_at IS NOT NULL
      BEGIN
        DELETE FROM kg_provenance WHERE parent_key = 'meeting:' || new.id;
      END;
      CREATE TRIGGER kg_meeting_item_deleted AFTER DELETE ON meeting_items
      BEGIN
        DELETE FROM kg_provenance WHERE source_kind = 'meeting_item' AND source_id = old.id;
      END;
      CREATE TRIGGER kg_meeting_item_rejected AFTER UPDATE OF status ON meeting_items
      WHEN new.status = 'rejected'
      BEGIN
        DELETE FROM kg_provenance WHERE source_kind = 'meeting_item' AND source_id = old.id;
      END;
    `,
  },
  {
    version: 12,
    name: "workflows",
    sql: `
      -- Definitions are data. The hash is recomputed on every read, so a row edited outside
      -- WorkflowAdmin is noticed and ignored.
      CREATE TABLE workflow_definitions (
        id TEXT PRIMARY KEY,
        definition TEXT NOT NULL,       -- JSON, validated by @phoenix/workflows on write
        hash TEXT NOT NULL,             -- sha256 of the behaviour-defining fields
        version INTEGER NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,    -- epoch ms
        updated_by TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- One row per run. The definition is snapshotted, so history stays truthful after an edit.
      -- UNIQUE (workflow_id, trigger_event_id): the same event never starts two runs.
      CREATE TABLE workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        definition TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'queued', 'running', 'waiting_approval', 'compensating', 'succeeded', 'rejected',
          'failed', 'failed_needs_attention', 'cancelled', 'interrupted', 'refused')),
        trigger_event_id TEXT NOT NULL,
        trigger_event TEXT NOT NULL,    -- JSON, redacted and size-capped
        correlation_id TEXT NOT NULL,   -- workflow-<run id>
        chain_depth INTEGER NOT NULL,   -- how many workflow-emitted events led to this run
        current_step TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        updated_at INTEGER NOT NULL,
        finished_at INTEGER,
        UNIQUE (workflow_id, trigger_event_id)
      );
      CREATE INDEX workflow_runs_workflow ON workflow_runs (workflow_id, created_at);
      CREATE INDEX workflow_runs_status ON workflow_runs (status);

      -- One row per executed step (and per compensation), in execution order.
      CREATE TABLE workflow_run_steps (
        run_id TEXT NOT NULL REFERENCES workflow_runs (id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN ('step', 'compensation')),
        step_type TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        destructive INTEGER NOT NULL DEFAULT 0,   -- decided from the tool contract at run time
        tool TEXT,
        input TEXT,                     -- JSON, redacted and truncated
        output TEXT,                    -- JSON, redacted and truncated
        error TEXT,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        PRIMARY KEY (run_id, seq)
      ) WITHOUT ROWID;
    `,
  },
  {
    version: 13,
    name: "workflow_safety",
    sql: `
      -- A production workflow runs only while an authorisation for its CURRENT hash is live.
      CREATE TABLE workflow_authorisations (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        authorised_by TEXT NOT NULL,
        authorised_at INTEGER NOT NULL,
        expires_at INTEGER,             -- NULL = until revoked or the definition changes
        revoked_at INTEGER,
        revoked_by TEXT
      );
      CREATE INDEX workflow_authorisations_workflow ON workflow_authorisations (workflow_id);

      -- Reliability counters, bumped in the same transaction as the state change they count.
      CREATE TABLE workflow_counters (
        workflow_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value INTEGER NOT NULL,
        PRIMARY KEY (workflow_id, name)
      ) WITHOUT ROWID;
    `,
  },
];
