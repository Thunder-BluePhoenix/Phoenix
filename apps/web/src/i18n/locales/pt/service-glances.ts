// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { serviceGlances as enServiceGlances } from "../../en/service-glances";

/** Machine-translated; unreviewed (see ../../README.md). */
export const serviceGlances: Record<keyof typeof enServiceGlances, string> = {
  "services.glance.heading": "{name} num relance",
  "services.glance.disabled": "{name} está desativado. Ative em Capacidades para vê-lo aqui.",
  "services.glance.loading": "Carregando…",
  "services.glance.error": "Não foi possível ler {name}.",
  "services.glance.stale": "Não foi possível atualizar {name}; mostrando os últimos dados.",
  "services.glance.unreadable": "{name} retornou dados que esta página não consegue ler.",
  "services.glance.updated": "Atualizado {time}",
  "services.glance.state.unknown": "Desconhecido",
  "services.glance.vercel.notConfigured":
    "Adicione um token da Vercel em Configurações para ver as implantações.",
  "services.glance.vercel.empty": "Ainda não há implantações.",
  "services.glance.vercel.summary": "Implantações recentes: {count}",
  "services.glance.vercel.failed": "Com falha: {count}",
  "services.glance.vercel.building": "Em andamento: {count}",
  "services.glance.vercel.state.queued": "Na fila",
  "services.glance.vercel.state.initializing": "Iniciando",
  "services.glance.vercel.state.building": "Compilando",
  "services.glance.vercel.state.ready": "Pronto",
  "services.glance.vercel.state.error": "Com falha",
  "services.glance.vercel.state.canceled": "Cancelado",
  "services.glance.stripe.notConfigured":
    "Adicione em Configurações uma chave Stripe restrita somente leitura para ver os pagamentos.",
  "services.glance.stripe.empty": "Nenhum pagamento recente.",
  "services.glance.stripe.counted": "Últimos pagamentos contados: {count}",
  "services.glance.stripe.succeeded": "Bem-sucedidos: {count}",
  "services.glance.stripe.failed": "Com falha: {count}",
  "services.glance.stripe.pending": "Pendentes: {count}",
  "services.glance.stripe.received": "Recebido: {amounts}",
  "services.glance.stripe.failedAmount": "Valores com falha: {amounts}",
  "services.glance.stripe.available": "Saldo disponível: {amounts}",
  "services.glance.stripe.pendingBalance": "Saldo pendente: {amounts}",
  "services.glance.stripe.privacy":
    "Somente valores e contagens. Clientes e cartões nunca são exibidos.",
  "services.glance.stripe.state.succeeded": "Bem-sucedido",
  "services.glance.stripe.state.failed": "Com falha",
  "services.glance.stripe.state.pending": "Pendente",
  "services.glance.stripe.state.refunded": "Reembolsado",
  "services.glance.n8n.notConfigured":
    "Informe o endereço do seu n8n e adicione uma chave de API em Configurações para ver as execuções.",
  "services.glance.n8n.empty": "Nenhuma execução recente.",
  "services.glance.n8n.summary": "Execuções recentes: {count}",
  "services.glance.n8n.failed": "Com falha: {count}",
  "services.glance.n8n.workflows": "Fluxos ativos: {active} de {total}",
  "services.glance.n8n.host": "A chave de API é enviada para {host}",
  "services.glance.n8n.state.success": "Bem-sucedida",
  "services.glance.n8n.state.error": "Com falha",
  "services.glance.n8n.state.crashed": "Travada",
  "services.glance.n8n.state.running": "Em execução",
  "services.glance.n8n.state.waiting": "Aguardando",
  "services.glance.n8n.state.new": "Na fila",
};
