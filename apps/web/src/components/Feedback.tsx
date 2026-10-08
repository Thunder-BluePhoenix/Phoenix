// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors

/** An error as an alert, or a success note as a status; nothing when neither is set. */
export function Feedback({ error, saved }: { error: string | null; saved?: string | null }) {
  if (error)
    return (
      <p className="error-text small" role="alert">
        {error}
      </p>
    );
  return saved ? (
    <p className="small" role="status">
      {saved}
    </p>
  ) : null;
}
