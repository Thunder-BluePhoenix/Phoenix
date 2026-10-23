// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { sounds as ensounds } from "../../en/sounds";

/** Machine-translated; unreviewed (see ../../README.md). */
export const sounds: Record<keyof typeof ensounds, string> = {
  "sounds.title": "Звуки Fawkes",
  "sounds.intro":
    "Короткие сигналы, которые Fawkes издаёт, когда что-то происходит. По умолчанию выключены. Их создаёт сам Phoenix, и они никогда не звучат в тихом режиме, в тихие часы, при отключённом звуке, при аварийной остановке и в демо.",
  "sounds.enabled": "Разрешить Fawkes издавать звуки",
  "sounds.volume": "Громкость",
  "sounds.volumeValue": "{percent} процентов",
  "sounds.event.launch": "Привет",
  "sounds.event.poke": "Тычок",
  "sounds.event.dizzy": "Головокружение",
  "sounds.event.recover": "Пришёл в себя",
  "sounds.event.completion": "Задача завершена",
  "sounds.event.needsYou": "Нужны вы",
  "sounds.event.failure": "Что-то не удалось",
  "sounds.preview.legend": "Послушать звук",
  "sounds.preview.play": "Воспроизвести: {name}",
  "sounds.preview.hint":
    "Предпрослушивание играет с указанной громкостью, даже если звуки выключены, и только после того, как вы взаимодействовали со страницей.",
  "sounds.preview.muted": "Fawkes отключён по звуку, поэтому ничего не воспроизведено.",
  "sounds.preview.silentVolume": "Громкость равна 0, поэтому ничего не воспроизведено.",
  "sounds.preview.quiet":
    "Включены тихий режим, тихие часы, аварийная остановка или демо, поэтому ничего не воспроизведено.",
  "sounds.preview.noGesture": "Сначала щёлкните или нажмите клавишу на странице, затем повторите.",
  "sounds.preview.failed": "Не удалось воспроизвести звук на этом устройстве.",
  "sounds.saveFailed": "Не удалось сохранить настройки звука.",
  "sounds.loadFailed": "Не удалось загрузить настройки звука.",
  "sounds.note":
    "Папка с вашими звуками пока недоступна; используются только встроенные сигналы Phoenix.",
};
