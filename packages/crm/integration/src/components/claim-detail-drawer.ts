import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
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
import { TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { ClaimDocumentDto, ClaimDto } from '@sankore/crm-api';
import { PERMISSIONS, PermissionsService } from '@sankore/crm/common';
import {
  CLAIM_DOCUMENT_ACCEPT,
  CLAIM_DOCUMENT_MAX_SIZE_MB,
  claimStatusMeta,
  formatAmount,
  formatContractDate,
  scanStatusMeta,
} from '../data-access/integration-referential';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../data-access/integration-facade.service';

export interface ClaimDetailDrawerData {
  claimId: string;
  productName: string;
}

/** Un jalon du dossier : un instant que le serveur tient vraiment, et son libellé. */
interface Milestone {
  id: string;
  at: string;
  label: string;
  severity: Severity;
}

/** Une pièce, enrichie de la lecture de son verdict antivirus. */
interface DocumentRow {
  /** Remonté à plat : `identifierField` de la table du kit ne suit pas un chemin imbriqué. */
  id: string;
  doc: ClaimDocumentDto;
  scanLabel: string;
  scanSeverity: Severity;
  scanHint: string | null;
}

/**
 * Détail et suivi d'un sinistre, et les pièces de son dossier — ASS-09.
 *
 * **Il n'y a pas de chronologie, et c'est délibéré.** Cet écran en affichait une,
 * écrite avant la livraison du lot : le serveur ne tient AUCUN historique de statut par
 * sinistre — `ins_claim` porte le statut courant et une poignée d'instants
 * (`declaredAt`, `statusChangedAt`, `indemnityPaidAt`, `lastSyncedAt`). Fabriquer une
 * frise à partir d'un seul statut aurait affiché une histoire que personne n'a
 * enregistrée. Les jalons réels sont montrés à la place, et ils sont peu nombreux.
 *
 * L'enregistrement horodaté opposable que demande le règlement 01/CIMA/2024 existe,
 * mais dans `audit.entries` — immuable au niveau de la base — et pas dans une table
 * que cet écran peut lire. Une vue d'audit serait son propre écran.
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
          <tas-alert type="error">
            <p class="text-sm font-medium">Ce dossier est introuvable</p>
            <p class="text-xs mt-1">
              Le sinistre « {{ data.productName }} » n'existe plus, ou n'appartient pas à votre
              périmètre. Rechargez la liste des sinistres.
            </p>
          </tas-alert>
        } @else {
          <div class="flex flex-col gap-5">
            <!-- Résumé : ce qu'un agent lit d'abord -->
            <div class="flex flex-wrap items-start gap-x-8 gap-y-3">
              <div>
                <p class="text-xs text-slate-500">Statut</p>
                <tas-tag class="mt-1" [severity]="statusSeverity()">{{ statusLabel() }}</tas-tag>
              </div>
              <div>
                <p class="text-xs text-slate-500">Numéro du dossier</p>
                <p class="mt-1 font-mono text-xs text-slate-800">
                  {{ claim()!.claimNumber || claim()!.externalClaimId || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-slate-500">Nature</p>
                <p class="mt-1 text-sm text-slate-800">{{ claim()!.nature }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-500">Survenu le</p>
                <p class="mt-1 text-sm text-slate-800">{{ formatDate(claim()!.occurredOn) }}</p>
              </div>
            </div>

            <!--
              La déclaration n'est pas encore partie chez l'assureur : tant qu'il n'a pas
              rendu sa référence, aucune pièce ne peut lui être jointe — le serveur a besoin
              de son identifiant de dossier pour les rattacher.
            -->
            @if (!claim()!.externalClaimId) {
              <tas-alert type="info">
                <p class="text-sm font-medium">L'assureur n'a pas encore accusé la déclaration</p>
                <p class="text-xs mt-1">
                  Les pièces peuvent être déposées dès maintenant ; elles partiront
                  automatiquement dès que l'assureur aura rendu sa référence de dossier.
                </p>
              </tas-alert>
            }

            <!-- Indemnisation créditée sur le compte du client -->
            @if (claim()!.indemnityAmount !== null) {
              <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p class="text-sm font-medium text-slate-800">Indemnisation</p>
                <p class="mt-1 text-lg font-semibold text-slate-800 tabular-nums">
                  {{ settlementLabel() }}
                </p>
                @if (claim()!.indemnityPaidAt) {
                  <p class="mt-0.5 text-xs text-slate-500">
                    Créditée le {{ formatDate(claim()!.indemnityPaidAt) }}
                    @if (claim()!.indemnityCbsReference) {
                      — référence {{ claim()!.indemnityCbsReference }}
                    }
                  </p>
                } @else {
                  <!--
                    L'assureur a annoncé un montant ; l'argent n'est pas arrivé. La
                    distinction compte : un agent ne doit pas dire à un client qu'il a été
                    payé parce que l'assureur l'a chiffré.
                  -->
                  <p class="mt-0.5 text-xs text-slate-500">
                    Montant annoncé par l'assureur. Le versement n'a pas encore été rapproché.
                  </p>
                }
              </div>
            }

            <!-- Pièces demandées par l'assureur : la seule action de l'agent ici -->
            @if (claim()!.missingDocuments; as requested) {
              <div class="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div>
                  <p class="text-sm font-medium text-slate-800">L'assureur demande des pièces</p>
                  <p class="mt-1 text-xs text-slate-700">{{ requested }}</p>
                  <p class="mt-1 text-xs text-slate-500">
                    PDF, JPG, PNG ou HEIC, {{ maxSizeMb }} Mo au plus. La pièce est analysée par
                    l'antivirus avant de partir chez l'assureur.
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
                    [disabled]="!complementFile() || isUploading()"
                    (click)="sendComplement()"
                  >
                    <tas-icon iconName="feather:upload" style="font-size:14px"></tas-icon>
                    Envoyer la pièce
                  </button>
                </div>
              </div>
            }

            <!-- Jalons : les instants que le serveur tient, pas une frise reconstituée -->
            <div>
              <p class="mb-2 text-sm font-medium text-slate-800">Jalons du dossier</p>
              <div class="flex flex-col gap-2">
                @for (step of milestones(); track step.id) {
                  <div class="flex items-center gap-3">
                    <tas-tag [severity]="step.severity">{{ step.label }}</tas-tag>
                    <span class="text-xs text-slate-500">{{ step.at | dateTimeAgo }}</span>
                  </div>
                }
              </div>
            </div>

            <!-- Pièces du dossier -->
            <div>
              <p class="mb-2 text-sm font-medium text-slate-800">Pièces du dossier</p>
              <tas-table [data]="documentRows()" identifierField="id">
                <ng-template #header>
                  <tr>
                    <th>Pièce</th>
                    <th>Analyse</th>
                    <th>Transmise</th>
                    <th class="text-right"></th>
                  </tr>
                </ng-template>
                <ng-template #body let-row>
                  <tr>
                    <td class="py-3">
                      <p class="text-sm text-slate-800">{{ row.doc.fileName }}</p>
                      <p class="text-xs text-slate-500">
                        {{ row.doc.documentKind }} — {{ row.doc.uploadedAt | dateTimeAgo }}
                        @if (row.doc.requestedByInsurer) {
                          — demandée par l'assureur
                        }
                      </p>
                    </td>
                    <td>
                      <tas-tag [severity]="row.scanSeverity">{{ row.scanLabel }}</tas-tag>
                      @if (row.scanHint) {
                        <p class="mt-1 max-w-xs text-xs text-slate-500">{{ row.scanHint }}</p>
                      }
                    </td>
                    <td class="text-sm text-slate-600">
                      @if (row.doc.transmittedAt) {
                        {{ row.doc.transmittedAt | dateTimeAgo }}
                      } @else if (row.doc.requestedByInsurer) {
                        <span class="text-xs text-slate-500">en attente</span>
                      } @else {
                        <!--
                          Le serveur ne pousse pas une pièce que personne n'a réclamée sur un
                          dossier à l'étude : dire « en attente » ici ferait croire à un envoi
                          qui ne viendra pas.
                        -->
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </td>
                    <td class="text-right">
                      <!--
                        Le téléchargement n'est offert que sur une pièce dont l'antivirus a
                        rendu un verdict propre : le serveur répond 409 sur tout le reste, et
                        proposer le bouton ferait cliquer l'agent sur une erreur.
                      -->
                      @if (row.doc.isTransmittable && canView()) {
                        <button
                          tas-button
                          iconButton
                          type="button"
                          title="Télécharger la pièce"
                          (click)="download(row.doc)"
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
        <button tas-button type="button" (click)="close()">Fermer</button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ClaimDetailDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _integration = inject(IntegrationFacadeService);

  public readonly data = inject<ClaimDetailDrawerData>(DIALOG_DATA);

  /**
   * Le serveur garde la relecture d'une pièce derrière `Ins.Claim.View`, et pas derrière
   * un droit « pièces sensibles » : celui-là avait été anticipé ici et n'existe pas dans
   * `Permissions.All`.
   */
  public readonly canView = this._permissions.can(PERMISSIONS.INS_CLAIM_VIEW);

  public readonly accept = CLAIM_DOCUMENT_ACCEPT;
  public readonly maxSizeMb = CLAIM_DOCUMENT_MAX_SIZE_MB;

  public readonly isLoading = signal(true);
  public readonly isUploading = signal(false);
  public readonly claim = signal<ClaimDto | null>(null);
  public readonly documents = signal<ClaimDocumentDto[]>([]);
  public readonly complementFile = signal<File | null>(null);

  public readonly statusLabel = computed(() => claimStatusMeta(this.claim()?.status).label);
  public readonly statusSeverity = computed(
    () => claimStatusMeta(this.claim()?.status).severity,
  );

  public readonly settlementLabel = computed(() => {
    const c = this.claim();
    if (!c) return '—';
    return formatAmount(c.indemnityAmount ?? null, c.indemnityCurrency ?? null);
  });

  /**
   * Les instants que `ins_claim` porte réellement, du plus récent au plus ancien.
   * Rien n'est déduit : un jalon absent ne s'affiche pas.
   */
  public readonly milestones = computed<Milestone[]>(() => {
    const c = this.claim();
    if (!c) return [];

    // Chaque champ du DTO généré est optionnel — le générateur ne reporte pas la
    // non-nullabilité du serveur — donc un jalon sans instant est simplement omis plutôt
    // que rendu avec une date vide.
    const steps: Milestone[] = [];

    if (c.declaredAt) {
      steps.push({ id: 'declared', at: c.declaredAt, label: 'Déclaré', severity: 'info' });
    }

    // Le changement de statut n'est un jalon distinct que s'il a bougé depuis la
    // déclaration : sinon il répète la même date sous un autre nom.
    if (c.statusChangedAt && c.statusChangedAt !== c.declaredAt) {
      steps.push({
        id: 'status',
        at: c.statusChangedAt,
        label: claimStatusMeta(c.status).label,
        severity: claimStatusMeta(c.status).severity,
      });
    }

    if (c.indemnityPaidAt) {
      steps.push({
        id: 'indemnity',
        at: c.indemnityPaidAt,
        label: 'Indemnisation créditée',
        severity: 'success',
      });
    }

    if (c.lastSyncedAt) {
      steps.push({
        id: 'synced',
        at: c.lastSyncedAt,
        label: "Dernière nouvelle de l'assureur",
        severity: 'neutral',
      });
    }

    return steps.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  });

  public readonly documentRows = computed<DocumentRow[]>(() =>
    [...this.documents()]
      .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''))
      .map((doc) => {
        const scan = scanStatusMeta(doc.scanStatus);
        return {
          id: doc.id ?? doc.sha256 ?? doc.fileName ?? '',
          doc,
          scanLabel: scan.label,
          scanSeverity: scan.severity,
          scanHint: scan.hint,
        };
      }),
  );

  constructor() {
    void this._load();
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public async sendComplement(): Promise<void> {
    const file = this.complementFile();
    const claim = this.claim();
    if (!file || !claim) return;

    this.isUploading.set(true);

    try {
      await firstValueFrom(
        this._integration.uploadClaimDocument(
          claim.id!,
          // La nature de la pièce est DÉDUITE et non demandée : le serveur la stocke en
          // texte libre, et un agent qui répond à une demande de l'assureur n'a pas à
          // classer le fichier pour qu'il parte. `requestedByInsurer` est ce qui compte,
          // parce que c'est ce qui déclenche la transmission automatique.
          'Complement',
          file,
          true,
        ),
      );

      this.complementFile.set(null);

      this._snackbar.success(
        'Pièce déposée',
        "Elle est chiffrée et analysée par l'antivirus avant de partir chez l'assureur.",
      );

      await this._load();
    } catch (error) {
      this._snackbar.error(
        'Pièce non déposée',
        integrationErrorMessage(error as HttpErrorResponse, "La pièce n'a pas pu être déposée."),
      );
    } finally {
      this.isUploading.set(false);
    }
  }

  public async download(doc: ClaimDocumentDto): Promise<void> {
    const claim = this.claim();
    if (!claim) return;

    try {
      const blob = await firstValueFrom(
        this._integration.downloadClaimDocument(claim.id!, doc.id!),
      );

      // Un object URL plutôt qu'un lien direct : la route exige le jeton porteur, donc
      // une balise <a href> ouvrirait un 401.
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = doc.fileName || 'piece';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this._snackbar.error(
        'Téléchargement impossible',
        integrationErrorMessage(error as HttpErrorResponse, "La pièce n'a pas pu être téléchargée."),
      );
    }
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private async _load(): Promise<void> {
    this.isLoading.set(true);

    try {
      const claim = await firstValueFrom(this._integration.getClaim(this.data.claimId));
      this.claim.set(claim);

      // Les pièces sont un second appel : le détail du dossier et son registre de pièces
      // sont deux endpoints, et le dossier reste lisible si le registre échoue.
      try {
        this.documents.set(
          await firstValueFrom(this._integration.listClaimDocuments(this.data.claimId)),
        );
      } catch {
        this.documents.set([]);
      }
    } catch {
      this.claim.set(null);
    } finally {
      this.isLoading.set(false);
    }
  }
}
