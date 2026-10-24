// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "Поделиться моей учётной личностью",
  "teamInvite.share.intro":
    "Отправьте это приглашение коллеге в чате или по почте. В нём только ваш идентификатор команды, открытый ключ и имя, которое вы введёте ниже. Секретов в нём нет, а ваш закрытый ключ никогда не покидает этот компьютер.",
  "teamInvite.share.label": "Имя для приглашения (необязательно)",
  "teamInvite.share.invalid": "Не удалось создать приглашение из этой личности.",
  "teamInvite.share.invite": "Ваше приглашение",
  "teamInvite.share.copy": "Скопировать приглашение",
  "teamInvite.share.copied": "Приглашение скопировано в буфер обмена.",
  "teamInvite.share.copyFailed":
    "Phoenix не смог использовать буфер обмена. Выделите приглашение выше и скопируйте его вручную.",
  "teamInvite.share.fingerprintHint":
    "Назовите отпечаток коллеге голосом или в другом чате, чтобы он проверил, что полученное приглашение — ваше.",
  "teamInvite.fingerprint": "Отпечаток ключа",
  "teamInvite.checksumNote":
    "Короткий код в конце приглашения ловит только ошибки копирования. Он не доказывает, кто создал приглашение; это доказывает только сверка отпечатка.",
  "teamInvite.refusal.empty": "Сначала вставьте приглашение.",
  "teamInvite.refusal.tooLong": "Это слишком длинно для приглашения в команду.",
  "teamInvite.refusal.format": "Это не приглашение в команду Phoenix.",
  "teamInvite.refusal.version":
    "Это приглашение из другой версии Phoenix, которую эта версия не может прочитать.",
  "teamInvite.refusal.checksum":
    "Приглашение изменено или скопировано неверно. Попросите коллегу отправить его снова.",
  "teamInvite.refusal.content": "Приглашение повреждено или содержит неожиданные данные.",
  "teamInvite.refusal.id": "В приглашении недопустимый идентификатор команды.",
  "teamInvite.refusal.key": "В приглашении недопустимый открытый ключ.",
  "teamInvite.refusal.label": "В приглашении недопустимое имя.",
  "teamInvite.refusal.unsupported": "Этот браузер не может проверять приглашения.",
  "teamInvite.refusal.own": "Это приглашение — ваша собственная личность.",
  "teamInvite.refusal.duplicate":
    "Этот коллега уже в вашем списке. Сначала удалите его, чтобы сменить ключ.",
  "teamInvite.add.title": "Добавить коллегу",
  "teamInvite.add.paste": "Вставьте приглашение коллеги",
  "teamInvite.add.preview": "Проверьте эти данные, прежде чем добавлять коллегу.",
  "teamInvite.add.noLabel": "В приглашении нет имени; введите имя для показа.",
  "teamInvite.add.theirLabel": "В приглашении указано имя: {label}",
  "teamInvite.add.confirm":
    "Я сверил этот отпечаток с коллегой голосом или в другом чате, и он совпадает.",
};
