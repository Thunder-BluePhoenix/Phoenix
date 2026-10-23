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
  "phone.addressChanged":
    "L’adresse réseau que vous avez choisie n’est plus disponible ; le lien téléphone reste donc désactivé. Choisissez de nouveau une adresse pour le réactiver.",
  "phone.addressChanged.title": "L'adresse de cet ordinateur a changé",
  "phone.addressChanged.mayNotReach":
    "Un téléphone déjà associé peut ne plus pouvoir joindre cet ordinateur, car il se souvient encore de l'ancienne adresse. Rien n'a été ouvert sur un autre réseau.",
  "phone.addressChanged.pick": "Adresse réseau",
  "phone.addressChanged.use": "Utiliser cette adresse",
  "phone.addressChanged.none":
    "Aucune adresse privée du réseau local n'a été trouvée pour le moment. Connectez-vous à votre réseau puis revenez, ou désactivez le lien téléphone.",
  "phone.addressChanged.off": "Désactiver le lien téléphone",
  "phone.addressChanged.repair":
    "Après avoir choisi une adresse, affichez un nouveau code d'association et associez de nouveau le téléphone s'il ne parvient toujours pas à se connecter.",
  "phone.saved.address": "L'adresse du lien téléphone a été modifiée.",
  "phone.port.label": "Port",
  "phone.port.save": "Enregistrer le port",
  "phone.port.invalid": "Saisissez un nombre entier de 1024 à 65535.",
  "phone.port.note":
    "Le lien téléphone écoute sur ce port (de 1024 à 65535 ; la valeur par défaut est 47821). Un nouveau port s'applique à la prochaine ouverture du lien ; s'il est activé en ce moment, il redémarre sur le nouveau port et tout code d'association affiché cesse de fonctionner. Les téléphones associés auparavant peuvent encore utiliser l'ancien port et devoir être associés de nouveau.",
  "phone.saved.port": "Port du lien téléphone enregistré : {port}.",
  "phone.pair.qrLabel": "Code QR contenant le lien d'association",
  "phone.pair.qrHint":
    "Scannez-le avec l'application du téléphone que vous associez. Il contient le code ci-dessus : ne le montrez qu'à votre propre téléphone.",
  "phone.pair.qrUnavailable":
    "Impossible de créer un code QR pour ce lien ; utilisez le lien ci-dessous.",
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
  "phone.pair.link": "Lien d'association (si le téléphone ne peut pas scanner le code QR) :",
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
