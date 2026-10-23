// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "Режим концентрации",
  "focus.start": "Начать",
  "focus.stop": "Завершить",
  "focus.minutes": "Минуты (оставьте пустым без таймера)",
  "focus.remaining": "Осталось минут: {count}",
  "focus.active": "Режим активен",
  "focus.inactive": "Режим выключен",
  "focus.held": "Отложено уведомлений: {count}",
  "focus.osDnd": "Системный режим «Не беспокоить» активен",
  "focus.osUnknown": "Состояние «Не беспокоить» недоступно",
  "focus.refresh": "Обновить состояние системы",
  "focus.pomodoro": "Запустить Помодоро",
  "focus.systemUnavailable":
    "Системный режим «Не беспокоить» недоступен; режим концентрации управляет только уведомлениями Phoenix.",
  "focus.screenshot.title": "Снимок экрана в задачу",
  "focus.screenshot.capture": "Выбрать область экрана…",
  "focus.screenshot.permission": "Требуется разрешение на запись экрана.",
  "focus.screenshot.error": "Не удалось выполнить: {error}",
  "focus.screenshot.box": "Рамка",
  "focus.screenshot.arrow": "Стрелка",
  "focus.screenshot.text": "Текст",
  "focus.screenshot.redact": "Скрыть навсегда",
  "focus.screenshot.annotationText": "Текст заметки",
  "focus.screenshot.project": "Репозиторий или проект",
  "focus.screenshot.issueTitle": "Название задачи",
  "focus.screenshot.body": "Описание задачи",
  "focus.screenshot.preview": "Предпросмотр черновика",
  "focus.screenshot.create": "Запросить одобрение и создать задачу",
  "focus.screenshot.draft": "Черновик задачи (не создана)",
  "focus.screenshot.attachment": "Снимок приложен, если поддерживается",
  "focus.screenshot.noAttachment":
    "Этот сервис не поддерживает вложения; изображение не будет отправлено.",
  "focus.screenshot.created": "Задача создана: {url}",
  "focus.screenshot.declined": "Создание не одобрено; ничего не отправлено.",
  "focus.screenshot.tracker": "Трекер задач",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "Задача из имеющегося у вас изображения",
  "focus.issueDraft.intro":
    "Перетащите, вставьте или выберите уже имеющийся PNG или JPEG, напишите задачу и проверьте, что именно будет отправлено. Phoenix не снимает ваш экран. Задача создаётся на GitHub только после вашего подтверждения здесь и ещё раз в разделе «Подтверждения».",
  "focus.issueDraft.unavailable.capability":
    "Интеграция с GitHub не включена или не может создавать задачи, поэтому ничего создать нельзя.",
  "focus.issueDraft.unavailable.token":
    "Для интеграции с GitHub не задан токен записи, поэтому ничего создать нельзя.",
  "focus.issueDraft.dropLabel": "Перетащите изображение для задачи",
  "focus.issueDraft.dropHint": "Перетащите или вставьте сюда PNG или JPEG либо {choose}.",
  "focus.issueDraft.choose": "выберите изображение…",
  "focus.issueDraft.chooseLabel": "Выбрать изображение для задачи",
  "focus.issueDraft.imageAlt": "Изображение для задачи: {name}",
  "focus.issueDraft.imageRemove": "Убрать изображение",
  "focus.issueDraft.oneImage": "Добавляйте по одному изображению.",
  "focus.issueDraft.imageRequired": "Сначала добавьте изображение.",
  "focus.issueDraft.titleRequired": "Напишите заголовок задачи.",
  "focus.issueDraft.titleTooLong": "Заголовок может содержать не более {max} символов.",
  "focus.issueDraft.bodyTooLong": "Описание может содержать не более {max} символов.",
  "focus.issueDraft.secretInTitle":
    "Заголовок похож на содержащий пароль, ключ или токен. Удалите его; ничего не отправлено.",
  "focus.issueDraft.secretInBody":
    "Описание похоже на содержащее пароль, ключ или токен. Удалите его; ничего не отправлено.",
  "focus.issueDraft.secretInBoth":
    "Заголовок и описание похожи на содержащие пароль, ключ или токен. Удалите его; ничего не отправлено.",
  "focus.issueDraft.previewRepository": "Репозиторий: {repository}",
  "focus.issueDraft.previewTitle": "Заголовок: {title}",
  "focus.issueDraft.previewBody": "Описание в точности так, как оно будет отправлено:",
  "focus.issueDraft.previewNoBody": "Описание отправлено не будет.",
  "focus.issueDraft.imageLocal":
    "Изображение ({name}) НЕ отправляется. Задачи GitHub создаются только из текста; изображение остаётся на этом устройстве и не сохраняется. При желании добавьте его в задачу сами.",
  "focus.issueDraft.approval":
    "Пока ничего не создано. После нажатия кнопки Phoenix запросит ваше подтверждение в разделе «Подтверждения», прежде чем что-либо отправить на GitHub.",
  "focus.issueDraft.create": "Запросить создание задачи",
  "focus.issueDraft.waiting": "Ожидание вашего подтверждения в разделе «Подтверждения»…",
  "focus.issueDraft.denied": "Вы отклонили запрос; на GitHub ничего не отправлено.",
  "focus.issueDraft.blocked": "Аварийная остановка включена; на GitHub ничего не отправлено.",
  "focus.issueDraft.timeout":
    "Запрос не был подтверждён вовремя или был отменён; ничего не отправлено.",
  "focus.issueDraft.failed": "Не удалось создать задачу: {message}",
};
