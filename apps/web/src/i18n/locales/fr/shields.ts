// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { shields as enShields } from "../../en/shields";

/** Machine-translated; unreviewed. */
export const shields: Record<keyof typeof enShields, string> = {
  "shields.title": "Blocage des publicités et des traqueurs",
  "shields.intro":
    "Ces réglages s'appliqueront dans le navigateur Phoenix à sa sortie. Phoenix n'a pas encore de fenêtre de navigateur : rien n'est donc bloqué aujourd'hui dans aucune page. Seules les requêtes réseau peuvent être bloquées ainsi : le masquage d'éléments de page n'est pas pris en charge, et ce n'est pas une copie des protections d'un autre navigateur.",
  "shields.unavailable":
    "Les réglages de blocage des publicités et des traqueurs ne sont pas disponibles dans Phoenix Core.",
  "shields.loadFailed": "Impossible de lire les réglages de blocage depuis Phoenix Core.",
  "shields.global.label": "Bloquer les publicités et les traqueurs",
  "shields.global.hint":
    "Désactivé, aucune liste n'est appliquée à aucun site. Activé sans liste téléchargée, une courte liste intégrée d'hôtes connus de publicité et d'analyse est utilisée.",
  "shields.lists.title": "Listes de filtres",
  "shields.lists.note":
    "Les listes ne sont pas fournies avec Phoenix et ne sont jamais téléchargées d'elles-mêmes. Appuyer sur Mettre à jour contacte easylist.to une fois pour télécharger cette liste. Rien sur vous ni sur vos pages n'est envoyé.",
  "shields.list.purpose.ads": "Bloque la publicité",
  "shields.list.purpose.trackers": "Bloque le pistage",
  "shields.list.never": "Jamais téléchargée.",
  "shields.list.damaged":
    "La copie enregistrée est endommagée et n'est pas utilisée. Appuyez sur Mettre à jour pour la télécharger de nouveau.",
  "shields.list.status":
    "Téléchargée le {date} · {rules} règles de blocage · {cosmetic} règles d'éléments de page ignorées",
  "shields.list.version": "Version de la liste {version}",
  "shields.list.due":
    "La liste suggère de chercher une nouvelle version après le {date}. Phoenix ne vérifie jamais de lui-même.",
  "shields.list.licence": "Licence : {licence}. Crédit : {attribution}.",
  "shields.list.source": "La mise à jour contacte {source}",
  "shields.list.enable": "Utiliser {name}",
  "shields.list.enableNeedsDownload": "Téléchargez la liste avant de l'activer.",
  "shields.list.update": "Mettre à jour",
  "shields.list.updateFirst": "Télécharger",
  "shields.list.updating": "Téléchargement…",
  "shields.list.updated": "{name} a été mise à jour.",
  "shields.list.remove": "Supprimer la copie téléchargée",
  "shields.list.removed": "La copie téléchargée de {name} a été supprimée.",
  "shields.sites.title": "Sites dont le blocage est désactivé",
  "shields.sites.empty": "Aucun site n'a le blocage désactivé.",
  "shields.sites.add.label": "Nom du site, par exemple example.com",
  "shields.sites.add.submit": "Désactiver le blocage pour ce site",
  "shields.sites.remove": "Réactiver le blocage pour {site}",
  "shields.sites.hint":
    "Saisissez uniquement le nom du site, pas une adresse. Le site et ses sous-domaines sont inclus. Les publicités propres à YouTube sont laissées tranquilles tant que le site de musique YouTube est autorisé, ce qui se règle dans les sites de musique, pas ici.",
};
