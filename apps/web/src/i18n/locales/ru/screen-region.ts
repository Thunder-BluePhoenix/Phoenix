// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Снимок области для задачи",
  "screenRegion.intro":
    "Нажмите «Выбрать область экрана», подтвердите в «Подтверждениях» и выделите нужную область системным инструментом (Esc отменяет). Только macOS. Изображение остаётся на этой странице и не сохраняется; задача создаётся только как текст, в GitHub, после повторного подтверждения.",
  "screenRegion.unavailable":
    "Снимок области отключён. Включите возможность «Снимок области экрана» и разрешите захват экрана. Работает только в macOS.",
  "screenRegion.cancelled": "Вы отменили выбор, ничего не снято.",
  "screenRegion.declined": "Вы отклонили запрос, ничего не снято.",
  "screenRegion.blocked": "Включена аварийная остановка, ничего не снято.",
  "screenRegion.timeout": "Область не выбрана вовремя или запрос не подтверждён; ничего не снято.",
  "screenRegion.failed": "Не удалось снять область: {message}",
  "screenRegion.badImage": "Снимок не был корректным PNG-изображением и отброшен.",
  "screenRegion.tooLarge": "Снятая область больше 5 МиБ и отброшена.",
  "screenRegion.unsupported": "Снимок области поддерживается только в macOS.",
  "screenRegion.expired": "Снимок больше недоступен. Выберите область снова.",
  "screenRegion.trackerUnsupported":
    "Отсюда задачу может создать только GitHub; Linear и Jira пока нет, поэтому ничего не отправлено.",
};
