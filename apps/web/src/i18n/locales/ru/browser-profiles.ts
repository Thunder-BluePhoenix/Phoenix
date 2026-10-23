// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "Профили браузера",
  "browserProfiles.intro":
    "У Phoenix пока нет собственного браузера, поэтому здесь ничего не открывается: профиль — это запись закладок, выбора синхронизации и расширений.",
  "browserProfiles.unavailable":
    "Профили браузера недоступны: у Phoenix Core нет хранилища секретов операционной системы, где их можно безопасно держать.",
  "browserProfiles.loadFailed": "Не удалось прочитать профили браузера из Phoenix Core.",
  "browserProfiles.empty": "Профилей пока нет.",
  "browserProfiles.list": "Профили",
  "browserProfiles.create.name": "Название профиля",
  "browserProfiles.create.submit": "Создать профиль",
  "browserProfiles.counts": "Закладки: {bookmarks} · История: {history} · Расширения: {extensions}",
  "browserProfiles.sync.label": "Синхронизировать этот профиль между моими устройствами",
  "browserProfiles.sync.hint":
    "Синхронизация работает, только если синхронизация аккаунта тоже настроена в разделе «Настройки → Синхронизация».",
  "browserProfiles.import.label": "Закладки для импорта (HTML-файл, экспортированный браузером)",
  "browserProfiles.import.hint":
    "Вставьте содержимое файла. Не более 256 KiB за раз; большой экспорт разделите на части.",
  "browserProfiles.import.submit": "Импортировать закладки",
  "browserProfiles.import.result": "Импортировано: {imported}, пропущено: {skipped}.",
  "browserProfiles.publish.submit": "Опубликовать на моих других устройствах",
  "browserProfiles.publish.done": "Опубликовано.",
  "browserProfiles.remove.start": "Удалить профиль",
  "browserProfiles.remove.ask":
    "Удалить «{name}»? Будут удалены его закладки, история, расширения и сохранённые учётные данные; это нельзя отменить.",
  "browserProfiles.remove.done":
    "Профиль удалён. Его закладки, история, расширения и сохранённые учётные данные удалены. Изолированное веб-хранилище {partition} Phoenix Core пока очистить не может.",
  "browserProfiles.devices.heading": "Другие устройства",
  "browserProfiles.devices.check": "Проверить профили с моих других устройств",
  "browserProfiles.devices.none": "Новых профилей с ваших других устройств нет.",
  "browserProfiles.devices.found": "Профили с ваших других устройств",
  "browserProfiles.devices.adopt": "Принять",
  "browserProfiles.devices.adoptLabel": "Принять {name} на это устройство",
  "browserProfiles.devices.adopted": "Профиль принят.",
  "browserProfiles.ext.heading": "Расширения",
  "browserProfiles.ext.admin": "Расширения устанавливает ваш администратор.",
  "browserProfiles.ext.none": "Расширений нет.",
  "browserProfiles.ext.loadFailed": "Не удалось прочитать расширения.",
  "browserProfiles.ext.version": "Версия {version}",
  "browserProfiles.ext.origins": "Сайты: {origins}",
  "browserProfiles.ext.permissions": "Разрешения: {permissions}",
  "browserProfiles.ext.noneListed": "нет",
  "browserProfiles.ext.approved": "Одобрено",
  "browserProfiles.ext.notApproved": "Не одобрено",
  "browserProfiles.ext.revoked": "Отозвано",
  "browserProfiles.ext.untrusted": "Подписант не доверенный",
  "browserProfiles.ext.approve": "Одобрить",
  "browserProfiles.ext.approveLabel": "Одобрить расширение {id}",
  "browserProfiles.ext.withdraw": "Отозвать одобрение",
  "browserProfiles.ext.withdrawLabel": "Отозвать одобрение расширения {id}",
  "browserProfiles.ext.remove": "Удалить",
  "browserProfiles.ext.removeLabel": "Удалить расширение {id}",
  "browserProfiles.ext.waiting": "Ожидание вашего ответа на запрос об одобрении…",
  "browserProfiles.music.title": "Музыкальные сайты",
  "browserProfiles.music.intro":
    "Phoenix не воспроизводит музыку. Включение сайта лишь позволяет Phoenix составить для него адрес поиска, который вы открываете сами. Все сайты выключены, пока вы их не включите.",
  "browserProfiles.music.unavailable": "В этом Phoenix Core музыкальные сайты недоступны.",
  "browserProfiles.music.loadFailed": "Не удалось прочитать музыкальные сайты из Phoenix Core.",
  "browserProfiles.music.list": "Музыкальные сайты",
  "browserProfiles.music.hosts": "Используемые адреса: {hosts}",
  "browserProfiles.music.adBlocking":
    "Пока YouTube включён, блокировка рекламы не действует на его собственный плеер.",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "Музыкальный сайт {site}",
  "browserProfiles.music.search.label": "Поиск на {site}",
  "browserProfiles.music.search.submit": "Искать",
  "browserProfiles.music.search.open": "Адрес поиска (открывается в новой вкладке):",
  "browserProfiles.music.search.badAddress": "Phoenix Core вернул адрес, который нельзя открыть.",
};
