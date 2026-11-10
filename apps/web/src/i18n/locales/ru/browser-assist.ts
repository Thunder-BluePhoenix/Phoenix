// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "Попросить Фокса помочь с этой страницей",
  "browser.assist.title": "Попросить Фокса помочь с этой страницей",
  "browser.assist.goalLabel": "Что вы хотите сделать на этой странице?",
  "browser.assist.goalPlaceholder": "Например: добавь синий в корзину",
  "browser.assist.propose": "Предложить шаги",
  "browser.assist.proposing": "Запрос к локальной модели…",
  "browser.assist.close": "Закрыть помощника",
  "browser.assist.goalTooLong": "Цель может содержать не более {max} символов.",
  "browser.assist.goalControl": "Цель не может содержать управляющие символы.",
  "browser.assist.goalHidden":
    "Цель не может содержать символы направления текста и символы нулевой ширины.",
  "browser.assist.requestFailed": "Помощник недоступен. Ничего не выполнено.",
  "browser.assist.noLocalModel":
    "На устройстве нет модели, поэтому Фокс не читал эту страницу. Текст страницы никогда не отправляется в облачный сервис.",
  "browser.assist.localModelFailed":
    "Модель на устройстве дала сбой. Ничего не выполнено и ничего не отправлено в другое место.",
  "browser.assist.noBrowser":
    "В этом приложении Phoenix нет браузера, из которого можно прочитать страницу.",
  "browser.assist.inert":
    "Предложено локальной моделью, которая прочитала эту страницу. Ничего не выполнено. Эти шаги — обычный текст и могут быть неверными.",
  "browser.assist.forPage": "Для страницы: {url}",
  "browser.assist.dropped":
    "{count, plural, one {# предложение модели отклонено и не показано.} few {# предложения модели отклонены и не показаны.} many {# предложений модели отклонено и не показано.} other {# предложения модели отклонено и не показано.}}",
  "browser.assist.noSteps": "Модель не предложила шагов для этой страницы.",
  "browser.assist.kind.click": "Нажать",
  "browser.assist.kind.type": "Ввести в",
  "browser.assist.kind.submit": "Отправить форму",
  "browser.assist.typeText": "текст: {text}",
  "browser.assist.modelWritten": "написано локальной моделью, а не вами",
  "browser.assist.run": "Выполнить этот шаг",
  "browser.assist.step.running": "Ожидание вашего подтверждения…",
  "browser.assist.step.done": "Готово. Больше ничего не выполнено.",
  "browser.assist.refused.noTab": "Нет активной вкладки для выполнения этого шага.",
  "browser.assist.refused.moved":
    "Вкладка больше не на странице, для которой предложены эти шаги. Спросите снова.",
  "browser.assist.failed.denied": "Вы отклонили этот шаг.",
  "browser.assist.failed.blocked": "Phoenix отклонил этот шаг (страница или элемент не разрешены).",
  "browser.assist.failed.unavailable": "Браузер недоступен.",
  "browser.assist.failed.timeout": "Время шага истекло. Он мог выполниться, а мог и нет.",
  "browser.assist.failed.failed": "Шаг не выполнен.",
};
