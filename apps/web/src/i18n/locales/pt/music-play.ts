// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "Pesquisar música",
  "musicPlay.body":
    "O Phoenix não reproduz nada nem escolhe um resultado. Abra a página de pesquisa e escolha você mesmo um resultado.",
  "musicPlay.service": "Site: {service}",
  "musicPlay.query": "Pesquisar: {query}",
  "musicPlay.open": "Abrir a página de pesquisa",
  "musicPlay.checking": "Verificando se este site é permitido…",
  "musicPlay.off":
    "{service} está desativado. Ative em Configurações, em sites de música, e peça de novo.",
  "musicPlay.failed": "Não foi possível criar o endereço de pesquisa.",
  "musicPlay.refused.unknown_service":
    "Só é possível pesquisar assim no SoundCloud, no Bandcamp e no YouTube.",
  "musicPlay.refused.empty_query": "Diga ou digite o que pesquisar.",
  "musicPlay.refused.too_long": "Essa pesquisa tem mais de {max} caracteres.",
  "musicPlay.refused.bad_characters": "Essa pesquisa tem caracteres não permitidos.",
};
