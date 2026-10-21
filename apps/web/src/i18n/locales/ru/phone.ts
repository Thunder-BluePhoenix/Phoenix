// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "Связь с телефоном",
  "phone.intro":
    "Свяжите телефон, чтобы он мог одобрять или отклонять то, о чём спрашивает Phoenix. Пока вы не включите функцию, она выключена.",
  "phone.unavailable": "Не удалось загрузить настройки связи с телефоном.",
  "phone.warning.title": "Прежде чем включить",
  "phone.warning.network":
    "При включении открывается отдельный HTTPS-слушатель, доступный другим устройствам вашей локальной сети (не интернету).",
  "phone.warning.pairing":
    "Одобрять что-либо могут только телефоны, которые вы связали и затем подтвердили здесь. Для связывания нужен код, показанный на этом экране.",
  "phone.warning.trust": "Включайте только в надёжных сетях, например в домашней.",
  "phone.warning.presence":
    "Phoenix не может проверить, что за этим компьютером находится человек: любая программа на этом компьютере, имеющая токен сессии Core, тоже может связывать телефоны.",
  "phone.enable.label": "Разрешить телефонам в моей локальной сети подключаться",
  "phone.saved.on": "Связь с телефоном включена.",
  "phone.saved.off": "Связь с телефоном выключена.",
  "phone.saved.verifyOn":
    "Одобрения с телефона теперь требуют биометрической проверки или проверки устройства.",
  "phone.saved.verifyOff": "Одобрения с телефона больше не требуют проверки устройства.",
  "phone.killSwitch":
    "Аварийный выключатель включён, поэтому слушатель телефона закрыт. Включите связь с телефоном снова здесь после отключения аварийного выключателя.",
  "phone.lockedOut": "Связывание заблокировано до {time}: введено слишком много неверных кодов.",
  "phone.notListening": "Связь с телефоном включена, но слушатель ещё не запущен.",
  "phone.listen.address": "Адрес и порт",
  "phone.listen.fingerprint": "Отпечаток сертификата (SHA-256)",
  "phone.pair.show": "Показать код связывания",
  "phone.pair.cancel": "Отменить код",
  "phone.pair.cancelled": "Код связывания отменён.",
  "phone.pair.expired": "Код связывания истёк. Покажите новый, чтобы связать телефон.",
  "phone.pair.instruction":
    "На телефоне введите или отсканируйте этот код и проверьте, что показанный отпечаток совпадает с указанным ниже. Если не совпадает, не продолжайте.",
  "phone.pair.codeLabel": "Код связывания",
  "phone.pair.remaining": "Истекает через {time}",
  "phone.pair.fingerprint": "Отпечаток сертификата:",
  "phone.pair.link": "Ссылка для связывания (QR-код недоступен):",
  "phone.pair.hiddenActive":
    "Код связывания активен до {time}. Он не показывается повторно; отмените его и покажите новый.",
  "phone.pending.question": "Связать «{name}»?",
  "phone.pending.fingerprint": "Отпечаток ключа",
  "phone.pending.yes": "Да, связать этот телефон",
  "phone.pending.no": "Нет, отклонить",
  "phone.pending.waiting": "Ожидание запроса подтверждения от Phoenix.",
  "phone.pending.approved": "Телефон связан.",
  "phone.pending.rejected": "Связывание отклонено.",
  "phone.verify.label": "Требовать биометрическую проверку или проверку устройства при одобрениях",
  "phone.verify.note":
    "Телефон сообщает, была ли проверена личность (отпечаток, лицо или блокировка экрана). Phoenix сам не может проверить это сообщение.",
  "phone.devices.title": "Связанные телефоны",
  "phone.devices.none": "Нет связанных телефонов.",
  "phone.devices.fingerprint": "Отпечаток ключа",
  "phone.devices.created": "Связан {date}",
  "phone.devices.lastSeen": "последний раз был {when}",
  "phone.devices.neverSeen": "ни разу не был на связи",
  "phone.devices.revoked": "Отозван {date}",
  "phone.devices.revoke": "Отозвать {name}",
  "phone.devices.revokeAsk": "Отозвать «{name}»? Он больше не сможет ничего одобрять.",
  "phone.devices.revokeYes": "Да, отозвать",
  "phone.devices.revokeNo": "Оставить",
  "phone.devices.revokedDone": "Телефон отозван.",
  "phone.device.unnamed": "Телефон без имени",
};
