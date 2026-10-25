// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserApproval as enBrowserApproval } from "../../en/browser-approval";

/** Machine-translated; unreviewed. */
export const browserApproval: Record<keyof typeof enBrowserApproval, string> = {
  "browserApproval.action": "Действие в браузере",
  "browserApproval.action.click": "Нажать элемент на странице",
  "browserApproval.action.type": "Ввести текст в поле на странице",
  "browserApproval.action.submit": "Отправить форму на странице",
  "browserApproval.action.download": "Начать загрузку со страницы",
  "browserApproval.action.navigate": "Перейти на другой адрес",
  "browserApproval.action.missing": "В запросе не указано, что это за действие.",
  "browserApproval.page": "Страница",
  "browserApproval.page.missing": "В запросе не указана страница.",
  "browserApproval.selector": "Элемент",
  "browserApproval.selector.missing": "В запросе не указан элемент.",
  "browserApproval.destination": "Адрес назначения",
  "browserApproval.destination.missing": "В запросе не указан адрес назначения.",
  "browserApproval.queryHidden": "В адресе есть также часть запроса, она не показана.",
  "browserApproval.text": "Текст, который будет введён (показан полностью)",
  "browserApproval.text.missing": "В запросе нет текста.",
  "browserApproval.textLength": "Длина текста",
  "browserApproval.textLength.value": "Символов: {length}",
  "browserApproval.textLength.missing": "Длина текста не указана.",
};
