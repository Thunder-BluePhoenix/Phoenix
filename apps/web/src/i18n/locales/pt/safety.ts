// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { safety as ensafety } from "../../en/safety";

/** Machine-translated; unreviewed (see ../../README.md). */
export const safety: Record<keyof typeof ensafety, string> = {
  "safety.title": "Rede de segurança do agente",
  "safety.intro":
    "Antes da primeira edição relatada por um agente de programação em uma sessão, o Phoenix salva um instantâneo do projeto no próprio repositório git do projeto (uma referência oculta; suas branches, o índice e os stashes nunca são tocados). Você pode reverter os arquivos para ele, após uma prévia e a sua aprovação.",
  "safety.timing":
    "O Claude Code relata uma etapa depois que a ferramenta foi executada, então o instantâneo é feito no primeiro relato de uma edição: essa primeira edição normalmente já está nele. A reversão desfaz o que o agente fez depois dela, não a primeira edição em si.",
  "safety.ignored":
    "Arquivos que o git ignora (saída de build, logs, dependências) não são salvos e nunca são restaurados nem excluídos.",
  "safety.loadFailed": "Não foi possível carregar a rede de segurança: {error}",
  "safety.killSwitch":
    "O kill switch está ativado, então nenhum novo ponto de verificação é criado.",

  "safety.warnings.title": "Avisos do Fawkes",
  "safety.warnings.loop": "Loop",
  "safety.warnings.stall": "Travado",
  "safety.warnings.line": "{kind} · {agent} em {repository}: {reason}",

  "safety.checkpoints.title": "Pontos de verificação",
  "safety.checkpoints.none":
    "Nenhum ponto de verificação ainda. Um é criado quando a primeira edição de um agente é relatada.",
  "safety.checkpoints.row": "{agent} em {repository}",
  "safety.checkpoints.facts":
    "Criado {taken} · {count, plural, one {# arquivo} other {# arquivos}} · mantido até {expires}",
  "safety.checkpoints.rolledBack": "Revertido {when}",
  "safety.checkpoints.preview": "Prévia da reversão…",
  "safety.checkpoints.previewLabel":
    "Prévia da reversão para o ponto de verificação de {agent} em {repository}",
  "safety.checkpoints.close": "Fechar prévia",

  "safety.skipped.title": "Sessões sem ponto de verificação",
  "safety.skipped.line": "{agent} em {repository}: {reason}",
  "safety.skipped.disabled": "a rede de segurança está desativada",
  "safety.skipped.kill_switch": "o kill switch estava ativado",
  "safety.skipped.not_git":
    "esta pasta não é um repositório git, então não há nada para salvar em instantâneo",
  "safety.skipped.git_unavailable": "não foi possível executar o git",
  "safety.skipped.too_many_files": "o projeto tem mais arquivos do que o limite",
  "safety.skipped.too_large": "o projeto é maior do que o limite de tamanho",
  "safety.skipped.throttled":
    "já foi criado um ponto de verificação neste projeto no último minuto",
  "safety.skipped.snapshot_failed": "o git não conseguiu criar o instantâneo",

  "safety.preview.title": "Prévia da reversão",
  "safety.preview.counts":
    "{restore, plural, one {# arquivo seria restaurado} other {# arquivos seriam restaurados}}, {remove, plural, one {# arquivo novo seria excluído} other {# arquivos novos seriam excluídos}}, {kept, plural, one {# diferença seria deixada como está} other {# diferenças seriam deixadas como estão}}.",
  "safety.preview.restore": "Restaurados para o ponto de verificação",
  "safety.preview.remove": "Arquivos novos que seriam excluídos",
  "safety.preview.kept": "Deixados como estão",
  "safety.preview.change.modified": "modificado",
  "safety.preview.change.deleted": "excluído pelo agente",
  "safety.preview.change.type_changed": "tipo alterado",
  "safety.preview.why.tracked_by_head": "rastreado pelo git, por isso não é excluído",
  "safety.preview.why.ignored": "ignorado pelo git",
  "safety.preview.why.submodule": "um submódulo",
  "safety.preview.why.unsafe_path": "caminho não seguro para alterar",
  "safety.preview.why.not_a_file": "não é um arquivo comum",
  "safety.preview.truncated": "As listas estão cortadas; as contagens acima são exatas.",
  "safety.preview.diff": "Alterações desde o ponto de verificação",
  "safety.preview.diffTruncated": "O diff foi cortado no limite de tamanho.",
  "safety.preview.diffRedacted": "Algum texto que parecia um segredo foi ocultado.",
  "safety.preview.diffEmpty": "Nenhuma alteração de texto para mostrar.",
  "safety.preview.nothing":
    "Os arquivos já correspondem ao ponto de verificação. Não há nada para reverter.",
  "safety.preview.refusal.repository_missing": "O projeto não é mais um repositório git aqui.",
  "safety.preview.refusal.checkpoint_gone": "O instantâneo não está mais no repositório.",
  "safety.preview.refusal.head_moved":
    "O HEAD do repositório mudou desde o ponto de verificação (um commit ou troca de branch). O Phoenix não reverterá através disso; nada foi alterado.",
  "safety.preview.refusal.snapshot_failed": "O git não conseguiu ler a árvore de trabalho.",
  "safety.preview.approvalNote":
    "A reversão pede a sua aprovação primeiro. Ela nunca altera o histórico do git, as branches, o índice nem os stashes, e é recusada se os arquivos mudarem depois desta prévia.",

  "safety.rollback.button": "Reverter…",
  "safety.rollback.waiting": "Aguardando a sua aprovação na lista de aprovações acima…",
  "safety.rollback.done":
    "Revertido: {restored, plural, one {# arquivo restaurado} other {# arquivos restaurados}}, {removed, plural, one {# arquivo novo excluído} other {# arquivos novos excluídos}}.",
  "safety.rollback.exact": "Os arquivos agora correspondem ao ponto de verificação.",
  "safety.rollback.inexact":
    "Algumas diferenças foram deixadas como estão, então os arquivos não correspondem exatamente ao ponto de verificação.",

  "safety.settings.title": "Configurações",
  "safety.settings.enabled":
    "Criar um ponto de verificação quando a primeira edição de um agente for relatada",
  "safety.settings.notify":
    "Enviar uma notificação quando o Fawkes avisar sobre um loop ou uma trava",
  "safety.settings.retention": "Manter pontos de verificação por (dias)",
  "safety.settings.maxFiles": "Ignorar projetos com mais arquivos do que",
  "safety.settings.loopThreshold": "Aviso de loop após este número de repetições",
  "safety.settings.waitingMin": "Avisar quando um agente esperar por você por (minutos)",
  "safety.settings.idleMin": "Avisar quando um agente ativo ficar em silêncio por (minutos)",
  "safety.settings.saved": "Salvo.",
  "safety.settings.detectNote":
    "Os hooks não informam códigos de saída nem conteúdo de arquivos, então um loop significa o mesmo comando executado repetidamente, ou um arquivo cujas edições se desfazem mutuamente (pela contagem de linhas).",
};
