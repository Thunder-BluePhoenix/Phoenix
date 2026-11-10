// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { chatApprovals as enChatApprovals } from "../../en/chat-approvals";

/** Machine-translated; unreviewed. */
export const chatApprovals: Record<keyof typeof enChatApprovals, string> = {
  "chatApprovals.title": "Aprovações por chat",
  "chatApprovals.notAvailable": "As aprovações por chat não estão disponíveis neste Phoenix Core.",
  "chatApprovals.intro":
    "Responda a uma aprovação pendente de um agente ou do Phoenix pelo Slack ou Discord e seja avisado no Teams. Tudo fica desligado até você ativar aqui, por provedor e por projeto.",
  "chatApprovals.limits":
    "Nunca usado com um espaço real do Slack, Discord ou Teams: o código só foi testado com retornos simulados. O Teams é só de aviso (um link para o Phoenix, nunca um botão Permitir). Um clique é verificado pela assinatura do provedor e pela sua lista de aprovadores, e a decisão é auditada.",
  "chatApprovals.noDm":
    "Resumos e avisos vão somente para o canal definido abaixo. Mensagens diretas para uma pessoa não foram implementadas.",
  "chatApprovals.capabilityOff":
    "A capacidade Aprovações por chat está desligada, então nada é enviado.",
  "chatApprovals.enable": "Ativar a capacidade",
  "chatApprovals.ready": "Pronto: este provedor pode publicar cartões.",
  "chatApprovals.notReady":
    "Não está pronto: precisa estar ativado, com um id de espaço, um id de canal e pelo menos um aprovador.",
  "chatApprovals.teamsNote":
    "O Teams é só de aviso. O endereço do webhook e a chave do link ficam guardados abaixo.",
  "chatApprovals.save": "Salvar aprovações por chat",
  "chatApprovals.saved": "Salvo.",
  "chatApprovals.provider.slack": "Slack",
  "chatApprovals.provider.discord": "Discord",
  "chatApprovals.provider.teams": "Microsoft Teams",
  "chatApprovals.enabledNamed": "Ativar {name}",
  "chatApprovals.notifyNamed": "Enviar um aviso genérico no {name}",
  "chatApprovals.digestNamed": "Incluir {name} nos resumos",
  "chatApprovals.notify": "Avisar (sem detalhes) sobre pedidos não ativados",
  "chatApprovals.digest.send": "Receber o resumo",
  "chatApprovals.workspace.slack": "Id do espaço do Slack (equipe)",
  "chatApprovals.workspace.discord": "Id do servidor do Discord (guild)",
  "chatApprovals.channel.slack": "Id do canal do Slack",
  "chatApprovals.channel.discord": "Id do canal do Discord",
  "chatApprovals.approvers.label": "Ids de usuário do {name} que podem decidir (um por linha)",
  "chatApprovals.approvers.hint":
    "Somente letras e dígitos, até 24 caracteres cada, no máximo 20. Lista vazia significa que ninguém pode decidir.",
  "chatApprovals.projects.title": "Projetos permitidos",
  "chatApprovals.projects.hint":
    "Somente aprovações de agente desses projetos podem ser respondidas pelo chat. Vazio: nenhum.",
  "chatApprovals.projects.label": "Nomes de projetos (um por linha)",
  "chatApprovals.digest.title": "Resumo agendado",
  "chatApprovals.digest.intro":
    "Desligado por padrão. Envia contagens e ids curtos de aprovação ao canal acima, somente aos provedores que recebem o resumo, nunca em horário de silêncio e nunca quando nada aconteceu.",
  "chatApprovals.digest.enabled": "Enviar um resumo agendado",
  "chatApprovals.digest.interval": "Minutos entre resumos",
  "chatApprovals.digest.hint": "De {min} (uma hora) a {max} minutos (uma semana).",
  "chatApprovals.cred.title": "Credenciais",
  "chatApprovals.cred.writeOnly":
    "Somente escrita. O que você digita é enviado ao armazém de credenciais do Core e removido desta página na hora. Valores salvos nunca são mostrados de novo.",
  "chatApprovals.cred.save": "Salvar",
  "chatApprovals.cred.stored": "Armazenado",
  "chatApprovals.cred.notStored": "Não armazenado",
  "chatApprovals.cred.remove": "Remover",
  "chatApprovals.cred.removeNamed": "Remover {name} armazenado",
  "chatApprovals.field.slackBot": "Token do bot do Slack",
  "chatApprovals.field.slackSigning": "Segredo de assinatura do Slack",
  "chatApprovals.field.discordBot": "Token do bot do Discord",
  "chatApprovals.field.discordKey": "Chave pública do aplicativo do Discord",
  "chatApprovals.field.teamsWebhook": "Endereço do webhook do Teams",
  "chatApprovals.field.teamsKey": "Chave de link do Teams",
  "chatApprovals.error.ids":
    "Ids de espaço e de canal usam somente letras e dígitos, até 24 caracteres.",
  "chatApprovals.error.approvers":
    "Ids de aprovador usam somente letras e dígitos, até 24 caracteres cada, no máximo 20.",
  "chatApprovals.error.projects":
    "Nomes de projeto devem ter de 1 a 120 caracteres visíveis, no máximo 200 projetos.",
  "chatApprovals.error.interval":
    "O intervalo do resumo deve ser um número inteiro de 60 a 10080 minutos.",
  "chatApprovals.error.save": "Não foi possível salvar a configuração de aprovações por chat.",
  "chatApprovals.error.capability": "Não foi possível alterar a capacidade Aprovações por chat.",
  "chatApprovals.error.unavailable":
    "Este Phoenix Core não tem armazém de credenciais do sistema, então uma credencial não pode ser mantida.",
  "chatApprovals.error.cred": "A credencial não foi salva ou removida.",
  "chatApprovals.error.credShape":
    "Esse valor não parece correto para este campo, então não foi enviado. Verifique e tente de novo.",
};
