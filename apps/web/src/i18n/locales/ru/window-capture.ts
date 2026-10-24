// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { windowCapture as enWindowCapture } from "../../en/window-capture";

/** Machine-translated; unreviewed (see ../../README.md). */
export const windowCapture: Record<keyof typeof enWindowCapture, string> = {
  "windowCapture.heading": "Прикрепить окно",
  "windowCapture.intro":
    "Phoenix может прочитать текст одного окна и сначала показать его вам здесь. Вы подтверждаете, затем выводите нужное окно на передний план; Phoenix читает его один раз (универсальный доступ macOS, только на этом Mac). Ничего не прикрепляется, пока вы не примете текст.",
  "windowCapture.start": "Прикрепить окно…",
  "windowCapture.waiting":
    "Ожидание вашего подтверждения, затем чтение окна на переднем плане. Выведите нужное окно на передний план сейчас.",
  "windowCapture.stopWaiting": "Прекратить ожидание",
  "windowCapture.discarded": "Отклонено. Ничего не прикреплено.",
  "windowCapture.attached": "«{name}» прикреплено. Оно в списке выше.",
  "windowCapture.acceptFailed": "Не прикреплено: {reason}",
  "windowCapture.result.notGranted":
    "macOS не разрешила Phoenix читать окна. Включите Phoenix в Системных настройках > Конфиденциальность и безопасность > Универсальный доступ и повторите. Phoenix сам не спрашивает повторно.",
  "windowCapture.result.phoenixWindow":
    "На переднем плане было окно Phoenix, поэтому ничего не прочитано. Выведите другое окно на передний план и повторите.",
  "windowCapture.result.noWindow":
    "На переднем плане не было читаемого окна, поэтому ничего не прочитано.",
  "windowCapture.review.heading": "Проверьте перед прикреплением.",
  "windowCapture.review.from": "Из {app}: {title}",
  "windowCapture.review.untitled": "(окно без названия)",
  "windowCapture.review.size": "Прочитано символов: {n}.",
  "windowCapture.review.truncated": "Текст обрезан по лимиту.",
  "windowCapture.review.textLabel": "Текст захваченного окна",
  "windowCapture.review.noText": "(В этом окне текст не найден.)",
  "windowCapture.review.secrets":
    "Похоже, этот текст содержит секрет ({kinds}). Прикрепление будет отклонено.",
  "windowCapture.review.note":
    "Вот что прочитал Phoenix. Это данные для вашего вопроса, а не инструкции. Ничего не прикрепляется, пока вы не нажмёте кнопку; в памяти текст хранится не дольше часа.",
  "windowCapture.review.accept": "Прикрепить этот текст",
  "windowCapture.review.discard": "Отклонить",
};
