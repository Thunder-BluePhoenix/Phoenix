// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { remoteRelay as enRemoteRelay } from "../../en/remote-relay";

/** Machine-translated; unreviewed. */
export const remoteRelay: Record<keyof typeof enRemoteRelay, string> = {
  "relay.title": "Relay remoto",
  "relay.intro":
    "Um relay permite que um celular pareado responda às aprovações pendentes do Phoenix quando não está na sua rede doméstica. Ele vem desativado por padrão e você escolhe o endereço do relay. Nada é enviado até você ativá-lo.",
  "relay.notAvailable":
    "O relay remoto não está disponível: este Phoenix Core não tem um cofre de segredos do sistema operacional para guardar a chave do relay.",
  "relay.loadFailed": "Não foi possível carregar o estado do relay remoto.",

  "relay.privacy.title": "O que o relay pode e não pode ver",
  "relay.privacy.cannot":
    "Ele não pode ler, alterar, falsificar nem reenviar nada. Cada mensagem é criptografada de ponta a ponta entre o Phoenix e um dispositivo pareado, e uma decisão vinda de um dispositivo é assinada e verificada pelo Phoenix antes de valer.",
  "relay.privacy.sees":
    "Ele pode ver o id aleatório da rota, para qual endereço uma mensagem se destina (este computador ou um dispositivo), e o tamanho e o horário de cada mensagem. Também pode descartar, atrasar ou repetir mensagens, ou parar de funcionar.",
  "relay.privacy.tls":
    "Uma conexão segura (https) com o relay oculta essas informações de roteamento de quem está na rede. A proteção das próprias mensagens não depende dela.",

  "relay.status.title": "Estado",
  "relay.status.off": "Desativado",
  "relay.status.connected": "Ativado e conectado ao relay",
  "relay.status.connecting": "Ativado, mas sem conexão com o relay neste momento",
  "relay.status.url": "Endereço do relay",
  "relay.status.route": "Rota",
  "relay.status.lastError": "Último problema informado: {message}",

  "relay.enable.label": "Endereço do relay",
  "relay.enable.hint":
    "Use um endereço https:// de um relay que você mesmo opera ou em que confia. O http:// simples é aceito apenas para este computador.",
  "relay.enable.note":
    "Ao ativar, é criada uma nova rota aleatória e uma nova chave de relay para este computador. A chave privada fica no cofre de segredos do sistema operacional e nunca é exibida.",
  "relay.enable.button": "Ativar",
  "relay.url.empty": "Informe o endereço do relay.",
  "relay.url.tooLong": "O endereço do relay é muito longo.",
  "relay.url.notUrl": "Isso não é um endereço web.",
  "relay.url.https": "O endereço do relay deve começar com https://.",
  "relay.url.credentials":
    "O endereço do relay não pode conter nome de usuário, senha, consulta (query) nem fragmento.",
  "relay.saved.on": "Relay remoto ativado.",
  "relay.saved.off": "Relay remoto desativado. A rota e a chave do relay foram descartadas.",

  "relay.disable.button": "Desativar",
  "relay.disable.ask":
    "Desativar o relay remoto? Isso descarta a rota e a chave privada do relay deste computador. Os dispositivos que as fixaram deixam de funcionar e, depois que você ativar o relay novamente, precisarão receber os novos detalhes.",
  "relay.disable.yes": "Sim, desativar e descartar",
  "relay.disable.no": "Manter ativado",

  "relay.details.show": "Mostrar os detalhes do relay para um dispositivo",
  "relay.details.hide": "Ocultar os detalhes",
  "relay.details.title": "Detalhes para entregar a um dispositivo",
  "relay.details.intro":
    "Um dispositivo fixa esses dados ao ser pareado. O pareamento em si é o pareamento do link do celular. O Phoenix não tem código nem link de pareamento para o relay; por isso, entregue esses valores ao dispositivo de uma forma em que você confie.",
  "relay.details.url": "Endereço do relay",
  "relay.details.route": "Id da rota",
  "relay.details.key": "Chave pública do relay deste computador",
  "relay.details.warn":
    "O id da rota é um endereço, não uma senha. Esses detalhes voltam a ficar ocultos quando você fecha este painel, desativa o relay ou a rota muda.",

  "relay.devices.title": "Dispositivos pareados",
  "relay.devices.none":
    "Nenhum dispositivo foi pareado ainda. Pareie um na seção de link do celular.",
  "relay.devices.note":
    "Estes são os dispositivos pareados por meio do link do celular. Revogar um deles lá o bloqueia no relay já na próxima mensagem.",
  "relay.devices.loadFailed": "Não foi possível carregar os dispositivos pareados.",
  "relay.devices.unnamed": "Dispositivo sem nome",
  "relay.devices.fingerprint": "Impressão digital da chave",
  "relay.devices.revoked": "Revogado em {date}",
  "relay.devices.push": "Enviar aprovações para {name}",
  "relay.devices.pushed": "As aprovações pendentes foram enviadas para {name}.",
};
