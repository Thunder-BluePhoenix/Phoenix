// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Снимок области для задачи",
  "screenRegion.intro":
    "Нажмите «Выбрать область экрана», подтвердите в «Одобрениях» и выделите нужную область системным инструментом (Esc отменяет). Только macOS. Изображение остаётся на этой странице и не сохраняется. Сама задача создаётся только текстом, после вашего одобрения. Для Linear и Jira затем можно отдельным шагом, с отдельным подтверждением, прикрепить к ней скрытое изображение; GitHub — только текст.",
  "screenRegion.projectLabel":
    "Репозиторий GitHub (owner/name), ID команды Linear или ключ проекта Jira",
  "screenRegion.linearTeamInvalid":
    "ID команды Linear выглядит как 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f; ничего не отправлено.",
  "screenRegion.jiraProjectInvalid":
    "Ключ проекта Jira состоит из заглавных букв, цифр или подчёркиваний, например PROJ; ничего не отправлено.",
  "screenRegion.issuesUnavailable":
    "Возможность «Трекеры задач» выключена или в ней нет команд создания и вложения; ничего не отправлено. Сначала включите её.",
  "screenRegion.issuesNoWriteCredential":
    "Для {tracker} в «Трекерах задач» не задан ключ записи (ключи опроса никогда не используются для записи); ничего не отправлено.",
  "screenRegion.issueKeyInvalid": "Это не допустимый ключ задачи; ничего не отправлено.",
  "focus.screenshot.textOnly":
    "Задача создаётся только текстом. Снимок в неё не входит; для Linear и Jira его можно предложить отдельно после этого.",
  "focus.screenshot.attach.title": "Прикрепить снимок (по желанию)",
  "focus.screenshot.attach.intro":
    "Задача {key} в {tracker} создана без изображения. Теперь можно прикрепить к ней скрытый снимок. Это отдельная загрузка, и Core снова попросит вас одобрить её. GitHub изображение не получает никогда.",
  "focus.screenshot.attach.prepare": "Показать, что будет прикреплено",
  "focus.screenshot.attach.details": "Что будет прикреплено",
  "focus.screenshot.attach.tracker": "Сервис: {tracker}",
  "focus.screenshot.attach.issue": "Задача: {key}",
  "focus.screenshot.attach.file": "Имя файла: {name}",
  "focus.screenshot.attach.size": "Размер: {bytes} байт",
  "focus.screenshot.attach.hash": "Хеш содержимого (SHA-256, первые 12 символов): {hash}",
  "focus.screenshot.attach.redacted":
    "Это изображение в том виде, как оно скрыто и размечено на этой странице; скрытые области уже вшиты. Пока ничего не отправлено.",
  "focus.screenshot.attach.confirm": "Да, загрузить это изображение в {tracker}",
  "focus.screenshot.attach.send": "Запросить одобрение и прикрепить",
  "focus.screenshot.attach.done": "Снимок прикреплён к {key}.",
  "focus.screenshot.attach.problem.badImage":
    "Изображение не является допустимым PNG и не отправлено.",
  "focus.screenshot.attach.problem.tooLarge": "Изображение больше 5 МиБ и не отправлено.",
  "focus.screenshot.attach.problem.changed":
    "Изображение изменилось после проверки; проверьте его снова. Ничего не отправлено.",
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
};
