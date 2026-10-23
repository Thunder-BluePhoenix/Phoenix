// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mission as enmission } from "../../en/mission";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mission: Record<keyof typeof enmission, string> = {
  "mission.title": "Controle de missão",
  "mission.nav": "Missão",
  "mission.note":
    "Os tokens e o custo são o que os próprios agentes informam. Não são conferidos com a fatura do provedor.",
  "mission.sourceMissing":
    "Algumas sessões de agentes não puderam ser lidas agora (o recurso de agentes está desativado ou não responde), então o quadro pode estar sem sessões.",
  "mission.refresh": "Atualizar",
  "mission.loadFailed": "Não foi possível carregar o controle de missão.",

  "mission.filter.search": "Pesquisar sessões",
  "mission.filter.searchPlaceholder": "Agente, projeto ou id da sessão",
  "mission.filter.agent": "Agente",
  "mission.filter.project": "Projeto",
  "mission.filter.state": "Estado",
  "mission.filter.all": "Todos",
  "mission.filter.clear": "Limpar filtros",

  "mission.state.working": "Trabalhando",
  "mission.state.waiting": "Aguardando você",
  "mission.state.finished": "Concluída",
  "mission.state.stuck": "Travada",
  "mission.reason.permission": "Precisa da sua permissão",
  "mission.reason.input": "Tem uma pergunta para você",
  "mission.reason.idle": "Parada no prompt",
  "mission.stuck.noReport": "Sem relatório há mais tempo que o limite de travamento",
  "mission.stuck.safetyStall": "Marcada como travada pela rede de segurança",

  "mission.board.title": "Sessões",
  "mission.board.empty": "Nenhuma sessão de agente para mostrar.",
  "mission.board.noMatch": "Nenhuma sessão corresponde aos filtros.",
  "mission.column.count": "{count, plural, one {# sessão} other {# sessões}}",
  "mission.column.empty": "Nenhuma",

  "mission.card.open": "Detalhes",
  "mission.card.focus": "Ir para o terminal",
  "mission.card.focused": "A janela do terminal foi trazida para a frente.",
  "mission.card.unnamedProject": "projeto desconhecido",
  "mission.card.tokens": "{input} de entrada, {output} de saída",
  "mission.card.noTokens": "Nenhuma contagem de tokens informada",
  "mission.card.cost": "Custo {cost}",
  "mission.card.costPartial": "Custo de {cost} ou mais (parte do uso não tem custo conhecido)",
  "mission.card.costUnknown": "Custo desconhecido",
  "mission.card.lastSeen": "Última resposta {ago}",
  "mission.card.steps": "{count, plural, one {# etapa} other {# etapas}}",

  "mission.totals.title": "Tokens e custo",
  "mission.totals.window": "{days, plural, one {Último # dia} other {Últimos # dias}}",
  "mission.totals.input": "Tokens de entrada",
  "mission.totals.output": "Tokens de saída",
  "mission.totals.cost": "Custo",
  "mission.totals.unknown": "desconhecido",
  "mission.totals.partial": "{cost} ou mais",
  "mission.totals.unpriced":
    "Não há preço definido para: {models}. O custo deles é desconhecido, não zero. Adicione um preço abaixo para ver um custo.",
  "mission.totals.empty": "Nenhum agente informou tokens ou custo neste período.",

  "mission.by.day": "Por dia",
  "mission.by.agent": "Por agente",
  "mission.by.project": "Por projeto",
  "mission.by.session": "Por sessão",
  "mission.col.day": "Dia",
  "mission.col.agent": "Agente",
  "mission.col.project": "Projeto",
  "mission.col.session": "Sessão",
  "mission.col.input": "Entrada",
  "mission.col.output": "Saída",
  "mission.col.cost": "Custo",

  "mission.budgets.title": "Orçamentos",
  "mission.budgets.note":
    "Um alerta chega antes de o limite ser atingido, em {thresholds} dele, uma vez por orçamento por dia. Orçamentos de custo só contam o uso com custo conhecido.",
  "mission.budgets.none": "Ainda não há orçamentos.",
  "mission.budgets.line": "{scope}, {metric}{agent}: {used} de {limit} ({pct}%)",
  "mission.budgets.lineAtLeast":
    "{scope}, {metric}{agent}: pelo menos {used} de {limit} ({pct}%); parte do uso não tem custo conhecido e não foi contada",
  "mission.ingest.notice":
    "Hoje o Core reduziu {clamped, plural, one {# relatório} other {# relatórios}} a um limite e recusou {refused, plural, one {# relatório} other {# relatórios}}, então os números abaixo podem ser menores do que os agentes informaram. Agentes: {agents}.",
  "mission.budgets.lineUnknown": "{scope}, {metric}{agent}: uso desconhecido, limite {limit}",
  "mission.budgets.agentSuffix": " ({agent})",
  "mission.budgets.scope": "Aplica-se a",
  "mission.budgets.scope.daily": "O dia inteiro",
  "mission.budgets.scope.session": "Cada sessão",
  "mission.budgets.metric": "Medido em",
  "mission.budgets.metric.tokens": "Tokens",
  "mission.budgets.metric.cost": "Dólares americanos",
  "mission.budgets.limit": "Limite",
  "mission.budgets.agent": "Agente (opcional)",
  "mission.budgets.add": "Adicionar orçamento",
  "mission.budgets.remove": "Remover o orçamento {id}",
  "mission.budgets.invalid": "Digite um limite maior que zero.",

  "mission.prices.title": "Preços",
  "mission.prices.note":
    "O Phoenix não tem preços embutidos. Digite os seus, em dólares americanos por milhão de tokens, com o nome do modelo que o agente informa.",
  "mission.prices.aiNote": "Modelos que também têm preço nas configurações de IA: {models}.",
  "mission.prices.none": "Ainda não há preços.",
  "mission.prices.model": "Modelo",
  "mission.prices.input": "Entrada por milhão de tokens",
  "mission.prices.output": "Saída por milhão de tokens",
  "mission.prices.line": "{model}: {input} de entrada, {output} de saída por milhão de tokens",
  "mission.prices.add": "Salvar preço",
  "mission.prices.remove": "Remover o preço de {model}",
  "mission.prices.invalid": "Digite um nome de modelo e dois preços de zero ou mais.",

  "mission.stall.label":
    "Marcar uma sessão ativa como travada após esta quantidade de minutos sem relatório",
  "mission.stall.save": "Salvar",

  "mission.keep.label":
    "Excluir registros de uso mais antigos que esta quantidade de dias (de 7 a 3650)",
  "mission.keep.save": "Salvar",

  "mission.saved": "Salvo",
  "mission.delete.button": "Excluir todo o uso dos agentes",
  "mission.delete.warning":
    "Excluir todos os números de tokens e custo armazenados? Os orçamentos e os preços permanecem. Isso não pode ser desfeito.",
  "mission.delete.confirm": "Sim, excluir",
  "mission.delete.done": "{count, plural, one {# registro excluído} other {# registros excluídos}}",
};
