// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Phoenix contributors
import type { teamInvite as enTeamInvite } from "../../en/team-invite";

/** Machine-translated; unreviewed. */
export const teamInvite: Record<keyof typeof enTeamInvite, string> = {
  "teamInvite.share.title": "Partager mon identité",
  "teamInvite.share.intro":
    "Envoyez cette invitation à un coéquipier par messagerie ou e-mail. Elle contient uniquement votre identifiant d'équipe, votre clé publique et le nom saisi ci-dessous. Aucun secret n'y figure et votre clé privée ne quitte jamais cet ordinateur.",
  "teamInvite.share.label": "Nom à mettre dans l'invitation (facultatif)",
  "teamInvite.share.invalid": "Impossible de créer une invitation à partir de cette identité.",
  "teamInvite.share.invite": "Votre invitation",
  "teamInvite.share.copy": "Copier l'invitation",
  "teamInvite.share.copied": "Invitation copiée dans le presse-papiers.",
  "teamInvite.share.copyFailed":
    "Phoenix n'a pas pu utiliser le presse-papiers. Sélectionnez l'invitation ci-dessus et copiez-la à la main.",
  "teamInvite.share.fingerprintHint":
    "Lisez l'empreinte à votre coéquipier de vive voix ou dans une autre discussion, afin qu'il vérifie que l'invitation reçue est bien la vôtre.",
  "teamInvite.fingerprint": "Empreinte de la clé",
  "teamInvite.checksumNote":
    "Le court code à la fin d'une invitation détecte seulement les erreurs de copie. Il ne prouve pas qui a créé l'invitation ; seule la comparaison de l'empreinte le fait.",
  "teamInvite.refusal.empty": "Collez d'abord une invitation.",
  "teamInvite.refusal.tooLong": "C'est trop long pour une invitation d'équipe.",
  "teamInvite.refusal.format": "Ce n'est pas une invitation d'équipe Phoenix.",
  "teamInvite.refusal.version":
    "Cette invitation vient d'une autre version de Phoenix que celle-ci ne peut pas lire.",
  "teamInvite.refusal.checksum":
    "L'invitation a été modifiée ou mal copiée. Demandez à votre coéquipier de la renvoyer.",
  "teamInvite.refusal.content": "L'invitation est endommagée ou a un contenu inattendu.",
  "teamInvite.refusal.id": "L'invitation contient un identifiant d'équipe non valide.",
  "teamInvite.refusal.key": "L'invitation contient une clé publique non valide.",
  "teamInvite.refusal.label": "L'invitation contient un nom non valide.",
  "teamInvite.refusal.unsupported": "Ce navigateur ne peut pas vérifier les invitations.",
  "teamInvite.refusal.own": "Cette invitation est votre propre identité.",
  "teamInvite.refusal.duplicate":
    "Ce coéquipier figure déjà dans votre liste. Retirez-le d'abord pour changer sa clé.",
  "teamInvite.add.title": "Ajouter un coéquipier",
  "teamInvite.add.paste": "Collez l'invitation d'un coéquipier",
  "teamInvite.add.preview": "Vérifiez ces informations avant d'ajouter ce coéquipier.",
  "teamInvite.add.noLabel": "L'invitation n'a pas de nom ; saisissez-en un à afficher.",
  "teamInvite.add.theirLabel": "Le nom indiqué dans l'invitation est : {label}",
  "teamInvite.add.confirm":
    "J'ai comparé cette empreinte avec mon coéquipier de vive voix ou dans une autre discussion, et elle correspond.",
};
