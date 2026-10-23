// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { focus as enFocus } from "../../en/focus";

/** Machine-translated; unreviewed. */
export const focus: Record<keyof typeof enFocus, string> = {
  "focus.title": "Modo de foco",
  "focus.start": "Iniciar foco",
  "focus.stop": "Terminar foco",
  "focus.minutes": "Minutos (vazio para duração indefinida)",
  "focus.remaining": "Minutos restantes: {count}",
  "focus.active": "Foco ativo",
  "focus.inactive": "Foco desativado",
  "focus.held": "Notificações retidas: {count}",
  "focus.osDnd": "Não Perturbe do sistema ativo",
  "focus.osUnknown": "Estado de Não Perturbe indisponível",
  "focus.refresh": "Atualizar estado do sistema",
  "focus.pomodoro": "Iniciar Pomodoro",
  "focus.systemUnavailable":
    "Não há Não Perturbe do sistema disponível; o modo de foco controla apenas as notificações do Phoenix.",
  "focus.screenshot.title": "Captura para ocorrência",
  "focus.screenshot.capture": "Selecionar região da tela…",
  "focus.screenshot.permission": "É necessária permissão para gravar a tela.",
  "focus.screenshot.error": "Não foi possível concluir: {error}",
  "focus.screenshot.box": "Caixa",
  "focus.screenshot.arrow": "Seta",
  "focus.screenshot.text": "Texto",
  "focus.screenshot.redact": "Ocultar permanentemente",
  "focus.screenshot.annotationText": "Texto da anotação",
  "focus.screenshot.project": "Repositório ou projeto",
  "focus.screenshot.issueTitle": "Título da ocorrência",
  "focus.screenshot.body": "Descrição",
  "focus.screenshot.preview": "Prévia do rascunho",
  "focus.screenshot.create": "Solicitar aprovação e criar ocorrência",
  "focus.screenshot.draft": "Rascunho (não criado)",
  "focus.screenshot.attachment": "Captura anexada quando suportado",
  "focus.screenshot.noAttachment":
    "Este serviço não permite anexar capturas; nenhuma imagem será enviada.",
  "focus.screenshot.created": "Ocorrência criada: {url}",
  "focus.screenshot.declined": "Não foi aprovado; nada foi enviado.",
  "focus.screenshot.tracker": "Gerenciador de ocorrências",
  "focus.screenshot.tracker.github": "GitHub",
  "focus.screenshot.tracker.linear": "Linear",
  "focus.screenshot.tracker.jira": "Jira",
  "focus.issueDraft.title": "Issue a partir de uma imagem que você tem",
  "focus.issueDraft.intro":
    "Solte, cole ou escolha um PNG ou JPEG que você já tem, escreva a issue e revise exatamente o que será enviado. O Phoenix não captura sua tela. A issue só é criada no GitHub depois que você confirmar aqui e de novo em Aprovações.",
  "focus.issueDraft.unavailable.capability":
    "A integração com o GitHub não está ativada ou não pode criar issues; nada pode ser criado.",
  "focus.issueDraft.unavailable.token":
    "Não há token de escrita do GitHub definido para a integração com o GitHub; nada pode ser criado.",
  "focus.issueDraft.dropLabel": "Solte uma imagem para a issue",
  "focus.issueDraft.dropHint": "Solte ou cole um PNG ou JPEG aqui, ou {choose}.",
  "focus.issueDraft.choose": "escolha uma imagem…",
  "focus.issueDraft.chooseLabel": "Escolher uma imagem para a issue",
  "focus.issueDraft.imageAlt": "Imagem para a issue: {name}",
  "focus.issueDraft.imageRemove": "Remover a imagem",
  "focus.issueDraft.oneImage": "Adicione uma imagem por vez.",
  "focus.issueDraft.imageRequired": "Adicione uma imagem primeiro.",
  "focus.issueDraft.titleRequired": "Escreva um título para a issue.",
  "focus.issueDraft.titleTooLong": "O título pode ter no máximo {max} caracteres.",
  "focus.issueDraft.bodyTooLong": "A descrição pode ter no máximo {max} caracteres.",
  "focus.issueDraft.secretInTitle":
    "O título parece conter uma senha, chave ou token. Remova; nada foi enviado.",
  "focus.issueDraft.secretInBody":
    "A descrição parece conter uma senha, chave ou token. Remova; nada foi enviado.",
  "focus.issueDraft.secretInBoth":
    "O título e a descrição parecem conter uma senha, chave ou token. Remova; nada foi enviado.",
  "focus.issueDraft.previewRepository": "Repositório: {repository}",
  "focus.issueDraft.previewTitle": "Título: {title}",
  "focus.issueDraft.previewBody": "Descrição, exatamente como será enviada:",
  "focus.issueDraft.previewNoBody": "Nenhuma descrição será enviada.",
  "focus.issueDraft.imageLocal":
    "A imagem ({name}) NÃO é enviada. As issues do GitHub são criadas apenas com texto; a imagem fica neste dispositivo e não é salva. Adicione-a você mesmo à issue se quiser.",
  "focus.issueDraft.approval":
    "Nada foi criado ainda. Depois que você apertar o botão, o Phoenix pede sua aprovação em Aprovações antes de enviar qualquer coisa ao GitHub.",
  "focus.issueDraft.create": "Pedir a criação da issue",
  "focus.issueDraft.waiting": "Aguardando sua aprovação em Aprovações…",
  "focus.issueDraft.denied": "Você recusou; nada foi enviado ao GitHub.",
  "focus.issueDraft.blocked": "A parada de emergência está ativada; nada foi enviado ao GitHub.",
  "focus.issueDraft.timeout":
    "A solicitação não foi aprovada a tempo ou foi cancelada; nada foi enviado.",
  "focus.issueDraft.failed": "Não foi possível criar a issue: {message}",
};
