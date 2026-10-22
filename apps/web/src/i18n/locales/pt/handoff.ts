// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { handoff as enhandoff } from "../../en/handoff";

/** Machine-translated; unreviewed (see ../../README.md). */
export const handoff: Record<keyof typeof enhandoff, string> = {
  "handoff.title": "Notas de passagem",
  "handoff.intro":
    "Uma nota de passagem é um resumo curto que o Phoenix monta com regras fixas, sem modelo, a partir do que um agente de programação informou durante uma sessão: o objetivo (só quando o agente informou um título de tarefa), os arquivos alterados com a contagem de linhas, os comandos executados (sem segredos) e as perguntas em aberto. O Phoenix não verificou nada disso, então trate como o que o agente disse, não como prova. As notas ficam guardadas neste computador, na pasta de dados do Phoenix, legíveis só por você; as 50 mais recentes são mantidas, e “Excluir tudo” de “handoff” em Privacidade as apaga.",

  "handoff.settings.legend": "Configurações de passagem",
  "handoff.settings.auto": "Escrever uma nota quando uma sessão de agente terminar",
  "handoff.settings.allowCloud":
    "Permitir que um modelo na nuvem escreva o resumo opcional (desativado: só um modelo neste dispositivo)",
  "handoff.settings.cloudWarning":
    "Se você ativar isto, o texto da nota (comandos com dados ocultados e nomes de arquivos) pode sair deste computador para um modelo na nuvem quando você pedir um resumo. As permissões de nuvem das configurações de IA continuam valendo além desta escolha.",
  "handoff.settings.saved": "Configurações salvas.",
  "handoff.settings.unavailable": "Não foi possível carregar as configurações de passagem.",
  "handoff.notes.unavailable": "Não foi possível carregar as notas de passagem.",
  "handoff.guard.unavailable": "Não foi possível carregar os resultados da proteção de segredos.",
  "handoff.notes.title": "Notas salvas",
  "handoff.notes.listLabel": "Notas de passagem",
  "handoff.notes.empty": "Nenhuma nota de passagem foi escrita ainda.",
  "handoff.notes.open": "{date} {time} · {agent}",
  "handoff.notes.meta": "{project} · {files} · {lines}",
  "handoff.notes.files": "{count, plural, one {# arquivo} many {# de arquivos} other {# arquivos}}",
  "handoff.notes.lines": "+{added} −{removed}",
  "handoff.notes.noProject": "sem projeto",
  "handoff.notes.hasSummary": "Resumo do modelo",
  "handoff.notes.detailLabel": "Nota selecionada",
  "handoff.notes.loading": "Carregando a nota…",
  "handoff.notes.trigger.auto": "Escrita automaticamente",
  "handoff.notes.trigger.user": "Você pediu",
  "handoff.notes.textLabel": "Texto da nota",

  "handoff.summary.title": "Resumo do modelo",
  "handoff.summary.processedBy": "Escrito por: {by}",
  "handoff.summary.warning":
    "Um modelo escreveu este resumo e ele pode estar errado. Confira antes de confiar nele.",
  "handoff.summary.add": "Adicionar um resumo do modelo",
  "handoff.summary.note":
    "O Phoenix só usa um modelo neste dispositivo, a menos que você tenha permitido um modelo na nuvem acima.",
  "handoff.summary.added": "Resumo adicionado.",

  "handoff.delete.button": "Excluir nota",
  "handoff.delete.done": "Nota excluída.",

  "handoff.generate.title": "Escrever uma nota para uma sessão",
  "handoff.generate.sessionLabel": "Sessão",
  "handoff.generate.choose": "Escolha uma sessão",
  "handoff.generate.option": "{agent} · {repository} · {time}",
  "handoff.generate.none":
    "Nenhuma sessão de agente de programação é conhecida ainda, então não há sobre o que escrever uma nota.",
  "handoff.generate.button": "Escrever uma nota",
  "handoff.generate.done": "Nota escrita.",

  "handoff.attach.title": "Usar esta nota",
  "handoff.attach.targetLabel": "Para onde vai",
  "handoff.attach.target.commit_message": "Uma mensagem de commit",
  "handoff.attach.target.pr_description": "A descrição de um pull request",
  "handoff.attach.target.task": "Uma issue do GitHub",
  "handoff.attach.repositoryLabel": "Repositório do GitHub (owner/name)",
  "handoff.attach.repositoryInvalid":
    "Informe o repositório como owner/name, por exemplo acme/app.",
  "handoff.attach.preview": "Pré-visualizar",
  "handoff.attach.previewAgain": "Pré-visualizar de novo",
  "handoff.attach.confirm": "Confirmar",
  "handoff.attach.previewLabel": "Pré-visualização do que será anexado",
  "handoff.attach.issueTitle": "Título da issue: {title}",
  "handoff.attach.textLabel": "Exatamente este texto",
  "handoff.attach.delivery.copy":
    "O Phoenix não escreve isto em lugar nenhum: confirme para copiar e depois cole você mesmo.",
  "handoff.attach.delivery.copyPr":
    "O Phoenix ainda não tem um comando que edite a descrição de um pull request: só copiar. Confirme para copiar e depois cole você mesmo.",
  "handoff.attach.delivery.issue":
    "O Phoenix criará uma issue do GitHub em {repository} com a capacidade github. Você será solicitado a confirmar mais uma vez, e é preciso o token de escrita.",
  "handoff.attach.stale":
    "A nota mudou depois desta pré-visualização, então nada foi anexado. Pré-visualize de novo.",
  "handoff.attach.copied": "Copiado para a área de transferência. Cole onde precisar.",
  "handoff.attach.copyByHand":
    "O Phoenix não conseguiu usar a área de transferência. Selecione o texto abaixo e copie à mão.",
  "handoff.attach.issueCreated": "Issue #{number} criada em {repository}.",
  "handoff.attach.issueExisting": "A issue #{number} em {repository} já existia.",
  "handoff.attach.issueAddress": "Endereço: {url}",

  "handoff.guard.title": "Proteção de segredos",
  "handoff.guard.intro":
    "A proteção de segredos é instalada com o instalador de hooks de agentes acima: faz parte dos hooks que o Phoenix adiciona ao Claude Code e ao Codex. Ela bloqueia uma chamada de ferramenta, um git commit ou um git push cuja entrada ou alterações em stage contenham um segredo reconhecido pelo detector do Phoenix, e informa ao agente que tipo de segredo foi encontrado e onde, nunca o segredo.",
  "handoff.guard.override":
    "Você só pode anular um bloqueio por meio de um cartão de aprovação; o agente não pode anulá-lo.",
  "handoff.guard.heuristic":
    "O detector é heurístico, não uma promessa de que nada vaza: um segredo que ele não reconhece não é detectado.",
  "handoff.guard.failOpen":
    "Se o Phoenix Core ou o hook não puder executar, o trabalho do agente continua (a proteção falha aberta), exceto que um segredo encontrado é sempre bloqueado.",
  "handoff.guard.countsLabel": "Resultados da proteção de segredos",
  "handoff.guard.allowed": "Permitidas após verificação: {count}",
  "handoff.guard.blocked": "Bloqueadas: {count}",
  "handoff.guard.overridden": "Permitidas após sua aprovação: {count}",
  "handoff.guard.since": "Contado desde {date} {time}",
  "handoff.guard.noResults": "Ainda não há resultados.",
  "handoff.guard.recentLabel": "Resultados recentes da proteção de segredos",
  "handoff.guard.row": "{date} {time} · {agent} · {tool}",
  "handoff.guard.outcome.blocked": "bloqueada",
  "handoff.guard.outcome.overridden": "permitida após sua aprovação",
  "handoff.guard.finding": "{kind} em {location}",
};
