// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "Ligação com o telemóvel",
  "phone.intro":
    "Emparelhe um telemóvel para que ele possa aprovar ou recusar o que o Phoenix perguntar. Fica desativado até você ativá-lo.",
  "phone.unavailable": "Não foi possível carregar as definições da ligação com o telemóvel.",
  "phone.warning.title": "Antes de ativar",
  "phone.warning.network":
    "Ao ativar, abre-se um serviço HTTPS separado que outros dispositivos da sua rede local podem alcançar (não a internet).",
  "phone.warning.pairing":
    "Só os telemóveis que você emparelhar e depois confirmar aqui podem aprovar algo. O emparelhamento exige um código mostrado neste ecrã.",
  "phone.warning.trust": "Ative apenas em redes de confiança, como a rede da sua casa.",
  "phone.warning.presence":
    "O Phoenix não consegue verificar se há uma pessoa neste computador: qualquer programa deste computador que tenha o token de sessão do Core também pode emparelhar telemóveis.",
  "phone.enable.label": "Permitir que telemóveis da minha rede local se liguem",
  "phone.saved.on": "A ligação com o telemóvel está ativada.",
  "phone.saved.off": "A ligação com o telemóvel está desativada.",
  "phone.saved.verifyOn":
    "As aprovações a partir de um telemóvel agora pedem verificação biométrica ou do dispositivo.",
  "phone.saved.verifyOff":
    "As aprovações a partir de um telemóvel já não pedem verificação do dispositivo.",
  "phone.killSwitch":
    "O interruptor de emergência está ativado, por isso o serviço do telemóvel está fechado. Volte a ativar aqui a ligação com o telemóvel depois de o desativar.",
  "phone.lockedOut":
    "O emparelhamento está bloqueado até {time} porque foram introduzidos demasiados códigos errados.",
  "phone.notListening":
    "A ligação com o telemóvel está ativada, mas o serviço ainda não está em execução.",
  "phone.addressChanged":
    "O endereço de rede que você escolheu não está mais disponível, então o link do telefone continua desligado. Escolha um endereço novamente para ligá-lo de novo.",
  "phone.listen.address": "Endereço e porta",
  "phone.listen.fingerprint": "Impressão digital do certificado (SHA-256)",
  "phone.pair.show": "Mostrar código de emparelhamento",
  "phone.pair.cancel": "Cancelar código",
  "phone.pair.cancelled": "Código de emparelhamento cancelado.",
  "phone.pair.expired":
    "O código de emparelhamento expirou. Mostre um novo para emparelhar um telemóvel.",
  "phone.pair.instruction":
    "No telemóvel, introduza ou leia este código e confirme que a impressão digital mostrada coincide com a de baixo. Se não coincidir, não continue.",
  "phone.pair.codeLabel": "Código de emparelhamento",
  "phone.pair.remaining": "Expira em {time}",
  "phone.pair.fingerprint": "Impressão digital do certificado:",
  "phone.pair.link": "Ligação de emparelhamento (não há código QR disponível):",
  "phone.pair.hiddenActive":
    "Há um código de emparelhamento ativo até {time}. Não é mostrado de novo; cancele-o e mostre um novo.",
  "phone.pending.question": 'Emparelhar "{name}"?',
  "phone.pending.fingerprint": "Impressão digital da chave",
  "phone.pending.yes": "Sim, emparelhar este telemóvel",
  "phone.pending.no": "Não, recusar",
  "phone.pending.waiting": "À espera de que o Phoenix peça a sua confirmação.",
  "phone.pending.approved": "Telemóvel emparelhado.",
  "phone.pending.rejected": "Emparelhamento recusado.",
  "phone.verify.label": "Exigir verificação biométrica ou do dispositivo nas aprovações",
  "phone.verify.note":
    "O telemóvel indica se a pessoa foi verificada (impressão digital, rosto ou bloqueio de ecrã). O Phoenix não consegue verificar esse relatório.",
  "phone.devices.title": "Telemóveis emparelhados",
  "phone.devices.none": "Nenhum telemóvel emparelhado.",
  "phone.devices.fingerprint": "Impressão digital da chave",
  "phone.devices.created": "Emparelhado em {date}",
  "phone.devices.lastSeen": "visto pela última vez {when}",
  "phone.devices.neverSeen": "nunca visto",
  "phone.devices.revoked": "Revogado em {date}",
  "phone.devices.revoke": "Revogar {name}",
  "phone.devices.revokeAsk": 'Revogar "{name}"? Já não poderá aprovar nada.',
  "phone.devices.revokeYes": "Sim, revogar",
  "phone.devices.revokeNo": "Manter",
  "phone.devices.revokedDone": "Telemóvel revogado.",
  "phone.device.unnamed": "Telemóvel sem nome",
};
