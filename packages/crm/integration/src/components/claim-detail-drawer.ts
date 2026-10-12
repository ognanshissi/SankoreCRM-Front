import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasIcon } from '@talisoft/ui/icon';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { PERMISSIONS, PermissionsService } from '@sankore/crm/common';
import {
  CLAIM_DOCUMENT_ACCEPT,
  CLAIM_DOCUMENT_MAX_SIZE_MB,
  claimStatusMeta,
  formatAmount,
  formatContractDate,
} from '../data-access/integration-referential';
import {
  ClaimDetail,
  ClaimTimelineEntry,
  PendingIntegrationEndpoints,
} from '../data-access/pending-endpoints';

export interface ClaimDetailDrawerData {
  claimId: string;
  productName: string;
}

/** Une ligne de chronologie, enrichie de son libellé et de sa sévérité. */
interface TimelineRow extends ClaimTimelineEntry {
  id: string;
  label: string;
  severity: Severity;
}

/**
 * Détail et suivi d'un sinistre — ASS-17.
 *
 * **Aucun endpoint de sinistre n'est déclaré dans le swagger** (lot back ASS-09 non
 * livré) : `PendingIntegrationEndpoints.getClaim()` répond `null`, et le drawer affiche
 * un vide expliqué plutôt qu'une erreur. La chronologie, la demande de pièce
 * complémentaire, l'indemnisation et le masquage des pièces sensibles sont écrits pour
 * de vrai et fonctionneront tels quels.
 *
 * À l'arrivée de l'endpoint : mettre à jour le swagger, lancer
 * `npm run openapi-generator`, nommer la méthode dans `IntegrationFacadeService`, puis
 * remplacer l'appel et retirer le bandeau.
 */
@Component({
  selector: 'claim-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasAlert,
    Button,
    TasIcon,
    TasSpinner,
    TasTable,
    TasTag,
    TasFileUploader,
    TimeagoPipe,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Suivi du sinistre</span>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex justify-center py-16">
            <tas-spinner size="10" class="text-primary"></tas-spinner>
          </div>
        } @else if (!claim()) {
          <tas-alert type="info">
            <p class="text-sm font-medium">Le suivi des sinistres attend une livraison serveur</p>
            <p class="text-xs mt-1">
              Le dossier « {{ data.productName }} » est suivi chez l'assureur. Son avancement
              apparaîtra ici dès que l'échange avec SANKORE sera en place ; demandez-le à
              l'assureur en attendant.
            </p>
          </tas-alert>
        } @else {
          <div class="flex flex-col gap-5">
            <!-- Résumé : trois valeurs, pas une liste -->
            <div class="flex flex-wrap items-start gap-x-8 gap-y-3">
              <div>
                <p class="text-xs text-slate-500">Statut</p>
                <tas-tag class="mt-1" [severity]="statusSeverity()">{{ statusLabel() }}</tas-tag>
              </div>
              <div>
                <p class="text-xs text-slate-500">Référence assureur</p>
                <p class="mt-1 font-mono text-xs text-slate-800">
                  {{ claim()!.insurerClaimRef || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-slate-500">Survenu le</p>
                <p class="mt-1 text-sm text-slate-800">{{ formatDate(claim()!.occurredOn) }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-500">Dernière mise à jour</p>
                <p class="mt-1 text-sm text-slate-800">{{ claim()!.updatedAt | dateTimeAgo }}</p>
              </div>
            </div>

            <!-- Indemnisation versée sur le compte CBS -->
            @if (claim()!.settlementAmount !== null) {
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p class="text-sm font-medium text-slate-800">Indemnisation versée</p>
                <p class="mt-1 text-lg font-semibold text-slate-800 tabular-nums">
                  {{ settlementLabel() }}
                </p>
                <p class="mt-0.5 text-xs text-slate-500">
                  Créditée sur le compte du client le {{ formatDate(claim()!.settledAt) }}.
                </p>
              </div>
            }

            <!-- Pièce complémentaire demandée : la seule action de l'agent ici -->
            @if (requestedDocumentLabel(); as requested) {
              <div class="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                <div>
                  <p class="text-sm font-medium text-slate-800">
                    L'assureur demande une pièce
                  </p>
                  <p class="mt-1 text-xs text-slate-500">
                    {{ requested }} — PDF, JPG ou PNG, {{ maxSizeMb }} Mo au plus.
                  </p>
                </div>
                <tas-file-uploader
                  [accept]="accept"
                  [maxSizeMb]="maxSizeMb"
                  [value]="complementFile()"
                  (valueChange)="complementFile.set($event)"
                ></tas-file-uploader>
                <div class="flex justify-end">
                  <button
                    tas-raised-button
                    color="primary"
                    type="button"
                    [disabled]="!complementFile()"
                    (click)="sendComplement()"
                  >
                    <tas-icon iconName="feather:upload" style="font-size:14px"></tas-icon>
                    Envoyer la pièce
                  </button>
                </div>
              </div>
            }

            <!-- Chronologie des statuts -->
            <div>
              <p class="mb-2 text-sm font-medium text-slate-800">Chronologie</p>
              <!--
                Rendue par la table du kit : chaque étape est une ligne d'une seule cellule,
                sans en-tête. La liste garde ainsi la pagination et l'état vide du kit,
                comme la frise du dossier KYC.
              -->
              <tas-table [data]="timeline()" identifierField="id" [config]="timelineConfig()">
                <ng-template #body let-entry>
                  <tr>
                    <td [attr.colspan]="1" class="p-0">
                      <div class="flex gap-3 p-3">
                        <div
                          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100"
                        >
                          <tas-icon
                            iconName="feather:clock"
                            class="text-slate-500"
                            style="font-size:14px"
                          ></tas-icon>
                        </div>
                        <div class="min-w-0">
                          <tas-tag [severity]="entry.severity">{{ entry.label }}</tas-tag>
                          @if (entry.note) {
                            <p class="mt-1 text-xs text-slate-600">{{ entry.note }}</p>
                          }
                          @if (entry.requestedDocumentLabel) {
                            <p class="mt-1 text-xs text-slate-600">
                              Pièce demandée :
                              <span class="font-medium">{{ entry.requestedDocumentLabel }}</span>
                            </p>
                          }
                          <p class="mt-1 text-xs text-slate-400">{{ entry.at | dateTimeAgo }}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                </ng-template>
              </tas-table>
            </div>

            <!-- Pièces du dossier -->
            <div>
              <p class="mb-2 text-sm font-medium text-slate-800">Pièces du dossier</p>
              <tas-table [data]="claim()!.documents" identifierField="documentId">
                <ng-template #header>
                  <tr>
                    <th>Pièce</th>
                    <th>Ajoutée</th>
                    <th class="text-right"></th>
                  </tr>
                </ng-template>
                <ng-template #body let-doc>
                  <tr>
                    <td class="py-3">
                      @if (doc.isSensitive && !canRevealSensitive()) {
                        <!--
                          La ligne reste visible : savoir qu'une pièce existe n'est pas la
                          voir, et la faire disparaître empêcherait l'agent de comprendre le
                          dossier. Le texte porte l'information, pas la seule couleur.
                        -->
                        <tas-tag severity="neutral">
                          <span class="inline-flex items-center gap-1.5">
                            <tas-icon iconName="feather:eye-off" style="font-size:12px"></tas-icon>
                            pièce sensible masquée
                          </span>
                        </tas-tag>
                        <p class="mt-1 text-xs text-slate-500">
                          Sa consultation demande le droit « Pièces sensibles des sinistres ».
                        </p>
                      } @else {
                        <span class="text-sm text-slate-800">{{ doc.fileName }}</span>
                      }
                    </td>
                    <td class="text-sm text-slate-600">{{ doc.uploadedAt | dateTimeAgo }}</td>
                    <td class="text-right">
                      @if (!doc.isSensitive || canRevealSensitive()) {
                        <button
                          tas-button
                          iconButton
                          type="button"
                          disabled
                          title="Le téléchargement attend une livraison serveur."
                        >
                          <tas-icon iconName="feather:download" style="font-size:14px"></tas-icon>
                        </button>
                      }
                    </td>
                  </tr>
                </ng-template>
              </tas-table>
            </div>
          </div>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">
          Fermer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ClaimDetailDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);

  /** `PendingIntegrationEndpoints` n'est pas un service Angular : il s'instancie. */
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly data = inject<ClaimDetailDrawerData>(DIALOG_DATA);

  /**
   * Le serveur garde la relecture d'une pièce derrière `Ins.Claim.View`, pas derrière un
   * droit « pièces sensibles » : celui-ci avait été anticipé ici et n'existe pas dans
   * `Permissions.All`, donc le compilateur le refuse depuis la régénération du client.
   *
   * Le vrai verrou du serveur n'est pas la sensibilité de la pièce mais le VERDICT
   * ANTIVIRUS — `GET .../content` répond 409 sur tout ce qui n'est pas `Clean`. C'est
   * une meilleure information pour l'agent, et le bloc « Pièces du dossier » la portera
   * quand il sera câblé sur les vrais endpoints.
   */
  public readonly canRevealSensitive = this._permissions.can(PERMISSIONS.INS_CLAIM_VIEW);

  public readonly accept = CLAIM_DOCUMENT_ACCEPT;
  public readonly maxSizeMb = CLAIM_DOCUMENT_MAX_SIZE_MB;

  public readonly isLoading = signal(true);
  public readonly claim = signal<ClaimDetail | null>(null);
  public readonly complementFile = signal<File | null>(null);

  public readonly statusLabel = computed(() => claimStatusMeta(this.claim()?.status).label);
  public readonly statusSeverity = computed(
    () => claimStatusMeta(this.claim()?.status).severity,
  );

  /** Chronologie du plus récent au plus ancien : la dernière nouvelle d'abord. */
  public readonly timeline = computed<TimelineRow[]>(() =>
    [...(this.claim()?.timeline ?? [])]
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
      .map((entry, index) => ({
        ...entry,
        id: `${entry.at}-${index}`,
        label: claimStatusMeta(entry.status).label,
        severity: claimStatusMeta(entry.status).severity,
      })),
  );

  /** La pièce demandée est celle de l'entrée la plus récente qui en nomme une. */
  public readonly requestedDocumentLabel = computed(() => {
    if (this.claim()?.status !== 'ComplementRequired') return null;
    return this.timeline().find((e) => !!e.requestedDocumentLabel)?.requestedDocumentLabel ?? null;
  });

  public readonly settlementLabel = computed(() => {
    const c = this.claim();
    if (!c) return '—';
    return formatAmount(c.settlementAmount, c.settlementCurrency);
  });

  public readonly timelineConfig = computed<TableConfig>(() => ({
    property: 'id',
    pagination: {
      // La chronologie arrive entière avec le sinistre : pagination côté client.
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
      totalElements: this.timeline().length,
    },
  }));

  constructor() {
    this._pending.getClaim().subscribe((claim) => {
      this.claim.set(claim);
      this.isLoading.set(false);
    });
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public sendComplement(): void {
    // Aucun endpoint d'ajout de pièce : on ne prétend pas que le fichier est parti.
    this._snackbar.info(
      'Pièce non transmise',
      "L'envoi de pièces attend une livraison serveur. Transmettez-la par votre canal habituel.",
    );
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
