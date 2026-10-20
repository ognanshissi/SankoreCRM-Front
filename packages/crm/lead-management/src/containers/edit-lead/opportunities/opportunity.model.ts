import { AdvanceOpportunityStageRequestStageEnum, OpportunityDto } from '@sankore/crm-api';

/**
 * L'onglet lisait et écrivait les opportunités dans le `localStorage` du navigateur « en attendant
 * l'API » : l'API existait, et une opportunité créée sur un poste n'existait nulle part ailleurs —
 * ni pour le collègue, ni pour la fiche client, ni pour la clôture qui ouvre la souscription.
 * Tout passe désormais par `OpportunitiesApiService`.
 */

/**
 * En littéraux et non en énumération : le client généré en produit deux (`OpportunityDtoStageEnum`
 * en lecture, `AdvanceOpportunityStageRequestStageEnum` en écriture) que TypeScript refuse de
 * comparer entre elles.
 */
export type OpenStage = 'Prospecting' | 'Qualification' | 'NeedsAnalysis' | 'Proposal' | 'Negotiation';

export function toStageRequest(stage: OpenStage): AdvanceOpportunityStageRequestStageEnum {
  return stage as AdvanceOpportunityStageRequestStageEnum;
}

export interface StageMeta {
  value: OpenStage;
  label: string;
  /** Ce que l'étape veut dire, sous son nom dans la frise. */
  hint: string;
  /** En pourcentage. */
  probability: number;
  /** Ce qu'on propose comme prochaine action quand aucune n'est définie. */
  suggestion: string;
  /** En deçà, une clôture prévue est jugée trop proche pour l'étape. */
  minDaysToClose: number;
}

/**
 * Les étapes ouvertes, dans l'ordre du parcours. Les probabilités recopient
 * `Opportunity.StageProbability` côté serveur, qui les fixe à chaque changement d'étape : l'écran
 * les annonce avant le clic, il ne les décide pas.
 */
export const OPEN_STAGES: ReadonlyArray<StageMeta> = [
  {
    value: 'Prospecting',
    label: 'Prospection', hint: 'Besoin exprimé', probability: 10,
    suggestion: 'Planifier un rendez-vous', minDaysToClose: 30,
  },
  {
    value: 'Qualification',
    label: 'Qualification', hint: 'Besoin confirmé', probability: 20,
    suggestion: "Vérifier l'éligibilité", minDaysToClose: 21,
  },
  {
    value: 'NeedsAnalysis',
    label: 'Étude', hint: 'Dossier en analyse', probability: 40,
    suggestion: 'Réunir les pièces du dossier', minDaysToClose: 14,
  },
  {
    value: 'Proposal',
    label: 'Proposition', hint: 'Offre remise', probability: 60,
    suggestion: "Présenter l'offre", minDaysToClose: 7,
  },
  {
    value: 'Negotiation',
    label: 'Négociation', hint: 'Conditions discutées', probability: 80,
    suggestion: 'Fixer la date de signature', minDaysToClose: 0,
  },
];

export function stageMeta(stage: string | null | undefined): StageMeta | null {
  return OPEN_STAGES.find((s) => s.value === stage) ?? null;
}

export function isClosed(opp: OpportunityDto): boolean {
  return opp.stage === 'ClosedWon' || opp.stage === 'ClosedLost';
}

/** « Prospection », « Gagnée », « Perdue ». */
export function stageLabel(stage: string | null | undefined): string {
  if (stage === 'ClosedWon') return 'Gagnée';
  if (stage === 'ClosedLost') return 'Perdue';
  return stageMeta(stage)?.label ?? stage ?? '—';
}

/** La probabilité en pourcentage entier — le serveur la tient entre 0 et 1. */
export function probabilityPercent(opp: OpportunityDto): number {
  return Math.round((opp.probability ?? 0) * 100);
}

export function weightedAmount(opp: OpportunityDto): number {
  return (opp.estimatedAmount?.amount ?? 0) * (opp.probability ?? 0);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Jours pleins entre aujourd'hui et la date, négatif quand elle est passée. */
export function daysUntil(iso: string, today = new Date()): number {
  const target = startOfDay(new Date(iso));
  return Math.round((target.getTime() - startOfDay(today).getTime()) / 86_400_000);
}

/** « Aujourd'hui, 20 oct. 2026 », « Demain, 21 oct. 2026 », « 21 déc. 2026 ». */
export function closeDateLabel(iso: string, today = new Date()): string {
  const day = new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  const days = daysUntil(iso, today);
  if (days === 0) return `Aujourd'hui, ${day}`;
  if (days === 1) return `Demain, ${day}`;
  return day;
}

/**
 * Ce qui cloche dans la clôture prévue, ou null. Une date passée est toujours à revoir ; une date
 * trop proche ne l'est qu'au regard de l'étape — demain, c'est plausible en négociation, pas pour
 * un besoin qu'on vient d'entendre.
 */
export function closeDateWarning(opp: OpportunityDto, today = new Date()): string | null {
  if (!opp.expectedCloseDate || isClosed(opp)) return null;
  const days = daysUntil(opp.expectedCloseDate, today);
  if (days < 0) return 'Date dépassée : à repousser ou à clôturer.';
  const meta = stageMeta(opp.stage);
  if (meta && days < meta.minDaysToClose) {
    return `Trop tôt pour une opportunité en ${meta.label.toLowerCase()}.`;
  }
  return null;
}

/** Aujourd'hui plus N mois, à midi UTC pour qu'aucun fuseau ne change le jour envoyé. */
export function monthsFromNow(months: number, today = new Date()): string {
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth() + months, today.getDate(), 12));
  return d.toISOString();
}

/**
 * Deux demandes différentes ? Le lead annonce un montant et l'opportunité un autre, et personne n'a
 * encore dit si c'était le même besoin réévalué ou un second besoin.
 */
export function differsFromLead(
  opp: OpportunityDto,
  leadAmount: number | null | undefined,
): boolean {
  const amount = opp.estimatedAmount?.amount;
  return !isClosed(opp)
    && !opp.separateNeedConfirmedAt
    && amount != null && amount > 0
    && leadAmount != null && leadAmount > 0
    && amount !== leadAmount;
}
