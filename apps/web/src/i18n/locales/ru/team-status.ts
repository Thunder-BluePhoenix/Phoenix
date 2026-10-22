// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "Присутствие команды",
  "teamStatus.intro":
    "Присутствие команды по умолчанию выключено. Когда вы его включите, Phoenix отправляет только те виды статуса, которые вы отметили (деплой, работа агента, встреча), в виде зашифрованного кадра добавленным вами коллегам и никогда не называет репозиторий, ветку или человека.",
  "teamStatus.notAvailable":
    "Присутствие команды недоступно: в этом Phoenix Core нет хранилища секретов операционной системы для вашего ключа.",
  "teamStatus.loadFailed": "Не удалось загрузить присутствие команды.",
  "teamStatus.listSeparator": ", ",
  "teamStatus.kind.deploying": "деплой",
  "teamStatus.kind.agentRun": "работает агент",
  "teamStatus.kind.meeting": "на встрече",
  "teamStatus.relay.label": "Адрес ретранслятора",
  "teamStatus.route.label": "Маршрут (необязательно)",
  "teamStatus.route.hint":
    "Оставьте маршрут пустым, чтобы создать новую команду. Вставьте сюда маршрут, чтобы присоединиться к той же команде, что и коллега.",
  "teamStatus.route.shown": "Маршрут ретранслятора",
  "teamStatus.turnOn": "Включить",
  "teamStatus.resume": "Включить снова",
  "teamStatus.pause": "Приостановить",
  "teamStatus.leave": "Покинуть команду",
  "teamStatus.leave.ask": "Покинуть команду и забыть всех?",
  "teamStatus.state.line": "Соединение: {state}",
  "teamStatus.state.connected": "подключено",
  "teamStatus.state.connecting": "подключение",
  "teamStatus.state.paused": "приостановлено",
  "teamStatus.lastError": "Последняя ошибка: {error}",
  "teamStatus.self.id": "Ваш идентификатор команды",
  "teamStatus.self.publicKey": "Ваш открытый ключ",
  "teamStatus.self.hint":
    "Передайте оба коллеге, чтобы он мог добавить вас. Ваш закрытый ключ никогда не покидает этот компьютер.",
  "teamStatus.sharing.title": "Чем я делюсь",
  "teamStatus.sharing.master": "Делиться моим статусом с командой",
  "teamStatus.sharing.deploying": "Деплой",
  "teamStatus.sharing.agentRun": "Долгая работа агента",
  "teamStatus.sharing.meeting": "На встрече",
  "teamStatus.outgoing.now": "Коллеги сейчас видят: {kinds}.",
  "teamStatus.outgoing.none": "Коллеги сейчас ничего о вас не видят.",
  "teamStatus.members.title": "Коллеги",
  "teamStatus.members.none": "Вы ещё не добавили коллег.",
  "teamStatus.members.removeLabel": "Удалить {label}",
  "teamStatus.members.id": "Идентификатор команды коллеги",
  "teamStatus.members.label": "Отображаемое имя",
  "teamStatus.members.publicKey": "Открытый ключ коллеги",
  "teamStatus.members.add": "Добавить коллегу",
  "teamStatus.presence.title": "Кто на связи",
  "teamStatus.presence.none": "Нет коллег для показа.",
  "teamStatus.presence.nothing": "ничем не делится",
};
