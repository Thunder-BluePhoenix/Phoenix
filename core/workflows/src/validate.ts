// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Load-time validation of a workflow definition. Shape (closed JSON Schema) first, then the rules
// a schema cannot express: references, cycles, the declared-permission model, expressions and
// templates, and the Phase 40 rules (destructive steps need a gate, retries only for idempotent
// tools). Tool facts always come from the live tool catalog, never from the definition.
import { isValidPattern } from "@phoenix/event-bus";
import { assessRisk } from "@phoenix/policy";
import { findSecrets, isPermission } from "@phoenix/protocol";
import {
  ExprError,
  expressionPaths,
  isForbiddenKey,
  parseExpression,
  parseTemplate,
  templatePaths,
  type PathRef,
} from "./expr";
import { checkShape } from "./schema";
import {
  DESTRUCTIVE_SIDE_EFFECTS,
  END,
  LIMITS,
  type ActionStep,
  type Step,
  type ToolCatalog,
  type ToolFacts,
  type WorkflowDefinition,
} from "./types";

export type ValidationResult =
  { ok: true; definition: WorkflowDefinition; problems: [] } | { ok: false; problems: string[] };

/** True when running the tool changes state (decided from the tool contract, never the workflow). */
export function isDestructive(facts: ToolFacts): boolean {
  return (
    DESTRUCTIVE_SIDE_EFFECTS[facts.sideEffect] || facts.permissions.includes("production_action")
  );
}

/** Where control may go after a step. Condition defaults: `then` = next in list, `else` = end. */
export function successors(def: WorkflowDefinition, index: number): string[] {
  const step = def.steps[index];
  if (!step || step.type === "result") return [];
  const following = def.steps[index + 1]?.id ?? END;
  if (step.type === "condition") return [step.then ?? following, step.else ?? END];
  return [step.next ?? following];
}

/** Id of the step control moves to after a non-condition step. */
export function nextStepId(def: WorkflowDefinition, index: number): string {
  return successors(def, index)[0] ?? END;
}

interface Graph {
  indexOf: Record<string, number>;
  /** step id -> ids that can run before it. */
  ancestors: Record<string, Record<string, true>>;
}

function buildGraph(def: WorkflowDefinition, problems: string[]): Graph {
  const indexOf: Record<string, number> = Object.create(null) as Record<string, number>;
  def.steps.forEach((s, i) => {
    if (s.id === END || isForbiddenKey(s.id))
      problems.push(`/steps/${i}/id "${s.id}" is reserved`);
    else if (Object.hasOwn(indexOf, s.id)) problems.push(`/steps/${i}/id "${s.id}" is used twice`);
    else indexOf[s.id] = i;
  });
  const ancestors: Graph["ancestors"] = Object.create(null) as Graph["ancestors"];
  for (const s of def.steps) ancestors[s.id] = Object.create(null) as Record<string, true>;

  // Edges, with unknown targets reported once.
  const edges: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  def.steps.forEach((s, i) => {
    const targets = successors(def, i);
    edges[s.id] = targets;
    for (const t of targets) {
      if (t !== END && !Object.hasOwn(indexOf, t))
        problems.push(`/steps/${i} points at unknown step "${t}"`);
    }
  });

  // Cycles are refused outright: a bounded loop would need a counter the language does not have.
  const state: Record<string, 1 | 2> = Object.create(null) as Record<string, 1 | 2>;
  const visit = (id: string, depth: number): boolean => {
    if (state[id] === 1) return true;
    if (state[id] === 2) return false;
    if (depth > LIMITS.maxSteps) return true;
    state[id] = 1;
    for (const t of edges[id] ?? [])
      if (t !== END && Object.hasOwn(indexOf, t) && visit(t, depth + 1)) return true;
    state[id] = 2;
    return false;
  };
  const first = def.steps[0]?.id;
  if (first !== undefined && visit(first, 0))
    problems.push("/steps contain a cycle; workflows may only move forward");

  // Reachability and ancestors (DAG once the cycle check passed; guarded by a pass limit anyway).
  const reached: Record<string, true> = Object.create(null) as Record<string, true>;
  const stack: { id: string; trail: string[] }[] =
    first === undefined ? [] : [{ id: first, trail: [] }];
  let longest = 0;
  let budget = 20_000;
  while (stack.length > 0 && budget-- > 0) {
    const { id, trail } = stack.pop()!;
    if (!Object.hasOwn(indexOf, id)) continue;
    reached[id] = true;
    longest = Math.max(longest, trail.length + 1);
    if (trail.length >= LIMITS.maxSteps) continue;
    const anc = ancestors[id]!;
    for (const t of trail) anc[t] = true;
    for (const t of edges[id] ?? []) if (t !== END) stack.push({ id: t, trail: [...trail, id] });
  }
  if (longest > LIMITS.maxPathLength)
    problems.push(`/steps the longest path is ${longest} steps (limit ${LIMITS.maxPathLength})`);
  def.steps.forEach((s, i) => {
    if (!reached[s.id]) problems.push(`/steps/${i} "${s.id}" can never run`);
  });
  return { indexOf, ancestors };
}

/** Walks JSON given as an action input: depth, size, key names, secrets and templates. */
function checkInputValue(
  value: unknown,
  path: string,
  check: { problems: string[]; nodes: number; paths: PathRef[] },
  depth = 0,
): void {
  if (++check.nodes > LIMITS.maxInputNodes) {
    if (check.nodes === LIMITS.maxInputNodes + 1)
      check.problems.push(`${path} has more than ${LIMITS.maxInputNodes} values`);
    return;
  }
  if (depth > LIMITS.maxInputDepth) {
    check.problems.push(`${path} is nested deeper than ${LIMITS.maxInputDepth}`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > LIMITS.maxTemplateLength)
      check.problems.push(`${path} is longer than ${LIMITS.maxTemplateLength} characters`);
    else {
      try {
        check.paths.push(...templatePaths(parseTemplate(value)));
      } catch (err) {
        check.problems.push(`${path} ${err instanceof ExprError ? err.message : "is invalid"}`);
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((v: unknown, i) => checkInputValue(v, `${path}/${i}`, check, depth + 1));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (isForbiddenKey(k)) check.problems.push(`${path} may not have a key "${k}"`);
      else if (k.length > 100) check.problems.push(`${path} has a key longer than 100 characters`);
      else checkInputValue(v, `${path}/${k}`, check, depth + 1);
    }
  } else if (typeof value === "number" && !Number.isFinite(value)) {
    check.problems.push(`${path} is not a finite number`);
  }
}

/** Reads of `steps.<id>` must name a step that can have run before the reading step. */
function checkPaths(
  paths: readonly PathRef[],
  stepId: string | undefined,
  graph: Graph,
  where: string,
  problems: string[],
  selfOk = false,
): void {
  for (const p of paths) {
    if (stepId === undefined && p.root !== "event") {
      problems.push(`${where} may only read "event"`);
      continue;
    }
    if (p.root !== "steps") continue;
    const target = p.segments[0];
    if (typeof target !== "string" || !Object.hasOwn(graph.indexOf, target)) {
      problems.push(`${where} reads steps.${String(target)}, which is not a step`);
    } else if (
      stepId !== undefined &&
      graph.ancestors[stepId]?.[target] !== true &&
      !(selfOk && target === stepId)
    ) {
      problems.push(`${where} reads steps.${target}, which never runs before this step`);
    }
  }
}

function checkExpression(
  src: string,
  stepId: string | undefined,
  graph: Graph,
  where: string,
  problems: string[],
): void {
  try {
    checkPaths(expressionPaths(parseExpression(src)), stepId, graph, where, problems);
  } catch (err) {
    problems.push(`${where} ${err instanceof ExprError ? err.message : "is invalid"}`);
  }
}

function checkTemplate(
  src: string,
  stepId: string,
  graph: Graph,
  where: string,
  problems: string[],
): void {
  try {
    checkPaths(templatePaths(parseTemplate(src)), stepId, graph, where, problems);
  } catch (err) {
    problems.push(`${where} ${err instanceof ExprError ? err.message : "is invalid"}`);
  }
}

/** Step ids from which an approval has NOT necessarily been given: reachable without crossing one. */
export function ungatedSteps(def: WorkflowDefinition): Record<string, true> {
  const open: Record<string, true> = Object.create(null) as Record<string, true>;
  const indexOf: Record<string, number> = Object.create(null) as Record<string, number>;
  def.steps.forEach((s, i) => (indexOf[s.id] = i));
  const first = def.steps[0]?.id;
  const stack = first === undefined ? [] : [first];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (open[id] === true || !Object.hasOwn(indexOf, id)) continue;
    open[id] = true;
    const step = def.steps[indexOf[id]!]!;
    // The approval step itself is reached ungated, but nothing after it is.
    if (step.type === "approval") continue;
    for (const t of successors(def, indexOf[id]!)) if (t !== END) stack.push(t);
  }
  return open;
}

/**
 * Whether running this workflow needs an explicit user authorisation (Phase 40): it targets
 * production, or any tool it can call is production-class or critical in this environment.
 * A tool the catalog does not know counts as needing it (fail closed).
 */
export function requiresAuthorisation(
  def: WorkflowDefinition,
  catalog: ToolCatalog,
): { required: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (def.environment === "production") reasons.push('environment is "production"');
  const names: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const t of def.declares.tools) names[t] = true;
  for (const s of def.steps) {
    if (s.type !== "action") continue;
    names[s.tool] = true;
    if (s.compensate) names[s.compensate.tool] = true;
  }
  for (const name of Object.keys(names)) {
    const facts = catalog(name);
    if (!facts) {
      reasons.push(`tool ${name} is unknown, so its risk cannot be assessed`);
      continue;
    }
    const permissions = facts.permissions.filter(isPermission);
    const { risk } = assessRisk({
      sideEffect: facts.sideEffect,
      permissions,
      environment: def.environment,
    });
    if (risk === "critical") reasons.push(`${name} is critical risk here`);
    else if (facts.sideEffect === "production" || permissions.includes("production_action"))
      reasons.push(`${name} is a production action`);
  }
  return { required: reasons.length > 0, reasons };
}

function actionProblems(
  step: ActionStep,
  i: number,
  def: WorkflowDefinition,
  graph: Graph,
  catalog: ToolCatalog | undefined,
  gated: Record<string, true>,
  problems: string[],
): void {
  const declared = def.declares.tools;
  const at = `/steps/${i}`;
  if (!declared.includes(step.tool))
    problems.push(`${at}/tool "${step.tool}" is not listed in declares.tools`);
  const check = { problems, nodes: 0, paths: [] as PathRef[] };
  checkInputValue(step.input ?? {}, `${at}/input`, check);
  checkPaths(check.paths, step.id, graph, `${at}/input`, problems);

  const facts = catalog?.(step.tool);
  if (catalog && !facts) problems.push(`${at}/tool "${step.tool}" is not an available tool`);
  if (facts && isDestructive(facts) && gated[step.id] === true)
    problems.push(
      `${at} calls ${step.tool} (${facts.sideEffect}) and can run before any approval step`,
    );
  if (step.retry && facts && !facts.idempotent)
    problems.push(`${at}/retry is not allowed: ${step.tool} is not idempotent`);

  const undo = step.compensate;
  if (!undo) return;
  if (!declared.includes(undo.tool))
    problems.push(`${at}/compensate/tool "${undo.tool}" is not listed in declares.tools`);
  const undoCheck = { problems, nodes: 0, paths: [] as PathRef[] };
  checkInputValue(undo.input ?? {}, `${at}/compensate/input`, undoCheck);
  checkPaths(undoCheck.paths, step.id, graph, `${at}/compensate/input`, problems, true);
  const undoFacts = catalog?.(undo.tool);
  if (catalog && !undoFacts)
    problems.push(`${at}/compensate/tool "${undo.tool}" is not an available tool`);
  // An undo that changes state is only as safe as the step it undoes: that step must be gated.
  if (undoFacts && isDestructive(undoFacts) && gated[step.id] === true)
    problems.push(`${at}/compensate changes state but its step can run before any approval step`);
  if (facts && !isDestructive(facts))
    problems.push(
      `${at}/compensate is only for steps that change something; ${step.tool} does not`,
    );
}

function stepProblems(
  step: Step,
  i: number,
  def: WorkflowDefinition,
  graph: Graph,
  catalog: ToolCatalog | undefined,
  gated: Record<string, true>,
  problems: string[],
): void {
  const at = `/steps/${i}`;
  switch (step.type) {
    case "condition":
      checkExpression(step.if, step.id, graph, `${at}/if`, problems);
      break;
    case "lookup":
      if (def.declares.context !== true)
        problems.push(`${at} looks up context but declares.context is not true`);
      checkTemplate(step.query, step.id, graph, `${at}/query`, problems);
      break;
    case "ai":
      if (!def.declares.ai) problems.push(`${at} is an ai step but declares.ai is false`);
      for (const [name, tpl] of Object.entries(step.data ?? {}))
        checkTemplate(tpl, step.id, graph, `${at}/data/${name}`, problems);
      break;
    case "action":
      actionProblems(step, i, def, graph, catalog, gated, problems);
      break;
    case "approval":
      checkTemplate(step.summary, step.id, graph, `${at}/summary`, problems);
      break;
    case "notify":
      checkTemplate(step.title, step.id, graph, `${at}/title`, problems);
      checkTemplate(step.message, step.id, graph, `${at}/message`, problems);
      break;
    case "result":
      checkTemplate(step.summary, step.id, graph, `${at}/summary`, problems);
      break;
  }
}

/**
 * Validates an untrusted value as a workflow definition. With a `catalog`, tool facts are
 * checked too (existence, destructive gating, idempotent retries); without one only the
 * structure is. Never throws and never executes anything.
 */
export function validateDefinition(value: unknown, catalog?: ToolCatalog): ValidationResult {
  let size: number;
  try {
    size = JSON.stringify(value)?.length ?? 0;
  } catch {
    return { ok: false, problems: ["/ is not JSON data"] };
  }
  if (size > LIMITS.maxDefinitionBytes)
    return { ok: false, problems: [`/ is larger than ${LIMITS.maxDefinitionBytes} bytes`] };
  const shape = checkShape(value);
  if (shape.length > 0) return { ok: false, problems: shape.slice(0, 30) };
  const def = value as WorkflowDefinition; // checkShape proved the shape above
  const problems: string[] = [];

  const secrets = findSecrets(def, "$");
  if (secrets.length > 0)
    problems.push(`/ contains what looks like a credential at ${secrets.slice(0, 3).join(", ")}`);
  if (def.trigger.event === "*" || !isValidPattern(def.trigger.event))
    problems.push("/trigger/event must be an event type or a prefix like build.*, not *");
  const toolSet: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const t of def.declares.tools) {
    if (toolSet[t]) problems.push(`/declares/tools lists ${t} twice`);
    toolSet[t] = true;
  }
  const graph = buildGraph(def, problems);
  if (def.trigger.where !== undefined)
    checkExpression(def.trigger.where, undefined, graph, "/trigger/where", problems);

  const gated =
    problems.length === 0 ? ungatedSteps(def) : (Object.create(null) as Record<string, true>);
  def.steps.forEach((s, i) => stepProblems(s, i, def, graph, catalog, gated, problems));
  // Declared but never used tools widen the permission surface for nothing.
  const used: Record<string, true> = Object.create(null) as Record<string, true>;
  for (const s of def.steps) {
    if (s.type !== "action") continue;
    used[s.tool] = true;
    if (s.compensate) used[s.compensate.tool] = true;
  }
  for (const t of def.declares.tools)
    if (used[t] !== true) problems.push(`/declares/tools lists ${t} but no step uses it`);

  return problems.length > 0
    ? { ok: false, problems: problems.slice(0, 40) }
    : { ok: true, definition: def, problems: [] };
}
