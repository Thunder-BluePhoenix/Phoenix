// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { remoteRelay as enRemoteRelay } from "../../en/remote-relay";

/** Machine-translated; unreviewed. */
export const remoteRelay: Record<keyof typeof enRemoteRelay, string> = {
  "relay.title": "Relais distant",
  "relay.intro":
    "Un relais permet à un téléphone associé de répondre aux approbations en attente de Phoenix lorsqu'il n'est pas sur votre réseau domestique. Il est désactivé par défaut et c'est vous qui choisissez l'adresse du relais. Rien n'est envoyé tant que vous ne l'activez pas.",
  "relay.notAvailable":
    "Le relais distant n'est pas disponible : ce Phoenix Core n'a pas de coffre de secrets du système d'exploitation pour conserver la clé du relais.",
  "relay.loadFailed": "Impossible de charger l'état du relais distant.",

  "relay.privacy.title": "Ce que le relais peut et ne peut pas voir",
  "relay.privacy.cannot":
    "Il ne peut rien lire, modifier, falsifier ni rejouer. Chaque message est chiffré de bout en bout entre Phoenix et un appareil associé, et une décision venant d'un appareil est signée et vérifiée par Phoenix avant d'être prise en compte.",
  "relay.privacy.sees":
    "Il peut voir l'identifiant (id) aléatoire de la route, à qui s'adresse un message (cet ordinateur ou un appareil), ainsi que la taille et l'heure de chaque message. Il peut aussi supprimer, retarder ou répéter des messages, ou cesser de fonctionner.",
  "relay.privacy.tls":
    "Une connexion sécurisée (https) au relais masque ces informations de routage aux personnes présentes sur le réseau. La protection des messages eux-mêmes n'en dépend pas.",

  "relay.status.title": "État",
  "relay.status.off": "Désactivé",
  "relay.status.connected": "Activé et connecté au relais",
  "relay.status.connecting": "Activé, mais non connecté au relais pour le moment",
  "relay.status.url": "Adresse du relais",
  "relay.status.route": "Route",
  "relay.status.lastError": "Dernier problème signalé : {message}",

  "relay.enable.label": "Adresse du relais",
  "relay.enable.hint":
    "Utilisez une adresse https:// d'un relais que vous gérez ou en qui vous avez confiance. http:// simple n'est accepté que pour cet ordinateur.",
  "relay.enable.note":
    "L'activation crée une nouvelle route aléatoire et une nouvelle clé de relais pour cet ordinateur. La clé privée reste dans le coffre de secrets du système d'exploitation et n'est jamais affichée.",
  "relay.enable.button": "Activer",
  "relay.url.empty": "Saisissez l'adresse du relais.",
  "relay.url.tooLong": "L'adresse du relais est trop longue.",
  "relay.url.notUrl": "Ce n'est pas une adresse web.",
  "relay.url.https": "L'adresse du relais doit commencer par https://.",
  "relay.url.credentials":
    "L'adresse du relais ne peut pas contenir de nom d'utilisateur, de mot de passe, de requête ni de fragment.",
  "relay.saved.on": "Relais distant activé.",
  "relay.saved.off": "Relais distant désactivé. La route et la clé du relais ont été supprimées.",

  "relay.disable.button": "Désactiver",
  "relay.disable.ask":
    "Désactiver le relais distant ? Cela supprime la route et la clé privée du relais de cet ordinateur. Les appareils qui les avaient enregistrées cessent de fonctionner, et après une nouvelle activation du relais, il faudra leur fournir les nouvelles informations.",
  "relay.disable.yes": "Oui, désactiver et supprimer",
  "relay.disable.no": "Le laisser activé",

  "relay.details.show": "Afficher les informations du relais pour un appareil",
  "relay.details.hide": "Masquer les informations",
  "relay.details.title": "Informations à donner à un appareil",
  "relay.details.intro":
    "Un appareil les enregistre lors de son association. L'association elle-même est celle du lien téléphone. Phoenix n'a pas de code d'association ni de lien pour le relais ; donnez donc ces valeurs à l'appareil par un moyen de confiance.",
  "relay.details.url": "Adresse du relais",
  "relay.details.route": "Identifiant (id) de la route",
  "relay.details.key": "Clé publique du relais de cet ordinateur",
  "relay.details.warn":
    "L'identifiant de la route est une adresse, pas un mot de passe. Ces informations sont de nouveau masquées lorsque vous fermez ce panneau, désactivez le relais ou que la route change.",

  "relay.devices.title": "Appareils associés",
  "relay.devices.none":
    "Aucun appareil n'est encore associé. Associez-en un dans la section du lien téléphone.",
  "relay.devices.note":
    "Ce sont les appareils associés via le lien téléphone. En révoquer un à cet endroit l'arrête sur le relais dès son prochain message.",
  "relay.devices.loadFailed": "Impossible de charger les appareils associés.",
  "relay.devices.unnamed": "Appareil sans nom",
  "relay.devices.fingerprint": "Empreinte de la clé",
  "relay.devices.revoked": "Révoqué le {date}",
  "relay.devices.push": "Envoyer les approbations à {name}",
  "relay.devices.pushed": "Les approbations en attente ont été envoyées à {name}.",
};
