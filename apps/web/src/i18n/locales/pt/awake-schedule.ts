// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { awakeSchedule as enAwakeSchedule } from "../../en/awake-schedule";

/** Machine-translated; unreviewed. */
export const awakeSchedule: Record<keyof typeof enAwakeSchedule, string> = {
  "awakeSchedule.loading": "Carregando…",
  "awakeSchedule.schedule.title": "Manter ativo por agenda",
  "awakeSchedule.schedule.notAvailable":
    "Manter ativo por agenda não está disponível: este Phoenix Core não tem um cofre de segredos do sistema.",
  "awakeSchedule.schedule.loadFailed": "Não foi possível carregar o manter ativo por agenda.",
  "awakeSchedule.schedule.intro":
    "Desativado por padrão. Ativá-lo e salvar cada janela perguntam antes em Aprovações; enquanto estiver ativado, este computador fica acordado durante as janelas salvas.",
  "awakeSchedule.schedule.awakeOff":
    "A capacidade Manter ativo não está habilitada, então nenhuma janela pode manter este computador acordado. Habilite-a em Integrações.",
  "awakeSchedule.schedule.enable": "Manter este computador acordado durante minhas janelas salvas",
  "awakeSchedule.schedule.confirming": "Aguardando sua confirmação em Aprovações…",
  "awakeSchedule.state.off": "Manter ativo por agenda está desativado.",
  "awakeSchedule.state.idle":
    "Manter ativo por agenda está ativado. Nenhuma janela está em andamento agora.",
  "awakeSchedule.state.holding": "Mantendo este computador acordado agora.",
  "awakeSchedule.state.holdingUntil": "Mantendo este computador acordado até {time}.",
  "awakeSchedule.state.waiting": "Uma janela está aguardando para começar porque {reason}",
  "awakeSchedule.waiting.needs_charger": "este computador não está na tomada.",
  "awakeSchedule.waiting.battery_low": "a bateria está abaixo do seu mínimo.",
  "awakeSchedule.waiting.low_power_mode": "o modo de baixo consumo está ativado.",
  "awakeSchedule.waiting.power_unknown": "não foi possível ler o estado da energia.",
  "awakeSchedule.waiting.busy": "outra sessão de manter ativo já está em andamento.",
  "awakeSchedule.waiting.battery_floor": "a bateria está baixa demais para continuar mantendo.",
  "awakeSchedule.waiting.start_failed": "não foi possível iniciar o manter ativo.",
  "awakeSchedule.waiting.unknown": "de um motivo que esta versão não reconhece.",
  "awakeSchedule.cancel.button": "Cancelar a janela atual",
  "awakeSchedule.list.title": "Janelas salvas",
  "awakeSchedule.list.empty": "Nenhuma janela salva.",
  "awakeSchedule.list.line": "{when}, {start}–{end} ({zone})",
  "awakeSchedule.list.remove": "Remover",
  "awakeSchedule.list.removeNamed": "Remover {name}",
  "awakeSchedule.upcoming.title": "Próximas janelas",
  "awakeSchedule.upcoming.empty": "Nenhuma janela próxima.",
  "awakeSchedule.upcoming.line": "{name}: de {from} a {to}",
  "awakeSchedule.upcoming.skipped": "Ignorada",
  "awakeSchedule.upcoming.skip": "Ignorar",
  "awakeSchedule.upcoming.unskip": "Parar de ignorar",
  "awakeSchedule.upcoming.skipNamed": "Ignorar {name} em {time}",
  "awakeSchedule.upcoming.unskipNamed": "Parar de ignorar {name} em {time}",
  "awakeSchedule.add.title": "Adicionar uma janela",
  "awakeSchedule.add.id": "Nome (letras minúsculas, dígitos, hífens)",
  "awakeSchedule.add.label": "Rótulo (opcional)",
  "awakeSchedule.add.zone": "Fuso horário",
  "awakeSchedule.add.start": "Início",
  "awakeSchedule.add.end": "Fim",
  "awakeSchedule.add.days": "Repete em",
  "awakeSchedule.add.charger": "Somente na tomada",
  "awakeSchedule.add.minBattery": "Bateria mínima (%)",
  "awakeSchedule.add.submit": "Salvar janela",
  "awakeSchedule.lights.title": "Luzes de status",
  "awakeSchedule.lights.notAvailable":
    "As luzes de status não estão disponíveis: este Phoenix Core não tem um cofre de segredos do sistema.",
  "awakeSchedule.lights.loadFailed": "Não foi possível carregar as luzes de status.",
  "awakeSchedule.lights.intro":
    "O Fawkes pode mostrar o que está fazendo em uma luz da sua própria rede. Uma luz só é contatada se você a adicionou aqui, permitiu que o Fawkes a acenda e a capacidade Luzes de status está habilitada.",
  "awakeSchedule.lights.limits":
    "Apenas cores fixas são enviadas, nunca texto. Por enquanto só há suporte para o Elgato Key Light.",
  "awakeSchedule.lights.capabilityOff":
    "A capacidade Luzes de status não está habilitada. Habilite-a aqui ou em Integrações.",
  "awakeSchedule.lights.enable": "Habilitar",
  "awakeSchedule.lights.empty": "Nenhuma luz adicionada.",
  "awakeSchedule.lights.line": "Key Light em {address}",
  "awakeSchedule.lights.allow": "Permitir que o Fawkes acenda esta luz",
  "awakeSchedule.lights.allowNamed": "Permitir que o Fawkes acenda {name}",
  "awakeSchedule.lights.remove": "Remover",
  "awakeSchedule.lights.removeNamed": "Remover {name}",
  "awakeSchedule.lights.add.title": "Adicionar uma Key Light",
  "awakeSchedule.lights.add.id": "Nome",
  "awakeSchedule.lights.add.address": "Endereço na sua rede (por exemplo 192.168.1.20)",
  "awakeSchedule.lights.add.submit": "Adicionar luz",
};
