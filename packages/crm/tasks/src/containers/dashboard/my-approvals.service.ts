import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import {
  KYCApiService,
  MyStepDto,
  WorkflowInstanceDto,
  WorkflowInstancesApiService,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { isKycWorkflowEntity } from '@sankore/crm/kyc';

export type ApprovalItem =
  | {
      kind: 'kyc';
      id: string;
      kycFileId: string;
      title: string;
      detail: string;
      receivedAt: string | null;
      dueAt: null;
    }
  | {
      kind: 'workflow';
      id: string;
      step: MyStepDto;
      /** `null` quand l'instance n'a pas pu être lue : la ligne s'ouvre, elle ne se signe pas d'ici. */
      instance: WorkflowInstanceDto | null;
      title: string;
      detail: string;
      receivedAt: string | null;
      dueAt: string | null;
    };

export interface MyApprovals {
  items: ApprovalItem[];
  /** Dossiers KYC en attente de l'utilisateur dans tout son périmètre, pas seulement ceux listés. */
  kycAwaitingTotal: number;
}

/** Au-delà, la liste renvoie vers l'écran des dossiers KYC plutôt que de tout charger ici. */
const KYC_PAGE_SIZE = 50;

const VIGILANCE_LABELS: Record<string, string> = {
  Low: 'Vigilance faible',
  Standard: 'Vigilance standard',
  High: 'Vigilance renforcée',
};

/**
 * Ce que l'utilisateur doit SIGNER, à côté de ce qu'il doit FAIRE : les dossiers KYC dont l'échelon
 * en attente correspond à ses rôles, et ses étapes de workflow.
 *
 * <p>
 * Les étapes de workflow qui reflètent un dossier KYC sont retirées : le dossier figure déjà dans
 * la première liste, et l'approuver côté workflow n'avancerait que le reflet — le module KYC
 * n'écoute pas le moteur, garde seul la règle des quatre yeux et ne validerait pas le dossier.
 * Une décision KYC se prend sur la fiche du dossier, qui la recopie ensuite sur le workflow.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class MyApprovalsService {
  private readonly _kyc = inject(KYCApiService);
  private readonly _workflows = inject(WorkflowInstancesApiService);
  private readonly _permissions = inject(PermissionsService);

  public load(): Observable<MyApprovals> {
    return forkJoin({ kyc: this._loadKyc(), workflow: this._loadWorkflowSteps() }).pipe(
      map(({ kyc, workflow }) => ({
        items: [...kyc.items, ...workflow],
        kycAwaitingTotal: kyc.total,
      })),
    );
  }

  private _loadKyc(): Observable<{ items: ApprovalItem[]; total: number }> {
    if (!this._permissions.has('kyc:read')) return of({ items: [], total: 0 });

    // Le serveur place en tête les dossiers qui attendent l'appelant, sur TOUTE la liste : une
    // page suffit tant qu'il n'y en a pas plus de KYC_PAGE_SIZE, et le total dit s'il y en a plus.
    return this._kyc.listKycFiles(undefined, undefined, undefined, undefined, undefined, 1, KYC_PAGE_SIZE).pipe(
      map((page) => ({
        total: page.awaitingMeCount ?? 0,
        items: (page.rows ?? [])
          .filter((r) => r.awaitingMe && r.kycFileId)
          .map<ApprovalItem>((r) => ({
            kind: 'kyc',
            id: `kyc:${r.kycFileId}`,
            kycFileId: r.kycFileId!,
            title: r.customerName || 'Client sans nom',
            detail: [
              'Dossier KYC',
              VIGILANCE_LABELS[r.vigilanceLevel ?? ''] ?? null,
              r.isRemoteCollection ? 'Collecte à distance' : null,
            ]
              .filter(Boolean)
              .join(' · '),
            receivedAt: r.updatedAt ?? null,
            dueAt: null,
          })),
      })),
      catchError(() => of({ items: [], total: 0 })),
    );
  }

  private _loadWorkflowSteps(): Observable<ApprovalItem[]> {
    if (!this._permissions.has('workflow:task:complete') && !this._permissions.has('workflow:approve')) {
      return of([]);
    }

    return this._workflows.listMySteps().pipe(
      // `MyStepDto` ne dit pas sur quelle entité porte l'étape : il faut l'instance pour écarter
      // les reflets de dossiers KYC. Une lecture par étape, en parallèle ; une file personnelle en
      // compte quelques-unes.
      switchMap((steps) =>
        (steps ?? []).length === 0
          ? of([])
          : forkJoin(
              (steps ?? []).map((step) =>
                (step.instanceId
                  ? this._workflows.getWorkflowInstance(step.instanceId).pipe(catchError(() => of(null)))
                  : of(null)
                ).pipe(map((instance) => ({ step, instance }))),
              ),
            ),
      ),
      map((rows) =>
        rows
          .filter(({ instance }) => !isKycWorkflowEntity(instance?.entityType))
          .map<ApprovalItem>(({ step, instance }) => ({
            kind: 'workflow',
            id: `wf:${step.stepId ?? step.instanceId}`,
            step,
            instance,
            title: step.stepName || 'Étape de validation',
            detail: ['Workflow', instance?.entityType ?? null, step.approverRoleCode ?? null]
              .filter(Boolean)
              .join(' · '),
            receivedAt: step.createdAt ?? null,
            dueAt: step.dueAt ?? null,
          })),
      ),
      catchError(() => of([])),
    );
  }
}
