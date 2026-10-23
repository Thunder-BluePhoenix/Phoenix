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
export const FAKE_STRIPE_KEY = join("s", "k_", "live_", "abcdefghijklmnop0123");
export const FAKE_GITLAB_TOKEN = join("gl", "pat-", "abcdefghijklmnopqrst");
export const FAKE_NPM_TOKEN = join("np", "m_", "abcdefghijklmnopqrstuvwxyz0123456789");
export const FAKE_JWT = join(
  "ey",
  "JhbGciOiJIUzI1NiJ9",
  ".",
  "ey",
  "JzdWIiOiJmYXdrZXMifQ",
  ".",
  "c2lnbmF0dXJlMTIz",
);
/** A Stripe test-mode key: the detector deliberately does not match it. */
export const FAKE_STRIPE_TEST_KEY = join("s", "k_", "test_", "abcdefghijklmnop0123");
export const GITHUB_TOKEN_PREFIX = join("gh", "p_");
