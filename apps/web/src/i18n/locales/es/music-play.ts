// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "Buscar música",
  "musicPlay.body":
    "Phoenix no reproduce nada ni elige un resultado. Abre la página de búsqueda y elige tú un resultado.",
  "musicPlay.service": "Sitio: {service}",
  "musicPlay.query": "Buscar: {query}",
  "musicPlay.open": "Abrir la página de búsqueda",
  "musicPlay.checking": "Comprobando que este sitio está permitido…",
  "musicPlay.off":
    "{service} está desactivado. Actívalo en Ajustes, en sitios de música, y vuelve a pedirlo.",
  "musicPlay.failed": "No se pudo crear la dirección de búsqueda.",
  "musicPlay.refused.unknown_service":
    "Solo se puede buscar así en SoundCloud, Bandcamp y YouTube.",
  "musicPlay.refused.empty_query": "Di o escribe qué buscar.",
  "musicPlay.refused.too_long": "Esa búsqueda tiene más de {max} caracteres.",
  "musicPlay.refused.bad_characters": "Esa búsqueda contiene caracteres no permitidos.",
};
