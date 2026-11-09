// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserChrome as enBrowserChrome } from "../../en/browser-chrome";

/** Machine-translated; unreviewed. */
export const browserChrome: Record<keyof typeof enBrowserChrome, string> = {
  "browser.find.open": "Localizar na página",
  "browser.find.label": "Localizar na página",
  "browser.find.placeholder": "Localizar na página",
  "browser.find.next": "Próxima ocorrência",
  "browser.find.prev": "Ocorrência anterior",
  "browser.find.close": "Fechar a busca",
  "browser.find.searching": "Procurando…",
  "browser.find.found": "Encontrado nesta página.",
  "browser.find.notFound": "Não encontrado nesta página.",
  "browser.find.tooLong": "O texto da busca pode ter no máximo {max} caracteres.",
  "browser.find.control": "O texto da busca não pode conter caracteres de controle.",
  "browser.find.bidi":
    "O texto da busca não pode conter caracteres de controle de direção do texto.",
  "browser.find.failed": "Não foi possível pesquisar nesta página.",
  "browser.find.bad_query": "O navegador recusou esse texto de busca.",
  "browser.find.unknown_tab": "Essa aba não existe mais.",
  "browser.find.no_page": "Ainda não há uma página para pesquisar.",
  "browser.permission.title": "Uma página está pedindo permissão",
  "browser.permission.origin": "Site: {origin}",
  "browser.permission.asks": "Quer usar: {permission}",
  "browser.permission.allow": "Permitir uma vez",
  "browser.permission.deny": "Negar",
  "browser.permission.countdown":
    "Será negado automaticamente em {seconds, plural, one {# segundo} other {# segundos}}.",
  "browser.permission.more":
    "{count, plural, one {# solicitação a mais está esperando} other {# solicitações a mais estão esperando}}",
  "browser.permission.kind.microphone": "seu microfone",
  "browser.permission.kind.camera": "sua câmera",
  "browser.permission.kind.geolocation": "sua localização",
  "browser.permission.kind.notifications": "notificações",
  "browser.permission.kind.clipboard-read": "a leitura da sua área de transferência",
  "browser.permission.kind.display-capture": "sua tela",
  "browser.permission.kind.midi": "dispositivos MIDI",
  "browser.permission.kind.sensors": "sensores de movimento e outros",
  "browser.permission.kind.media-key-system-access": "mídia protegida (DRM)",
  "browser.permission.kind.local-fonts": "as fontes instaladas neste computador",
  "browser.permission.kind.window-management": "suas telas e janelas",
  "browser.permission.kind.pointer-lock": "o ponteiro do mouse",
  "browser.permission.kind.automatic-downloads": "vários downloads de uma vez",
  "browser.permission.kind.file-system-access": "arquivos neste computador",
  "browser.permission.kind.autoplay": "tocar som automaticamente",
  "browser.permission.kind.other": "outra coisa",
  "browser.corner.noShell": "Não conectado ao aplicativo de desktop do Phoenix.",
  "browser.corner.noTab": "Nenhuma aba está aberta.",
  "browser.corner.loading": "Carregando a página.",
  "browser.corner.idle": "A página foi carregada.",
  "browser.corner.permission": "Uma página está pedindo permissão. Responda, por favor.",
  "browser.corner.shieldsOff": "O bloqueio de anúncios e rastreadores está desativado em {site}.",
  "browser.corner.blocked":
    "{count, plural, one {# solicitação foi bloqueada nesta página.} other {# solicitações foram bloqueadas nesta página.}}",
  "browser.corner.setting":
    "Mostrar o Fawkes no canto do navegador Phoenix (somente aplicativo de desktop)",
  "browser.corner.settingHint":
    "Ativado por padrão. Um pequeno Fawkes na barra de ferramentas do navegador mostra se a página está carregando, se uma permissão está sendo pedida, se o bloqueio está desativado ou se uma busca foi feita. Ele nunca aparece dentro de uma página da web.",
};
