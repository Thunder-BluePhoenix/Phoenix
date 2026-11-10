// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserAssist as enBrowserAssist } from "../../en/browser-assist";

/** Machine-translated; unreviewed. */
export const browserAssist: Record<keyof typeof enBrowserAssist, string> = {
  "browser.assist.open": "Peça ajuda ao Fawkes com esta página",
  "browser.assist.title": "Peça ajuda ao Fawkes com esta página",
  "browser.assist.goalLabel": "O que você quer fazer nesta página?",
  "browser.assist.goalPlaceholder": "Por exemplo: adicione o azul ao carrinho",
  "browser.assist.propose": "Propor passos",
  "browser.assist.proposing": "Consultando o modelo local…",
  "browser.assist.close": "Fechar o assistente",
  "browser.assist.goalTooLong": "O objetivo pode ter no máximo {max} caracteres.",
  "browser.assist.goalControl": "O objetivo não pode conter caracteres de controle.",
  "browser.assist.goalHidden":
    "O objetivo não pode conter caracteres de direção do texto nem de largura zero.",
  "browser.assist.requestFailed": "Não foi possível falar com o assistente. Nada foi executado.",
  "browser.assist.noLocalModel":
    "Não há modelo no dispositivo, então o Fawkes não leu esta página. O texto da página nunca é enviado a um serviço na nuvem.",
  "browser.assist.localModelFailed":
    "O modelo do dispositivo falhou. Nada foi executado e nada foi enviado a outro lugar.",
  "browser.assist.noBrowser": "Este app Phoenix não tem um navegador de onde ler uma página.",
  "browser.assist.inert":
    "Proposto por um modelo local que leu esta página. Nada foi executado. Estes passos são texto simples e podem estar errados.",
  "browser.assist.forPage": "Para a página: {url}",
  "browser.assist.dropped":
    "{count, plural, one {# sugestão do modelo foi recusada e não é exibida.} other {# sugestões do modelo foram recusadas e não são exibidas.}}",
  "browser.assist.noSteps": "O modelo não propôs nenhum passo para esta página.",
  "browser.assist.kind.click": "Clicar em",
  "browser.assist.kind.type": "Digitar em",
  "browser.assist.kind.submit": "Enviar o formulário",
  "browser.assist.typeText": "o texto: {text}",
  "browser.assist.run": "Executar este passo",
  "browser.assist.step.running": "Aguardando a sua aprovação…",
  "browser.assist.step.done": "Concluído. Nada mais foi executado.",
  "browser.assist.refused.noTab": "Não há aba ativa para executar este passo.",
  "browser.assist.refused.moved":
    "A aba não está mais na página para a qual estes passos foram propostos. Pergunte de novo.",
  "browser.assist.failed.denied": "Você recusou este passo.",
  "browser.assist.failed.blocked":
    "O Phoenix recusou este passo (a página ou o controle não é permitido).",
  "browser.assist.failed.unavailable": "Não foi possível falar com o navegador.",
  "browser.assist.failed.timeout": "O passo expirou. Pode ter sido executado ou não.",
  "browser.assist.failed.failed": "O passo não foi executado.",
};
