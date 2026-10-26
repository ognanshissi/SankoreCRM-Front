import { HttpErrorResponse } from '@angular/common/http';
import { ProductDto, ProjectTemplateDto } from '@sankore/crm-api';
import { productCategoryLabel, ProjectAmountKind } from '@sankore/crm/common';

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
  requiresQuestionnaires?: boolean;
  requiresAmount?: boolean;
  requiresCloseDate?: boolean;
  checklist?: string[];
}

/**
 * Des points de départ pour un nouveau gabarit, modifiables avant l'enregistrement. Ils ne sont
 * pas stockés : un gabarit n'existe qu'une fois enregistré.
 */
export interface TemplatePreset {
  key: string;
  label: string;
  tracksForecast: boolean;
  amountKind: ProjectAmountKind;
  criticalCloseDate?: boolean;
  steps: StepPreset[];
}

/** La nature du montant qu'une famille suggère à la création d'un gabarit. */
export const FAMILY_AMOUNT_KIND: Record<string, ProjectAmountKind> = {
  Loan: 'Loan',
  GroupCredit: 'Loan',
  Agriculture: 'Loan',
  Insurance: 'Premium',
  HealthInsurance: 'Premium',
  ForecastInsurance: 'Premium',
  Savings: 'Deposit',
  Tontine: 'Deposit',
};

export const PRESETS: TemplatePreset[] = [
  {
    key: 'credit',
    label: 'Crédit',
    tracksForecast: true,
    amountKind: 'Loan',
    steps: [
      { label: 'Étude du besoin', phase: 'Qualification', probability: 20, suggestion: "Vérifier l'éligibilité" },
      { label: 'Montage du dossier', phase: 'NeedsAnalysis', probability: 35, suggestion: 'Réunir les pièces du dossier', opensClientFile: true, requiresQuestionnaires: true, requiresAmount: true, checklist: ['Pièces du dossier réunies', 'Capacité de remboursement vérifiée'] },
      { label: 'Analyse de crédit', phase: 'NeedsAnalysis', probability: 50, suggestion: "Transmettre le dossier à l'analyste" },
      { label: 'Comité', phase: 'Proposal', probability: 65, suggestion: 'Présenter le dossier au comité', isApproval: true },
      { label: 'Accord et offre', phase: 'Negotiation', probability: 85, suggestion: 'Fixer la date de signature' },
    ],
  },
  {
    key: 'insurance',
    label: 'Assurance',
    tracksForecast: true,
    amountKind: 'Premium',
    steps: [
      { label: 'Recueil du besoin', phase: 'Qualification', probability: 20, suggestion: 'Recueillir le besoin de couverture' },
      { label: 'Devis', phase: 'Proposal', probability: 50, suggestion: 'Envoyer le devis' },
      { label: 'Souscription', phase: 'Negotiation', probability: 70, suggestion: "Compléter la proposition d'assurance", opensClientFile: true, requiresQuestionnaires: true },
      { label: 'Acceptation', phase: 'Negotiation', probability: 85, suggestion: "Obtenir l'acceptation de l'assureur", isApproval: true },
    ],
  },
  {
    key: 'account',
    label: 'Épargne ou compte',
    tracksForecast: true,
    amountKind: 'Deposit',
    steps: [
      { label: 'Prise de contact', phase: 'Prospecting', probability: 10, suggestion: 'Planifier un rendez-vous' },
      { label: "Présentation de l'offre", phase: 'Proposal', probability: 50, suggestion: "Présenter l'offre", opensClientFile: true, requiresQuestionnaires: true },
      { label: 'Ouverture', phase: 'Negotiation', probability: 80, suggestion: "Fixer le rendez-vous d'ouverture", isApproval: true },
    ],
  },
  {
    // Un crédit accordé après le début des pluies ne sert plus : la date est une échéance.
    key: 'campaign',
    label: 'Crédit de campagne',
    tracksForecast: true,
    amountKind: 'Loan',
    criticalCloseDate: true,
    steps: [
      { label: 'Recensement des besoins', phase: 'Qualification', probability: 20, suggestion: 'Recenser la surface et les intrants' },
      { label: 'Montage du dossier', phase: 'NeedsAnalysis', probability: 40, suggestion: 'Réunir les pièces avant la date limite', opensClientFile: true, requiresQuestionnaires: true, requiresAmount: true, requiresCloseDate: true, checklist: ['Surface et intrants recensés', 'Pièces du dossier réunies'] },
      { label: 'Comité', phase: 'Proposal', probability: 70, suggestion: 'Présenter le dossier au comité', isApproval: true },
      { label: 'Mise en place', phase: 'Negotiation', probability: 90, suggestion: 'Décaisser avant le début de la saison' },
    ],
  },
  {
    // Une vente conclue au rendez-vous : une date de clôture et un pourcentage n'y diraient rien.
    key: 'standard',
    label: 'Produit standard',
    tracksForecast: false,
    amountKind: 'Generic',
    steps: [
      { label: 'Présentation', phase: 'Proposal', probability: 50, suggestion: 'Présenter le produit', opensClientFile: true },
      { label: 'Vente', phase: 'Negotiation', probability: 90, suggestion: 'Conclure la vente', isApproval: true },
    ],
  },
];

/**
 * Les portées encore libres pour un NOUVEAU gabarit : les familles du catalogue du tenant (un
 * gabarit pour une famille sans aucun produit ne s'appliquerait à rien) et ses produits actifs,
 * moins ceux qui ont déjà leur gabarit.
 */
export function templateScopeOptions(
  templates: ProjectTemplateDto[],
  catalogue: ProductDto[],
): { categories: { value: string; label: string }[]; products: { value: string; label: string }[] } {
  const takenCategories = new Set(templates.filter((t) => t.scope === 'Category').map((t) => String(t.category)));
  const takenProducts = new Set(templates.filter((t) => t.scope === 'Product').map((t) => (t.productCode ?? '').toUpperCase()));
  const active = catalogue.filter((p) => p.isActive !== false);

  const categories = [...new Set(active.map((p) => p.category).filter((c): c is NonNullable<typeof c> => !!c))]
    .filter((c) => !takenCategories.has(String(c)))
    .map((c) => ({ value: String(c), label: productCategoryLabel(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  const products = active
    .filter((p) => p.code && !takenProducts.has(p.code.toUpperCase()))
    .map((p) => ({ value: p.code!, label: `${p.name} (${productCategoryLabel(p.category)})` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  return { categories, products };
}

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
  PROJECT_TEMPLATE_TOO_MANY_QUESTIONNAIRE_STEPS: 'Une seule étape peut exiger les questionnaires complets.',
  PROJECT_TEMPLATE_CRITICAL_DATE_WITHOUT_FORECAST: 'Une date de clôture critique demande de suivre la prévision.',
  PROJECT_TEMPLATE_AMOUNT_KIND_INVALID: 'Choisissez ce que représente le montant.',
  PROJECT_TEMPLATE_APPROVAL_BEFORE_CLIENT_FILE: 'L’approbation ne peut pas précéder l’ouverture du dossier client.',
  PROJECT_STEP_QUESTIONNAIRE_FORM_MISSING:
    'Aucun formulaire de qualification publié ne s’applique à ce produit ou à sa famille : publiez-en un (Paramétrage › Formulaires de qualification) ou retirez « Questionnaires du produit remplis ».',
  PROJECT_STEP_FIELD_UNKNOWN: 'Une étape exige un champ que le gabarit ne déclare plus.',
  PROJECT_TEMPLATE_TOO_MANY_FIELDS: '30 champs au plus par gabarit.',
  PROJECT_FIELD_LABEL_REQUIRED: 'Chaque champ doit avoir un libellé.',
  PROJECT_FIELD_LABEL_TOO_LONG: 'Un libellé de champ ne peut pas dépasser 100 caractères.',
  PROJECT_FIELD_LABEL_DUPLICATE: 'Deux champs portent le même libellé.',
  PROJECT_FIELD_KEY_DUPLICATE: 'Deux champs ont la même clé : renommez l’un d’eux.',
  PROJECT_FIELD_TYPE_INVALID: 'Choisissez le type de chaque champ.',
  PROJECT_FIELD_TYPE_CHANGED: 'Le type d’un champ déjà enregistré ne change pas : créez un autre champ.',
  PROJECT_FIELD_HELP_TOO_LONG: 'Une aide ne peut pas dépasser 300 caractères.',
  PROJECT_FIELD_OPTIONS_REQUIRED: 'Une liste de choix doit proposer au moins une option.',
  PROJECT_FIELD_OPTIONS_TOO_MANY: '50 options au plus par liste.',
  PROJECT_FIELD_OPTIONS_DUPLICATE: 'Deux options d’une liste sont identiques.',
};

/**
 * Les types d'un champ de gabarit : les 14 des champs personnalisés, plus la pièce jointe
 * (propriétaire, 2026-10-26). Même orthographe que le serveur (`ProjectFieldType`).
 */
export const PROJECT_FIELD_TYPES: { value: string; label: string }[] = [
  { value: 'Text', label: 'Texte court' },
  { value: 'LongText', label: 'Texte long' },
  { value: 'Integer', label: 'Nombre entier' },
  { value: 'Decimal', label: 'Nombre décimal' },
  { value: 'Money', label: 'Montant' },
  { value: 'Percent', label: 'Pourcentage' },
  { value: 'Date', label: 'Date' },
  { value: 'DateTime', label: 'Date et heure' },
  { value: 'Boolean', label: 'Oui / non' },
  { value: 'SingleChoice', label: 'Liste (un choix)' },
  { value: 'MultiChoice', label: 'Liste (plusieurs choix)' },
  { value: 'Email', label: 'E-mail' },
  { value: 'Phone', label: 'Téléphone' },
  { value: 'Url', label: 'Lien web' },
  { value: 'Attachment', label: 'Pièce jointe' },
];

export function isChoiceType(type: string): boolean {
  return type === 'SingleChoice' || type === 'MultiChoice';
}

/**
 * La clé d'un nouveau champ, tirée de son libellé comme le fait le serveur (« Nombre de personnes »
 * → nombreDePersonnes). Calculée ici pour qu'une étape enregistrée en même temps puisse exiger le
 * champ ; le serveur garde une clé valide telle qu'envoyée.
 */
export function fieldKeyOf(label: string, taken: Set<string>): string {
  const words = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean);
  let base = words.length
    ? words[0] + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
    : 'champ';
  if (/^[0-9]/.test(base)) base = 'f' + base;
  base = base.slice(0, 46);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base}${i}`;
  return key;
}

export function projectTemplateError(error: HttpErrorResponse, fallback: string): string {
  if (error.status === 403) return "Vous n'avez pas le droit de modifier les étapes des projets.";
  const code = (error.error as { detail?: string; error?: string } | null)?.detail
    ?? (error.error as { error?: string } | null)?.error;
  return (code && ERRORS[code]) || fallback;
}
