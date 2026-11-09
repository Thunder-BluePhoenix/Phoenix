// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "Rechercher de la musique",
  "musicPlay.body":
    "Phoenix ne lit rien et ne choisit aucun résultat. Ouvrez la page de recherche et choisissez vous-même un résultat.",
  "musicPlay.service": "Site : {service}",
  "musicPlay.query": "Recherche : {query}",
  "musicPlay.open": "Ouvrir la page de recherche",
  "musicPlay.checking": "Vérification que ce site est autorisé…",
  "musicPlay.off":
    "{service} est désactivé. Activez-le dans Réglages, sous sites de musique, puis redemandez.",
  "musicPlay.failed": "L’adresse de recherche n’a pas pu être créée.",
  "musicPlay.refused.unknown_service":
    "Seuls SoundCloud, Bandcamp et YouTube peuvent être recherchés ainsi.",
  "musicPlay.refused.empty_query": "Dites ou saisissez ce qu’il faut chercher.",
  "musicPlay.refused.too_long": "Cette recherche dépasse {max} caractères.",
  "musicPlay.refused.bad_characters": "Cette recherche contient des caractères non autorisés.",
};
