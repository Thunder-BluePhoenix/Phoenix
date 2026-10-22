// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "Защитная сеть агента",
  "safety.intro":
    "Перед первой сообщённой правкой кодового агента в сессии Phoenix сохраняет снимок проекта в собственном git-репозитории проекта (скрытая ссылка; ваши ветки, индекс и stash никогда не затрагиваются). Вы можете откатить файлы к нему после предпросмотра и вашего одобрения.",
  "safety.timing":
    "Claude Code сообщает о шаге после запуска инструмента, поэтому снимок делается при первом сообщении о правке: эта первая правка обычно уже в нём. Откат отменяет то, что агент сделал после неё, но не саму первую правку.",
  "safety.ignored":
    "Файлы, которые игнорирует git (результаты сборки, журналы, зависимости), не сохраняются и никогда не восстанавливаются и не удаляются.",
  "safety.loadFailed": "Не удалось загрузить защитную сеть: {error}",
  "safety.killSwitch":
    "Аварийный выключатель включён, поэтому новые контрольные точки не создаются.",

  "safety.warnings.title": "Предупреждения от Fawkes",
  "safety.warnings.loop": "Цикл",
  "safety.warnings.stall": "Зависание",
  "safety.warnings.line": "{kind} · {agent} в {repository}: {reason}",

  "safety.checkpoints.title": "Контрольные точки",
  "safety.checkpoints.none":
    "Контрольных точек пока нет. Она создаётся, когда сообщается о первой правке агента.",
  "safety.checkpoints.row": "{agent} в {repository}",
  "safety.checkpoints.facts":
    "Создана {taken} · {count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}} · хранится до {expires}",
  "safety.checkpoints.rolledBack": "Откат выполнен {when}",
  "safety.checkpoints.preview": "Предпросмотр отката…",
  "safety.checkpoints.previewLabel":
    "Предпросмотр отката к контрольной точке агента {agent} в {repository}",
  "safety.checkpoints.close": "Закрыть предпросмотр",

  "safety.skipped.title": "Сессии без контрольной точки",
  "safety.skipped.line": "{agent} в {repository}: {reason}",
  "safety.skipped.disabled": "защитная сеть выключена",
  "safety.skipped.kill_switch": "аварийный выключатель был включён",
  "safety.skipped.not_git": "эта папка не является git-репозиторием, поэтому снимать нечего",
  "safety.skipped.git_unavailable": "не удалось запустить git",
  "safety.skipped.too_many_files": "в проекте больше файлов, чем допускает лимит",
  "safety.skipped.too_large": "проект больше лимита по размеру",
  "safety.skipped.throttled": "в этом проекте контрольная точка уже создавалась в последнюю минуту",
  "safety.skipped.snapshot_failed": "git не смог сделать снимок",

  "safety.preview.title": "Предпросмотр отката",
  "safety.preview.counts":
    "{restore, plural, one {Будет восстановлен # файл} few {Будет восстановлено # файла} many {Будет восстановлено # файлов} other {Будет восстановлено # файла}}, {remove, plural, one {будет удалён # новый файл} few {будет удалено # новых файла} many {будет удалено # новых файлов} other {будет удалено # нового файла}}, {kept, plural, one {# различие останется нетронутым} few {# различия останутся нетронутыми} many {# различий останутся нетронутыми} other {# различия останутся нетронутыми}}.",
  "safety.preview.restore": "Будут восстановлены до контрольной точки",
  "safety.preview.remove": "Новые файлы, которые будут удалены",
  "safety.preview.kept": "Останутся нетронутыми",
  "safety.preview.change.modified": "изменён",
  "safety.preview.change.deleted": "удалён агентом",
  "safety.preview.change.type_changed": "тип изменён",
  "safety.preview.why.tracked_by_head": "отслеживается git, поэтому не удаляется",
  "safety.preview.why.ignored": "игнорируется git",
  "safety.preview.why.submodule": "подмодуль",
  "safety.preview.why.unsafe_path": "путь небезопасно трогать",
  "safety.preview.why.not_a_file": "не обычный файл",
  "safety.preview.truncated": "Списки обрезаны; числа выше точные.",
  "safety.preview.diff": "Изменения с момента контрольной точки",
  "safety.preview.diffTruncated": "Diff обрезан по лимиту размера.",
  "safety.preview.diffRedacted": "Часть текста, похожая на секрет, была скрыта.",
  "safety.preview.diffEmpty": "Нет текстовых изменений для показа.",
  "safety.preview.nothing": "Файлы уже совпадают с контрольной точкой. Откатывать нечего.",
  "safety.preview.refusal.repository_missing": "Проект здесь больше не является git-репозиторием.",
  "safety.preview.refusal.checkpoint_gone": "Снимка больше нет в репозитории.",
  "safety.preview.refusal.head_moved":
    "HEAD репозитория сдвинулся с момента контрольной точки (коммит или переключение ветки). Phoenix не станет откатывать через это; ничего не изменено.",
  "safety.preview.refusal.snapshot_failed": "Git не смог прочитать рабочее дерево.",
  "safety.preview.approvalNote":
    "Перед откатом запрашивается ваше одобрение. Он никогда не меняет историю git, ветки, индекс или stash и отказывается выполняться, если файлы изменились после этого предпросмотра.",

  "safety.rollback.button": "Откатить…",
  "safety.rollback.waiting": "Ожидание вашего одобрения в списке одобрений выше…",
  "safety.rollback.done":
    "Откат выполнен: {restored, plural, one {восстановлен # файл} few {восстановлено # файла} many {восстановлено # файлов} other {восстановлено # файла}}, {removed, plural, one {удалён # новый файл} few {удалено # новых файла} many {удалено # новых файлов} other {удалено # нового файла}}.",
  "safety.rollback.exact": "Теперь файлы совпадают с контрольной точкой.",
  "safety.rollback.inexact":
    "Некоторые различия оставлены нетронутыми, поэтому файлы не полностью совпадают с контрольной точкой.",

  "safety.settings.title": "Настройки",
  "safety.settings.enabled": "Создавать контрольную точку, когда сообщается о первой правке агента",
  "safety.settings.notify":
    "Отправлять уведомление, когда Fawkes предупреждает о цикле или зависании",
  "safety.settings.retention": "Хранить контрольные точки (дней)",
  "safety.settings.maxFiles": "Пропускать проекты, в которых файлов больше, чем",
  "safety.settings.loopThreshold": "Предупреждать о цикле после стольких повторов",
  "safety.settings.waitingMin": "Предупреждать, когда агент ждёт вас дольше (минут)",
  "safety.settings.idleMin": "Предупреждать, когда активный агент молчит дольше (минут)",
  "safety.settings.saved": "Сохранено.",
  "safety.settings.detectNote":
    "Хуки не сообщают ни кодов возврата, ни содержимого файлов, поэтому цикл означает одну и ту же команду, запускаемую снова и снова, или файл, правки которого постоянно отменяют друг друга (по числу строк).",
};
