// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { signals as ensignals } from "../../en/signals";

/** Machine-translated; unreviewed. */
export const signals: Record<keyof typeof ensignals, string> = {
  "signals.title": "Инженерные сигналы",
  "signals.intro":
    "Проверяйте уведомления о зависимостях, нестабильные тесты, тенденции длительности и расхождения ключей конфигурации в выбранных репозиториях. Чтение не изменяет файлы.",
  "signals.root": "Папка репозитория",
  "signals.add": "Отслеживать папку",
  "signals.remove": "Прекратить отслеживание",
  "signals.refresh": "Проверить сейчас",
  "signals.empty": "В отслеживаемых репозиториях нет актуальных сигналов.",
  "signals.unconfigured": "Выберите папку репозитория для отслеживания.",
  "signals.error": "Не удалось прочитать инженерные сигналы.",
  "signals.advisory": "Уведомление о зависимости",
  "signals.flaky_test": "Нестабильный тест",
  "signals.duration_trend": "Увеличение длительности",
  "signals.config_drift": "Отсутствует ключ конфигурации",
  "signals.optin":
    "Проактивные уведомления требуют явного согласия и соблюдают тихие часы и почасовой лимит.",
  "signals.privacy": "Сравниваются только имена ключей; значения никогда не отображаются.",
  "signals.unknown.advisories":
    "Уведомления о зависимостях не оценены (статус неизвестен, не «чисто»):",
  "signals.unknown.history":
    "История тестов и тенденции длительности не оценены (статус неизвестен, не «чисто»):",
};
