import { telLabel } from '../../data-access/telephony-referential';
import { TelephonyRealtimeState } from '../../data-access/telephony-realtime.service';

/**
 * `TelUserLinkStatus` du contrat : quatre valeurs et non un booléen, parce que les
 * réparations diffèrent. **Un lien `Broken` autorise encore les appels** — le
 * fournisseur a cessé de lister le compte, c'est une ligne de réglage à reprendre et
 * non une raison d'arrêter un agent en pleine vacation. Seul `Disabled`, où quelqu'un a
 * saisi un motif, bloque.
 */
export const TEL_LINK_STATUS_LABELS: Readonly<Record<string, string>> = {
  NotLinked: 'Compte non lié',
  Active: 'Téléphonie active',
  Broken: 'Compte non lié',
  Disabled: 'Téléphonie désactivée',
};

export type TelephonyPillTone = 'success' | 'warning' | 'error' | 'neutral';

export interface TelephonyPill {
  readonly label: string;
  /** L'action attendue, affichée en infobulle. Jamais un diagnostic sans suite. */
  readonly hint: string;
  readonly tone: TelephonyPillTone;
  readonly icon: string;
}

export interface TelephonyPillInput {
  readonly telephonyEnabled: boolean;
  readonly linkStatus: string | null;
  readonly realtimeState: TelephonyRealtimeState;
  /** `connect()` a rendu la main au moins une fois. Voir `TelephonyStatusService`. */
  readonly realtimeAttempted: boolean;
  readonly canViewCalls: boolean;
}

/**
 * La pastille de la barre supérieure (TEL-F-11), ou `null` quand il n'y a rien à
 * afficher du tout.
 *
 * L'ordre des cas est le sujet de cette fonction, et il n'est pas arbitraire :
 *
 * 1. **Aucune téléphonie active dans l'établissement : on ne montre RIEN.** C'est le cas
 *    de la majorité des établissements, et une pastille grise permanente chez eux serait
 *    du bruit sur chaque écran. Le contrat le dit explicitement de `telephonyEnabled`.
 * 2. **Un problème de poste passe devant une perte de temps réel.** Les deux peuvent être
 *    vrais en même temps ; « votre poste n'est pas rattaché » est la cause, « les appels
 *    entrants ne s'affichent plus » en est une conséquence attendue. Afficher la
 *    conséquence enverrait l'agent recharger la page pour un problème qu'un rechargement
 *    ne corrige pas.
 * 3. **La perte de temps réel ne se dit qu'APRÈS une tentative de connexion.** L'état
 *    initial du client est `Disconnected`, qui au démarrage veut dire « pas encore
 *    essayé » : sans ce garde-fou, chaque chargement de page afficherait une seconde de
 *    « Connexion temps réel perdue ».
 * 4. **Un code de rattachement inconnu reste lisible.** Il passe par `telLabel`, donc il
 *    s'affiche « Point à vérifier » au lieu de vider la pastille ou de lever.
 */
export function telephonyIndicatorPill(
  input: TelephonyPillInput,
): TelephonyPill | null {
  if (!input.telephonyEnabled) return null;

  const link = input.linkStatus;

  if (link === 'Disabled') {
    return {
      label: TEL_LINK_STATUS_LABELS['Disabled'],
      hint: 'Un administrateur a désactivé votre poste téléphonique. Contactez un administrateur pour le réactiver.',
      tone: 'neutral',
      icon: 'feather:phone-off',
    };
  }

  if (link === 'NotLinked') {
    return {
      label: TEL_LINK_STATUS_LABELS['NotLinked'],
      hint: "Votre poste n'est pas rattaché au système de téléphonie : vous ne pouvez pas appeler. Demandez à un administrateur de le rattacher.",
      tone: 'warning',
      icon: 'feather:phone-missed',
    };
  }

  if (link === 'Broken') {
    return {
      label: TEL_LINK_STATUS_LABELS['Broken'],
      hint: "Le fournisseur ne liste plus votre compte. Vous pouvez encore appeler, mais signalez-le à un administrateur : le rattachement doit être repris.",
      tone: 'warning',
      icon: 'feather:phone-missed',
    };
  }

  const realtimeLost =
    input.realtimeAttempted &&
    input.canViewCalls &&
    (input.realtimeState === 'Disconnected' || input.realtimeState === 'Reconnecting');

  if (realtimeLost) {
    return {
      label: 'Connexion temps réel perdue',
      hint: "Les appels entrants ne s'afficheront pas tant que la connexion n'est pas rétablie. Rechargez la page.",
      tone: 'error',
      icon: 'feather:wifi-off',
    };
  }

  if (link === 'Active') {
    return {
      label: TEL_LINK_STATUS_LABELS['Active'],
      hint: 'Votre poste est rattaché et la connexion temps réel est établie.',
      tone: 'success',
      icon: 'feather:phone-call',
    };
  }

  // Code de rattachement que ce front ne connaît pas : lisible, et l'action reste juste.
  return {
    label: telLabel(TEL_LINK_STATUS_LABELS, link),
    hint: "L'état de votre poste téléphonique n'est pas reconnu par cette version. Contactez un administrateur.",
    tone: 'neutral',
    icon: 'feather:help-circle',
  };
}
