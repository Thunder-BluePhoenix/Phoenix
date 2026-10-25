// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "Perfis de navegador",
  "browserProfiles.intro":
    "O Phoenix ainda não tem navegador próprio, por isso nenhuma página abre aqui: um perfil é um registo de favoritos, uma escolha de sincronização e extensões.",
  "browserProfiles.unavailable":
    "Os perfis de navegador não estão disponíveis: o Phoenix Core não tem um cofre de segredos do sistema operativo para os guardar com segurança.",
  "browserProfiles.loadFailed": "Não foi possível ler os perfis de navegador do Phoenix Core.",
  "browserProfiles.empty": "Ainda não há perfis.",
  "browserProfiles.list": "Perfis",
  "browserProfiles.create.name": "Nome do perfil",
  "browserProfiles.create.submit": "Criar perfil",
  "browserProfiles.counts":
    "Favoritos: {bookmarks} · Histórico: {history} · Extensões: {extensions}",
  "browserProfiles.sync.label": "Sincronizar este perfil entre os meus dispositivos",
  "browserProfiles.sync.hint":
    "A sincronização só funciona quando a sincronização da conta também está configurada em Definições → Sincronização.",
  "browserProfiles.import.label": "Favoritos a importar (ficheiro HTML exportado por um navegador)",
  "browserProfiles.import.hint":
    "Cole o conteúdo do ficheiro. Até 256 KiB de cada vez; divida uma exportação maior em partes.",
  "browserProfiles.import.submit": "Importar favoritos",
  "browserProfiles.import.result": "Importados {imported}, ignorados {skipped}.",
  "browserProfiles.publish.submit": "Publicar nos meus outros dispositivos",
  "browserProfiles.publish.done": "Publicado.",
  "browserProfiles.remove.start": "Remover perfil",
  "browserProfiles.remove.ask":
    "Remover “{name}”? Isto apaga os seus favoritos, histórico, extensões e credenciais guardadas, e não pode ser desfeito.",
  "browserProfiles.remove.done":
    "Perfil removido. Os seus favoritos, histórico, extensões e credenciais guardadas foram apagados. Os dados web guardados (cookies e armazenamento de sites) são apagados quando a janela do navegador Phoenix está aberta, porque só essa janela pode pedir ao shell do ambiente de trabalho que os apague.",
  "browserProfiles.purge.pending":
    "Os dados web guardados de {count, plural, one {# perfil removido aguardam} other {# perfis removidos aguardam}} a eliminação. Abra o navegador Phoenix para concluir.",
  "browserProfiles.devices.heading": "Outros dispositivos",
  "browserProfiles.devices.check": "Procurar perfis dos meus outros dispositivos",
  "browserProfiles.devices.none": "Não há perfis novos dos seus outros dispositivos.",
  "browserProfiles.devices.found": "Perfis dos seus outros dispositivos",
  "browserProfiles.devices.adopt": "Adotar",
  "browserProfiles.devices.adoptLabel": "Adotar {name} neste dispositivo",
  "browserProfiles.devices.adopted": "Perfil adotado.",
  "browserProfiles.ext.heading": "Extensões",
  "browserProfiles.ext.admin": "As extensões são instaladas pelo seu administrador.",
  "browserProfiles.ext.none": "Sem extensões.",
  "browserProfiles.ext.loadFailed": "Não foi possível ler as extensões.",
  "browserProfiles.ext.version": "Versão {version}",
  "browserProfiles.ext.origins": "Sites: {origins}",
  "browserProfiles.ext.permissions": "Permissões: {permissions}",
  "browserProfiles.ext.noneListed": "nenhuma",
  "browserProfiles.ext.approved": "Aprovada",
  "browserProfiles.ext.notApproved": "Não aprovada",
  "browserProfiles.ext.revoked": "Revogada",
  "browserProfiles.ext.untrusted": "Signatário não confiável",
  "browserProfiles.ext.approve": "Aprovar",
  "browserProfiles.ext.approveLabel": "Aprovar a extensão {id}",
  "browserProfiles.ext.withdraw": "Retirar aprovação",
  "browserProfiles.ext.withdrawLabel": "Retirar a aprovação da extensão {id}",
  "browserProfiles.ext.remove": "Remover",
  "browserProfiles.ext.removeLabel": "Remover a extensão {id}",
  "browserProfiles.ext.waiting": "A aguardar a sua resposta à pergunta de aprovação…",
  "browserProfiles.music.title": "Sites de música",
  "browserProfiles.music.intro":
    "O Phoenix não reproduz música. Ativar um site só permite ao Phoenix criar um endereço de pesquisa para ele, que abre você mesmo. Todos os sites ficam desativados até os ativar.",
  "browserProfiles.music.unavailable":
    "Os sites de música não estão disponíveis neste Phoenix Core.",
  "browserProfiles.music.loadFailed": "Não foi possível ler os sites de música do Phoenix Core.",
  "browserProfiles.music.list": "Sites de música",
  "browserProfiles.music.hosts": "Endereços usados: {hosts}",
  "browserProfiles.music.adBlocking":
    "Enquanto o YouTube estiver ativado, o bloqueio de anúncios não se aplica ao seu próprio leitor.",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "Site de música {site}",
  "browserProfiles.music.search.label": "Pesquisar em {site}",
  "browserProfiles.music.search.submit": "Pesquisar",
  "browserProfiles.music.search.open": "Endereço de pesquisa (abre num novo separador):",
  "browserProfiles.music.search.badAddress":
    "O Phoenix Core devolveu um endereço que não pode ser aberto.",
};
