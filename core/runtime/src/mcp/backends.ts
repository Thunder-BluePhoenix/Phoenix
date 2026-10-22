// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The real data behind the MCP read tools. Every memory-backed read runs as the CLIENT's viewer
// (built from its grants, see grants.ts), never the owner's: the permission filter runs inside the
// search, before the limit, so a memory outside the grants cannot occupy a slot or change a count.
// Lexical search only: the hybrid (embedding) path is not used for MCP clients.
import { basename } from "node:path";
import {
  answerQuestion,
  GraphQuery,
  type GraphAnswer,
  type KnowledgeGraph,
} from "@phoenix/ai-knowledge-graph";
import {
  buildMatchQuery,
  canView,
  MEMORY_DOMAINS,
  type MemoryItem,
  type MemoryStore,
  type Viewer,
} from "@phoenix/ai-memory";
import { searchMeetings } from "@phoenix/ai-meetings";
import { ToolGatewayError, type ToolGateway } from "@phoenix/ai-tool-gateway";
import type { LiveSessionView } from "@phoenix/api";
import { McpToolError } from "./args";
import { isRecord } from "./guards";
import { basenamesOnly, lastSegment } from "./paths";
import type { McpBackends } from "./tools";

const STEPS_PER_SESSION = 5;
const DOCUMENT_LIMIT = 5;

/** The slice of Core the backends read. The runtime passes the real parts. */
export interface McpBackendSources {
  agentLive: {
    sessions(): LiveSessionView[];
    session(id: string): Promise<{
      steps: { kind: string; tool: string; target: string; at: string }[];
    }>;
  };
  store: MemoryStore;
  graph: KnowledgeGraph;
  gateway: Pick<ToolGateway, "call">;
  meetingsAllowed: () => boolean;
  now: () => Date;
}

const memoryView = (item: MemoryItem, score: number) => ({
  id: item.id,
  source: item.source,
  domain: item.domain,
  kind: item.kind,
  text: item.text,
  observed_at: item.observedAt,
  score,
});

function answerView(a: GraphAnswer): unknown {
  if (a.kind === "why")
    return { kind: "why", subject: a.subject?.label ?? null, paths: a.paths.map((p) => p.text) };
  if (a.kind === "which")
    return {
      kind: "which",
      subject: a.subject?.label ?? null,
      results: a.results.map((r) => ({
        type: r.node.type,
        label: r.node.label,
        path: r.path.text,
      })),
    };
  return {
    kind: "who",
    subject: a.subject?.label ?? null,
    people: a.people.map((p) => ({ person: p.person.label, paths: p.paths.map((x) => x.text) })),
  };
}

/**
 * `git.status` reports each repository's absolute path; a client gets the folder name only, and the
 * free text git printed (an error line, conflicted file names) loses any absolute path in it.
 */
export function gitView(output: unknown): unknown {
  if (!isRecord(output) || !Array.isArray(output.repositories)) return output;
  return {
    repositories: output.repositories.map((repo: unknown) => {
      if (!isRecord(repo)) return null;
      const { path, name, error, conflicts, ...rest } = repo;
      return {
        ...rest,
        name: typeof path === "string" ? lastSegment(path) : String(name ?? ""),
        ...(typeof error === "string" ? { error: basenamesOnly(error) } : {}),
        ...(Array.isArray(conflicts)
          ? { conflicts: conflicts.map((c: unknown) => basenamesOnly(String(c))) }
          : {}),
      };
    }),
  };
}

export function createMcpBackends(s: McpBackendSources): McpBackends {
  const graphQuery = new GraphQuery(s.graph);

  const gitTool = async (clientId: string, tool: string): Promise<unknown> => {
    try {
      const result = await s.gateway.call({
        // Not trusted by the user: the policy sees an agent-origin read and audits it.
        actor: { kind: "agent", id: `mcp:${clientId}`, trustedByUser: false },
        tool,
        input: {},
        environment: "local",
      });
      return {
        available: true,
        ...(typeof result.output === "object"
          ? { data: tool === "git.status" ? gitView(result.output) : result.output }
          : {}),
      };
    } catch (err) {
      // A capability that is off, or a call the policy refused: say so, never why in detail.
      if (err instanceof ToolGatewayError) return { available: false, reason: err.code };
      throw err;
    }
  };

  return {
    async activity(limit) {
      const sessions = s.agentLive.sessions().slice(0, limit);
      return Promise.all(
        sessions.map(async (session) => {
          let recent: { kind: string; tool: string; target: string; at: string }[] = [];
          try {
            recent = (await s.agentLive.session(session.id)).steps.slice(-STEPS_PER_SESSION);
          } catch {
            // The session ended between the two reads; the summary alone is still true.
          }
          return {
            agent: session.agent,
            // The folder name only, never the full path.
            project: basename(session.project),
            active: session.active,
            last_seen: session.last_seen,
            step_count: session.step_count,
            recent_steps: recent.map((r) => ({
              kind: r.kind,
              tool: r.tool,
              // Another agent's work: file and folder names, never the account's directory layout.
              target: basenamesOnly(r.target),
              at: r.at,
            })),
          };
        }),
      );
    },

    meetingsAllowed: s.meetingsAllowed,

    searchMeetings(query, viewer, limit) {
      const found = searchMeetings({ store: s.store, now: s.now }, query, viewer, limit);
      return {
        total: found.total,
        hits: found.hits.map((h) => ({
          meeting: h.citation.meetingId,
          part: h.part,
          origin: h.origin,
          kind: h.kind,
          text: h.text,
          observed_at: h.observedAt,
          freshness: h.freshness,
        })),
      };
    },

    async graphQuery(question, viewer) {
      const answer = await answerQuestion(graphQuery, question, {
        viewer,
        documentLimit: DOCUMENT_LIMIT,
        retriever: async (request) => {
          const match = buildMatchQuery(request.query);
          if (match === null) return [];
          return s.store
            .search({
              match,
              limit: request.limit,
              accept: (item) => canView(request.viewer, item),
            })
            .map((h) => ({
              id: h.item.id,
              text: h.item.text,
              citation: { source: h.item.source, sourceRef: h.item.sourceRef },
              score: h.score,
            }));
        },
      });
      return {
        entities: answer.seeds.map((n) => ({ type: n.type, label: n.label })),
        facts: answer.graph.map(answerView),
        documents: answer.documents.map((d) => ({
          source: d.citation.source,
          text: d.text,
        })),
        notes: answer.notes,
      };
    },

    async gitState(clientId) {
      return {
        git: await gitTool(clientId, "git.status"),
        github: await gitTool(clientId, "github.status"),
      };
    },

    searchMemory(query, viewer: Viewer, domain, limit) {
      if (domain !== undefined && !(MEMORY_DOMAINS as readonly string[]).includes(domain))
        throw new McpToolError("Unknown domain");
      const match = buildMatchQuery(query);
      if (match === null) return { items: [] };
      const hits = s.store.search({
        match,
        ...(domain === undefined ? {} : { domain: domain as MemoryItem["domain"] }),
        limit,
        // The permission filter runs here, before the limit counts the row.
        accept: (item) => canView(viewer, item),
      });
      return { items: hits.map((h) => memoryView(h.item, h.score)) };
    },
  };
}
