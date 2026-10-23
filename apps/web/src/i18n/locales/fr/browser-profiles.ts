// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { browserProfiles as enBrowserProfiles } from "../../en/browser-profiles";

/** Machine-translated; unreviewed. */
export const browserProfiles: Record<keyof typeof enBrowserProfiles, string> = {
  "browserProfiles.title": "Profils de navigateur",
  "browserProfiles.intro":
    "Phoenix n’a pas encore de navigateur propre : aucune page ne s’ouvre ici. Un profil est un enregistrement de favoris, un choix de synchronisation et des extensions.",
  "browserProfiles.unavailable":
    "Les profils de navigateur ne sont pas disponibles : Phoenix Core n’a pas de coffre de secrets du système d’exploitation pour les protéger.",
  "browserProfiles.loadFailed": "Impossible de lire les profils de navigateur depuis Phoenix Core.",
  "browserProfiles.empty": "Aucun profil pour le moment.",
  "browserProfiles.list": "Profils",
  "browserProfiles.create.name": "Nom du profil",
  "browserProfiles.create.submit": "Créer le profil",
  "browserProfiles.counts":
    "Favoris : {bookmarks} · Historique : {history} · Extensions : {extensions}",
  "browserProfiles.sync.label": "Synchroniser ce profil entre mes appareils",
  "browserProfiles.sync.hint":
    "La synchronisation ne fonctionne que si la synchronisation du compte est aussi configurée dans Réglages → Synchronisation.",
  "browserProfiles.import.label": "Favoris à importer (fichier HTML exporté par un navigateur)",
  "browserProfiles.import.hint":
    "Collez le contenu du fichier. 256 KiB au maximum à la fois ; scindez un export plus volumineux.",
  "browserProfiles.import.submit": "Importer les favoris",
  "browserProfiles.import.result": "{imported} importés, {skipped} ignorés.",
  "browserProfiles.publish.submit": "Publier sur mes autres appareils",
  "browserProfiles.publish.done": "Publié.",
  "browserProfiles.remove.start": "Supprimer le profil",
  "browserProfiles.remove.ask":
    "Supprimer « {name} » ? Cela efface ses favoris, son historique, ses extensions et ses identifiants enregistrés, et ne peut pas être annulé.",
  "browserProfiles.remove.done":
    "Profil supprimé. Ses favoris, son historique, ses extensions et ses identifiants enregistrés ont été effacés. Phoenix Core ne peut pas encore effacer le stockage web isolé nommé {partition}.",
  "browserProfiles.devices.heading": "Autres appareils",
  "browserProfiles.devices.check": "Rechercher les profils de mes autres appareils",
  "browserProfiles.devices.none": "Aucun nouveau profil de vos autres appareils.",
  "browserProfiles.devices.found": "Profils de vos autres appareils",
  "browserProfiles.devices.adopt": "Adopter",
  "browserProfiles.devices.adoptLabel": "Adopter {name} sur cet appareil",
  "browserProfiles.devices.adopted": "Profil adopté.",
  "browserProfiles.ext.heading": "Extensions",
  "browserProfiles.ext.admin": "Les extensions sont installées par votre administrateur.",
  "browserProfiles.ext.none": "Aucune extension.",
  "browserProfiles.ext.loadFailed": "Impossible de lire les extensions.",
  "browserProfiles.ext.version": "Version {version}",
  "browserProfiles.ext.origins": "Sites : {origins}",
  "browserProfiles.ext.permissions": "Autorisations : {permissions}",
  "browserProfiles.ext.noneListed": "aucune",
  "browserProfiles.ext.approved": "Approuvée",
  "browserProfiles.ext.notApproved": "Non approuvée",
  "browserProfiles.ext.revoked": "Révoquée",
  "browserProfiles.ext.untrusted": "Signataire non approuvé",
  "browserProfiles.ext.approve": "Approuver",
  "browserProfiles.ext.approveLabel": "Approuver l’extension {id}",
  "browserProfiles.ext.withdraw": "Retirer l’approbation",
  "browserProfiles.ext.withdrawLabel": "Retirer l’approbation de l’extension {id}",
  "browserProfiles.ext.remove": "Supprimer",
  "browserProfiles.ext.removeLabel": "Supprimer l’extension {id}",
  "browserProfiles.ext.waiting": "En attente de votre réponse à la question d’approbation…",
  "browserProfiles.music.title": "Sites de musique",
  "browserProfiles.music.intro":
    "Phoenix ne lit pas de musique. Activer un site permet seulement à Phoenix de construire une adresse de recherche pour celui-ci, que vous ouvrez vous-même. Tous les sites sont désactivés tant que vous ne les activez pas.",
  "browserProfiles.music.unavailable":
    "Les sites de musique ne sont pas disponibles dans ce Phoenix Core.",
  "browserProfiles.music.loadFailed":
    "Impossible de lire les sites de musique depuis Phoenix Core.",
  "browserProfiles.music.list": "Sites de musique",
  "browserProfiles.music.hosts": "Adresses utilisées : {hosts}",
  "browserProfiles.music.adBlocking":
    "Tant que YouTube est activé, le blocage des publicités ne s’applique pas à son propre lecteur.",
  "browserProfiles.music.site.youtube": "YouTube",
  "browserProfiles.music.site.soundcloud": "SoundCloud",
  "browserProfiles.music.site.bandcamp": "Bandcamp",
  "browserProfiles.music.site.spotify-web": "Spotify Web",
  "browserProfiles.music.site.other": "Site de musique {site}",
  "browserProfiles.music.search.label": "Rechercher sur {site}",
  "browserProfiles.music.search.submit": "Rechercher",
  "browserProfiles.music.search.open": "Adresse de recherche (s’ouvre dans un nouvel onglet) :",
  "browserProfiles.music.search.badAddress":
    "Phoenix Core a renvoyé une adresse impossible à ouvrir.",
};
