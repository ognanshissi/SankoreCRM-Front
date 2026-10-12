import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés et métadonnées du module Intégration.
 *
 * Le contrat renvoie beaucoup de valeurs en `string` nue (statut de commande, type
 * d'écart, famille d'erreur) : sans table de correspondance, chaque écran réinvente
 * ses propres libellés et ses propres couleurs, et deux écrans finissent par appeler
 * le même état autrement. Tout ce qui est affiché à l'utilisateur part donc d'ici.
 */

// ——— Connexions ———

export type ConnectionFamily = 'CoreBanking' | 'Insurance';
export type ConnectionKind =
  | 'Temenos'
  | 'Amplitude'
  | 'Sab'
  | 'PerfectVision'
  | 'Orass'
  | 'Fake';
export type ConnectionMode = 'Api' | 'Batch' | 'Relay';

export const CONNECTION_FAMILIES: ReadonlyArray<{
  value: ConnectionFamily;
  label: string;
  description: string;
}> = [
  {
    value: 'CoreBanking',
    label: 'Core banking',
    description: 'Le système qui tient les comptes et les prêts de vos clients.',
  },
  {
    value: 'Insurance',
    label: 'Assurance',
    description: "Le back-office d'un assureur partenaire dont vous distribuez les produits.",
  },
];

export const CONNECTION_FAMILY_LABELS: Record<ConnectionFamily, string> = {
  CoreBanking: 'Core banking',
  Insurance: 'Assurance',
};

/**
 * Les systèmes sont déclarés par famille : le contrat refuse une connexion assurance
 * sur un cœur bancaire, et laisser le choix ouvert ne fait que déplacer le refus à
 * l'enregistrement.
 */
export const CONNECTION_KINDS_BY_FAMILY: Record<
  ConnectionFamily,
  ReadonlyArray<{ value: ConnectionKind; label: string }>
> = {
  CoreBanking: [
    { value: 'Temenos', label: 'Temenos' },
    { value: 'Amplitude', label: 'Amplitude' },
    { value: 'Sab', label: 'SAB' },
    { value: 'PerfectVision', label: 'Perfect Vision' },
    { value: 'Fake', label: 'Simulateur (recette)' },
  ],
  Insurance: [
    { value: 'Orass', label: 'ORASS®Suite' },
    { value: 'Fake', label: 'Simulateur (recette)' },
  ],
};

export const CONNECTION_KIND_LABELS: Record<ConnectionKind, string> = {
  Temenos: 'Temenos',
  Amplitude: 'Amplitude',
  Sab: 'SAB',
  PerfectVision: 'Perfect Vision',
  Orass: 'ORASS®Suite',
  Fake: 'Simulateur (recette)',
};

export const CONNECTION_MODES: ReadonlyArray<{
  value: ConnectionMode;
  label: string;
  description: string;
}> = [
  {
    value: 'Api',
    label: 'API',
    description: 'SANKORE appelle directement le système, joignable depuis Internet.',
  },
  {
    value: 'Batch',
    label: 'Fichiers',
    description: 'Les écritures partent par fichiers, à intervalle régulier.',
  },
  {
    value: 'Relay',
    label: 'Agent relais',
    description: "Un agent installé chez vous relaie les appels vers un système interne.",
  },
];

export const CONNECTION_MODE_LABELS: Record<ConnectionMode, string> = {
  Api: 'API',
  Batch: 'Fichiers',
  Relay: 'Agent relais',
};

/**
 * Les trois emplacements de secret que `GET connections/{id}/secrets` renvoie, dans
 * l'ordre où on les saisit. Les valeurs ne sont récupérables par aucun endpoint :
 * l'écran n'affiche que l'indice masqué du coffre.
 */
export const CONNECTION_SECRET_SLOTS: ReadonlyArray<{
  name: string;
  label: string;
  hint: string;
  modes: ReadonlyArray<ConnectionMode>;
}> = [
  {
    name: 'connection-credential',
    label: "Identifiant d'appel",
    hint: "Le secret que le système externe attend pour accepter nos appels.",
    modes: ['Api', 'Relay'],
  },
  {
    name: 'sftp-credential',
    label: 'Accès SFTP',
    hint: 'Le secret du dépôt de fichiers par lequel passent les échanges batch.',
    modes: ['Batch'],
  },
  {
    name: 'webhook-secret',
    label: 'Secret de webhook',
    hint: 'Sert à vérifier que les notifications reçues viennent bien du système externe.',
    modes: ['Api', 'Batch', 'Relay'],
  },
];

/**
 * Réglages techniques de la connexion. `ConnectionSettings` est polymorphe côté
 * serveur (« it carries a "$kind" … and is validated against that kind's own rules »),
 * mais le swagger n'expose aujourd'hui que le socle commun : on génère donc le
 * formulaire depuis cette liste, filtrée par mode, plutôt que d'inventer des champs
 * par système que le serveur refuserait.
 */
export const CONNECTION_SETTING_FIELDS: ReadonlyArray<{
  key:
    | 'rateLimitPerMinute'
    | 'timeoutSeconds'
    | 'circuitBreakerFailureThreshold'
    | 'circuitBreakerBreakSeconds';
  label: string;
  hint: string;
  min: number;
  max: number;
}> = [
  {
    key: 'rateLimitPerMinute',
    label: 'Appels par minute',
    hint: "Au-delà, SANKORE met les écritures en attente plutôt que de saturer le système.",
    min: 1,
    max: 10_000,
  },
  {
    key: 'timeoutSeconds',
    label: 'Délai d’attente (secondes)',
    hint: 'Durée au bout de laquelle un appel sans réponse est considéré comme perdu.',
    min: 1,
    max: 300,
  },
  {
    key: 'circuitBreakerFailureThreshold',
    label: 'Échecs avant coupure',
    hint: "Nombre d'échecs consécutifs qui suspendent les appels, pour laisser le système se rétablir.",
    min: 1,
    max: 100,
  },
  {
    key: 'circuitBreakerBreakSeconds',
    label: 'Durée de coupure (secondes)',
    hint: 'Temps pendant lequel SANKORE arrête d’appeler après une coupure.',
    min: 1,
    max: 3_600,
  },
];

/** Les six flux dont `syncIntervalMinutes` accepte une période, d'après le schéma. */
export const CONNECTION_SYNC_FLOWS: ReadonlyArray<{
  key: 'Customers' | 'Accounts' | 'Transactions' | 'Loans' | 'Policies' | 'Claims';
  label: string;
  families: ReadonlyArray<ConnectionFamily>;
}> = [
  { key: 'Customers', label: 'Clients', families: ['CoreBanking'] },
  { key: 'Accounts', label: 'Comptes', families: ['CoreBanking'] },
  { key: 'Transactions', label: 'Opérations', families: ['CoreBanking'] },
  { key: 'Loans', label: 'Prêts', families: ['CoreBanking'] },
  { key: 'Policies', label: 'Contrats', families: ['Insurance'] },
  { key: 'Claims', label: 'Sinistres', families: ['Insurance'] },
];

// ——— Mappings ———

export type MappingDomain =
  | 'IdDocType'
  | 'Product'
  | 'Agency'
  | 'Country'
  | 'Gender'
  | 'MaritalStatus'
  | 'Profession'
  | 'Sector';

/**
 * Les huit domaines déclarés par les endpoints de mapping, dans l'ordre d'affichage
 * des onglets. `isRequired` marque ceux qui bloquent l'activation d'une connexion
 * tant qu'un code reste sans correspondance.
 */
export const MAPPING_DOMAINS: ReadonlyArray<{
  value: MappingDomain;
  label: string;
  crmLabel: string;
  isRequired: boolean;
}> = [
  { value: 'Product', label: 'Produits', crmLabel: 'Produit CRM', isRequired: true },
  { value: 'Agency', label: 'Agences', crmLabel: 'Agence CRM', isRequired: true },
  {
    value: 'IdDocType',
    label: "Pièces d'identité",
    crmLabel: 'Type de pièce CRM',
    isRequired: true,
  },
  { value: 'Country', label: 'Pays', crmLabel: 'Pays CRM', isRequired: false },
  { value: 'Gender', label: 'Civilité', crmLabel: 'Civilité CRM', isRequired: false },
  {
    value: 'MaritalStatus',
    label: 'Situation familiale',
    crmLabel: 'Situation CRM',
    isRequired: false,
  },
  { value: 'Profession', label: 'Professions', crmLabel: 'Profession CRM', isRequired: false },
  { value: 'Sector', label: "Secteurs d'activité", crmLabel: 'Secteur CRM', isRequired: false },
];

export const MAPPING_DOMAIN_LABELS: Record<MappingDomain, string> = MAPPING_DOMAINS.reduce(
  (acc, d) => ({ ...acc, [d.value]: d.label }),
  {} as Record<MappingDomain, string>,
);

/**
 * `availability` de `GET mappings/{domain}/unmapped`. À lire AVANT de conclure d'une
 * liste vide que rien ne manque : « Unavailable » veut dire que le CRM n'expose pas
 * cette liste, donc zéro par construction et non par mesure.
 */
export function unmappedAvailabilityMeta(availability: string | null | undefined): {
  isMeasured: boolean;
  label: string;
  severity: Severity;
} {
  switch (availability) {
    case 'Complete':
      return { isMeasured: true, label: 'Liste complète', severity: 'success' };
    case 'Partial':
      return { isMeasured: true, label: 'Liste partielle', severity: 'warning' };
    case 'Unavailable':
      return { isMeasured: false, label: 'Non mesurable', severity: 'neutral' };
    default:
      return { isMeasured: false, label: 'Indéterminé', severity: 'neutral' };
  }
}

// ——— Commandes ———

/**
 * Le swagger ne déclare pas d'énumération pour `status` : ces valeurs viennent des
 * descriptions de `replay` (« Only a Rejected command can be replayed ») et de
 * `cancel` (« Possible only from Pending and Rejected … already in flight or already
 * confirmed »). Un statut inconnu est affiché tel quel plutôt que masqué, pour qu'une
 * valeur ajoutée côté serveur se voie au lieu de disparaître.
 */
export const COMMAND_STATUSES = [
  'Pending',
  'Sent',
  'Succeeded',
  'Rejected',
  'Cancelled',
] as const;

export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export function commandStatusMeta(status: string | null | undefined): {
  label: string;
  severity: Severity;
} {
  switch (status) {
    case 'Pending':
      return { label: 'En attente', severity: 'neutral' };
    case 'Sent':
      return { label: 'Envoyée', severity: 'info' };
    case 'Succeeded':
      return { label: 'Acceptée', severity: 'success' };
    case 'Rejected':
      return { label: 'Rejetée', severity: 'error' };
    case 'Cancelled':
      return { label: 'Annulée', severity: 'neutral' };
    default:
      return { label: status || '—', severity: 'neutral' };
  }
}

/** Seul un rejet se rejoue ; seules une attente et un rejet s'annulent. */
export function canReplayCommand(status: string | null | undefined): boolean {
  return status === 'Rejected';
}

export function canCancelCommand(status: string | null | undefined): boolean {
  return status === 'Pending' || status === 'Rejected';
}

/**
 * Message métier d'un rejet, à destination d'un agent. Les détails techniques
 * (`errorCode`, `errorDetail`) restent sur l'écran Commandes : ici on dit ce qui
 * bloque et qui peut le débloquer.
 */
export function errorFamilyMessage(errorFamily: string | null | undefined): string {
  switch (errorFamily) {
    case 'Mapping':
      return "Un code n'a pas de correspondance dans le système externe. Contactez votre administrateur.";
    case 'Validation':
      return 'Le système externe a refusé une donnée du dossier. Contactez votre administrateur.';
    case 'Auth':
      return "La connexion au système externe n'est plus autorisée. Contactez votre administrateur.";
    case 'Network':
    case 'Timeout':
      return 'Le système externe est injoignable. La demande sera relancée automatiquement.';
    case 'Duplicate':
      return 'Le système externe signale un client déjà existant. Contactez votre administrateur.';
    case 'Configuration':
      return "La connexion au système externe est incomplète. Contactez votre administrateur.";
    default:
      return 'Le système externe a refusé la demande. Contactez votre administrateur.';
  }
}

export function errorFamilyLabel(errorFamily: string | null | undefined): string {
  switch (errorFamily) {
    case 'Mapping':
      return 'Correspondance manquante';
    case 'Validation':
      return 'Donnée refusée';
    case 'Auth':
      return 'Autorisation';
    case 'Network':
      return 'Réseau';
    case 'Timeout':
      return 'Délai dépassé';
    case 'Duplicate':
      return 'Doublon';
    case 'Configuration':
      return 'Configuration';
    default:
      return errorFamily || '—';
  }
}

export function commandTypeLabel(commandType: string | null | undefined): string {
  switch (commandType) {
    case 'CreateCustomer':
      return 'Création client';
    case 'UpdateCustomer':
      return 'Mise à jour client';
    case 'OpenAccount':
      return 'Ouverture de compte';
    case 'CreatePolicy':
      return 'Souscription de contrat';
    case 'CollectPremium':
      return 'Prélèvement de prime';
    case 'CancelPolicy':
      return 'Résiliation de contrat';
    case 'DeclareClaim':
      return 'Déclaration de sinistre';
    default:
      return commandType || '—';
  }
}

export function entityTypeLabel(entityType: string | null | undefined): string {
  switch (entityType) {
    case 'Customer':
      return 'Client';
    case 'Account':
      return 'Compte';
    case 'Loan':
      return 'Prêt';
    case 'Policy':
      return 'Contrat';
    case 'Claim':
      return 'Sinistre';
    default:
      return entityType || '—';
  }
}

// ——— Agent relais ———

export function relayAgentStatusMeta(status: string | null | undefined): {
  label: string;
  severity: Severity;
} {
  switch (status) {
    case 'Active':
      return { label: 'Enrôlé', severity: 'success' };
    case 'Pending':
      return { label: 'Enrôlement en attente', severity: 'warning' };
    case 'Revoked':
      return { label: 'Révoqué', severity: 'error' };
    default:
      return { label: status || '—', severity: 'neutral' };
  }
}

/**
 * Un agent est considéré hors ligne passé ce délai sans battement de cœur. Le contrat
 * ne publie pas de seuil : trois minutes laissent passer un battement manqué sans
 * laisser croire qu'un agent arrêté depuis une heure est en ligne.
 */
export const RELAY_HEARTBEAT_STALE_AFTER_MS = 3 * 60 * 1000;

export function isRelayAgentOnline(
  lastHeartbeatAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!lastHeartbeatAt) return false;
  const beat = Date.parse(lastHeartbeatAt);
  return Number.isFinite(beat) && now - beat < RELAY_HEARTBEAT_STALE_AFTER_MS;
}

// ——— Réconciliation ———

export function gapTypeLabel(gapType: string | null | undefined): string {
  switch (gapType) {
    case 'MissingInExternal':
      return 'Absent du système externe';
    case 'MissingInCrm':
      return 'Absent du CRM';
    case 'StatusMismatch':
      return 'Statut divergent';
    case 'KycTierMismatch':
      return 'Niveau KYC divergent';
    case 'BalanceMismatch':
      return 'Solde divergent';
    case 'OrphanReference':
      return 'Référence orpheline';
    default:
      return gapType || '—';
  }
}

export function gapResolutionMeta(resolution: string | null | undefined): {
  label: string;
  severity: Severity;
} {
  switch (resolution) {
    case 'Open':
      return { label: 'Ouvert', severity: 'error' };
    case 'Resolved':
      return { label: 'Résolu', severity: 'success' };
    case 'Ignored':
      return { label: 'Ignoré', severity: 'neutral' };
    default:
      return { label: resolution || '—', severity: 'neutral' };
  }
}

export const GAP_RESOLUTIONS = ['Open', 'Resolved', 'Ignored'] as const;

// ——— Assurance ———

export type InsurancePeriodicity = 'Single' | 'Monthly' | 'Quarterly' | 'SemiAnnual' | 'Annual';

export const INSURANCE_PERIODICITIES: ReadonlyArray<{
  value: InsurancePeriodicity;
  label: string;
}> = [
  { value: 'Single', label: 'Prime unique' },
  { value: 'Monthly', label: 'Mensuelle' },
  { value: 'Quarterly', label: 'Trimestrielle' },
  { value: 'SemiAnnual', label: 'Semestrielle' },
  { value: 'Annual', label: 'Annuelle' },
];

export const INSURANCE_PERIODICITY_LABELS: Record<InsurancePeriodicity, string> = {
  Single: 'Prime unique',
  Monthly: 'Mensuelle',
  Quarterly: 'Trimestrielle',
  SemiAnnual: 'Semestrielle',
  Annual: 'Annuelle',
};

export type InsurancePricingMode = 'CatalogueFixed' | 'InsurerComputed';

export const INSURANCE_PRICING_MODES: ReadonlyArray<{
  value: InsurancePricingMode;
  label: string;
  description: string;
}> = [
  {
    value: 'CatalogueFixed',
    label: 'Tarif fixe',
    description: 'La prime est celle inscrite ici, quelle que soit la situation du client.',
  },
  {
    value: 'InsurerComputed',
    label: 'Tarif calculé par l’assureur',
    description: "La prime est demandée à l'assureur au moment de la souscription.",
  },
];

export const INSURANCE_PRICING_MODE_LABELS: Record<InsurancePricingMode, string> = {
  CatalogueFixed: 'Tarif fixe',
  InsurerComputed: "Tarif calculé par l'assureur",
};

export type InsuranceMinKycLevel = 'None' | 'Simplified' | 'Full';

export const INSURANCE_MIN_KYC_LEVELS: ReadonlyArray<{
  value: InsuranceMinKycLevel;
  label: string;
}> = [
  { value: 'None', label: 'Aucune exigence' },
  { value: 'Simplified', label: 'KYC simplifié' },
  { value: 'Full', label: 'KYC complet' },
];

export const INSURANCE_MIN_KYC_LEVEL_LABELS: Record<InsuranceMinKycLevel, string> = {
  None: 'Aucune exigence',
  Simplified: 'KYC simplifié',
  Full: 'KYC complet',
};

/**
 * `notOfferableReasons` de `listInsuranceProducts`. Ces six valeurs sont celles que la
 * description de l'endpoint énumère ; elles expliquent à l'agent pourquoi un produit
 * n'apparaît pas, au lieu de le faire disparaître sans mot dire.
 */
export function notOfferableReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'PRODUCT_INACTIVE':
      return 'Produit désactivé';
    case 'CONNECTION_INACTIVE':
      return "La connexion à l'assureur est inactive";
    case 'CONNECTION_WRONG_FAMILY':
      return "La connexion n'est pas une connexion assurance";
    case 'NOT_YET_EFFECTIVE':
      return "Le produit n'est pas encore en vigueur";
    case 'NO_LONGER_EFFECTIVE':
      return "Le produit n'est plus en vigueur";
    case 'INSURER_PRICING_UNAVAILABLE':
      return "L'assureur ne renvoie pas de tarif";
    default:
      return reason || 'Indisponible';
  }
}

/** Statut d'un contrat, tel qu'un agent le lit. Valeurs de `PolicyRow.status`. */
export function policyStatusMeta(status: string | null | undefined): {
  label: string;
  severity: Severity;
} {
  switch (status) {
    case 'Pending':
      return { label: 'En cours de souscription', severity: 'info' };
    case 'Active':
      return { label: 'En vigueur', severity: 'success' };
    case 'Suspended':
      return { label: 'Suspendu', severity: 'error' };
    case 'Lapsed':
      return { label: 'Résilié pour impayé', severity: 'error' };
    case 'Cancelled':
      return { label: 'Résilié', severity: 'neutral' };
    case 'Expired':
      return { label: 'Échu', severity: 'neutral' };
    default:
      return { label: status || '—', severity: 'neutral' };
  }
}

/** Statut d'un sinistre. Valeurs de `ClaimRow.status`. */
/**
 * Les six valeurs de `ClaimStatus` du serveur.
 *
 * Trois libellés avaient été écrits ici avant la livraison du lot ASS-09 et ne
 * correspondaient à rien — `ComplementRequired`, `Approved` et `Paid` n'existent pas
 * dans le contrat, qui dit `DocumentsRequired`, `Accepted` et `Indemnified`. Un statut
 * inconnu retombait sur le libellé brut, donc l'écran affichait « DocumentsRequired »
 * en anglais au lieu de la phrase qui compte.
 */
export function claimStatusMeta(status: string | null | undefined): {
  label: string;
  severity: Severity;
} {
  switch (status) {
    case 'Declared':
      return { label: 'Déclaré', severity: 'info' };
    case 'UnderReview':
      return { label: "À l'étude", severity: 'info' };
    case 'DocumentsRequired':
      return { label: 'Pièces attendues', severity: 'warning' };
    case 'Accepted':
      return { label: 'Accepté', severity: 'success' };
    case 'Indemnified':
      return { label: 'Indemnisé', severity: 'success' };
    case 'Refused':
      return { label: 'Refusé', severity: 'error' };
    default:
      return { label: status || '—', severity: 'neutral' };
  }
}

/**
 * Un sinistre attend une action de l'agence quand l'assureur demande des pièces.
 * C'est le seul statut sur lequel l'agent peut agir, et donc celui qui doit ressortir.
 */
export function claimNeedsAction(status: string | null | undefined): boolean {
  return status === 'DocumentsRequired';
}

/**
 * Le verdict antivirus d'une pièce — `DocumentScanStatus` côté serveur.
 *
 * C'est le vrai verrou de transmission : `GET .../content` refuse par 409 tout ce qui
 * n'est pas `Clean`, et l'assureur ne reçoit rien d'autre. Les quatre états sont donc
 * montrés tels quels, y compris `ScanFailed`, parce que « notre antivirus n'a pas
 * répondu » et « le fichier du client est dangereux » ne demandent pas la même action
 * de l'agent : le premier se réessaie tout seul, le second demande une autre pièce.
 */
export function scanStatusMeta(status: string | null | undefined): {
  label: string;
  severity: Severity;
  hint: string | null;
} {
  switch (status) {
    case 'Pending':
      return {
        label: 'Analyse en attente',
        severity: 'neutral',
        hint: "La pièce est déposée et chiffrée. L'analyse antivirus passe dans les dix minutes.",
      };
    case 'Clean':
      return { label: 'Analysée', severity: 'success', hint: null };
    case 'Infected':
      return {
        label: 'Rejetée par l’antivirus',
        severity: 'error',
        hint: 'Le fichier a été supprimé du stockage. Demandez une autre pièce au client.',
      };
    case 'ScanFailed':
      return {
        label: 'Analyse indisponible',
        severity: 'warning',
        hint: "L'antivirus n'a pas répondu. La pièce est conservée et sera réanalysée automatiquement.",
      };
    default:
      return { label: status || '—', severity: 'neutral', hint: null };
  }
}

/**
 * Natures de sinistre proposées à la déclaration. Le contrat ne les énumère pas
 * (aucun endpoint de sinistre n'est encore déclaré) : cette liste est une proposition
 * à faire valider par le métier, et `nature` part en chaîne libre, donc l'ajout d'une
 * valeur côté assureur ne casse rien.
 */
export const CLAIM_NATURES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Death', label: 'Décès' },
  { value: 'Disability', label: 'Invalidité' },
  { value: 'Illness', label: 'Maladie' },
  { value: 'Hospitalisation', label: 'Hospitalisation' },
  { value: 'Accident', label: 'Accident' },
  { value: 'Fire', label: 'Incendie' },
  { value: 'Theft', label: 'Vol' },
  { value: 'Other', label: 'Autre' },
];

/** Extensions et poids acceptés pour une pièce justificative de sinistre. */
/**
 * Alignés sur `ClaimStorageOptions` côté serveur : image/jpeg, image/png, image/heic et
 * application/pdf, 20 Mo. Pas d'archive — le serveur la refuse, parce que son contenu
 * est ce qu'une analyse antivirus devrait parcourir et que la plateforme ne le fait pas.
 *
 * Le plafond était à 10 Mo ici, la moitié de ce que le serveur accepte : une photo de
 * véhicule accidenté prise au téléphone était refusée par l'écran alors que l'API
 * l'aurait prise.
 */
export const CLAIM_DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic';
export const CLAIM_DOCUMENT_MAX_SIZE_MB = 20;

export function quoteSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'Catalogue':
      return 'Tarif du catalogue';
    case 'Insurer':
      return "Tarif de l'assureur";
    default:
      return source || '—';
  }
}

// ——— Utilitaires d'affichage ———

/**
 * Montant en francs CFA et devises sans sous-unité courante ici : deux décimales
 * n'apportent rien et désalignent les colonnes. La devise vient du contrat, jamais
 * d'une constante.
 */
export function formatAmount(
  amount: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (amount === null || amount === undefined) return '—';
  const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(amount);
  return currency ? `${formatted} ${currency}` : formatted;
}

/**
 * Les dates `yyyy-MM-dd` du contrat ne passent pas par `DatePipe` : il les interprète
 * en UTC et affiche la veille pour les fuseaux négatifs.
 */
export function formatContractDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}
