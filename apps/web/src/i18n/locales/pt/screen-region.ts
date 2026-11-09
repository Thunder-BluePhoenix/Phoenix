// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { screenRegion as enScreenRegion } from "../../en/screen-region";

/** Machine-translated; unreviewed (see ../../README.md). */
export const screenRegion: Record<keyof typeof enScreenRegion, string> = {
  "screenRegion.title": "Capturar uma região para uma issue",
  "screenRegion.intro":
    "Escolha Escolher região do ecrã, confirme em Aprovações e arraste a área pretendida com o seletor do sistema (Esc cancela). Apenas macOS. A imagem fica nesta página e não é guardada. A tarefa em si é criada só com texto, depois de a aprovar. No Linear e no Jira pode depois anexar a imagem censurada a essa tarefa num passo separado, com a sua própria confirmação; o GitHub é só texto.",
  "screenRegion.projectLabel":
    "Repositório do GitHub (owner/name), ID de equipa do Linear ou chave de projeto do Jira",
  "screenRegion.linearTeamInvalid":
    "Um ID de equipa do Linear é parecido com 6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f; nada foi enviado.",
  "screenRegion.jiraProjectInvalid":
    "Uma chave de projeto do Jira tem maiúsculas, dígitos ou sublinhados, como PROJ; nada foi enviado.",
  "screenRegion.issuesUnavailable":
    "A capacidade Acompanhamento de tarefas está desativada ou não tem os comandos de criar e anexar; nada foi enviado. Ative-a primeiro.",
  "screenRegion.issuesNoWriteCredential":
    "Não há credencial de escrita para {tracker} em Acompanhamento de tarefas (as chaves de consulta nunca são usadas para escrever); nada foi enviado.",
  "screenRegion.issueKeyInvalid": "Essa não é uma chave de tarefa válida; nada foi enviado.",
  "focus.screenshot.textOnly":
    "A tarefa é criada só com texto. A captura não faz parte dela; no Linear e no Jira pode oferecê-la separadamente depois.",
  "focus.screenshot.attach.title": "Anexar a captura (opcional)",
  "focus.screenshot.attach.intro":
    "A tarefa {key} de {tracker} foi criada sem a imagem. Pode agora anexar-lhe a captura censurada. É um envio separado que o Core pede para aprovar de novo. O GitHub nunca recebe a imagem.",
  "focus.screenshot.attach.prepare": "Mostrar o que seria anexado",
  "focus.screenshot.attach.details": "O que seria anexado",
  "focus.screenshot.attach.tracker": "Serviço: {tracker}",
  "focus.screenshot.attach.issue": "Tarefa: {key}",
  "focus.screenshot.attach.file": "Nome do ficheiro: {name}",
  "focus.screenshot.attach.size": "Tamanho: {bytes} bytes",
  "focus.screenshot.attach.hash": "Hash do conteúdo (SHA-256, primeiros 12 caracteres): {hash}",
  "focus.screenshot.attach.redacted":
    "Esta é a imagem como está censurada e anotada nesta página; as censuras já estão integradas. Ainda nada foi enviado.",
  "focus.screenshot.attach.confirm": "Sim, enviar esta imagem para {tracker}",
  "focus.screenshot.attach.send": "Pedir aprovação e anexar",
  "focus.screenshot.attach.done": "A captura foi anexada a {key}.",
  "focus.screenshot.attach.problem.badImage": "A imagem não é um PNG válido e não foi enviada.",
  "focus.screenshot.attach.problem.tooLarge": "A imagem excede 5 MiB e não foi enviada.",
  "focus.screenshot.attach.problem.changed":
    "A imagem mudou depois de a rever; reveja-a de novo. Nada foi enviado.",
  "screenRegion.unavailable":
    "A captura de região está desativada. Ative a capacidade Captura de região da tela e permita a captura de tela para usá-la. Funciona só no macOS.",
  "screenRegion.cancelled": "Você cancelou a seleção, então nada foi capturado.",
  "screenRegion.declined": "Você recusou, então nada foi capturado.",
  "screenRegion.blocked": "A parada de emergência está ativa, então nada foi capturado.",
  "screenRegion.timeout":
    "Nenhuma região foi escolhida a tempo ou o pedido não foi aprovado; nada foi capturado.",
  "screenRegion.failed": "Não foi possível capturar a região: {message}",
  "screenRegion.badImage": "A captura não era uma imagem PNG válida e foi descartada.",
  "screenRegion.tooLarge": "A região capturada tem mais de 5 MiB e foi descartada.",
  "screenRegion.unsupported": "A captura de região só é compatível com o macOS.",
  "screenRegion.expired": "A captura não estava mais disponível. Escolha uma região novamente.",
};
