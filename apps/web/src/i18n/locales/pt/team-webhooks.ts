// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamWebhooks as enTeamWebhooks } from "../../en/team-webhooks";

/** Machine-translated; unreviewed. */
export const teamWebhooks: Record<keyof typeof enTeamWebhooks, string> = {
  "teamWebhooks.title": "Webhooks de entrada",
  "teamWebhooks.intro":
    "Os webhooks de entrada vêm desativados por padrão. Uma fonte dá a outra ferramenta seu próprio endereço e segredo; quando essa ferramenta envia uma mensagem assinada corretamente, o Phoenix a transforma em um evento local. Nada é enviado para lugar nenhum, e o que uma fonte envia é tratado como texto não confiável.",
  "teamWebhooks.notAvailable":
    "Os webhooks de entrada não estão disponíveis: este Phoenix Core não tem um cofre de segredos do sistema operacional para guardar os segredos das fontes.",
  "teamWebhooks.loadFailed": "Não foi possível carregar os webhooks de entrada.",
  "teamWebhooks.master": "Aceitar webhooks de entrada",
  "teamWebhooks.secret.title": "Segredo de {id}",
  "teamWebhooks.secret.warning":
    "Este segredo é mostrado apenas uma vez. Copie-o agora e guarde-o na ferramenta que envia. O Phoenix o mantém somente no cofre de segredos do sistema operacional e não pode mostrá-lo de novo; se o perder, exclua a fonte e crie uma nova.",
  "teamWebhooks.secret.path": "Endereço de envio (neste Core)",
  "teamWebhooks.secret.label": "Segredo de assinatura",
  "teamWebhooks.secret.copy": "Copiar segredo",
  "teamWebhooks.secret.copied": "Copiado para a área de transferência.",
  "teamWebhooks.secret.copyFailed":
    "O Phoenix não conseguiu usar a área de transferência. Selecione o segredo acima e copie à mão antes de fechar.",
  "teamWebhooks.secret.done": "Já guardei, fechar",
  "teamWebhooks.sources.title": "Fontes",
  "teamWebhooks.sources.none": "Você ainda não criou nenhuma fonte de webhook.",
  "teamWebhooks.row.path": "Endereço: {path}",
  "teamWebhooks.row.types": "Tipos de evento: {types}",
  "teamWebhooks.row.never": "Nada recebido ainda.",
  "teamWebhooks.row.last": "Último aceito: {time}",
  "teamWebhooks.delete.label": "Excluir a fonte {id}",
  "teamWebhooks.delete.ask":
    "Excluir {id}? O segredo dela para de funcionar imediatamente e a ferramenta que envia precisa ser alterada.",
  "teamWebhooks.create.title": "Criar uma fonte",
  "teamWebhooks.create.id": "Nome da fonte",
  "teamWebhooks.create.idHint":
    "3 a 32 caracteres: letras minúsculas, dígitos, - ou _, começando com uma letra.",
  "teamWebhooks.create.types": "Tipos de evento que ela pode enviar",
  "teamWebhooks.create.typesHint":
    "Separe por vírgulas, por exemplo ci.finished. Cada tipo começa com um destes: {namespaces}.",
  "teamWebhooks.create.typesTooMany": "Informe no máximo {max} tipos de evento.",
  "teamWebhooks.create.typesInvalid":
    "Um tipo de evento são palavras minúsculas unidas por pontos, como ci.finished.",
  "teamWebhooks.create.typesNamespace":
    "Um tipo de evento deve começar com um destes: {namespaces}.",
  "teamWebhooks.create.limit": "Você atingiu o limite de {max} fontes. Exclua uma primeiro.",
  "teamWebhooks.create.submit": "Criar fonte",
};
