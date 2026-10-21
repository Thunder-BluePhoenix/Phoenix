// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { phone as enphone } from "../../en/phone";

/** Machine-translated; unreviewed (see ../../README.md). */
export const phone: Record<keyof typeof enphone, string> = {
  "phone.title": "Lien téléphone",
  "phone.intro":
    "Associez un téléphone pour qu'il puisse approuver ou refuser ce que Phoenix vous demande. C'est désactivé tant que vous ne l'activez pas.",
  "phone.unavailable": "Impossible de charger les réglages du lien téléphone.",
  "phone.warning.title": "Avant de l'activer",
  "phone.warning.network":
    "L'activer ouvre un écouteur HTTPS distinct, accessible aux autres appareils de votre réseau local (pas à Internet).",
  "phone.warning.pairing":
    "Seuls les téléphones que vous associez, puis confirmez ici, peuvent approuver quoi que ce soit. L'association nécessite un code affiché sur cet écran.",
  "phone.warning.trust":
    "Ne l'activez que sur des réseaux de confiance, comme votre réseau domestique.",
  "phone.warning.presence":
    "Phoenix ne peut pas vérifier qu'une personne est devant cet ordinateur : tout programme de cet ordinateur détenant le jeton de session de Core peut aussi associer des téléphones.",
  "phone.enable.label": "Autoriser les téléphones de mon réseau local à se connecter",
  "phone.saved.on": "Le lien téléphone est activé.",
  "phone.saved.off": "Le lien téléphone est désactivé.",
  "phone.saved.verifyOn":
    "Les approbations depuis un téléphone demandent désormais une vérification biométrique ou de l'appareil.",
  "phone.saved.verifyOff":
    "Les approbations depuis un téléphone ne demandent plus de vérification de l'appareil.",
  "phone.killSwitch":
    "Le coupe-circuit est activé : l'écouteur du téléphone est fermé. Réactivez le lien téléphone ici après avoir désactivé le coupe-circuit.",
  "phone.lockedOut":
    "L'association est verrouillée jusqu'à {time} car trop de codes erronés ont été saisis.",
  "phone.notListening": "Le lien téléphone est activé, mais l'écouteur n'est pas encore démarré.",
  "phone.listen.address": "Adresse et port",
  "phone.listen.fingerprint": "Empreinte du certificat (SHA-256)",
  "phone.pair.show": "Afficher le code d'association",
  "phone.pair.cancel": "Annuler le code",
  "phone.pair.cancelled": "Code d'association annulé.",
  "phone.pair.expired":
    "Le code d'association a expiré. Affichez-en un nouveau pour associer un téléphone.",
  "phone.pair.instruction":
    "Sur le téléphone, saisissez ou scannez ce code et vérifiez que l'empreinte affichée correspond à celle ci-dessous. Si elle diffère, n'allez pas plus loin.",
  "phone.pair.codeLabel": "Code d'association",
  "phone.pair.remaining": "Expire dans {time}",
  "phone.pair.fingerprint": "Empreinte du certificat :",
  "phone.pair.link": "Lien d'association (aucun code QR disponible) :",
  "phone.pair.hiddenActive":
    "Un code d'association est actif jusqu'à {time}. Il n'est pas réaffiché ; annulez-le et affichez-en un nouveau.",
  "phone.pending.question": "Associer « {name} » ?",
  "phone.pending.fingerprint": "Empreinte de la clé",
  "phone.pending.yes": "Oui, associer ce téléphone",
  "phone.pending.no": "Non, refuser",
  "phone.pending.waiting": "En attente de la demande de confirmation de Phoenix.",
  "phone.pending.approved": "Téléphone associé.",
  "phone.pending.rejected": "Association refusée.",
  "phone.verify.label":
    "Exiger une vérification biométrique ou de l'appareil pour les approbations",
  "phone.verify.note":
    "Le téléphone indique si la personne a été vérifiée (empreinte, visage ou verrouillage d'écran). Phoenix ne peut pas vérifier ce rapport lui-même.",
  "phone.devices.title": "Téléphones associés",
  "phone.devices.none": "Aucun téléphone associé.",
  "phone.devices.fingerprint": "Empreinte de la clé",
  "phone.devices.created": "Associé le {date}",
  "phone.devices.lastSeen": "vu pour la dernière fois {when}",
  "phone.devices.neverSeen": "jamais vu",
  "phone.devices.revoked": "Révoqué le {date}",
  "phone.devices.revoke": "Révoquer {name}",
  "phone.devices.revokeAsk": "Révoquer « {name} » ? Il ne pourra plus rien approuver.",
  "phone.devices.revokeYes": "Oui, révoquer",
  "phone.devices.revokeNo": "Le garder",
  "phone.devices.revokedDone": "Téléphone révoqué.",
  "phone.device.unnamed": "Téléphone sans nom",
};
