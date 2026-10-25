// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserApproval as enBrowserApproval } from "../../en/browser-approval";

/** Machine-translated; unreviewed. */
export const browserApproval: Record<keyof typeof enBrowserApproval, string> = {
  "browserApproval.action": "Ação do navegador",
  "browserApproval.action.click": "Clicar em um controle da página",
  "browserApproval.action.type": "Digitar texto em um campo da página",
  "browserApproval.action.submit": "Enviar um formulário da página",
  "browserApproval.action.download": "Iniciar um download a partir da página",
  "browserApproval.action.navigate": "Ir para outro endereço",
  "browserApproval.action.missing": "O pedido não diz que tipo de ação é.",
  "browserApproval.page": "Página",
  "browserApproval.page.missing": "O pedido não nomeia a página.",
  "browserApproval.selector": "Controle",
  "browserApproval.selector.missing": "O pedido não nomeia nenhum controle.",
  "browserApproval.destination": "Destino",
  "browserApproval.destination.missing": "O pedido não nomeia nenhum destino.",
  "browserApproval.queryHidden": "O endereço também tem uma parte de consulta, que não é mostrada.",
  "browserApproval.text": "Texto que será digitado (mostrado por inteiro)",
  "browserApproval.text.missing": "O pedido não inclui o texto.",
  "browserApproval.textLength": "Tamanho do texto",
  "browserApproval.textLength.value": "{length} caracteres",
  "browserApproval.textLength.missing": "O tamanho do texto está ausente.",
};
