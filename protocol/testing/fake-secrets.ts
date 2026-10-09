// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Fake credentials for tests. They are assembled at runtime so that no
// token-shaped literal exists in the source tree (keeps secret scanners quiet).

const join = (...parts: string[]) => parts.join("");

export const FAKE_BEARER = join("Bear", "er ", "abcdefghijklmnop");
export const FAKE_GITHUB_TOKEN = join("gh", "p_", "abcdefghijklmnopqrstuvwxyz0123");
export const FAKE_OPENAI_KEY = join("s", "k-", "abcdefghijklmnopqrstuvwx");
export const FAKE_AWS_KEY = join("AK", "IA", "ABCDEFGHIJKLMNOP");
export const GITHUB_TOKEN_PREFIX = join("gh", "p_");
