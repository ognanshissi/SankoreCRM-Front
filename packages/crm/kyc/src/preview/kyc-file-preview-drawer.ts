import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { catchError, EMPTY, Observable, of, switchMap } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { KycApprovalCircuitDto, KycFileDto } from '@sankore/crm-api';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  kycApprovalLevelLabel,
  kycScoreBarClasses,
  kycVigilanceMeta,
} from '../data-access/kyc-referential';
import { KycStatusBadge } from '../ui/kyc-status-badge';

/**
 * Ce que l'appelant connaît du dossier.
 *
 * Les deux formes sont acceptées parce qu'un appelant extérieur — une instance de workflow, par
 * exemple — ne sait pas toujours laquelle il détient : `entityId` peut désigner le dossier comme le
 * client. Le drawer résout l'une puis l'autre plutôt que d'imposer le choix à l'appelant.
 */
export interface KycFilePreviewDrawerData {
  kycFileId?: string | null;
  customerId?: string | null;
  /** Contexte affiché en tête, pour rappeler d'où vient la consultation. */
  context?: string | null;
}

@Component({
  selector: 'kyc-file-preview-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    KycStatusBadge,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Dossier KYC</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex items-center justify-center gap-3 py-16">
            <tas-spinner size="6" class="text-primary"></tas-spinner>
            <span class="text-sm text-slate-500">Lecture du dossier…</span>
          </div>
        } @else if (loadError()) {
          <!--
            Distinct d'un dossier vide : une panne qui s'afficherait « aucun dossier » ferait
            valider à l'aveugle en croyant qu'il n'y a rien à consulter.
          -->
          <div class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3" role="alert">
            <tas-icon
              iconName="feather:alert-octagon"
              class="mt-0.5 shrink-0 text-red-600"
              style="font-size:14px"
            ></tas-icon>
            <div class="text-sm">
              <p class="font-medium text-slate-800">Dossier illisible</p>
              <p class="text-xs text-slate-500 mt-0.5">{{ loadError() }}</p>
              <p class="text-xs text-slate-500 mt-1">
                Ne validez pas sans l'avoir consulté : ouvrez la fiche complète ou réessayez.
              </p>
            </div>
          </div>
        } @else if (file(); as kycFile) {
          <div class="flex flex-col gap-4">
            @if (data.context) {
              <p class="text-xs text-slate-400">{{ data.context }}</p>
            }

            <div class="rounded-lg border border-slate-200 p-3">
              <div class="flex flex-wrap items-center gap-2">
                <kyc-status-badge [status]="kycFile.status"></kyc-status-badge>
                <tas-tag [severity]="vigilanceSeverity()">{{ vigilanceLabel() }}</tas-tag>
                @if (kycFile.duplicateSuspected) {
                  <tas-tag severity="error">Doublon suspecté</tas-tag>
                }
              </div>

              <p class="mt-2 text-sm font-medium text-slate-800">{{ customerName() || '—' }}</p>
              <p class="font-mono text-xs text-slate-400 break-all">{{ kycFile.id }}</p>
            </div>

            <!-- Score : le chiffre porte l'information, la barre ne fait que la situer -->
            <div class="rounded-lg border border-slate-200 p-3">
              <p class="text-xs font-semibold text-slate-600 mb-2">Score de confiance</p>
              @if (score() !== null) {
                <div class="flex items-center gap-2">
                  <span class="text-sm tabular-nums text-slate-700 w-8">{{ score() }}</span>
                  <div
                    class="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden"
                    role="progressbar"
                    [attr.aria-valuenow]="score()"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    [attr.aria-label]="'Score de confiance : ' + score() + ' sur 100'"
                  >
                    <div class="h-full rounded-full" [class]="scoreBarClasses()" [style.width.%]="score()"></div>
                  </div>
                </div>
              } @else {
                <p class="text-sm text-slate-400">Non noté</p>
              }
            </div>

            <!-- Circuit : qui a signé, et qui doit encore se prononcer -->
            <div class="rounded-lg border border-slate-200 p-3">
              <p class="text-xs font-semibold text-slate-600 mb-2">Circuit de validation</p>
              @if (circuitFailed()) {
                <p class="text-xs text-slate-500">Le circuit n'a pas pu être lu.</p>
              } @else if (steps().length === 0) {
                <p class="text-xs text-slate-500">Aucune étape enregistrée pour l'instant.</p>
              } @else {
                <ul class="divide-y divide-slate-100">
                  @for (step of steps(); track step.level) {
                    <li class="flex items-center justify-between gap-2 py-2">
                      <span class="text-sm text-slate-700">{{ levelLabel(step.level) }}</span>
                      @if (step.decision) {
                        <tas-tag [severity]="decisionSeverity(step.decision)">{{ step.decision }}</tas-tag>
                      } @else {
                        <span class="text-xs text-slate-400">En attente</span>
                      }
                    </li>
                  }
                </ul>
              }
            </div>

            <div class="rounded-lg border border-slate-200 p-3 text-xs text-slate-500">
              Dernière mise à jour :
              {{ kycFile.updatedAt ? (kycFile.updatedAt | date: 'dd/MM/yyyy à HH:mm') : '—' }}
            </div>

            <!--
              Le drawer est un aperçu : pièces, champs lus et historique vivent sur la fiche. Le lien
              est donc une sortie assumée, pas un pis-aller.
            -->
            <p class="text-xs text-slate-400">
              Pièces, champs relus et historique complet sont sur la fiche du dossier.
            </p>
          </div>
        } @else {
          <div class="flex flex-col items-center gap-2 py-16 text-center">
            <tas-icon iconName="feather:folder" class="text-slate-300" style="font-size:24px"></tas-icon>
            <p class="text-sm text-slate-600">Aucun dossier KYC rattaché.</p>
            <p class="text-xs text-slate-500">
              Cette instance ne pointe sur aucun dossier lisible : vérifiez son entité.
            </p>
          </div>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Fermer</button>
        @if (file()?.id) {
          <button tas-raised-button color="primary" type="button" (click)="openFullFile()">
            <tas-icon iconName="feather:external-link" style="font-size:14px"></tas-icon>
            Ouvrir la fiche complète
          </button>
        }
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class KycFilePreviewDrawer {
  public readonly data: KycFilePreviewDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _facade = inject(KycFacadeService);
  private readonly _router = inject(Router);

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly file = signal<KycFileDto | null>(null);
  public readonly customerName = signal('');
  public readonly circuit = signal<KycApprovalCircuitDto | null>(null);
  public readonly circuitFailed = signal(false);

  public readonly levelLabel = kycApprovalLevelLabel;

  public readonly steps = computed(() => this.circuit()?.steps ?? []);
  public readonly score = computed(() => this.file()?.confidenceScore ?? null);
  public readonly scoreBarClasses = computed(() => kycScoreBarClasses(this.score()));
  public readonly vigilanceLabel = computed(() => kycVigilanceMeta(this.file()?.vigilanceLevel).label);
  public readonly vigilanceSeverity = computed<Severity>(
    () => kycVigilanceMeta(this.file()?.vigilanceLevel).severity,
  );

  constructor() {
    this._load();
  }

  public decisionSeverity(decision: string | null | undefined): Severity {
    switch (decision) {
      case 'Approved':
        return 'success';
      case 'Rejected':
        return 'error';
      case 'ComplementRequired':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  public openFullFile(): void {
    const id = this.file()?.id;
    if (!id) return;
    this._dialogRef.close(true);
    this._router.navigate(['/kyc', id]);
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  /**
   * Résolution du dossier. `kycFileId` d'abord quand il est connu, `customerId` ensuite.
   *
   * Un appelant qui ne détient qu'un identifiant d'entité peut le passer dans les deux champs : la
   * lecture par dossier est tentée, et un 404 bascule sur la lecture par client. C'est ce qui
   * permet de brancher le drawer sur un `entityId` de workflow sans savoir ce qu'il désigne.
   */
  private _load(): void {
    const byFile = this.data.kycFileId?.trim();
    const byCustomer = this.data.customerId?.trim();

    if (!byFile && !byCustomer) {
      this.isLoading.set(false);
      return;
    }

    const lookup: Observable<KycFileDto | null> = byFile
      ? this._facade.getFile(byFile).pipe(
          catchError((error: HttpErrorResponse) => {
            if (error.status === 404 && byCustomer) {
              return this._facade.getFileByCustomer(byCustomer).pipe(catchError(() => of(null)));
            }
            if (error.status === 404) return of(null);
            throw error;
          }),
        )
      : this._facade.getFileByCustomer(byCustomer as string).pipe(
          catchError((error: HttpErrorResponse) => {
            if (error.status === 404) return of(null);
            throw error;
          }),
        );

    lookup
      .pipe(
        catchError(() => {
          this.loadError.set("Le dossier n'a pas pu être lu. Réessayez dans un instant.");
          this.isLoading.set(false);
          return EMPTY;
        }),
        switchMap((kycFile) => {
          this.file.set(kycFile);
          this.isLoading.set(false);
          if (!kycFile?.id) return EMPTY;
          this._loadCustomerName(kycFile.customerId);
          // Le circuit est un confort : son absence ne doit pas vider l'aperçu.
          return this._facade.getApprovalCircuit(kycFile.id).pipe(
            catchError(() => {
              this.circuitFailed.set(true);
              return EMPTY;
            }),
          );
        }),
      )
      .subscribe((circuit) => this.circuit.set(circuit));
  }

  private _loadCustomerName(customerId: string | null | undefined): void {
    if (!customerId) return;
    this._facade
      .getCustomerName(customerId)
      .pipe(catchError(() => of('')))
      .subscribe((name) => this.customerName.set(name));
  }
}
