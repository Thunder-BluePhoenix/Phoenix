// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "Bloqueio de anúncios e rastreadores",
  "shields.intro":
    "Estas configurações valem no navegador do Phoenix quando ele for lançado. O Phoenix ainda não tem janela de navegador, então hoje nada é bloqueado em nenhuma página. Só é possível bloquear requisições de rede assim: ocultar elementos da página não é suportado, e isto não é uma cópia das proteções de nenhum outro navegador.",
  "shields.unavailable":
    "As configurações de bloqueio de anúncios e rastreadores não estão disponíveis no Phoenix Core.",
  "shields.loadFailed": "Não foi possível ler as configurações de bloqueio do Phoenix Core.",
  "shields.global.label": "Bloquear anúncios e rastreadores",
  "shields.global.hint":
    "Desligado, nenhuma lista é aplicada a nenhum site. Ligado e sem lista baixada, usa-se uma lista curta embutida de hosts conhecidos de anúncios e análise.",
  "shields.lists.title": "Listas de filtros",
  "shields.lists.note":
    "As listas não vêm com o Phoenix e nunca são baixadas sozinhas. Ao tocar em Atualizar, easylist.to é contatado uma vez para baixar essa lista. Nada sobre você ou suas páginas é enviado.",
  "shields.list.purpose.ads": "Bloqueia publicidade",
  "shields.list.purpose.trackers": "Bloqueia rastreamento",
  "shields.list.never": "Nunca baixada.",
  "shields.list.damaged":
    "A cópia salva está danificada e não é usada. Toque em Atualizar para baixá-la de novo.",
  "shields.list.status":
    "Baixada em {date} · {rules} regras de bloqueio · {cosmetic} regras de elementos de página ignoradas",
  "shields.list.version": "Versão da lista {version}",
  "shields.list.due":
    "A lista sugere procurar uma versão nova depois de {date}. O Phoenix nunca verifica sozinho.",
  "shields.list.licence": "Licença: {licence}. Crédito: {attribution}.",
  "shields.list.source": "A atualização contata {source}",
  "shields.list.enable": "Usar {name}",
  "shields.list.enableNeedsDownload": "Baixe a lista antes de ligá-la.",
  "shields.list.update": "Atualizar",
  "shields.list.updateFirst": "Baixar",
  "shields.list.updating": "Baixando…",
  "shields.list.updated": "{name} foi atualizada.",
  "shields.list.remove": "Excluir a cópia baixada",
  "shields.list.removed": "A cópia baixada de {name} foi excluída.",
  "shields.sites.title": "Sites com o bloqueio desligado",
  "shields.sites.empty": "Nenhum site tem o bloqueio desligado.",
  "shields.sites.add.label": "Nome do site, por exemplo example.com",
  "shields.sites.add.submit": "Desligar o bloqueio neste site",
  "shields.sites.remove": "Ligar o bloqueio de novo para {site}",
  "shields.sites.hint":
    "Digite apenas o nome do site, não um endereço. O site e seus subdomínios estão incluídos. Os anúncios do próprio YouTube são deixados em paz enquanto o site de música YouTube estiver permitido, e isso é definido em sites de música, não aqui.",
};
