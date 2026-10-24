// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "Compartilhar minha identidade",
  "teamInvite.share.intro":
    "Envie este convite a um colega por chat ou e-mail. Ele contém apenas seu id de equipe, sua chave pública e o nome que você digitar abaixo. Não há nenhum segredo nele e sua chave privada nunca sai deste computador.",
  "teamInvite.share.label": "Nome para colocar no convite (opcional)",
  "teamInvite.share.invalid": "Não foi possível criar um convite com esta identidade.",
  "teamInvite.share.invite": "Seu convite",
  "teamInvite.share.copy": "Copiar convite",
  "teamInvite.share.copied": "Convite copiado para a área de transferência.",
  "teamInvite.share.copyFailed":
    "O Phoenix não conseguiu usar a área de transferência. Selecione o convite acima e copie-o manualmente.",
  "teamInvite.share.fingerprintHint":
    "Diga a impressão digital ao seu colega por voz ou em outro chat, para que ele confirme que o convite recebido é o seu.",
  "teamInvite.fingerprint": "Impressão digital da chave",
  "teamInvite.checksumNote":
    "O código curto no fim de um convite só detecta erros de cópia. Ele não prova quem criou o convite; só comparar a impressão digital prova.",
  "teamInvite.refusal.empty": "Cole um convite primeiro.",
  "teamInvite.refusal.tooLong": "Isso é longo demais para um convite de equipe.",
  "teamInvite.refusal.format": "Isso não é um convite de equipe do Phoenix.",
  "teamInvite.refusal.version":
    "Este convite é de outra versão do Phoenix que esta não consegue ler.",
  "teamInvite.refusal.checksum":
    "O convite foi alterado ou copiado errado. Peça ao colega que o envie novamente.",
  "teamInvite.refusal.content": "O convite está danificado ou tem conteúdo inesperado.",
  "teamInvite.refusal.id": "O convite tem um id de equipe inválido.",
  "teamInvite.refusal.key": "O convite tem uma chave pública inválida.",
  "teamInvite.refusal.label": "O convite tem um nome inválido.",
  "teamInvite.refusal.unsupported": "Este navegador não consegue verificar convites.",
  "teamInvite.refusal.own": "Esse convite é a sua própria identidade.",
  "teamInvite.refusal.duplicate":
    "Esse colega já está na sua lista. Remova-o primeiro para mudar a chave dele.",
  "teamInvite.add.title": "Adicionar um colega",
  "teamInvite.add.paste": "Cole o convite de um colega",
  "teamInvite.add.preview": "Confira estes dados antes de adicionar este colega.",
  "teamInvite.add.noLabel": "O convite não tem nome; digite um para exibir.",
  "teamInvite.add.theirLabel": "O convite diz que o nome é: {label}",
  "teamInvite.add.confirm":
    "Comparei esta impressão digital com meu colega por voz ou em outro chat, e ela confere.",
};
