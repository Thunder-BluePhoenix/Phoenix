// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "Заметки о передаче",
  "handoff.intro":
    "Заметка о передаче — это краткая сводка, которую Phoenix составляет по фиксированным правилам, без модели, из того, о чём агент-программист сообщил во время сессии: цель (только если агент сообщил название задачи), изменённые файлы с числом строк, выполненные команды (без секретов) и открытые вопросы. Phoenix ничего из этого не проверял, поэтому воспринимайте это как слова агента, а не как доказательство. Заметки хранятся на этом компьютере в папке данных Phoenix и доступны только вам; сохраняются 50 последних, а «Удалить всё» для «handoff» в разделе «Конфиденциальность» удаляет их.",

  "handoff.settings.legend": "Настройки передачи",
  "handoff.settings.auto": "Писать заметку, когда сессия агента заканчивается",
  "handoff.settings.allowCloud":
    "Разрешить облачной модели писать необязательную сводку (выключено: только модель на этом устройстве)",
  "handoff.settings.cloudWarning":
    "Если включить, текст заметки (команды с вычеркнутыми данными и имена файлов) может покинуть этот компьютер и уйти облачной модели, когда вы запросите сводку. Облачные разрешения в настройках ИИ продолжают действовать сверх этого выбора.",
  "handoff.settings.saved": "Настройки сохранены.",
  "handoff.settings.unavailable": "Не удалось загрузить настройки передачи.",
  "handoff.notes.unavailable": "Не удалось загрузить заметки о передаче.",
  "handoff.guard.unavailable": "Не удалось загрузить результаты защиты секретов.",
  "handoff.notes.title": "Сохранённые заметки",
  "handoff.notes.listLabel": "Заметки о передаче",
  "handoff.notes.empty": "Ни одной заметки о передаче ещё не написано.",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files":
    "{count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "без проекта",
  "handoff.notes.hasSummary": "Сводка модели",
  "handoff.notes.detailLabel": "Выбранная заметка",
  "handoff.notes.loading": "Загрузка заметки…",
  "handoff.notes.trigger.auto": "Написана автоматически",
  "handoff.notes.trigger.user": "Вы запросили её",
  "handoff.notes.textLabel": "Текст заметки",

  "handoff.summary.title": "Сводка модели",
  "handoff.summary.processedBy": "Написано: {by}",
  "handoff.summary.warning":
    "Эту сводку написала модель, и она может ошибаться. Проверьте её, прежде чем полагаться на неё.",
  "handoff.summary.add": "Добавить сводку модели",
  "handoff.summary.note":
    "Phoenix использует только модель на этом устройстве, если вы не разрешили облачную модель выше.",
  "handoff.summary.added": "Сводка добавлена.",

  "handoff.delete.button": "Удалить заметку",
  "handoff.delete.done": "Заметка удалена.",

  "handoff.generate.title": "Написать заметку для сессии",
  "handoff.generate.sessionLabel": "Сессия",
  "handoff.generate.choose": "Выберите сессию",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none":
    "Пока не известно ни одной сессии агента-программиста, поэтому писать заметку не о чем.",
  "handoff.generate.button": "Написать заметку",
  "handoff.generate.done": "Заметка написана.",

  "handoff.attach.title": "Использовать эту заметку",
  "handoff.attach.targetLabel": "Куда она пойдёт",
  "handoff.attach.target.commit_message": "Сообщение коммита",
  "handoff.attach.target.pr_description": "Описание pull request",
  "handoff.attach.target.task": "Задача (issue) на GitHub",
  "handoff.attach.repositoryLabel": "Репозиторий GitHub (owner/name)",
  "handoff.attach.repositoryInvalid": "Введите репозиторий в виде owner/name, например acme/app.",
  "handoff.attach.preview": "Предпросмотр",
  "handoff.attach.previewAgain": "Показать предпросмотр снова",
  "handoff.attach.confirm": "Подтвердить",
  "handoff.attach.previewLabel": "Предпросмотр того, что будет прикреплено",
  "handoff.attach.issueTitle": "Заголовок задачи: {title}",
  "handoff.attach.textLabel": "Именно этот текст",
  "handoff.attach.delivery.copy":
    "Phoenix никуда это не записывает: подтвердите, чтобы скопировать, и вставьте сами.",
  "handoff.attach.delivery.copyPr":
    "У Phoenix пока нет команды, которая изменяет описание pull request: только копирование. Подтвердите, чтобы скопировать, и вставьте сами.",
  "handoff.attach.delivery.issue":
    "Phoenix создаст задачу GitHub в {repository} через возможность github. Вас попросят подтвердить ещё раз, и нужен токен на запись.",
  "handoff.attach.stale":
    "Заметка изменилась после этого предпросмотра, поэтому ничего не прикреплено. Сделайте предпросмотр снова.",
  "handoff.attach.copied": "Скопировано в буфер обмена. Вставьте там, где нужно.",
  "handoff.attach.copyByHand":
    "Phoenix не смог использовать буфер обмена. Выделите текст ниже и скопируйте вручную.",
  "handoff.attach.issueCreated": "Создана задача #{number} в {repository}.",
  "handoff.attach.issueExisting": "Задача #{number} в {repository} уже существовала.",
  "handoff.attach.issueAddress": "Адрес: {url}",

  "handoff.guard.title": "Защита секретов",
  "handoff.guard.intro":
    "Защита секретов устанавливается вместе с установщиком хуков агентов выше: это часть хуков, которые Phoenix добавляет в Claude Code и Codex. Она блокирует вызов инструмента, git commit или git push, если их ввод или подготовленные изменения содержат секрет, распознаваемый детектором Phoenix, и сообщает агенту, какой это вид секрета и где он найден, но никогда сам секрет.",
  "handoff.guard.override":
    "Отменить одну блокировку можно только через карточку подтверждения; агент сделать этого не может.",
  "handoff.guard.heuristic":
    "Детектор эвристический и не гарантирует, что ничего не утечёт: секрет, который он не распознаёт, не будет пойман.",
  "handoff.guard.failOpen":
    "Если Phoenix Core или хук не могут работать, работа агента продолжается (защита отказывает «открытой»), но найденный секрет блокируется всегда.",
  "handoff.guard.countsLabel": "Результаты защиты секретов",
  "handoff.guard.allowed": "Разрешено после проверки: {count}",
  "handoff.guard.blocked": "Заблокировано: {count}",
  "handoff.guard.overridden": "Разрешено после вашего подтверждения: {count}",
  "handoff.guard.since": "Подсчёт с {date} {time}",
  "handoff.guard.noResults": "Результатов пока нет.",
  "handoff.guard.recentLabel": "Недавние результаты защиты секретов",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "заблокировано",
  "handoff.guard.outcome.overridden": "разрешено после вашего подтверждения",
  "handoff.guard.finding": "{kind}, место: {location}",
};
