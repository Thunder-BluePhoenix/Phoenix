// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// A MINIMAL LOCAL SUBSET of the VS Code extension API, hand-written so that `tsc` can check this
// directory's JavaScript without the `@types/vscode` package (this directory has no dependencies and
// no build step). It is NOT the official typings: it declares only what extension.js and src/ use,
// copied by hand from https://code.visualstudio.com/api/references/vscode-api, so it can drift from
// the real API (a signature changed upstream, an omitted member, a narrower interface). When the
// extension starts using another member, add it here; test/vscode-types.test.ts fails until you do.
// Interfaces list only the fields the extension reads, and `engines.vscode` in package.json is the
// version this was written against (^1.80.0).
//
// Reference: https://code.visualstudio.com/api/references/vscode-api

declare module "vscode" {
  /** https://code.visualstudio.com/api/references/vscode-api#Disposable */
  export class Disposable {
    constructor(callOnDispose: () => unknown);
    static from(...disposableLikes: { dispose: () => unknown }[]): Disposable;
    dispose(): unknown;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#Event */
  export interface Event<T> {
    (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: Disposable[]): Disposable;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#Uri (fields read here only) */
  export class Uri {
    readonly fsPath: string;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#ExtensionContext (fields used here only) */
  export interface ExtensionContext {
    readonly subscriptions: { dispose(): unknown }[];
  }

  /** https://code.visualstudio.com/api/references/vscode-api#OutputChannel (members used here only) */
  export interface OutputChannel {
    appendLine(value: string): void;
    dispose(): void;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#DiagnosticSeverity */
  export enum DiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3,
  }

  /** https://code.visualstudio.com/api/references/vscode-api#Diagnostic (fields read here only) */
  export class Diagnostic {
    message: string;
    severity: DiagnosticSeverity;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#TaskDefinition */
  export interface TaskDefinition {
    readonly type: string;
    [name: string]: unknown;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#Task (fields read here only) */
  export class Task {
    definition: TaskDefinition;
    readonly name: string;
    readonly source: string;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#TaskExecution */
  export interface TaskExecution {
    task: Task;
    terminate(): void;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#TaskProcessStartEvent */
  export interface TaskProcessStartEvent {
    readonly execution: TaskExecution;
    readonly processId: number;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#TaskProcessEndEvent */
  export interface TaskProcessEndEvent {
    readonly execution: TaskExecution;
    readonly exitCode: number | undefined;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#DiagnosticChangeEvent */
  export interface DiagnosticChangeEvent {
    readonly uris: readonly Uri[];
  }

  /** https://code.visualstudio.com/api/references/vscode-api#TextDocument (the extension never reads it) */
  export interface TextDocument {
    readonly uri: Uri;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#WorkspaceFolder */
  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#WorkspaceConfiguration (get only) */
  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#window */
  export namespace window {
    function createOutputChannel(name: string): OutputChannel;
    function showInformationMessage(
      message: string,
      ...items: string[]
    ): Thenable<string | undefined>;
    function showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#workspace */
  export namespace workspace {
    const name: string | undefined;
    const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    const isTrusted: boolean;
    function getConfiguration(section?: string): WorkspaceConfiguration;
    const onDidSaveTextDocument: Event<TextDocument>;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#tasks */
  export namespace tasks {
    const onDidStartTaskProcess: Event<TaskProcessStartEvent>;
    const onDidEndTaskProcess: Event<TaskProcessEndEvent>;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#languages */
  export namespace languages {
    function getDiagnostics(): [Uri, Diagnostic[]][];
    const onDidChangeDiagnostics: Event<DiagnosticChangeEvent>;
  }

  /** https://code.visualstudio.com/api/references/vscode-api#commands */
  export namespace commands {
    function registerCommand(
      command: string,
      callback: (...args: unknown[]) => unknown,
      thisArg?: unknown,
    ): Disposable;
  }
}
