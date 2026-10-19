// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { automation as enAutomation } from "../../en/automation";

/** Machine-translated; unreviewed (see ../../README.md). */
export const automation: Record<keyof typeof enAutomation, string> = {
  // ---- workflows: tables and checks (core/workflows.ts) ----
  "automation.workflows.environment.local": "Локальное",
  "automation.workflows.environment.dev": "Разработка",
  "automation.workflows.environment.staging": "Стейджинг",
  "automation.workflows.environment.production": "ПРОДАКШН",
  "automation.workflows.environment.productionLive": "ПРОДАКШН (изменяет рабочие системы)",

  "automation.workflows.runStatus.queued": "В очереди",
  "automation.workflows.runStatus.running": "Выполняется",
  "automation.workflows.runStatus.waiting_approval": "Ожидает вашего одобрения",
  "automation.workflows.runStatus.compensating": "Откат предыдущих шагов",
  "automation.workflows.runStatus.succeeded": "Успешно",
  "automation.workflows.runStatus.rejected": "Отклонён вами",
  "automation.workflows.runStatus.failed": "Сбой",
  "automation.workflows.runStatus.failed_needs_attention": "Сбой: требуется ваше внимание",
  "automation.workflows.runStatus.cancelled": "Отменён",
  "automation.workflows.runStatus.interrupted": "Прерван (Phoenix перезапущен)",
  "automation.workflows.runStatus.refused": "Отказ: запуск не был разрешён",

  "automation.workflows.stepStatus.running": "Выполняется",
  "automation.workflows.stepStatus.waiting": "Ожидает",
  "automation.workflows.stepStatus.succeeded": "Успешно",
  "automation.workflows.stepStatus.failed": "Сбой",
  "automation.workflows.stepStatus.timed_out": "Тайм-аут (результат неизвестен)",
  "automation.workflows.stepStatus.rejected": "Отклонён",
  "automation.workflows.stepStatus.expired": "Срок истёк",
  "automation.workflows.stepStatus.unknown": "Результат неизвестен",

  "automation.workflows.authorisation.notNeeded": "Разрешение не требуется",
  "automation.workflows.authorisation.authorised": "Разрешён для продакшна",
  "automation.workflows.authorisation.notAuthorised":
    "НЕ разрешён: запуски по триггеру отклоняются",

  "automation.workflows.expiry.invalid": "Это не дата и время.",
  "automation.workflows.expiry.past": "Срок действия должен быть в будущем.",
  "automation.workflows.expiry.tooFar":
    "Срок действия не может превышать {days} дн. от текущего момента.",
  "automation.workflows.refused.noReason": "Причина не указана.",
  "automation.workflows.payload.invalidJson": "Полезная нагрузка не является корректным JSON.",
  "automation.workflows.payload.notObject":
    "Полезная нагрузка должна быть объектом JSON, например '{}'.",
  "automation.workflows.payload.tooMany": "В полезной нагрузке может быть не более {max} ключей.",

  // ---- workflows: the list ----
  "automation.workflows.title": "Рабочие процессы",
  "automation.workflows.intro":
    "Рабочий процесс реагирует на событие фиксированным списком шагов. Рабочий процесс, изменяющий продакшн, ничего не делает, пока вы не разрешите именно то определение, которое проверили.",
  "automation.workflows.empty":
    "Рабочих процессов пока нет. Создайте один, проверив определение ниже.",
  "automation.workflows.row.runsWhen": "Запускается при событии {event} · версия {version}",
  "automation.workflows.row.cannotRun": "Не может запуститься: {problems}",
  "automation.workflows.row.metrics": "Запусков: {started}, успешно: {succeeded}",

  // ---- workflows: the numbers of one workflow ----
  "automation.workflows.metrics.title": "Показатели",
  "automation.workflows.metrics.label": "Метрики",
  "automation.workflows.metrics.none":
    "Этот рабочий процесс ещё не запускался, поэтому показателей нет.",
  "automation.workflows.metrics.started": "Запущено",
  "automation.workflows.metrics.succeeded": "Успешно",
  "automation.workflows.metrics.failed": "Сбой",
  "automation.workflows.metrics.attention": "Требуют вашего внимания",
  "automation.workflows.metrics.cancelled": "Отменено",
  "automation.workflows.metrics.refused": "Отклонено",
  "automation.workflows.metrics.interrupted": "Прервано",
  "automation.workflows.metrics.stepsFailed": "Шаги со сбоем",
  "automation.workflows.metrics.stepsFailedValue": "{count} ({percent}% шагов)",
  "automation.workflows.metrics.approvalsWaiting": "Ожидают одобрения",
  "automation.workflows.metrics.approvalsOutcome": "Одобрения: одобрено / отклонено / истекло",
  "automation.workflows.metrics.approvalsOutcomeValue": "{approved} / {rejected} / {expired}",
  "automation.workflows.metrics.runTime": "Время выполнения (медиана / 90-й перцентиль)",
  "automation.workflows.metrics.runTimeValue":
    "{median} ms / {p90} ms по {samples, plural, one {# запуску} few {# запускам} many {# запускам} other {# запуска}}",
  "automation.workflows.metrics.noFinishedRuns": "нет завершённых запусков",

  // ---- workflows: the definition editor ----
  "automation.workflows.editor.titleEdit": "Редактирование определения",
  "automation.workflows.editor.titleCreate": "Создание рабочего процесса",
  "automation.workflows.editor.introExisting":
    'Введите полное определение в формате JSON. Оставьте "enabled": {enabled}; это изменение сохраняет текущее положение переключателя. Сохранение не разрешает и не запускает процесс. Проверка ничего не сохраняет.',
  "automation.workflows.editor.introNew":
    'Введите полное определение в формате JSON. В новых определениях должно быть "enabled": false. Сохранение не запускает, не включает и не разрешает их. Проверка ничего не сохраняет.',
  "automation.workflows.editor.label": "Определение рабочего процесса (JSON)",
  "automation.workflows.editor.check": "Проверить черновик",
  "automation.workflows.editor.enterJson":
    "Перед проверкой введите определение рабочего процесса в формате JSON.",
  "automation.workflows.editor.notObject":
    "Определение рабочего процесса должно быть объектом JSON.",
  "automation.workflows.editor.keepEnabled":
    'Оставьте "enabled": {enabled}. Переключатель меняйте отдельно, после сохранения.',
  "automation.workflows.editor.setDisabled":
    'Укажите "enabled": false. Сохранение нового определения не должно его включать.',
  "automation.workflows.editor.keepId":
    "При редактировании ID рабочего процесса должен остаться прежним. Для нового ID используйте «Создание рабочего процесса».",
  "automation.workflows.editor.notValid": "Некорректно: {problems}",
  "automation.workflows.editor.noHash": "Проверка не вернула корректный хеш определения.",
  "automation.workflows.editor.hashDiffers":
    "Хеш сохранённого определения отличается от проверенного. Прежде чем использовать, просмотрите сохранённое определение.",
  "automation.workflows.editor.savedExisting":
    "Определение сохранено. Положение переключателя не изменилось; сохранение не даёт разрешения.",
  "automation.workflows.editor.savedNew":
    "Определение сохранено выключенным. Сохранение не разрешает и не включает его.",
  "automation.workflows.editor.reviewed": "Проверенное определение",
  "automation.workflows.editor.validLead": "Черновик корректен.",
  "automation.workflows.editor.valid":
    "{lead} Перед сохранением просмотрите именно это определение и хеш. После любого изменения нужна новая проверка.",
  "automation.workflows.editor.toSave": "Определение для сохранения",
  "automation.workflows.editor.hash": "Проверенный хеш: {hash}",
  "automation.workflows.editor.authRequired": "Отдельно требуется разрешение: {reasons}",
  "automation.workflows.editor.authNotRequired": "Разрешение не требуется.",
  "automation.workflows.editor.switchOn":
    "Сохранение никогда не даёт разрешения; переключатель остаётся включённым.",
  "automation.workflows.editor.switchOff":
    "Сохранение никогда не даёт разрешения; переключатель остаётся выключенным.",
  "automation.workflows.editor.switchNew":
    "Сохранение никогда не даёт разрешения; новый рабочий процесс остаётся выключенным.",
  "automation.workflows.editor.confirm": "Подтвердить: сохранить именно это определение",
  "automation.workflows.editor.reviewStored": "Просмотреть сохранённый рабочий процесс",

  // ---- workflows: checking the stored definition ----
  "automation.workflows.validate.button": "Проверить определение",
  "automation.workflows.validate.dryRun": "Пробный прогон. Ничего не сохраняется и не запускается.",
  "automation.workflows.validate.validLead": "Корректно.",
  "automation.workflows.validate.valid": "{lead} Хеш {hash}. {authorisation}",
  "automation.workflows.validate.needsAuth": "Требуется ваше разрешение: {reasons}.",
  "automation.workflows.validate.noAuth": "Разрешение не требуется.",
  "automation.workflows.validate.invalidLead": "Некорректно.",
  "automation.workflows.validate.invalid":
    "{lead} {count, plural, one {# проблема:} few {# проблемы:} many {# проблем:} other {# проблемы:}}",
  "automation.workflows.validate.problems": "Проблемы",

  // ---- workflows: authorising ----
  "automation.workflows.authorise.title": "Разрешить для продакшна",
  "automation.workflows.authorise.notNeeded": "Этому рабочему процессу разрешение не требуется.",
  "automation.workflows.authorise.why": "Почему нужно ваше разрешение:",
  "automation.workflows.authorise.reasons": "Причины",
  "automation.workflows.authorise.intro":
    "Это позволит рабочему процессу {name} запускаться каждый раз при событии {event} без дополнительных вопросов по этим шагам, если только сам процесс их не задаст:",
  "automation.workflows.authorise.allowed": "Что будет разрешено запускать",
  "automation.workflows.authorise.noTools": "Инструменты не вызываются.",
  "automation.workflows.authorise.step": "Шаг {step} вызывает {tool}",
  "automation.workflows.authorise.stepUndo": "Шаг {step} вызывает {tool} (откат: {undo})",
  "automation.workflows.authorise.being": "Разрешаемое определение: версия {version}, хеш {hash}",
  "automation.workflows.authorise.expires": "Истекает {hint}",
  "automation.workflows.authorise.expiresHint": "(необязательно, в пределах {days} дн.)",
  "automation.workflows.authorise.submit": "Разрешить именно это определение",
  "automation.workflows.authorise.done":
    "Версия {version} разрешена. Любое последующее изменение определения отменяет разрешение.",

  // ---- workflows: run now ----
  "automation.workflows.runNow.title": "Запустить сейчас",
  "automation.workflows.runNow.intro":
    "Запускает рабочий процесс вручную с теми же проверками, что и при наступлении его события: он включён, не остановлен аварийной остановкой, корректен и разрешён, если изменяет продакшн.",
  "automation.workflows.runNow.payload": "Данные, которые передало бы событие {hint}",
  "automation.workflows.runNow.payloadHint": "(объект JSON, необязательно)",
  "automation.workflows.runNow.button": "Запустить сейчас",
  "automation.workflows.runNow.cannotRun": "Запуск невозможен: {problems}",
  "automation.workflows.runNow.enableFirst": "Чтобы запустить рабочий процесс, включите его.",
  "automation.workflows.runNow.refusedLead": "В запуске отказано.",
  "automation.workflows.runNow.seeRefused": "Посмотреть отклонённый запуск",
  "automation.workflows.runNow.started": "Запущено. {link}",
  "automation.workflows.runNow.follow": "Следить за запуском",

  // ---- workflows: one workflow ----
  "automation.workflows.detail.all": "Все рабочие процессы",
  "automation.workflows.detail.backAll": "← Все рабочие процессы",
  "automation.workflows.detail.productionLead": "Продакшн.",
  "automation.workflows.detail.production":
    "{lead} Этот рабочий процесс может изменять рабочие системы. Он запускается только пока вы разрешаете его точное определение.",
  "automation.workflows.detail.cannotRunNow": "Сейчас он не может запуститься:",
  "automation.workflows.detail.definition": "Определение",
  "automation.workflows.detail.versionHash": "Версия {version} · хеш {hash}",
  "automation.workflows.detail.runsWhen": "Запускается при событии {event}.",
  "automation.workflows.detail.runsWhenAnd": "Запускается при событии {event}, если {condition}.",
  "automation.workflows.detail.tools": "Инструменты, которые он может вызывать",
  "automation.workflows.detail.toolsLabel": "Инструменты",
  "automation.workflows.detail.none": "Нет.",
  "automation.workflows.detail.toolStep": "Шаг {step}: {tool}",
  "automation.workflows.detail.flagged": "Продакшн или критическое действие",
  "automation.workflows.detail.declaredUndo": "объявленный откат: {undo}",
  "automation.workflows.detail.definitionText":
    "Определение (текст только для чтения, прокручивается)",
  "automation.workflows.detail.unreadable": "Не удалось прочитать сохранённое определение.",
  "automation.workflows.detail.switch": "Переключатель",
  "automation.workflows.detail.enable": "Включить",
  "automation.workflows.detail.disable": "Выключить",
  "automation.workflows.detail.switchNote":
    "Включение не даёт разрешения. Включённый продакшн-процесс без разрешения фиксирует каждый триггер как отклонённый.",
  "automation.workflows.detail.authorisations": "Разрешения",
  "automation.workflows.detail.noneYet": "Пока нет.",
  "automation.workflows.detail.inForce": "Действует",
  "automation.workflows.detail.revoked": "Отозвано",
  "automation.workflows.detail.notInForce": "Не действует",
  "automation.workflows.detail.authorisedBy": "выдал {by}, {date}",
  "automation.workflows.detail.authExpires": "истекает {date}",
  "automation.workflows.detail.authChanged": "определение изменилось или срок истёк",
  "automation.workflows.detail.forHash": "для хеша {hash}",
  "automation.workflows.detail.confirmRevoke": "Подтвердить: отозвать разрешение",
  "automation.workflows.detail.revoke": "Отозвать разрешение…",
  "automation.workflows.detail.revokeNote": "Выполняющиеся запуски остановятся на следующем шаге.",
  "automation.workflows.detail.recentRuns": "Последние запуски",
  "automation.workflows.detail.noRuns": "Запусков пока нет.",

  // ---- workflows: runs and steps ----
  "automation.workflows.run.needsLook": "(требует внимания)",
  "automation.workflows.run.notSuccess": "(неуспешно)",
  "automation.workflows.run.nowAtStep": "сейчас на шаге {step}",
  "automation.workflows.run.atStep": "на шаге {step}",
  "automation.workflows.run.backToWorkflow": "Назад к рабочему процессу",
  "automation.workflows.run.title": "Запуск {name}",
  "automation.workflows.run.created": "Создан {date}",
  "automation.workflows.run.finished": "завершён {date}",
  "automation.workflows.run.chainDepth": "глубина цепочки {depth}",
  "automation.workflows.run.waitingForYou": "Ожидает вас",
  "automation.workflows.run.stop": "Остановить этот запуск",
  "automation.workflows.run.confirmCancel": "Подтвердить: отменить этот запуск",
  "automation.workflows.run.keepRunning": "Продолжить выполнение",
  "automation.workflows.run.cancel": "Отменить этот запуск…",
  "automation.workflows.run.cancelNote":
    "Отмена не выполняет объявленные шаги отката. Уже выполняющийся шаг может всё же завершиться.",
  "automation.workflows.run.trigger": "Что его запустило",
  "automation.workflows.run.triggerText": "Триггер (обычный текст, прокручивается)",
  "automation.workflows.run.stepsHeading": "Шаги ({count})",
  "automation.workflows.run.stepsLabel": "Шаги",
  "automation.workflows.run.noSteps": "Ни один шаг не начат.",
  "automation.workflows.step.undo": "Откат: {step}",
  "automation.workflows.step.attempts":
    "{count, plural, one {# попытка} few {# попытки} many {# попыток} other {# попытки}}",
  "automation.workflows.step.changesState": "Изменяет состояние",
  "automation.workflows.step.destructive": "{lead}: этот шаг может изменить реальную систему.",
  "automation.workflows.step.tool": "Инструмент {tool}",
  "automation.workflows.step.input": "Входные данные шага {step} (обычный текст, прокручивается)",
  "automation.workflows.step.output": "Результат шага {step} (обычный текст, прокручивается)",

  // ---- plans: tables and checks (core/plans.ts) ----
  "automation.plans.status.draft": "Черновик: ещё не предложен",
  "automation.plans.status.proposed": "Предложен: ожидает вашего одобрения",
  "automation.plans.status.approved": "Одобрен: готов к созданию",
  "automation.plans.status.creating": "Создание задач…",
  "automation.plans.status.created": "Создан",
  "automation.plans.status.failed": "Сбой: часть задач не создана",
  "automation.plans.status.cancelled": "Отменён",
  "automation.plans.basis.meeting": "из встречи",
  "automation.plans.basis.suggested": "предложено моделью",
  "automation.plans.basis.user": "написано вами",
  "automation.plans.run.pending": "Не начата",
  "automation.plans.run.attempting": "Выполняется",
  "automation.plans.run.created": "Создана",
  "automation.plans.run.failed": "Сбой",
  "automation.plans.tool.githubIssue": "Создать issue в GitHub",
  "automation.plans.tool.frappeTask": "Создать задачу во Frappe",
  "automation.plans.kind.decision": "решение",
  "automation.plans.kind.action_item": "пункт действий",
  "automation.plans.kind.requirement": "требование",
  "automation.plans.authorship.rules":
    "Черновик по правилам: ИИ его не писал, он лишь пересказывает пункт встречи.",
  "automation.plans.authorship.model":
    "Результат модели ({model}): перед одобрением сверьте его со встречей.",
  "automation.plans.destination.github": "Репозиторий GitHub {repository}",
  "automation.plans.destination.frappe": "Сайт Frappe {site}",
  "automation.plans.problem.repository": 'Репозиторий должен иметь вид "owner/name".',
  "automation.plans.problem.site": "Это недопустимое имя сайта Frappe.",
  "automation.plans.problem.titleEmpty": "Заголовок не может быть пустым.",
  "automation.plans.problem.titleLong": "Заголовок длиннее {max}.",
  "automation.plans.problem.summaryEmpty": "Краткое описание не может быть пустым.",
  "automation.plans.problem.summaryLong": "Краткое описание длиннее {max}.",
  "automation.plans.problem.taskCount": "План должен содержать от 1 до {max} задач.",
  "automation.plans.problem.taskTitle": "Задаче {n} нужен заголовок.",
  "automation.plans.problem.bodyLong": "Текст длиннее {max}.",
  "automation.plans.problem.labelCount": "Не более {max} меток.",
  "automation.plans.problem.labelLong": "Метка длиннее {max}.",

  // ---- plans: make a plan from a meeting item ----
  "automation.plans.off": "Планирование выключено.",
  "automation.plans.make.open": "Составить план…",
  "automation.plans.make.openFrom": "Составить план: {kind} — {text}",
  "automation.plans.make.intro":
    "План — это черновик инженерных задач. Ничего не создаётся, пока вы не одобрите план и не подтвердите каждую задачу.",
  "automation.plans.make.where": "Куда направить задачи?",
  "automation.plans.make.githubIssues": "Issues в GitHub",
  "automation.plans.make.frappeTasks": "Задачи во Frappe",
  "automation.plans.make.repository": "Репозиторий (owner/name)",
  "automation.plans.make.site": "Сайт Frappe",
  "automation.plans.make.chooseSite": "Выберите сайт",
  "automation.plans.make.drafting": "Составление плана…",
  "automation.plans.make.draft": "Составить черновик плана",
  "automation.plans.make.localModel":
    "Локальной модели может потребоваться минута. Ничего никуда больше не отправляется.",
  "automation.plans.make.drafted": "Черновик плана составлен.",
  "automation.plans.make.openPlan": "Открыть план",

  // ---- plans: on a meeting ----
  "automation.plans.meeting.title": "Планы и задачи по этой встрече",
  "automation.plans.meeting.plans": "Планы",
  "automation.plans.meeting.summary":
    "{status} · {count, plural, one {# задача} few {# задачи} many {# задач} other {# задачи}} · {system}",
  "automation.plans.meeting.tasksCreated": "Созданные задачи",
  "automation.plans.meeting.tasksLabel": "Задачи, созданные по этой встрече",
  "automation.plans.link.frappeTask": "Задача {id}",
  "automation.plans.link.detail": "задача {index} из плана {plan} · одобрено {date}",
  "automation.plans.link.itsPlan": "её план",

  // ---- plans: the editor ----
  "automation.plans.editor.label": "Редактирование плана",
  "automation.plans.editor.title": "Заголовок {hint}",
  "automation.plans.editor.summary": "Краткое описание {hint}",
  "automation.plans.editor.upTo": "(до {max})",
  "automation.plans.editor.tasks": "Задачи {hint}",
  "automation.plans.editor.tasksRange": "(от 1 до {max})",
  "automation.plans.editor.task": "Задача {n}",
  "automation.plans.editor.taskTitle": "Заголовок задачи {n}",
  "automation.plans.editor.taskBody": "Текст задачи {n} {hint}",
  "automation.plans.editor.taskLabels": "Метки задачи {n} {hint}",
  "automation.plans.editor.labelsHint": "(через запятую, до {max})",
  "automation.plans.editor.removeTask": "Удалить задачу {n}",
  "automation.plans.editor.addTask": "Добавить задачу",
  "automation.plans.editor.note":
    "Сохранение возвращает план в черновик и сбрасывает одобрение. Затем план нужно предложить и одобрить снова.",
  "automation.plans.editor.save": "Сохранить изменения",

  // ---- plans: preview and results ----
  "automation.plans.preview.title": "Что именно будет отправлено",
  "automation.plans.preview.intro":
    "Каждая задача — один вызов от вашего имени. Это реальные входные данные в виде обычного текста.",
  "automation.plans.preview.calls": "Вызовы, которые будут выполнены",
  "automation.plans.preview.task": "Задача {n}: {tool}",
  "automation.plans.preview.decision": "(эффект: {effect}, риск: {risk})",
  "automation.plans.preview.input": "Входные данные задачи {n} (обычный текст, прокручивается)",
  "automation.plans.runs.title": "Задача за задачей",
  "automation.plans.runs.label": "Результаты задач",
  "automation.plans.runs.task": "Задача {n}:",
  "automation.plans.runs.attempts":
    "{count, plural, one {# попытка} few {# попытки} many {# попыток} other {# попытки}}",
  "automation.plans.runs.frappeTask": "Задача Frappe {id}",
  "automation.plans.runs.stopped":
    "Остановлено на задаче {n}: {message}. Ничего после неё не создано. Можно снова нажать «Создать задачи»: уже существующие задачи будут найдены, а не продублированы.",

  // ---- plans: one plan ----
  "automation.plans.page.allMeetings": "Все встречи",
  "automation.plans.page.meeting": "← Встреча",
  "automation.plans.page.rules": "Черновик по правилам",
  "automation.plans.page.model": "Результат модели",
  "automation.plans.page.destination": "Назначение: {destination}",
  "automation.plans.page.from": "Источник, {kind}: {text}",
  "automation.plans.page.owner": "владелец {owner}",
  "automation.plans.page.due": "срок {due}",
  "automation.plans.page.proposedNotice": "Предложено. Проверьте предпросмотр, затем одобрите.",
  "automation.plans.page.approvedNotice": "Одобрено. Пока ничего не создано.",
  "automation.plans.page.savedNotice":
    "Сохранено. План снова черновик; предложите его, чтобы одобрить.",
  "automation.plans.page.cancelledNotice": "Отменено. Ничего не создано.",
  "automation.plans.page.plan": "План",
  "automation.plans.page.tasks": "Задачи ({count})",
  "automation.plans.page.tasksLabel": "Задачи",
  "automation.plans.page.labels": "Метки:",
  "automation.plans.page.edit": "Редактировать план",
  "automation.plans.page.acceptance": "Критерии приёмки",
  "automation.plans.page.risks": "Риски",
  "automation.plans.page.questions": "Открытые вопросы",
  "automation.plans.frappe.doctype": "Предлагаемый DocType Frappe: {doctype}",
  "automation.plans.frappe.note":
    "Только предложение по проектированию. Создание задач не создаёт этот DocType, его поля, рабочий процесс или права доступа.",
  "automation.plans.frappe.fields": "Поля",
  "automation.plans.frappe.fieldsLabel": "Предлагаемые поля Frappe",
  "automation.plans.frappe.required": "обязательное",
  "automation.plans.frappe.noFields": "Поля не предложены.",
  "automation.plans.frappe.states": "Состояния рабочего процесса",
  "automation.plans.frappe.statesLabel": "Предлагаемые состояния рабочего процесса Frappe",
  "automation.plans.frappe.noStates": "Состояния рабочего процесса не предложены.",
  "automation.plans.frappe.permissions": "Права доступа",
  "automation.plans.frappe.permissionsLabel": "Предлагаемые права доступа Frappe",
  "automation.plans.frappe.noPermissions": "Права доступа не предложены.",
  "automation.plans.frappe.access": "{role}: {access}",
  "automation.plans.frappe.read": "чтение",
  "automation.plans.frappe.write": "запись",
  "automation.plans.frappe.create": "создание",
  "automation.plans.frappe.noAccess": "нет доступа",
  "automation.plans.decide.title": "Решение",
  "automation.plans.decide.fingerprint":
    "Отпечаток того, что вы просматриваете: {hash}. Одобрение относится ровно к этому содержимому; если план изменится, оно будет отклонено.",
  "automation.plans.decide.propose": "Предложить этот план",
  "automation.plans.decide.nameMeeting": "Указать встречу в созданных задачах",
  "automation.plans.decide.approve": "Одобрить именно этот план",
  "automation.plans.decide.approved": "Одобрено: {by}, {date}.",
  "automation.plans.decide.approvedNamed": "Одобрено: {by}, {date} · встреча указана в задачах.",
  "automation.plans.decide.understand":
    "Я понимаю, что это создаст {count, plural, one {# задачу} few {# задачи} many {# задач} other {# задачи}} в {destination} от моего имени.",
  "automation.plans.decide.createRemaining": "Создать оставшиеся задачи",
  "automation.plans.decide.create": "Создать задачи",
  "automation.plans.decide.waiting": "Ожидается ваше одобрение задачи {n} из {total}.",
  "automation.plans.decide.waitingNote":
    "Core спрашивает вас перед созданием каждой задачи. Ответьте ниже; страница ждёт столько, сколько потребуется.",
  "automation.plans.decide.cancel": "Отменить этот план",

  // ---- automation settings (AutomationSettings.tsx) ----
  "automation.settings.title": "Автоматизация",
  "automation.settings.intro":
    "Автоматизация выключена, пока вы её не включите. Пока она выключена, Fawkes не запускает задачи и ничего не выполняет сам. Когда она включена, Fawkes может запустить задачу только по вашей просьбе, например «Диагностировать сбой CI» на вкладке «Чат». Он читает данные и предлагает; всё, что что-либо изменяет, ждёт вашего одобрения, а задачу можно отменить в любой момент. Выключение автоматизации отменяет все выполняющиеся задачи.",
  "automation.settings.allow": "Разрешить Fawkes выполнять запущенные мной задачи",
  "automation.settings.statusOn":
    "Автоматизация включена. {active, plural, one {Выполняется # задача} few {Выполняются # задачи} many {Выполняется # задач} other {Выполняется # задачи}} (не более {max} одновременно).",
  "automation.settings.statusOff":
    "Автоматизация выключена. {active, plural, one {Выполняется # задача} few {Выполняются # задачи} many {Выполняется # задач} other {Выполняется # задачи}} (не более {max} одновременно).",
  "automation.settings.unavailable": "Настройки автоматизации недоступны в Phoenix Core ({error}).",

  // ---- proactive suggestions (ProactiveSettings.tsx) ----
  "automation.proactive.title": "Проактивные предложения",
  "automation.proactive.intro":
    "По умолчанию выключено. Единственный поддерживаемый источник — принятые неназначенные пункты действий из встреч Kage. Kage должен быть доступен. Провайдеры прогноза развёртывания, инцидентов и зависимостей недоступны. Оценка выполняется вручную, пока вы после согласия явно не выберете периодичность. Плановая оценка выполняется локально и учитывает тихие часы, ограничения частоты и аварийную остановку.",
  "automation.proactive.status": "Источник Kage: {source}. Предложения: {state} ({cadence}).",
  "automation.proactive.sourceAvailable": "доступен",
  "automation.proactive.sourceUnavailable": "недоступен",
  "automation.proactive.stateOn": "включены",
  "automation.proactive.stateOff": "выключены",
  "automation.proactive.cadenceEvery":
    "раз в {minutes, plural, one {# минуту} few {# минуты} many {# минут} other {# минуты}}",
  "automation.proactive.cadenceManual": "только вручную",
  "automation.proactive.optIn": "Согласие",
  "automation.proactive.enable": "Включить проактивные предложения",
  "automation.proactive.kageItems": "Принятые неназначенные пункты действий Kage",
  "automation.proactive.cadence": "Периодичность автоматической оценки",
  "automation.proactive.cadenceOff": "Только вручную (выключено)",
  "automation.proactive.cadence15": "Каждые 15 минут",
  "automation.proactive.cadence30": "Каждые 30 минут",
  "automation.proactive.cadence60": "Каждый час",
  "automation.proactive.cadence1440": "Каждый день",
  "automation.proactive.quietHours": "Тихие часы",
  "automation.proactive.useQuiet": "Использовать тихие часы",
  "automation.proactive.timezone": "Часовой пояс (IANA)",
  "automation.proactive.quietFrom": "Тихие часы с",
  "automation.proactive.quietUntil": "Тихие часы до",
  "automation.proactive.maxPerHour": "Максимум предложений в час",
  "automation.proactive.preview": "Предпросмотр предложений",
  "automation.proactive.evaluate": "Оценить сейчас",
  "automation.proactive.refreshNoise": "Обновить метрики шума",
  "automation.proactive.delivered": "Доставленные предложения",
  "automation.proactive.dismiss": "Отклонить {title}",
  "automation.proactive.previewHeading": "Обоснованный предпросмотр",
  "automation.proactive.previewLabel": "Предпросмотр предложений",
  "automation.proactive.previewEmpty":
    "Нет подходящих принятых неназначенных пунктов действий Kage.",
  "automation.proactive.evidence":
    "Основание: встреча {meeting}, пункт {item} ({source}): «{quote}»",
  "automation.proactive.sourceTranscript": "транскрипт",
  "automation.proactive.sourceSummary": "резюме",
  "automation.proactive.noiseLabel": "Метрики шума предложений",
  "automation.proactive.noiseDelivered": "Доставлено",
  "automation.proactive.noiseDismissed": "Отклонено",
  "automation.proactive.noiseSuppressed": "Подавлено",
  "automation.proactive.noiseRate": "Доля отклонений",
  "automation.proactive.saved": "Настройки предложений сохранены.",
  "automation.proactive.previewCount":
    "В предпросмотре: {count, plural, one {# обоснованное предложение} few {# обоснованных предложения} many {# обоснованных предложений} other {# обоснованного предложения}}.",
  "automation.proactive.evaluated": "Доставлено: {delivered}; подавлено: {suppressed}.",
  "automation.proactive.dismissed": "Предложение отклонено.",

  // ---- capability registry (RegistrySettings.tsx) ----
  "automation.registry.title": "Реестр возможностей",
  "automation.registry.intro":
    "Просмотр метаданных из локально настроенного подписанного индекса, которому доверяет хост. Phoenix Core проверяет подпись индекса перед возвратом записей. Просмотр не устанавливает и не запускает сторонний код.",
  "automation.registry.noInstall":
    "Установка недоступна: нет проверенной песочницы ОС. Сторонние возможности здесь установить нельзя.",
  "automation.registry.unavailable": "Реестр недоступен",
  "automation.registry.loadFailed": "Не удалось загрузить реестр: {error}",
  "automation.registry.loading": "Загрузка реестра…",
  "automation.registry.notConfigured":
    "Локальный реестр не настроен. Попросите администратора хоста настроить доверенный ключ и подписанный индекс, чтобы просматривать возможности.",
  "automation.registry.indexSignature":
    "Подпись индекса: проверена доверенным для хоста подписантом Ed25519 {signer}.",
  "automation.registry.signature": "Подпись: {signature}",
  "automation.registry.indexHash": "SHA-256 подписанного индекса: {hash}",
  "automation.registry.empty": "Подписанный реестр не содержит возможностей.",
  "automation.registry.preview": "Предпросмотр {name} {version}",
  "automation.registry.previewFailed": "Предпросмотр недоступен: {error}",
  "automation.registry.previewLoading": "Загрузка проверенного предпросмотра…",
  "automation.registry.permissions": "Разрешения",
  "automation.registry.noDescription": "Описание не предоставлено",
  "automation.registry.noneDeclared": "Не заявлено.",
  "automation.registry.dataCategories": "Категории данных",
  "automation.registry.licence": "Лицензия",
  "automation.registry.licenceLine": "{licence}. {policy}",
  "automation.registry.security": "Безопасность",
  "automation.registry.securityContact": "Контакт по безопасности",
  "automation.registry.advisories": "Бюллетени безопасности",
  "automation.registry.provenance": "Подписанное происхождение",
  "automation.registry.artifact":
    "SHA-256 артефакта, заявленный подписанным индексом: {hash} ({bytes, plural, one {# байт} few {# байта} many {# байт} other {# байта}}). Проверка артефакта: не проверен; байты артефакта не загружались и не проверялись. Просмотр не выполняет артефакт.",
  "automation.registry.sandbox":
    "Песочница: недоступна. Установка отключена; запрос на установку не будет отправлен.",

  // ---- encrypted sync (SyncSettings.tsx) ----
  "automation.sync.title": "Зашифрованная синхронизация",
  "automation.sync.intro":
    "Необязательна и по умолчанию выключена. Для синхронизации нужен ваш собственный доступный HTTPS-ретранслятор и аутентификация на нём; Phoenix не предоставляет размещённый ретранслятор. Настройка — явное согласие: во время неё ничего не отправляется, но записи в очереди затем синхронизируются автоматически, пока вы онлайн. «Синхронизировать сейчас» немедленно запускает попытку. Адаптер подготавливает только две явно выбранные настройки без содержимого; более поздние локальные изменения требуют «Опубликовать текущее». Текст встреч, людей и памяти этим адаптером никогда не передаётся.",
  "automation.sync.unavailable":
    "Настройки синхронизации недоступны в Phoenix Core. Этот запрос статуса не обращался к ретранслятору.",
  "automation.sync.relayNone": "не настроен",
  "automation.sync.relayUnknown": "настроенный ретранслятор (URL недоступен)",
  "automation.sync.statusOn":
    "Синхронизация включена. В очереди: {pending}; {conflicts, plural, one {# конфликт} few {# конфликта} many {# конфликтов} other {# конфликта}}.",
  "automation.sync.statusOff":
    "Синхронизация выключена. В очереди: {pending}; {conflicts, plural, one {# конфликт} few {# конфликта} many {# конфликтов} other {# конфликта}}.",
  "automation.sync.chooseExclusions":
    "Выберите исключения до согласия; исключённые классы и проекты не загружаются.",
  "automation.sync.excludeClasses": "Исключить классы данных",
  "automation.sync.class.preference": "предпочтения",
  "automation.sync.class.context": "контекст",
  "automation.sync.class.project_profile": "профиль проекта",
  "automation.sync.excludeProject": "Исключить проект по названию",
  "automation.sync.excludeProjectButton": "Исключить проект",
  "automation.sync.removeExclusion": "Убрать исключение для {name}",
  "automation.sync.exclusionsSaved": "Исключения сохранены.",
  "automation.sync.adapterLegend": "Включать существующие настройки по отдельности",
  "automation.sync.adapterNote":
    "Допустимы только настройки владельца аккаунта: уменьшение анимации (предпочтения) и количество результатов поиска (конфигурация контекста); источников на уровне проекта нет. Выбор подготавливает текущее значение. Более позднее локальное изменение публикуйте явно. Входящие значения остаются подготовленными, пока вы не проверите и не подтвердите их локальное применение. Исключение класса также снимает выбор его адаптера, если это возможно; уже опубликованные записи нужно сначала удалить и синхронизировать. Снятие выбора не стирает загруженный шифротекст; при необходимости удалите его синхронизированный элемент отдельно.",
  "automation.sync.adapter.reducedMotion": "Предпочтение уменьшения анимации",
  "automation.sync.adapter.searchCount": "Метаданные количества результатов поиска",
  "automation.sync.adapterSaved":
    "Выбор адаптера сохранён. Вновь выбранные текущие настройки подготовлены; другие источники не включены.",
  "automation.sync.adapterApplied": "Выбранная синхронизированная настройка применена локально.",
  "automation.sync.adapterPublished":
    "Текущая локальная настройка подготовлена для зашифрованной синхронизации.",
  "automation.sync.publish": "Опубликовать текущее: {key}",
  "automation.sync.reviewApply": "Проверить применение {key}",
  "automation.sync.applyPreview": "Предпросмотр применения настройки",
  "automation.sync.applyText":
    "Применить расшифрованную подготовленную ревизию {revision} настройки {key} к существующей локальной настройке? Она заменит текущее значение только после подтверждения. Текущее и входящее значения скрыты; определите версии по источнику и ревизии или отмените. Изменение локального значения или подготовленной ревизии делает этот предпросмотр недействительным.",
  "automation.sync.confirmApply": "Подтвердить применение настройки",
  "automation.sync.cancelApply": "Отменить применение",
  "automation.sync.relayLine":
    "Ретранслятор: {relay}. Идентичность: {identity}. Нужен доступный ретранслятор; этот статус не доказывает его доступность.",
  "automation.sync.identityNone": "недоступна",
  "automation.sync.identityNote":
    "Эта идентичность представляет общий аккаунт ключа восстановления, а не отдельное устройство. Устройства с одним ключом и токеном ретранслятора нельзя отозвать по отдельности, а защита ретранслятора от повторного воспроизведения не обеспечена.",
  "automation.sync.syncNow": "Синхронизировать сейчас",
  "automation.sync.turnOff": "Выключить синхронизацию",
  "automation.sync.turnedOff": "Синхронизация выключена. Записи в очереди остаются локальными.",
  "automation.sync.offlineNote":
    "Если ретранслятор недоступен, ручная синхронизация сообщает об ошибке, а ожидающие элементы остаются в очереди для повторной попытки позже. При конфликтах ничего не перезаписывается молча.",
  "automation.sync.syncedPending":
    "{pending, plural, one {# элемент остаётся} few {# элемента остаются} many {# элементов остаются} other {# элемента остаются}} в очереди. Проверьте статус и конфликты ниже.",
  "automation.sync.syncedDone": "Синхронизация завершена. Проверьте элементы и конфликты ниже.",
  "automation.sync.items": "Синхронизированные элементы",
  "automation.sync.itemsNote":
    "Только метаданные; содержимое элементов и конфликтующие значения не показываются.",
  "automation.sync.noItems": "Нет подготовленных записей синхронизации.",
  "automation.sync.itemLine":
    "{id} · {dataClass} · владелец {owner} · область {scope} · проект {project} · ревизия {revision} · обновлено {updated} · {state}",
  "automation.sync.projectNone": "нет",
  "automation.sync.updatedUnknown": "неизвестно",
  "automation.sync.state.deletionQueued": "удаление в очереди",
  "automation.sync.state.deleted": "удалено",
  "automation.sync.state.queued": "в очереди",
  "automation.sync.state.synced": "синхронизировано",
  "automation.sync.conflictMissing":
    "Конфликт: эта запись отсутствует на ретрансляторе. Оставьте локальную, чтобы восстановить её на ретрансляторе, или примите удаление на удалённой стороне, чтобы удалить локальную подготовленную запись синхронизации. Ничего не перезаписывается автоматически.",
  "automation.sync.conflictRemote":
    "Конфликт: удалённая ревизия {revision}, обновлена {updated}. Ничего не перезаписывается, пока вы не выберете сторону.",
  "automation.sync.reviewKeepLocal": "Проверить сохранение локальной версии для {id}",
  "automation.sync.reviewKeepRemote": "Проверить сохранение удалённой версии для {id}",
  "automation.sync.reviewAcceptDeletion": "Проверить принятие удалённого удаления для {id}",
  "automation.sync.reviewDeletion": "Проверить удаление на удалённой стороне для {id}",
  "automation.sync.resolutionPreview": "Предпросмотр разрешения конфликта",
  "automation.sync.previewFor": "Предпросмотр для {id} ({scope}):",
  "automation.sync.previewAcceptDeletion":
    "Принять удаление на удалённой стороне: локальная подготовленная запись синхронизации удаляется сейчас; ничего не загружается.",
  "automation.sync.previewRestore":
    "Восстановить отсутствующую удалённую запись: локальная версия ставится в очередь на загрузку при следующей успешной синхронизации.",
  "automation.sync.previewKeepRemote":
    "Оставить удалённую: локальная подготовленная запись синхронизации сейчас заменяется удалённой версией.",
  "automation.sync.previewKeepLocal":
    "Оставить локальную: эта версия ставится в очередь на загрузку при следующей успешной синхронизации. Более новое удалённое изменение по-прежнему потребует разрешения.",
  "automation.sync.previewTail":
    "Содержимое элементов здесь скрыто; если по метаданным версии определить нельзя, отмените. Здесь это действие нельзя отменить.",
  "automation.sync.confirmAcceptDeletion": "Подтвердить принятие удалённого удаления",
  "automation.sync.confirmRestore": "Подтвердить восстановление отсутствующей удалённой записи",
  "automation.sync.confirmKeepLocal": "Подтвердить: оставить локальную",
  "automation.sync.confirmKeepRemote": "Подтвердить: оставить удалённую",
  "automation.sync.cancelResolution": "Отменить разрешение",
  "automation.sync.resolvedDeletion":
    "Удаление на удалённой стороне принято. Локальная подготовленная запись синхронизации удалена; ничего не поставлено в очередь на загрузку.",
  "automation.sync.resolvedChoice":
    "Выбор по конфликту сохранён. Ожидающие изменения синхронизируются автоматически, пока вы онлайн; «Синхронизировать сейчас» немедленно запускает попытку.",
  "automation.sync.deletionConfirmation": "Подтверждение удаления на удалённой стороне",
  "automation.sync.deletionText":
    "Удалить {id} ({scope}) с ретранслятора? Локально в очередь ставится маркер удаления; удалённая копия удаляется только после успешной синхронизации. Здесь это действие нельзя отменить.",
  "automation.sync.confirmDeletion": "Подтвердить удаление на удалённой стороне",
  "automation.sync.cancelDeletion": "Отменить удаление",
  "automation.sync.deletionQueued":
    "Удаление поставлено в очередь. Удалённая копия не удаляется до успешной синхронизации.",
  "automation.sync.relayUrl": "HTTPS URL ретранслятора",
  "automation.sync.relayToken": "Токен аутентификации ретранслятора",
  "automation.sync.restoreKey":
    "Существующий ключ восстановления (необязательно, для восстановления идентичности)",
  "automation.sync.optInNote":
    "Явное согласие: настройка локально сохраняет учётные данные ретранслятора и включает автоматическую синхронизацию записей в очереди, пока вы онлайн. Новая идентичность один раз показывает ключ восстановления: сохраните его сразу, позже получить его нельзя. Повторная настройка после выключения синхронизации использует локально сохранённую идентичность, если она доступна. Никогда не передавайте свой ключ оператору ретранслятора.",
  "automation.sync.configure": "Настроить зашифрованную синхронизацию",
  "automation.sync.configured":
    "Синхронизация настроена. Записи в очереди синхронизируются автоматически, пока вы онлайн; «Синхронизировать сейчас» немедленно запускает попытку.",
  "automation.sync.recoveryGroup": "Одноразовый ключ восстановления",
  "automation.sync.recoveryText":
    "Скопируйте этот ключ восстановления и сейчас же сохраните в надёжном месте. Он показывается только один раз, позже его получить нельзя. Никому его не передавайте.",
  "automation.sync.copyKey": "Копировать ключ восстановления",
  "automation.sync.savedKey": "Я сохранил ключ — закрыть",
  "automation.sync.refresh": "Обновить статус синхронизации",
};
