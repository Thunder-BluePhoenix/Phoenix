// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { statusLights as enStatusLights } from "../../en/status-lights";

/** Machine-translated; unreviewed. */
export const statusLights: Record<keyof typeof enStatusLights, string> = {
  "statusLights.limits":
    "Seules des couleurs fixes sont envoyées, jamais de texte. Les identifiants (une clé d’application Hue, un jeton Luxafor) sont en écriture seule : une fois enregistrés, ils ne sont plus jamais affichés. Les noms et identifiants qu’une lumière signale sont affichés en texte brut.",
  "statusLights.line.luxafor": "Application Luxafor à l’adresse {address}",
  "statusLights.line.hue": "Lumière Hue sur le pont {bridge}",

  "statusLights.error.unavailable":
    "Ce Phoenix Core n’a pas de coffre d’identifiants du système, un identifiant ne peut donc pas être conservé.",
  "statusLights.error.save":
    "La liste des lumières n’a pas pu être enregistrée. Vérifiez le nom et l’adresse.",
  "statusLights.error.capability": "Le réglage Voyants d’état n’a pas pu être modifié.",
  "statusLights.error.hueName":
    "Donnez au pont un nom composé de lettres, de chiffres et de . _ : - (160 caractères au maximum).",
  "statusLights.error.hueInspect":
    "Le pont n’a pas répondu à cette adresse. Utilisez son adresse IPv4 sur votre propre réseau.",
  "statusLights.error.huePair":
    "L’appairage a échoué. Appuyez sur le bouton rond du pont, puis réessayez.",
  "statusLights.error.hueRemove": "Le pont n’a pas pu être retiré.",
  "statusLights.error.hueLights": "Les lumières de ce pont n’ont pas pu être listées.",
  "statusLights.error.luxaforToken":
    "Le jeton n’a pas été enregistré. Il doit comporter de 1 à 128 caractères imprimables sans espaces.",
  "statusLights.error.lifx":
    "La détection LIFX ne s’est pas terminée. Patientez quelques secondes et réessayez.",
  "statusLights.error.quietInvalid":
    "Saisissez deux heures et un vrai fuseau horaire, par exemple Europe/Paris.",

  "statusLights.hue.title": "Philips Hue",
  "statusLights.hue.notAvailable":
    "Hue n’est pas disponible : ce Phoenix Core n’a pas de coffre d’identifiants du système.",
  "statusLights.hue.loadFailed": "Impossible de charger les ponts Hue.",
  "statusLights.hue.intro":
    "Un pont appairé n’est approuvé que tant qu’il présente le certificat dont vous avez confirmé l’empreinte SHA-256. Sa clé d’application est conservée dans le coffre d’identifiants de votre système et n’est jamais affichée.",
  "statusLights.hue.empty": "Aucun pont appairé.",
  "statusLights.hue.bridgeLine": "à l’adresse {address}:{port}",
  "statusLights.hue.fingerprint": "Empreinte SHA-256 :",
  "statusLights.hue.find": "Afficher les lumières",
  "statusLights.hue.findNamed": "Afficher les lumières du pont {name}",
  "statusLights.hue.remove": "Retirer le pont",
  "statusLights.hue.removeNamed": "Retirer le pont {name}",
  "statusLights.hue.removeNote":
    "Retirer un pont supprime sa clé enregistrée. Les lumières qui l’utilisent ne sont plus contactées.",
  "statusLights.hue.noLights": "Ce pont n’a signalé aucune lumière.",
  "statusLights.hue.alreadyAdded": "Ajoutée",
  "statusLights.hue.add": "Ajouter",
  "statusLights.hue.addNamed": "Ajouter la lumière Hue {name}",
  "statusLights.hue.pairTitle": "Appairer un pont",
  "statusLights.hue.name": "Nom de ce pont",
  "statusLights.hue.address": "Adresse du pont sur votre réseau (par exemple 192.168.1.2)",
  "statusLights.hue.lookup": "Lire le certificat du pont",
  "statusLights.hue.confirmGroup": "Confirmer le certificat du pont",
  "statusLights.hue.found": "Un pont a répondu à l’adresse {address}:{port}.",
  "statusLights.hue.certName": "Sujet du certificat : {name}",
  "statusLights.hue.linkStep":
    "Appuyez maintenant sur le bouton rond situé sur le dessus du pont, puis confirmez ci-dessous. L’appairage est refusé si le bouton n’a pas été pressé dans les 30 dernières secondes environ.",
  "statusLights.hue.confirm":
    "J’ai comparé cette empreinte avec celle de mon pont et je fais confiance à ce pont.",
  "statusLights.hue.pair": "Appairer et épingler cette empreinte",
  "statusLights.hue.cancel": "Annuler",

  "statusLights.luxafor.title": "Luxafor",
  "statusLights.luxafor.intro":
    "Phoenix ne communique qu’avec le webhook local de l’application Luxafor, en HTTP simple sur votre propre réseau. L’application répond par un succès quel que soit le jeton ; un jeton enregistré ne prouve donc pas que la lumière a changé.",
  "statusLights.luxafor.name": "Nom de ce voyant Luxafor",
  "statusLights.luxafor.address": "Adresse de l’ordinateur qui exécute l’application Luxafor",
  "statusLights.luxafor.add": "Ajouter une lumière Luxafor",
  "statusLights.luxafor.token": "Jeton du webhook",
  "statusLights.luxafor.tokenNamed": "Jeton du webhook pour {name}",
  "statusLights.luxafor.save": "Définir ou remplacer le jeton",
  "statusLights.luxafor.saved": "Jeton enregistré.",
  "statusLights.luxafor.writeOnly":
    "Le jeton n’est plus jamais affiché. Pour l’effacer, retirez cette lumière.",

  "statusLights.lifx.title": "LIFX",
  "statusLights.lifx.intro":
    "La détection envoie une diffusion sur votre réseau et liste les lumières qui répondent. Rien n’est ajouté et aucune couleur n’est envoyée tant que vous n’activez pas une lumière.",
  "statusLights.lifx.discover": "Trouver des lumières LIFX",
  "statusLights.lifx.none": "Aucune lumière LIFX n’a répondu.",
  "statusLights.lifx.line": "Lumière LIFX {serial} à l’adresse {address}",
  "statusLights.lifx.added": "Ajoutée",
  "statusLights.lifx.enable": "Ajouter cette lumière",
  "statusLights.lifx.enableNamed": "Ajouter la lumière LIFX {serial}",

  "statusLights.quiet.title": "Heures calmes",
  "statusLights.quiet.intro":
    "Les lumières restent éteintes entre ces heures, dans le fuseau horaire que vous choisissez.",
  "statusLights.quiet.off": "Les heures calmes sont désactivées.",
  "statusLights.quiet.on": "Les lumières sont éteintes de {start} à {end} ({timezone}).",
  "statusLights.quiet.start": "De",
  "statusLights.quiet.end": "Jusqu’à",
  "statusLights.quiet.timezone": "Fuseau horaire",
  "statusLights.quiet.save": "Enregistrer les heures calmes",
  "statusLights.quiet.clear": "Désactiver les heures calmes",
};
