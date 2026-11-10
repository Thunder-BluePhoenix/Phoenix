// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "Подтверждения в чате",
  "chatApprovals.notAvailable": "Подтверждения в чате недоступны в этом Phoenix Core.",
  "chatApprovals.intro":
    "Отвечайте на ожидающее подтверждение агента или Phoenix из Slack или Discord и получайте уведомления в Teams. Всё выключено, пока вы не включите это здесь, для каждого провайдера и каждого проекта.",
  "chatApprovals.limits":
    "Никогда не использовалось с настоящим пространством Slack, Discord или Teams: код проверялся только на имитированных обратных вызовах. Teams — только уведомления (ссылка в Phoenix, никогда не кнопка «Разрешить»). Нажатие кнопки проверяется по подписи провайдера и вашему списку утверждающих, а решение журналируется.",
  "chatApprovals.noDm":
    "Сводки и уведомления идут только в канал, указанный ниже. Личные сообщения человеку не реализованы.",
  "chatApprovals.capabilityOff":
    "Возможность «Подтверждения в чате» выключена, поэтому ничего не отправляется.",
  "chatApprovals.enable": "Включить возможность",
  "chatApprovals.ready": "Готово: этот провайдер может публиковать карточки.",
  "chatApprovals.notReady":
    "Не готово: нужно включить, указать id рабочего пространства, id канала и хотя бы одного утверждающего.",
  "chatApprovals.teamsNote":
    "Teams — только уведомления. Адрес вебхука и ключ ссылки хранятся ниже.",
  "chatApprovals.save": "Сохранить подтверждения в чате",
  "chatApprovals.saved": "Сохранено.",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "Включить {name}",
  "chatApprovals.notifyNamed": "Отправлять общее уведомление в {name}",
  "chatApprovals.digestNamed": "Включить {name} в сводки",
  "chatApprovals.notify": "Уведомлять (без подробностей) о запросах, не включённых для чата",
  "chatApprovals.digest.send": "Получать сводку",
  "chatApprovals.workspace.slack": "Id рабочего пространства Slack (команды)",
  "chatApprovals.workspace.discord": "Id сервера Discord (guild)",
  "chatApprovals.channel.slack": "Id канала Slack",
  "chatApprovals.channel.discord": "Id канала Discord",
  "chatApprovals.approvers.label":
    "Id пользователей {name}, которые могут решать (по одному в строке)",
  "chatApprovals.approvers.hint":
    "Только буквы и цифры, до 24 символов каждый, не более 20. Пустой список означает, что решать не может никто.",
  "chatApprovals.projects.title": "Разрешённые проекты",
  "chatApprovals.projects.hint":
    "Из чата можно отвечать только на подтверждения агентов этих проектов. Пусто: ни одного.",
  "chatApprovals.projects.label": "Названия проектов (по одному в строке)",
  "chatApprovals.digest.title": "Сводка по расписанию",
  "chatApprovals.digest.intro":
    "По умолчанию выключено. Отправляет счётчики и короткие id подтверждений в канал выше, только провайдерам, получающим сводку, никогда в тихие часы и никогда, если ничего не произошло.",
  "chatApprovals.digest.enabled": "Отправлять сводку по расписанию",
  "chatApprovals.digest.interval": "Минут между сводками",
  "chatApprovals.digest.hint": "От {min} (один час) до {max} минут (одна неделя).",
  "chatApprovals.cred.title": "Учётные данные",
  "chatApprovals.cred.writeOnly":
    "Только запись. Введённое отправляется в хранилище учётных данных Core и сразу удаляется с этой страницы. Сохранённые значения больше не показываются.",
  "chatApprovals.cred.save": "Сохранить",
  "chatApprovals.cred.stored": "Сохранено",
  "chatApprovals.cred.notStored": "Не сохранено",
  "chatApprovals.cred.remove": "Удалить",
  "chatApprovals.cred.removeNamed": "Удалить сохранённое: {name}",
  "chatApprovals.field.slackBot": "Токен бота Slack",
  "chatApprovals.field.slackSigning": "Секрет подписи Slack",
  "chatApprovals.field.discordBot": "Токен бота Discord",
  "chatApprovals.field.discordKey": "Публичный ключ приложения Discord",
  "chatApprovals.field.teamsWebhook": "Адрес вебхука Teams",
  "chatApprovals.field.teamsKey": "Ключ ссылки Teams",
  "chatApprovals.error.ids": "Id пространства и канала — только буквы и цифры, до 24 символов.",
  "chatApprovals.error.approvers":
    "Id утверждающих — только буквы и цифры, до 24 символов каждый, не более 20.",
  "chatApprovals.error.projects":
    "Названия проектов — от 1 до 120 видимых символов, не более 200 проектов.",
  "chatApprovals.error.interval": "Интервал сводки — целое число от 60 до 10080 минут.",
  "chatApprovals.error.save": "Не удалось сохранить настройку подтверждений в чате.",
  "chatApprovals.error.capability": "Не удалось изменить возможность «Подтверждения в чате».",
  "chatApprovals.error.unavailable":
    "В этом Phoenix Core нет хранилища учётных данных ОС, поэтому учётные данные сохранить нельзя.",
  "chatApprovals.error.cred": "Учётные данные не были сохранены или удалены.",
  "chatApprovals.error.credShape":
    "Это значение не подходит для данного поля, поэтому оно не отправлено. Проверьте и повторите.",
};
