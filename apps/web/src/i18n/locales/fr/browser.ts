// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browser as enBrowser } from "../../en/browser";

/** Machine-translated; unreviewed. */
export const browser: Record<keyof typeof enBrowser, string> = {
  "browser.tabs.label": "Onglets",
  "browser.tab.untitled": "Nouvel onglet",
  "browser.tab.loading": "Chargement",
  "browser.tab.close": "Fermer l'onglet {title}",
  "browser.tab.new": "Nouvel onglet",
  "browser.nav.back": "Précédent",
  "browser.nav.forward": "Suivant",
  "browser.nav.reload": "Actualiser",
  "browser.address.label": "Adresse ou recherche",
  "browser.address.placeholder": "Rechercher ou saisir une adresse",
  "browser.address.go": "Aller",
  "browser.address.blocked": "Non ouvert : {text}",
  "browser.deny.unparseable": "Ce n'est pas une adresse web valide.",
  "browser.deny.scheme_not_allowed":
    "Seules les adresses web sécurisées (https) peuvent être ouvertes.",
  "browser.deny.dangerous_scheme":
    "Les adresses qui exécutent du code ou contiennent la page elle-même ne peuvent pas être ouvertes.",
  "browser.deny.file_blocked": "Les fichiers de cet ordinateur ne peuvent pas être ouverts ici.",
  "browser.deny.credentials_in_url":
    "Les adresses contenant un nom d'utilisateur ou un mot de passe sont refusées.",
  "browser.deny.private_network":
    "Les adresses de cet ordinateur ou de votre réseau local ne peuvent pas être saisies ici. Ouvrez plutôt la page d'un programme depuis le radar de ports.",
  "browser.deny.bad_port": "Ce port est bloqué car il appartient à un service non web.",
  "browser.deny.insecure_blocked": "Les adresses http simples ne sont pas ouvertes.",
  "browser.deny.site_denied": "Ce site figure sur la liste de blocage.",
  "browser.deny.dns_private":
    "Ce nom pointe vers une adresse de cet ordinateur ou de votre réseau local.",
  "browser.deny.port_radar_invalid":
    "La demande du radar de ports n'était pas une simple page de cet ordinateur ; elle a été ignorée.",
  "browser.deny.unknown": "Cette adresse a été refusée.",
  "browser.zoom.label": "Zoom",
  "browser.zoom.out": "Zoom arrière",
  "browser.zoom.in": "Zoom avant",
  "browser.zoom.reset": "Rétablir le zoom à {percent}",
  "browser.shields.label": "Bloquer les publicités et les traqueurs sur {site}",
  "browser.shields.saveFailed":
    "Le choix a été appliqué ici mais n'a pas pu être enregistré dans Phoenix Core.",
  "browser.shields.blocked": "{count, plural, one {# requête bloquée} other {# requêtes bloquées}}",
  "browser.empty": "Aucun onglet ouvert. Saisissez une adresse ou une recherche ci-dessus.",
  "browser.noShell":
    "Cette page est la barre d'outils du navigateur Phoenix. Elle ne fonctionne que dans l'application de bureau Phoenix.",
  "browser.radar.title": "Ouvrir un programme de cet ordinateur ?",
  "browser.radar.body":
    "Le radar de ports demande d'ouvrir cette adresse. C'est un programme qui s'exécute sur cet ordinateur, pas un site web, et elle n'est pas chiffrée.",
  "browser.radar.url": "Adresse : {url}",
  "browser.radar.open": "L'ouvrir",
  "browser.radar.cancel": "Annuler",
  "browser.error.action": "Le navigateur n'a pas pu effectuer cette action.",
  "browser.profile.label": "Les nouveaux onglets s’ouvrent dans",
  "browser.profile.private": "Privé (rien n’est enregistré)",
  "browser.tab.profile": "Profil : {name}",
  "browser.deny.profile_invalid": "Ce profil n’est pas valide, rien n’a donc été ouvert.",
  "browser.deny.profile_unsupported":
    "Les profils enregistrés ne sont pas disponibles dans cette version du navigateur.",
  "browser.deny.profile_busy":
    "Ce profil est en cours de suppression ou occupé. Réessayez dans un instant.",
  "browser.deny.profile_failed": "Le stockage web du profil n’a pas pu être ouvert.",
  "browser.purge.running": "Suppression des données web enregistrées d’un profil supprimé…",
  "browser.purge.failed":
    "Les données web enregistrées d’un profil supprimé n’ont pas encore pu être effacées. Phoenix réessaiera.",
};
