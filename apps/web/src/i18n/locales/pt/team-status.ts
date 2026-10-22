// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamStatus as enTeamStatus } from "../../en/team-status";

/** Machine-translated; unreviewed. */
export const teamStatus: Record<keyof typeof enTeamStatus, string> = {
  "teamStatus.title": "Presença da equipe",
  "teamStatus.intro":
    "A presença da equipe vem desativada por padrão. Ao ativá-la, o Phoenix envia apenas os tipos de status que você marcar (implantando, executando um agente, em reunião) como um quadro criptografado aos colegas que você adicionou, e nunca cita um repositório, uma branch ou uma pessoa.",
  "teamStatus.notAvailable":
    "A presença da equipe não está disponível: este Phoenix Core não tem um cofre de segredos do sistema operacional para guardar sua chave.",
  "teamStatus.loadFailed": "Não foi possível carregar a presença da equipe.",
  "teamStatus.listSeparator": ", ",
  "teamStatus.kind.deploying": "implantando",
  "teamStatus.kind.agentRun": "executando um agente",
  "teamStatus.kind.meeting": "em reunião",
  "teamStatus.relay.label": "Endereço do relay",
  "teamStatus.route.label": "Rota (opcional)",
  "teamStatus.route.hint":
    "Deixe a rota vazia para criar uma nova equipe. Cole aqui uma rota para entrar na mesma equipe de um colega.",
  "teamStatus.route.shown": "Rota do relay",
  "teamStatus.turnOn": "Ativar",
  "teamStatus.resume": "Reativar",
  "teamStatus.pause": "Pausar",
  "teamStatus.leave": "Sair da equipe",
  "teamStatus.leave.ask": "Sair da equipe e esquecer todos?",
  "teamStatus.state.line": "Conexão: {state}",
  "teamStatus.state.connected": "conectado",
  "teamStatus.state.connecting": "conectando",
  "teamStatus.state.paused": "em pausa",
  "teamStatus.lastError": "Último erro: {error}",
  "teamStatus.self.id": "Seu id de equipe",
  "teamStatus.self.publicKey": "Sua chave pública",
  "teamStatus.self.hint":
    "Entregue os dois a um colega para que ele possa adicionar você. Sua chave privada nunca sai deste computador.",
  "teamStatus.sharing.title": "O que eu compartilho",
  "teamStatus.sharing.master": "Compartilhar meu status com minha equipe",
  "teamStatus.sharing.deploying": "Implantando",
  "teamStatus.sharing.agentRun": "Executando um agente por muito tempo",
  "teamStatus.sharing.meeting": "Em reunião",
  "teamStatus.outgoing.now": "Os colegas veem agora: {kinds}.",
  "teamStatus.outgoing.none": "Os colegas não veem nada seu agora.",
  "teamStatus.members.title": "Colegas",
  "teamStatus.members.none": "Você ainda não adicionou colegas.",
  "teamStatus.members.removeLabel": "Remover {label}",
  "teamStatus.members.id": "Id de equipe do colega",
  "teamStatus.members.label": "Nome a exibir",
  "teamStatus.members.publicKey": "Chave pública do colega",
  "teamStatus.members.add": "Adicionar colega",
  "teamStatus.presence.title": "Quem está por aí",
  "teamStatus.presence.none": "Nenhum colega para mostrar.",
  "teamStatus.presence.nothing": "nada compartilhado",
};
