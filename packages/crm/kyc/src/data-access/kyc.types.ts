/**
 * Types des données que **le contrat KYC-B-08 ne fournit pas encore**.
 *
 * Chacun correspond à un critère d'acceptation du cahier sans endpoint derrière. Ils vivent ici, et
 * non dispersés dans les écrans, pour que le rebranchement sur l'API réelle se fasse en un seul
 * endroit : `kyc-facade.service.ts`.
 *
 * Plus aucune valeur de démonstration n'y subsiste. Là où le contrat n'offre pas d'endpoint dédié —
 * l'historique du dossier — la façade **compose** la réponse à partir de lectures réelles, et
 * l'écran dit ce qui manque. Aucun écran ne doit présenter une donnée simulée comme une donnée
 * serveur, ni une vue partielle comme une vue complète.
 */

/** Fiabilité d'un champ lu par l'OCR — le code couleur de KYC-F-02. */
/**
 * `'unknown'` n'est pas une quatrième nuance : c'est l'absence de mesure. Le serveur ne note pas
 * tous les champs, et une pièce lue avant que les confiances ne soient conservées n'en a aucune —
 * aucune reprise ne peut les inventer. Sans cette valeur, « non mesuré » s'afficherait comme
 * « sûr », et l'agent re-saisirait les champs déjà bons en ignorant les douteux.
 */
export type KycFieldConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface KycOcrField {
  /** Nom technique, celui qu'attend `CorrectKycFieldRequest.fieldName`. */
  name: string;
  /** Libellé français affiché à l'agent. */
  label: string;
  value: string;
  confidence: KycFieldConfidence;
  /**
   * Faux pour un champ que **sa nature** rend non corrigeable — aujourd'hui le seul numéro de pièce,
   * affiché masqué. Ce n'est pas le porteur du droit de corriger : celui-là est `kyc:verify`, vérifié
   * par l'écran de capture, parce qu'il vaut pour tous les champs à la fois et non champ par champ.
   */
  editable: boolean;
}

/**
 * Zone codée de la pièce, affichée en lecture seule pour contrôle (KYC-F-02).
 *
 * La forme suit celle du serveur, pas l'inverse : les clés de `fields` sont celles du service de
 * biométrie, pas une liste fermée. Figer `surname`/`givenNames`/`nationality` ici supposerait
 * connaître les noms qu'un service externe emploie, et afficherait « — » partout le jour où il en
 * change un.
 */
export interface KycMrzData {
  /**
   * Toujours `null`, et déclaré pour qu'aucun écran ne l'attende : la ligne brute **n'est jamais
   * stockée**. Elle épelle le numéro de la pièce en clair, donc la garder dans une colonne jsonb
   * annulerait le chiffrement du numéro trois champs plus loin.
   */
  rawLine: null;
  checksumValid: boolean;
  /** Champs analysés, numéro de pièce exclu — il est retiré avant écriture, comme pour l'OCR. */
  fields: Record<string, string>;
}

/**
 * Contribution d'un critère au score global (KYC-F-04).
 *
 * Nommé « contribution » et non « composante », et **sans `max`** : le service rend un apport par
 * critère et aucun dénominateur. Une jauge par critère ne peut donc pas être dessinée honnêtement —
 * seul le score global est sur 100. Et `key` est une chaîne libre, pas `'face' | 'mrz' | 'fields' |
 * 'anomalies'` : le service de biométrie est externe à cette solution, ses critères sont les siens,
 * et les projeter sur une liste fermée écarterait silencieusement ceux qu'on n'avait pas prévus.
 */
export interface KycScoreContribution {
  key: string;
  label: string;
  score: number;
}

export interface KycVerificationDetail {
  score: number;
  level: string;
  contributions: KycScoreContribution[];
  flagCodes: string[];
  /** Pourcentage de correspondance faciale (KYC-F-03). `null` si aucune comparaison n'a eu lieu. */
  faceMatchPercent: number | null;
  /**
   * Cause d'une capture refusée : flou, reflet, lumière.
   *
   * Toujours `null` par cette lecture : le code n'est **pas persisté**, il n'existe que dans la
   * réponse synchrone de `POST /verify`. L'écran qui lance la vérification doit donc le garder de
   * cette réponse-là ; un écran rouvert plus tard ne peut pas le retrouver.
   */
  captureRejectionReason: string | null;
  /**
   * Détail technique, pour les profils autorisés (KYC-F-04).
   *
   * C'est **ce que le serveur a conservé** de la vérification, pas la charge brute du service : il
   * n'existe aucune colonne « payload brut », et prétendre le contraire ferait croire à une trace
   * qui n'a jamais été gardée.
   */
  rawPayload: Record<string, unknown> | null;
}

/**
 * Nature de l'image déposée, telle que le serveur la nomme. Le verso existe côté serveur même si
 * aucun écran ne le capture encore : le reprendre tel quel évite une table de correspondance entre
 * deux vocabulaires, et c'est le piège que le contrat sert à éviter.
 */
export type KycDocumentKind = 'IdentityDocumentFront' | 'IdentityDocumentBack' | 'Selfie';

/**
 * Verdict d'un validateur sur une pièce, tel que le serveur le nomme.
 *
 * `NotReviewed` n'est **pas** « en attente » : il désigne une image collectée avant que la revue
 * pièce à pièce n'existe, dont le serveur n'a gardé que la référence de stockage — ni type MIME, ni
 * taille, ni empreinte, et aucune ligne de registre à décider. Elle est une preuve de ce qui a été
 * collecté, pas du travail en attente, et l'écran doit la présenter ainsi : « Pending » promettrait
 * une décision que personne ne peut prendre.
 */
export type KycDocumentReviewDecision = 'NotReviewed' | 'Pending' | 'Accepted' | 'Refused';

/** Une pièce du dossier, telle que la liste la rend. */
export interface KycDocumentRow {
  /**
   * Identifiant de la ligne de registre. **Null** pour une image antérieure au registre : il n'y a
   * rien à décider, et c'est ce `null` qui le dit.
   */
  id: string | null;
  kind: KycDocumentKind | string;
  storageRef: string;
  /** Null pour une image antérieure au registre — jamais persistés, donc irrécupérables. */
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: string;
  uploadedBy: string | null;
  decision: KycDocumentReviewDecision;
  reviewedBy: string | null;
  reviewedAt: string | null;
  refusalReason: string | null;
  /** Seule la plus récente de chaque nature peut être décidée : c'est celle qui vaut preuve. */
  isCurrentForKind: boolean;
  /** Vrai quand une vérification a lu cette image (rapprochement par référence de stockage). */
  hasOcrReading: boolean;
}

/** Les pièces d'un dossier, avec de quoi dire si la décision de dossier est ouverte. */
export interface KycDocumentList {
  fileStatus: string;
  documents: KycDocumentRow[];
  /**
   * Vraie quand chaque pièce courante a été acceptée, et qu'il y en a au moins une. C'est un
   * **constat, pas un déclencheur** : accepter la dernière pièce ne fait pas avancer le dossier, par
   * décision produit explicite. L'écran s'en sert pour dire au validateur qu'il peut passer à la
   * décision de dossier.
   */
  allCurrentAccepted: boolean;
  /** Vraie dès qu'une pièce courante est antérieure au registre : « tout accepté » serait trompeur. */
  anyNotReviewed: boolean;
}

/** Référence d'image dans le magasin documentaire, attendue par `RunKycVerificationRequest`. */
export interface KycImageRef {
  storageRef: string;
  /**
   * URL d'aperçu **locale** (`blob:`), pas un lien serveur.
   *
   * Il n'y a pas de lien de lecture temporaire et il n'y en aura pas : la relecture passe par
   * `GET /kyc-files/{id}/documents/{storageRef}`, un flux authentifié qui journalise chaque accès
   * dans `kyc_document_access_logs`. Une URL signée n'auditerait que son émission, pas la lecture,
   * ce qui viderait cette table de son sens. Juste après une capture le navigateur a déjà les
   * octets, donc l'aperçu se fabrique ici — et l'appelant doit `revokeObjectURL` l'ancien.
   */
  url: string | null;
}

export type KycHistoryKind = 'verification' | 'correction' | 'decision' | 'review' | 'creation';

export interface KycHistoryEntry {
  kind: KycHistoryKind;
  label: string;
  /** Nom du champ pour une correction, niveau pour une décision. */
  detail: string | null;
  /**
   * Auteur de l'évènement, tel que le contrat le donne : un identifiant d'utilisateur. `null` pour
   * un évènement machine (ouverture, notation). Le nom est résolu par l'écran, qui ne demande
   * qu'une fois chaque identifiant — l'historique répète les mêmes.
   */
  authorId: string | null;
  /** Rempli par l'écran après résolution ; vide tant que le nom n'est pas connu. */
  authorName: string;
  at: string;
  /** Vrai quand la valeur est masquée faute de permission (KYC-F-08). */
  masked: boolean;
}

/** Ligne du tableau de bord (KYC-F-06). */
export interface KycDashboardRow {
  kycFileId: string;
  customerId: string;
  customerName: string;
  status: string;
  confidenceScore: number | null;
  vigilanceLevel: string;
  updatedAt: string;
  /** Action attendue, déjà formulée côté serveur dans la cible. */
  requiredAction: string | null;
  /** Le dossier attend une décision de l'utilisateur connecté : il remonte en tête. */
  awaitingMe: boolean;
}

export interface KycDashboardFilters {
  status: string;
  agencyId: string;
  vigilanceLevel: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export interface KycDashboardPage {
  rows: KycDashboardRow[];
  /** Dossiers du périmètre, tous filtres appliqués — pas seulement ceux de la page. */
  totalCount: number;
  /**
   * Dossiers dont le prochain échelon relève des rôles de l'appelant, sur tout le périmètre.
   *
   * Indice de tri, jamais un droit : un remplaçant porteur d'une délégation M12 sans le rôle n'est
   * pas compté ici et peut quand même signer depuis le dossier.
   */
  awaitingMeCount: number;
}

/**
 * Plafonds du KYC simplifié (KYC-F-09), tels que le serveur les applique (KYC-B-06).
 *
 * Deux moitiés à ne pas confondre : les **plafonds**, qui sont des paramètres du tenant et arrivent
 * toujours renseignés pour un client plafonné ; et la **consommation**, qui n'est aujourd'hui pas
 * mesurable — aucun module ne tient de compte ni de transaction. Un `null` de consommation veut dire
 * « on ne sait pas », jamais « rien consommé » : l'écran doit le dire au lieu de rassurer.
 */
export interface KycCaps {
  /** `false` pour un KYC complet : aucun plafond ne s'applique et les quatre champs suivants sont `null`. */
  isCapped: boolean;
  /** Palier renvoyé par le serveur : « Simplified » ou « Full ». */
  tier: string;
  /** Code ISO 4217 des montants. Le serveur le donne : ne jamais supposer le franc CFA. */
  currency: string;
  balanceCap: number | null;
  flowCap: number | null;
  /**
   * Largeur de la fenêtre **glissante** du plafond de flux, en jours (30 par défaut, paramétrable).
   * Ce n'est pas un mois calendaire — un libellé « ce mois-ci » serait faux.
   */
  flowWindowDays: number | null;
  /** Part du plafond de flux qui déclenche l'avertissement, en pourcentage. */
  alertPct: number | null;

  /** `null` = NON MESURÉ, jamais zéro. */
  balance: number | null;
  /** `null` = NON MESURÉ, jamais zéro. */
  flow: number | null;
  flowWindowStart: string | null;
  /** Code stable expliquant pourquoi une consommation manque, quand elle manque. */
  usageUnavailableReason: string | null;
}

/** Motifs d'absence de consommation renvoyés par le serveur. */
export const KYC_USAGE_UNAVAILABLE_LABELS: Record<string, string> = {
  KYC_USAGE_NO_TRANSACTION_SOURCE:
    "Les soldes et les mouvements ne sont pas encore tenus par l'application : la consommation des "
    + 'plafonds ne peut pas être calculée.',
};

/** Un dossier en attente d'envoi, pour l'indicateur hors-ligne (KYC-F-07). */
export interface KycPendingUpload {
  draftId: string;
  customerName: string;
  capturedAt: string;
  /** 0 à 100 pendant la synchronisation. */
  progress: number;
}
