// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { mcp as enmcp } from "../../en/mcp";

/** Machine-translated; unreviewed (see ../../README.md). */
export const mcp: Record<keyof typeof enmcp, string> = {
  "mcp.title": "Servidor MCP do Phoenix",
  "mcp.intro":
    "Permite que agentes de código e outros clientes MCP neste computador leiam contexto do Phoenix e peçam sua aprovação. Fica desligado até você ligar, e cada cliente não recebe nada até você conceder.",
  "mcp.unavailable": "Não foi possível carregar as configurações do servidor MCP.",
  "mcp.demoUnavailable": "O servidor MCP não está disponível no modo de demonstração.",
  "mcp.warning.title": "Antes de ligar",
  "mcp.warning.local":
    "Abre um ouvinte separado apenas neste computador (127.0.0.1). Outros computadores e páginas da web não conseguem acessá-lo.",
  "mcp.warning.token":
    "Cada cliente tem seu próprio token, mostrado uma única vez. Qualquer programa que tenha um token pode usar o que você concedeu a esse cliente.",
  "mcp.warning.untrusted":
    "O que o Phoenix devolve é marcado como dados não confiáveis, mas um modelo que o leia ainda pode ser enganado pelo texto dentro dele. Conceda apenas o necessário.",
  "mcp.warning.approval":
    "Uma aprovação pedida por um cliente aparece junto com suas outras aprovações de agentes. Só você, aqui ou em um telefone pareado, pode respondê-la.",
  "mcp.enable.label": "Permitir que clientes MCP neste computador se conectem",
  "mcp.saved.on": "O servidor MCP está ligado.",
  "mcp.saved.off": "O servidor MCP está desligado.",
  "mcp.port.label": "Porta",
  "mcp.port.save": "Salvar porta",
  "mcp.port.saved": "Porta salva.",
  "mcp.killSwitch":
    "A parada de emergência está ativa: o servidor MCP está fechado. Ligue-o novamente aqui depois de desativá-la.",
  "mcp.notListening":
    "O servidor MCP está ligado, mas não está escutando. Verifique se a porta está livre.",
  "mcp.listening.url": "Endereço",
  "mcp.new.title": "Adicionar um cliente",
  "mcp.new.name": "Nome do cliente",
  "mcp.new.create": "Criar cliente",
  "mcp.new.created": "Cliente criado. Ele ainda não tem permissões.",
  "mcp.token.title": "Copie este token agora",
  "mcp.token.note":
    "Ele é mostrado só uma vez e o Phoenix guarda apenas uma impressão digital dele. Coloque-o no ambiente do cliente como PHOENIX_MCP_TOKEN, nunca em uma linha de comando.",
  "mcp.token.label": "Token do cliente",
  "mcp.token.copy": "Copiar token",
  "mcp.token.copied": "Token copiado.",
  "mcp.token.copyFailed": "Não foi possível copiar. Selecione o token e copie manualmente.",
  "mcp.token.done": "Já salvei",
  "mcp.clients.title": "Clientes",
  "mcp.clients.none": "Nenhum cliente ainda.",
  "mcp.client.created": "Criado em {date}",
  "mcp.client.id": "ID do cliente {id} (aparece nos cartões de aprovação deste cliente)",
  "mcp.client.lastUsed": "Último uso {when}",
  "mcp.client.neverUsed": "Nunca usado",
  "mcp.client.revokedOn": "Revogado em {date}",
  "mcp.client.noGrants": "Sem permissões: este cliente pode se conectar, mas tudo é recusado.",
  "mcp.grants.title": "O que {name} pode fazer",
  "mcp.grants.tools": "Ferramentas de leitura",
  "mcp.grants.tool.phoenix_activity": "Sessões de agentes recentes",
  "mcp.grants.tool.phoenix_meetings": "Decisões e resumos de reuniões",
  "mcp.grants.tool.phoenix_graph_query": "Perguntas ao grafo de conhecimento",
  "mcp.grants.tool.phoenix_ci_git_state": "Estado do Git e da CI",
  "mcp.grants.tool.phoenix_memory_search": "Busca na memória",
  "mcp.grants.actions": "Ações",
  "mcp.grants.requestApproval": "Pedir minha aprovação",
  "mcp.grants.notify": "Informar ao Fawkes seu estado (trabalhando, esperando, concluído)",
  "mcp.grants.memory": "Memória que pode ler",
  "mcp.grants.memory.note":
    "A busca na memória, o grafo e as reuniões só veem os escopos abaixo, nunca tudo o que você pode ver.",
  "mcp.grants.memory.none": "Nenhum escopo de memória concedido.",
  "mcp.grants.memory.scope": "Escopo",
  "mcp.grants.memory.sensitivity": "Sensibilidade máxima",
  "mcp.grants.memory.add": "Adicionar escopo",
  "mcp.grants.memory.remove": "Remover o escopo {scope}",
  "mcp.grants.memory.invalid":
    "Um escopo é *, global, ou repo:, path: ou meeting: seguido de texto.",
  "mcp.sensitivity.public": "público",
  "mcp.sensitivity.internal": "interno",
  "mcp.sensitivity.sensitive": "sensível (reuniões)",
  "mcp.grants.save": "Salvar permissões",
  "mcp.grants.saved": "Permissões salvas.",
  "mcp.revoke": "Revogar {name}",
  "mcp.revoke.ask": "Revogar {name}? Ele é recusado imediatamente, mesmo no meio de uma chamada.",
  "mcp.revoke.yes": "Sim, revogar",
  "mcp.revoke.no": "Manter",
  "mcp.revoke.done": "Cliente revogado.",
};
