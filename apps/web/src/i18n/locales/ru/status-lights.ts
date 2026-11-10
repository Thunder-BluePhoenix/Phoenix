// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "Отправляются только фиксированные цвета, но никогда не текст. Учётные данные (ключ приложения Hue, токен Luxafor) доступны только для записи: после сохранения они больше не показываются. Имена и идентификаторы, которые сообщает лампа, показываются как обычный текст.",
  "statusLights.line.luxafor": "Приложение Luxafor по адресу {address}",
  "statusLights.line.hue": "Лампа Hue на мосту {bridge}",

  "statusLights.error.unavailable":
    "У этого Phoenix Core нет хранилища учётных данных ОС, поэтому сохранить учётные данные нельзя.",
  "statusLights.error.save": "Не удалось сохранить список ламп. Проверьте имя и адрес.",
  "statusLights.error.capability": "Не удалось изменить настройку «Индикаторы состояния».",
  "statusLights.error.hueName":
    "Дайте мосту имя из букв, цифр и символов . _ : - (до 160 символов).",
  "statusLights.error.hueInspect":
    "Мост не ответил по этому адресу. Используйте его адрес IPv4 в вашей собственной сети.",
  "statusLights.error.huePair":
    "Не удалось выполнить сопряжение. Нажмите круглую кнопку связи на мосту и повторите попытку.",
  "statusLights.error.hueRemove": "Не удалось удалить мост.",
  "statusLights.error.hueLights": "Не удалось получить список ламп этого моста.",
  "statusLights.error.luxaforToken":
    "Токен не сохранён. Он должен состоять из 1–128 печатаемых символов без пробелов.",
  "statusLights.error.lifx":
    "Обнаружение LIFX не завершилось. Подождите несколько секунд и повторите попытку.",
  "statusLights.error.quietInvalid":
    "Введите два времени и существующий часовой пояс, например Europe/Paris.",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue недоступен: у этого Phoenix Core нет хранилища учётных данных ОС.",
  "statusLights.hue.loadFailed": "Не удалось загрузить мосты Hue.",
  "statusLights.hue.intro":
    "Сопряжённый мост считается доверенным, только пока он предъявляет сертификат, отпечаток SHA-256 которого вы подтвердили. Ключ его приложения хранится в хранилище учётных данных вашей ОС и никогда не показывается.",
  "statusLights.hue.empty": "Нет сопряжённых мостов.",
  "statusLights.hue.bridgeLine": "по адресу {address}:{port}",
  "statusLights.hue.fingerprint": "Отпечаток SHA-256:",
  "statusLights.hue.find": "Показать лампы",
  "statusLights.hue.findNamed": "Показать лампы моста {name}",
  "statusLights.hue.remove": "Удалить мост",
  "statusLights.hue.removeNamed": "Удалить мост {name}",
  "statusLights.hue.removeNote":
    "Удаление моста стирает сохранённый ключ. Лампы, которые его используют, больше не опрашиваются.",
  "statusLights.hue.noLights": "Этот мост не сообщил ни об одной лампе.",
  "statusLights.hue.alreadyAdded": "Добавлено",
  "statusLights.hue.add": "Добавить",
  "statusLights.hue.addNamed": "Добавить лампу Hue {name}",
  "statusLights.hue.pairTitle": "Сопряжение с мостом",
  "statusLights.hue.name": "Имя этого моста",
  "statusLights.hue.address": "Адрес моста в вашей сети (например, 192.168.1.2)",
  "statusLights.hue.lookup": "Прочитать сертификат моста",
  "statusLights.hue.confirmGroup": "Подтвердите сертификат моста",
  "statusLights.hue.found": "Мост ответил по адресу {address}:{port}.",
  "statusLights.hue.certName": "Субъект сертификата: {name}",
  "statusLights.hue.linkStep":
    "Нажмите сейчас круглую кнопку связи сверху на мосту, затем подтвердите ниже. Сопряжение отклоняется, если кнопка не была нажата примерно в последние 30 секунд.",
  "statusLights.hue.confirm":
    "Я сравнил(а) этот отпечаток с отпечатком на моём мосту и доверяю этому мосту.",
  "statusLights.hue.pair": "Сопрячь и закрепить этот отпечаток",
  "statusLights.hue.cancel": "Отмена",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix обращается только к локальному вебхуку приложения Luxafor по обычному HTTP в вашей собственной сети. Приложение отвечает «успешно» при любом токене, поэтому сохранённый токен не доказывает, что лампа изменилась.",
  "statusLights.luxafor.name": "Название этого индикатора Luxafor",
  "statusLights.luxafor.address": "Адрес компьютера, на котором работает приложение Luxafor",
  "statusLights.luxafor.add": "Добавить лампу Luxafor",
  "statusLights.luxafor.token": "Токен вебхука",
  "statusLights.luxafor.tokenNamed": "Токен вебхука для {name}",
  "statusLights.luxafor.save": "Задать или заменить токен",
  "statusLights.luxafor.saved": "Токен сохранён.",
  "statusLights.luxafor.writeOnly":
    "Токен больше не показывается. Чтобы очистить его, удалите эту лампу.",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "Обнаружение отправляет один широковещательный запрос в вашей сети и перечисляет ответившие лампы. Ничего не добавляется и никакой цвет не отправляется, пока вы не включите лампу.",
  "statusLights.lifx.discover": "Найти лампы LIFX",
  "statusLights.lifx.none": "Ни одна лампа LIFX не ответила.",
  "statusLights.lifx.line": "Лампа LIFX {serial} по адресу {address}",
  "statusLights.lifx.added": "Добавлено",
  "statusLights.lifx.enable": "Добавить эту лампу",
  "statusLights.lifx.enableNamed": "Добавить лампу LIFX {serial}",

  "statusLights.quiet.title": "Тихие часы",
  "statusLights.quiet.intro":
    "В это время лампы остаются выключенными, в выбранном вами часовом поясе.",
  "statusLights.quiet.off": "Тихие часы отключены.",
  "statusLights.quiet.on": "Лампы выключены с {start} до {end} ({timezone}).",
  "statusLights.quiet.start": "С",
  "statusLights.quiet.end": "До",
  "statusLights.quiet.timezone": "Часовой пояс",
  "statusLights.quiet.save": "Сохранить тихие часы",
  "statusLights.quiet.clear": "Отключить тихие часы",
};
