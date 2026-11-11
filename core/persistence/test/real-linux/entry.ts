// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// Bundling entry for the manual Linux harness (run-in-container.sh): the production secret store and
// the production provider-key reference function, bundled into one CJS file by esbuild.
export { KeychainSecretStore, SecretTooLongError } from "../../src/secret-store";
export { secretRef } from "../../../runtime/src/ai";
