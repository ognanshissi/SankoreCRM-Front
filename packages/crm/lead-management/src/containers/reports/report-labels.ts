/**
 * Libellés et couleurs du rapport des leads.
 *
 * Les couleurs de séries suivent la palette catégorielle de référence, dans l'ordre fixe
 * (bleu puis orange), validée pour la vision des couleurs : `#2a78d6` / `#eb6834`, écart ΔE 24,7
 * dans le pire cas de daltonisme. Une couleur suit la série, jamais son rang : « Captés » est
 * toujours bleu, « Convertis » toujours orange, sur tous les graphes de l'écran.
 */
export const SERIES_COLORS = {
  captured: '#2a78d6',
  converted: '#eb6834',
} as const;

export const STAGE_LABELS: Record<string, string> = {
  New: 'Nouveau',
  ContactAttempted: 'Contact tenté',
  ContactEstablished: 'Contact établi',
  NeedIdentified: 'Besoin identifié',
  Qualified: 'Qualifié',
  ProductProposed: 'Produit proposé',
  ApplicationStarted: 'Dossier démarré',
  DocumentCollection: 'Collecte des pièces',
  ApplicationCompleted: 'Dossier complet',
  ApprovalPending: 'En approbation',
  Converted: 'Converti',
  Lost: 'Perdu',
};

/** Les phases d'un projet, communes à tous les gabarits d'étapes. */
export const PROJECT_PHASE_LABELS: Record<string, string> = {
  Prospecting: 'Prospection',
  Qualification: 'Qualification',
  NeedsAnalysis: 'Étude',
  Proposal: 'Proposition',
  Negotiation: 'Négociation',
  ClosedWon: 'Gagné',
  ClosedLost: 'Perdu',
};

export const STATUS_LABELS: Record<string, string> = {
  New: 'Nouveau',
  Open: 'Ouvert',
  Qualifying: 'En qualification',
  Qualified: 'Qualifié',
  Nurturing: 'En maturation',
  Recycled: 'Recyclé',
  Converted: 'Converti',
  Lost: 'Perdu',
  Disqualified: 'Disqualifié',
  Archived: 'Archivé',
};

export const SOURCE_LABELS: Record<string, string> = {
  Web: 'Web',
  MobileAgent: 'Agent mobile',
  Agency: 'Agence',
  CallCenter: "Centre d'appels",
  Sms: 'SMS',
  Ussd: 'USSD',
  WhatsApp: 'WhatsApp',
  Referral: 'Recommandation',
  Partner: 'Partenaire',
  FileImport: 'Import',
  Campaign: 'Campagne',
};

export const label = (map: Record<string, string>, key: string | null | undefined) =>
  (key && map[key]) || key || '—';

const nf = new Intl.NumberFormat('fr-FR');
export const formatNumber = (n: number | null | undefined) => (n == null ? '—' : nf.format(n));
export const formatPercent = (n: number | null | undefined) =>
  n == null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n)} %`;

/** « 1 h 35 », « 2 j 4 h » : un délai de premier contact se lit mieux qu'un nombre de minutes. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}
