// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
//
// The lists Phoenix may download, fixed in code. A list id, its host and its path are never read
// from settings, a request or the environment: a compromised UI or a hand-edited settings file
// cannot point Core's downloader at another address. Only `baseUrl` of the service may replace the
// origin, and only through a code-only option that tests use to reach a loopback fake server.

/** The only origin a production build contacts. */
export const FILTER_LIST_ORIGIN = "https://easylist.to";

export interface FilterListSpec {
  readonly id: string;
  readonly title: string;
  /** What the list is for, one line, shown next to its name. */
  readonly purpose: "ads" | "trackers";
  /** Path on {@link FILTER_LIST_ORIGIN}; never contains a query. */
  readonly path: string;
  readonly homepage: string;
  /** SPDX-style expression of the licences the list is offered under. */
  readonly licence: string;
  readonly licenceUrl: string;
  /** What the licences ask a user of the list to credit. */
  readonly attribution: string;
}

/**
 * EasyList and EasyPrivacy. Licence wording: https://easylist.to/pages/licence.html says the
 * repository content "is dual licensed under the GNU General Public License version 3 of the
 * License, or (at your option) any later version, and Creative Commons Attribution-ShareAlike
 * 3.0 Unported, or (at your option) any later version", and that "The EasyList authors
 * (https://easylist.to/)" should be attributed. Both lists carry `! Licence:
 * https://easylist.to/pages/licence.html` in their own header. Read by hand on 2026-10-24; no
 * list text is stored in this repository.
 */
export const FILTER_LIST_CATALOGUE: readonly FilterListSpec[] = [
  {
    id: "easylist",
    title: "EasyList",
    purpose: "ads",
    path: "/easylist/easylist.txt",
    homepage: "https://easylist.to/",
    licence: "GPL-3.0-or-later OR CC-BY-SA-3.0-or-later",
    licenceUrl: "https://easylist.to/pages/licence.html",
    attribution: "The EasyList authors (https://easylist.to/)",
  },
  {
    id: "easyprivacy",
    title: "EasyPrivacy",
    purpose: "trackers",
    path: "/easylist/easyprivacy.txt",
    homepage: "https://easylist.to/",
    licence: "GPL-3.0-or-later OR CC-BY-SA-3.0-or-later",
    licenceUrl: "https://easylist.to/pages/licence.html",
    attribution: "The EasyList authors (https://easylist.to/)",
  },
];

export function findFilterList(id: string): FilterListSpec | undefined {
  return FILTER_LIST_CATALOGUE.find((spec) => spec.id === id);
}
