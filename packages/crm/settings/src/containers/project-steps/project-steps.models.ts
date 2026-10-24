import { HttpErrorResponse } from '@angular/common/http';

/** Les cinq phases : ce que l'entonnoir, les rapports et la clôture lisent d'une étape. */
export const PHASE_OPTIONS: { value: string; label: string }[] = [
  { value: 'Prospecting', label: 'Prospection' },
  { value: 'Qualification', label: 'Qualification' },
  { value: 'NeedsAnalysis', label: 'Étude' },
  { value: 'Proposal', label: 'Proposition' },
  { value: 'Negotiation', label: 'Négociation' },
];

export function phaseLabel(phase: string | null | undefined): string {
  return PHASE_OPTIONS.find((p) => p.value === phase)?.label ?? '—';
}

export function phaseIndex(phase: string | null | undefined): number {
  return PHASE_OPTIONS.findIndex((p) => p.value === phase);
}

export interface StepPreset {
  label: string;
  phase: string;
  probability: number;
  suggestion?: string;
  opensClientFile?: boolean;
  isApproval?: boolean;
}

/**
 * Des points de départ pour un nouveau gabarit, modifiables avant l'enregistrement. Ils ne sont
 * pas stockés : un gabarit n'existe qu'une fois enregistré.
 */
export const PRESETS: { key: string; label: string; steps: StepPreset[] }[] = [
  {
    key: 'credit',
    label: 'Crédit',
    steps: [
      { label: 'Étude du besoin', phase: 'Qualification', probability: 20, suggestion: "Vérifier l'éligibilité" },
      { label: 'Montage du dossier', phase: 'NeedsAnalysis', probability: 35, suggestion: 'Réunir les pièces du dossier', opensClientFile: true },
      { label: 'Analyse de crédit', phase: 'NeedsAnalysis', probability: 50, suggestion: "Transmettre le dossier à l'analyste" },
      { label: 'Comité', phase: 'Proposal', probability: 65, suggestion: 'Présenter le dossier au comité', isApproval: true },
      { label: 'Accord et offre', phase: 'Negotiation', probability: 85, suggestion: 'Fixer la date de signature' },
    ],
  },
  {
    key: 'insurance',
    label: 'Assurance',
    steps: [
      { label: 'Recueil du besoin', phase: 'Qualification', probability: 20, suggestion: 'Recueillir le besoin de couverture' },
      { label: 'Devis', phase: 'Proposal', probability: 50, suggestion: 'Envoyer le devis' },
      { label: 'Souscription', phase: 'Negotiation', probability: 70, suggestion: "Compléter la proposition d'assurance", opensClientFile: true },
      { label: 'Acceptation', phase: 'Negotiation', probability: 85, suggestion: "Obtenir l'acceptation de l'assureur", isApproval: true },
    ],
  },
  {
    key: 'account',
    label: 'Épargne ou compte',
    steps: [
      { label: 'Prise de contact', phase: 'Prospecting', probability: 10, suggestion: 'Planifier un rendez-vous' },
      { label: "Présentation de l'offre", phase: 'Proposal', probability: 50, suggestion: "Présenter l'offre", opensClientFile: true },
      { label: 'Ouverture', phase: 'Negotiation', probability: 80, suggestion: "Fixer le rendez-vous d'ouverture", isApproval: true },
    ],
  },
];

const ERRORS: Record<string, string> = {
  PROJECT_TEMPLATE_SCOPE_TAKEN: 'Un gabarit existe déjà pour cette famille ou ce produit.',
  PROJECT_TEMPLATE_UNKNOWN_PRODUCT: "Ce produit n'existe pas dans le catalogue.",
  PROJECT_TEMPLATE_SCOPE_INVALID: 'Un gabarit vaut pour une famille ou pour un produit, pas les deux.',
  PROJECT_TEMPLATE_NAME_REQUIRED: 'Le nom est obligatoire.',
  PROJECT_TEMPLATE_NAME_TOO_LONG: 'Le nom ne peut pas dépasser 100 caractères.',
  PROJECT_TEMPLATE_NO_STEP: 'Ajoutez au moins une étape.',
  PROJECT_TEMPLATE_TOO_MANY_STEPS: '12 étapes au plus.',
  PROJECT_STEP_LABEL_REQUIRED: 'Chaque étape doit avoir un nom.',
  PROJECT_STEP_LABEL_TOO_LONG: "Le nom d'une étape ne peut pas dépasser 60 caractères.",
  PROJECT_STEP_LABEL_DUPLICATE: 'Deux étapes portent le même nom.',
  PROJECT_STEP_PROBABILITY_OUT_OF_RANGE: 'La probabilité d’une étape va de 1 à 99 %.',
  PROJECT_STEP_SUGGESTION_TOO_LONG: 'Une action proposée ne peut pas dépasser 200 caractères.',
  PROJECT_STEP_PHASES_OUT_OF_ORDER: 'Les phases ne peuvent pas revenir en arrière d’une étape à la suivante.',
  PROJECT_TEMPLATE_NOT_FOUND: "Ce gabarit n'existe plus. Rechargez la page.",
  PROJECT_TEMPLATE_TOO_MANY_CLIENT_FILE_STEPS: 'Une seule étape peut ouvrir le dossier client.',
  PROJECT_TEMPLATE_TOO_MANY_APPROVAL_STEPS: 'Une seule étape peut être l’étape d’approbation.',
  PROJECT_TEMPLATE_APPROVAL_BEFORE_CLIENT_FILE: 'L’approbation ne peut pas précéder l’ouverture du dossier client.',
};

export function projectTemplateError(error: HttpErrorResponse, fallback: string): string {
  if (error.status === 403) return "Vous n'avez pas le droit de modifier les étapes des projets.";
  const code = (error.error as { detail?: string; error?: string } | null)?.detail
    ?? (error.error as { error?: string } | null)?.error;
  return (code && ERRORS[code]) || fallback;
}
