import { Observable, of } from 'rxjs';

/**
 * Frontière unique vers les endpoints que le back n'expose pas encore.
 *
 * Cinq US front de ce lot dépendent de lots back non livrés : INT-29 (fichiers batch,
 * dépend d'INT-24/INT-25), ASS-15 (souscription, ASS-04/ASS-05), ASS-16 (contrats du
 * client, ASS-07/ASS-08), ASS-17 (sinistres, ASS-09) et ASS-18 (bordereaux, ASS-10).
 * Le swagger ne déclare aujourd'hui, côté assurance, que le catalogue des produits et
 * le devis.
 *
 * Deux mauvaises réponses à ça : inventer les chemins dans le swagger et régénérer le
 * client — ce qui ferait passer un contrat supposé pour le contrat réel —, ou peupler
 * les écrans de données factices — ce qui fait croire la fonctionnalité livrée. Les
 * écrans appellent donc ce fichier, qui répond vide, et affichent l'état vide
 * documenté du repo (précédent : `customers/.../groupes.ts`).
 *
 * À l'arrivée des endpoints : mettre à jour `swaggers/sankore-crm-api-swagger.json`,
 * lancer `npm run openapi-generator`, puis remplacer chaque méthode ci-dessous par
 * l'appel `IntegrationApiService` correspondant. Les types sont alignés sur ce que les
 * US back annoncent, de sorte que les écrans n'aient pas à bouger.
 */

// ——— INT-29 — Fichiers batch ———

export interface BatchFileRow {
  batchFileId: string;
  connectionId: string;
  direction: 'Outbound' | 'Inbound';
  sequence: number;
  fileName: string;
  producedAt: string;
  recordCount: number;
  acknowledgedAt: string | null;
  acknowledgementStatus: 'Pending' | 'Acknowledged' | 'Rejected' | 'Overdue';
  rejectedRecordCount: number | null;
}

export interface BatchFilePage {
  rows: BatchFileRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  /** Délai annoncé au-delà duquel un fichier sortant sans accusé est signalé. */
  acknowledgementDueHours: number | null;
}

// ——— ASS-15 / ASS-16 — Contrats ———

export interface PolicyRow {
  policyId: string;
  productId: string;
  productName: string;
  insurerName: string;
  connectionId: string;
  status: 'Pending' | 'Active' | 'Suspended' | 'Lapsed' | 'Cancelled' | 'Expired';
  policyNumber: string | null;
  effectiveFrom: string;
  premiumAmount: number;
  currency: string;
  periodicity: string;
  nextInstalmentDate: string | null;
  lastInstalmentDate: string | null;
  lastInstalmentPaid: boolean | null;
  certificateAvailable: boolean;
  asOf: string;
}

export interface PolicyListResult {
  rows: PolicyRow[];
  totalCount: number;
  asOf: string | null;
}

export interface SubscribePolicyRequest {
  crmCustomerId: string;
  productId: string;
  effectiveFrom: string;
  debitAccountRef: string;
  insuredAmount: number | null;
  beneficiaries: Array<{
    fullName: string;
    relationship: string;
    sharePercent: number;
    birthDate: string | null;
  }>;
  questionnaireAnswers: Array<{ code: string; answer: string }>;
  consentGiven: boolean;
  signatureReference: string | null;
}

export interface SubscribePolicyResult {
  policyId: string;
  status: string;
  commandId: string | null;
}

// ——— ASS-17 — Sinistres ———

export interface ClaimRow {
  claimId: string;
  policyId: string;
  productName: string;
  insurerClaimRef: string | null;
  status: 'Declared' | 'UnderReview' | 'ComplementRequired' | 'Approved' | 'Paid' | 'Rejected';
  occurredOn: string;
  declaredAt: string;
  updatedAt: string;
  nature: string;
  settlementAmount: number | null;
  settlementCurrency: string | null;
  settledAt: string | null;
}

export interface ClaimTimelineEntry {
  at: string;
  status: string;
  note: string | null;
  requestedDocumentLabel: string | null;
}

export interface ClaimDetail extends ClaimRow {
  description: string;
  timeline: ClaimTimelineEntry[];
  documents: Array<{
    documentId: string;
    fileName: string;
    uploadedAt: string;
    isSensitive: boolean;
  }>;
}

export interface DeclareClaimRequest {
  policyId: string;
  occurredOn: string;
  nature: string;
  description: string;
  documentIds: string[];
}

// ——— ASS-18 — Bordereaux ———

export interface StatementLine {
  productId: string;
  productName: string;
  subscriptionCount: number;
  premiumCollected: number;
  reversalCount: number;
  reversedAmount: number;
  cancellationCount: number;
  commissionAmount: number;
}

export interface InsuranceStatement {
  connectionId: string;
  insurerName: string;
  period: string;
  currency: string;
  lines: StatementLine[];
  totalPremiumCollected: number;
  totalReversedAmount: number;
  totalCommissionAmount: number;
  totalSubscriptionCount: number;
  totalCancellationCount: number;
  generatedAt: string | null;
}

/**
 * Chacune de ces méthodes répond l'état vide, jamais une erreur : un écran n'a pas à
 * distinguer « le module n'est pas livré » d'une panne, et `isPending` lui suffit pour
 * afficher le bon message.
 */
export class PendingIntegrationEndpoints {
  /** Vrai tant que les endpoints correspondants ne sont pas livrés. */
  public static readonly isPending = true;

  public static readonly pendingNotice =
    "Cette vue attend un endpoint qui n'est pas encore livré côté serveur.";

  public listBatchFiles(): Observable<BatchFilePage> {
    return of({ rows: [], totalCount: 0, page: 1, pageSize: 20, acknowledgementDueHours: null });
  }

  public listBatchFileCommandIds(): Observable<string[]> {
    return of([]);
  }

  public listCustomerPolicies(): Observable<PolicyListResult> {
    return of({ rows: [], totalCount: 0, asOf: null });
  }

  public subscribePolicy(): Observable<SubscribePolicyResult | null> {
    return of(null);
  }

  public listCustomerClaims(): Observable<ClaimRow[]> {
    return of([]);
  }

  public getClaim(): Observable<ClaimDetail | null> {
    return of(null);
  }

  public declareClaim(): Observable<ClaimRow | null> {
    return of(null);
  }

  public getInsuranceStatement(): Observable<InsuranceStatement | null> {
    return of(null);
  }
}
