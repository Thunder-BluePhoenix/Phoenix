// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

export interface ShutdownStep {
  name: string;
  close(): void | Promise<void>;
}

/** Preserve dependency order and release every resource, even if an earlier close fails. */
export async function shutdown(steps: readonly ShutdownStep[]): Promise<void> {
  const errors: Error[] = [];
  for (const step of steps) {
    try {
      await step.close();
    } catch (cause) {
      errors.push(new Error(`Failed to stop ${step.name}`, { cause }));
    }
  }
  if (errors.length) throw new AggregateError(errors, "Phoenix shutdown did not complete cleanly");
}
