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
}
