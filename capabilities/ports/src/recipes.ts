// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Restart recipes: the ONLY thing `restart_process` can start. A recipe is written by the owner in
// this capability's config: a name, an absolute executable with fixed arguments, a working folder
// inside folders the owner declared, and the ports it serves. Phoenix NEVER reconstructs a command
// from what `ps` or `lsof` print about a running process (any local process can set its own argv
// and title): the process is only matched to a recipe by a port the owner declared, and what is
// started is the owner's text, shown in full in the approval prompt.
//
//   - no shell: the executable may not be a shell, nothing is joined or parsed, argv goes to the OS as an array;
//   - nothing is inherited: the new process gets a short fixed environment (`RESTART_BASE_ENV`) and no more;
//   - the executable and the folder are looked at again, with symlinks resolved, right before the start.
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { isRecord } from "./guards";
import { PortsError, type PortsEnv } from "./types";

export const MAX_RECIPES = 8;
export const MAX_ARGV = 16;
export const MAX_ROOTS = 8;
export const MAX_RECIPE_PORTS = 8;
/**
 * The approval prompt clips every shown value at 80 characters. A recipe whose argv or folder does
 * not fit is refused, so the prompt can never hide the end of what will run.
 */
export const MAX_SHOWN_CHARS = 80;
export const MIN_RECIPE_PORT = 1024;

/** The names copied from Core's own environment into a restarted process; nothing else is. */
export const RESTART_BASE_ENV: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TMPDIR",
];

export const RECIPE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** Control, format, line and paragraph separator characters: the prompt strips them, so they are refused. */
const UNSHOWN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Interpreters that would turn an argument into a command line. A guard against mistakes, not a boundary. */
const SHELLS: Readonly<Record<string, true>> = {
  sh: true,
  bash: true,
  zsh: true,
  dash: true,
  fish: true,
  ksh: true,
  csh: true,
  tcsh: true,
  ash: true,
  busybox: true,
  cmd: true,
  "cmd.exe": true,
  powershell: true,
  pwsh: true,
};

export interface RestartRecipe {
  /** Absolute executable followed by fixed arguments. */
  argv: string[];
  /** Absolute working folder, inside one of the declared roots. */
  cwd: string;
  /** Ports the owner says this program serves: how a listening process is matched to the recipe. */
  ports: number[];
}

export type RecipeTable = Record<string, RestartRecipe>;

export interface RecipeConfig {
  recipes: RecipeTable;
  roots: string[];
  /** One line per problem; a recipe with a problem is not usable. */
  problems: string[];
}

/** True for a normalised absolute POSIX path: no `..`, `.`, double or trailing slashes. */
export function isCleanAbsolute(path: string): boolean {
  return isAbsolute(path) && resolve(path) === path && !UNSHOWN.test(path);
}

/** The argv exactly as the approval prompt shows it: JSON, so spaces and quotes stay visible. */
export function renderArgv(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

function strings(
  value: unknown,
  label: string,
  max: number,
  problems: string[],
): string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    problems.push(`${label} must be an array of 1 to ${max} strings`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > MAX_SHOWN_CHARS) {
      problems.push(`${label} entries must be strings of 1 to ${MAX_SHOWN_CHARS} characters`);
      return undefined;
    }
    if (UNSHOWN.test(item)) {
      problems.push(`${label} entries must not contain control or invisible characters`);
      return undefined;
    }
    out.push(item);
  }
  return out;
}

function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const RECIPE_KEYS: readonly string[] = ["argv", "cwd", "ports"];

function checkRecipe(
  name: string,
  raw: unknown,
  roots: readonly string[],
  claimed: Map<number, string>,
  problems: string[],
): RestartRecipe | undefined {
  const at = `recipe "${name}"`;
  if (!RECIPE_NAME.test(name)) {
    problems.push(`${at}: the name must be a short slug (letters, digits, . _ -)`);
    return undefined;
  }
  if (!isRecord(raw)) {
    problems.push(`${at} must be an object`);
    return undefined;
  }
  const before = problems.length;
  for (const key of Object.keys(raw)) {
    if (!RECIPE_KEYS.includes(key)) problems.push(`${at}: unknown field "${key}"`);
  }
  const argv = strings(raw.argv, `${at}: argv`, MAX_ARGV, problems);
  if (argv) {
    const exe = argv[0]!;
    if (!isCleanAbsolute(exe)) {
      problems.push(`${at}: the executable must be a normalised absolute path`);
    } else if (SHELLS[basename(exe).toLowerCase()] === true) {
      problems.push(
        `${at}: a shell cannot be a restart executable (use a program or a script file)`,
      );
    }
    if (renderArgv(argv).length > MAX_SHOWN_CHARS) {
      problems.push(
        `${at}: argv is too long to show in full in the approval prompt (${MAX_SHOWN_CHARS} characters as JSON)`,
      );
    }
  }
  const cwd = raw.cwd;
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > MAX_SHOWN_CHARS) {
    problems.push(`${at}: cwd must be a string of 1 to ${MAX_SHOWN_CHARS} characters`);
  } else if (!isCleanAbsolute(cwd) || cwd.includes("*")) {
    problems.push(`${at}: cwd must be a normalised absolute path without wildcards`);
  } else if (!roots.some((root) => inside(cwd, root))) {
    problems.push(`${at}: cwd is not inside any restart_roots folder`);
  }
  let ports: number[] | undefined;
  if (
    !Array.isArray(raw.ports) ||
    raw.ports.length < 1 ||
    raw.ports.length > MAX_RECIPE_PORTS ||
    !raw.ports.every(
      (p) => typeof p === "number" && Number.isSafeInteger(p) && p >= MIN_RECIPE_PORT && p <= 65535,
    )
  ) {
    problems.push(
      `${at}: ports must be 1 to ${MAX_RECIPE_PORTS} integers from ${MIN_RECIPE_PORT} to 65535`,
    );
  } else {
    ports = [...new Set(raw.ports as number[])];
    for (const p of ports) {
      const owner = claimed.get(p);
      if (owner !== undefined) {
        problems.push(`${at}: port ${p} already belongs to recipe "${owner}"`);
        ports = undefined;
        break;
      }
    }
  }
  if (problems.length > before || !argv || typeof cwd !== "string" || !ports) return undefined;
  for (const p of ports) claimed.set(p, name);
  return { argv, cwd, ports };
}

/**
 * Validates the `restart_roots` and `restart_recipes` config values. Never throws: usable recipes
 * come back and every problem is listed. A hostile or mistyped recipe is simply not usable, so it
 * can never be matched to a process or started.
 */
export function parseRecipes(config: Readonly<Record<string, unknown>>): RecipeConfig {
  const problems: string[] = [];
  const recipes: RecipeTable = Object.create(null) as RecipeTable;
  const roots: string[] = [];
  const rawRecipes = config.restart_recipes;
  if (rawRecipes === undefined) return { recipes, roots, problems };
  if (!isRecord(rawRecipes)) {
    return { recipes, roots, problems: ["restart_recipes must be an object"] };
  }
  const rawRoots = config.restart_roots;
  if (!Array.isArray(rawRoots) || rawRoots.length < 1 || rawRoots.length > MAX_ROOTS) {
    return {
      recipes,
      roots,
      problems: [`restart_roots must list 1 to ${MAX_ROOTS} folders when recipes are configured`],
    };
  }
  for (const root of rawRoots) {
    if (typeof root !== "string" || root.length > 1000 || !isCleanAbsolute(root)) {
      problems.push("restart_roots must be normalised absolute paths");
    } else if (root === dirname(root)) {
      problems.push("restart_roots must not be the filesystem root");
    } else if (root.includes("*")) {
      problems.push('restart_roots must not contain "*"');
    } else {
      roots.push(root);
    }
  }
  const names = Object.keys(rawRecipes);
  if (names.length > MAX_RECIPES) {
    return {
      recipes,
      roots,
      problems: [`at most ${MAX_RECIPES} restart recipes may be configured`],
    };
  }
  const claimed = new Map<number, string>();
  for (const name of names) {
    const recipe = checkRecipe(name, rawRecipes[name], roots, claimed, problems);
    if (recipe) recipes[name] = recipe;
  }
  return { recipes, roots, problems };
}

/** What a restart will start, looked at on the real file system at this moment. */
export interface RestartPlan {
  /** The executable's real path (symlinks resolved): this, not the configured path, is run. */
  file: string;
  args: string[];
  /** The working folder's real path, inside a declared root. */
  cwd: string;
}

const refuse = (message: string) => new PortsError("refused", message);

/**
 * Looks at the real executable and folder NOW and refuses anything unsafe: Core running as root or
 * on Windows, an executable that is missing, not a regular executable file, writable by everyone
 * (or in such a folder without the sticky bit), and a folder that is missing, not a directory or,
 * once symlinks are followed, outside every declared root.
 */
export async function resolvePlan(
  env: PortsEnv,
  recipe: RestartRecipe,
  roots: readonly string[],
): Promise<RestartPlan> {
  if (env.platform === "win32" || env.uid < 0) {
    throw new PortsError("unsupported", "Restarting is not available on this system.");
  }
  if (env.uid === 0) throw refuse("Phoenix will not start a program while it runs as root.");
  const exe = await env.inspect(recipe.argv[0]!);
  if (exe === undefined || exe.kind !== "file" || (exe.mode & 0o111) === 0) {
    throw refuse("The recipe's executable does not exist or is not an executable file.");
  }
  if ((exe.mode & 0o002) !== 0) throw refuse("The recipe's executable is writable by everyone.");
  const dir = await env.inspect(dirname(exe.real));
  if (dir === undefined || ((dir.mode & 0o002) !== 0 && (dir.mode & 0o1000) === 0)) {
    throw refuse("The recipe's executable sits in a folder writable by everyone.");
  }
  const cwd = await env.inspect(recipe.cwd);
  if (cwd === undefined || cwd.kind !== "directory") {
    throw refuse("The recipe's folder does not exist.");
  }
  let allowed = false;
  for (const root of roots) {
    const real = await env.inspect(root);
    if (real?.kind === "directory" && inside(cwd.real, real.real)) {
      allowed = true;
      break;
    }
  }
  if (!allowed)
    throw refuse("The recipe's folder is outside the folders you allowed for restarts.");
  return { file: exe.real, args: recipe.argv.slice(1), cwd: cwd.real };
}

/** The whole environment of a restarted process. Only `RESTART_BASE_ENV` names, plus two fixed ones. */
export function restartEnv(source: Readonly<Record<string, string | undefined>>) {
  const env: Record<string, string> = { TERM: "dumb", NO_COLOR: "1" };
  for (const name of RESTART_BASE_ENV) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
