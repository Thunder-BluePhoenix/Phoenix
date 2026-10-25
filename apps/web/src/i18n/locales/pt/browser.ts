// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "Abas",
  "browser.tab.untitled": "Nova aba",
  "browser.tab.loading": "Carregando",
  "browser.tab.close": "Fechar a aba {title}",
  "browser.tab.new": "Nova aba",
  "browser.nav.back": "Voltar",
  "browser.nav.forward": "Avançar",
  "browser.nav.reload": "Recarregar",
  "browser.address.label": "Endereço ou pesquisa",
  "browser.address.placeholder": "Pesquise ou digite um endereço",
  "browser.address.go": "Ir",
  "browser.address.blocked": "Não aberto: {text}",
  "browser.deny.unparseable": "Este não é um endereço web válido.",
  "browser.deny.scheme_not_allowed": "Só endereços web seguros (https) podem ser abertos.",
  "browser.deny.dangerous_scheme":
    "Endereços que executam código ou contêm a própria página não podem ser abertos.",
  "browser.deny.file_blocked": "Arquivos deste computador não podem ser abertos aqui.",
  "browser.deny.credentials_in_url": "Endereços com nome de usuário ou senha são recusados.",
  "browser.deny.private_network":
    "Endereços deste computador ou da sua rede local não podem ser digitados aqui. Abra a página de um programa pelo radar de portas.",
  "browser.deny.bad_port": "Essa porta está bloqueada porque pertence a um serviço que não é web.",
  "browser.deny.insecure_blocked": "Endereços http simples não são abertos.",
  "browser.deny.site_denied": "Este site está na lista de bloqueio.",
  "browser.deny.dns_private":
    "Esse nome aponta para um endereço deste computador ou da sua rede local.",
  "browser.deny.port_radar_invalid":
    "O pedido do radar de portas não era uma página simples deste computador e foi ignorado.",
  "browser.deny.unknown": "Esse endereço foi recusado.",
  "browser.zoom.label": "Zoom",
  "browser.zoom.out": "Diminuir zoom",
  "browser.zoom.in": "Aumentar zoom",
  "browser.zoom.reset": "Redefinir zoom para {percent}",
  "browser.shields.label": "Bloquear anúncios e rastreadores em {site}",
  "browser.shields.saveFailed":
    "A escolha foi aplicada aqui, mas não pôde ser salva no Phoenix Core.",
  "browser.shields.blocked":
    "{count, plural, one {# solicitação bloqueada} other {# solicitações bloqueadas}}",
  "browser.empty": "Nenhuma aba aberta. Digite um endereço ou uma pesquisa acima.",
  "browser.noShell":
    "Esta página é a barra de ferramentas do navegador Phoenix. Só funciona dentro do aplicativo de desktop do Phoenix.",
  "browser.radar.title": "Abrir um programa deste computador?",
  "browser.radar.body":
    "O radar de portas pede para abrir este endereço. É um programa em execução neste computador, não um site, e não é criptografado.",
  "browser.radar.url": "Endereço: {url}",
  "browser.radar.open": "Abrir",
  "browser.radar.cancel": "Cancelar",
  "browser.error.action": "O navegador não conseguiu fazer isso.",
};
