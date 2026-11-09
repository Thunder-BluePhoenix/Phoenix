// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { musicPlay as enMusicPlay } from "../../en/music-play";

/** Machine-translated; unreviewed (see ../../README.md). */
export const musicPlay: Record<keyof typeof enMusicPlay, string> = {
  "musicPlay.title": "Поиск музыки",
  "musicPlay.body":
    "Phoenix ничего не воспроизводит и не выбирает результат. Откройте страницу поиска и выберите результат сами.",
  "musicPlay.service": "Сайт: {service}",
  "musicPlay.query": "Искать: {query}",
  "musicPlay.open": "Открыть страницу поиска",
  "musicPlay.checking": "Проверяем, разрешён ли этот сайт…",
  "musicPlay.off":
    "{service} выключен. Включите его в Настройках, в разделе музыкальных сайтов, и повторите запрос.",
  "musicPlay.failed": "Не удалось создать адрес поиска.",
  "musicPlay.refused.unknown_service": "Так можно искать только на SoundCloud, Bandcamp и YouTube.",
  "musicPlay.refused.empty_query": "Скажите или введите, что искать.",
  "musicPlay.refused.too_long": "Этот запрос длиннее {max} символов.",
  "musicPlay.refused.bad_characters": "В этом запросе есть недопустимые символы.",
};
