import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  LeadsApiService,
  LeadDto,
  ConsentDto,
} from '@sankore/crm-api';

export interface NurtureRecycleDrawerData {
  lead: LeadDto;
}

export type NurtureRecycleResult = 'nurtured' | 'recycled';

type Mode = 'nurture' | 'recycle';

const RECYCLE_REASON_OPTIONS = [
  { label: 'Pas prêt maintenant',             value: 'not_ready' },
  { label: 'Budget non disponible',           value: 'no_budget' },
  { label: 'Besoin reporté',                  value: 'deferred' },
  { label: 'Informations incomplètes',        value: 'incomplete_info' },
  { label: 'Contact perdu temporairement',    value: 'lost_contact' },
  { label: 'Autre',                           value: 'other' },
];

@Component({
  selector: 'nurture-recycle-drawer',
  imports: [
    FormsModule,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasIcon, TasSpinner, TasTag, Button,
    TasFormField, TasLabel, TasError, TasInput, TasSelect, TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>{{ mode() === 'nurture' ? 'Nurturing' : 'Recycler le lead' }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Lead context -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-sm font-medium text-slate-800">{{ leadDisplayName() }}</p>
          @if (data.lead.phoneNumber) {
            <p class="text-xs text-slate-400 mt-0.5">{{ data.lead.phoneNumber }}</p>
          }
        </div>

        <!-- Mode selector -->
        <div class="flex gap-2 mb-4">
          <button
            type="button"
            class="flex-1 p-3 rounded-lg border transition-all text-center"
            [class]="mode() === 'nurture'
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-slate-200 hover:border-slate-300'"
            (click)="mode.set('nurture')"
          >
            <div class="flex items-center justify-center gap-2">
              <tas-icon iconName="feather:heart" style="font-size:16px"
                [class]="mode() === 'nurture' ? 'text-primary' : 'text-slate-400'"></tas-icon>
              <span class="text-sm font-medium"
                [class]="mode() === 'nurture' ? 'text-primary' : 'text-slate-600'">Nurturing</span>
            </div>
            <p class="text-[10px] text-slate-400 mt-1">Maintenir le contact automatiquement</p>
          </button>
          <button
            type="button"
            class="flex-1 p-3 rounded-lg border transition-all text-center"
            [class]="mode() === 'recycle'
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-slate-200 hover:border-slate-300'"
            (click)="mode.set('recycle')"
          >
            <div class="flex items-center justify-center gap-2">
              <tas-icon iconName="feather:refresh-cw" style="font-size:16px"
                [class]="mode() === 'recycle' ? 'text-primary' : 'text-slate-400'"></tas-icon>
              <span class="text-sm font-medium"
                [class]="mode() === 'recycle' ? 'text-primary' : 'text-slate-600'">Recycler</span>
            </div>
            <p class="text-[10px] text-slate-400 mt-1">Reprendre plus tard avec un motif</p>
          </button>
        </div>

        <!-- ===== NURTURE MODE ===== -->
        @if (mode() === 'nurture') {
          <!-- Consent check -->
          @if (isCheckingConsent()) {
            <div class="flex items-center gap-2 py-4">
              <tas-spinner size="4" class="text-primary"></tas-spinner>
              <span class="text-xs text-slate-400">Vérification du consentement…</span>
            </div>
          } @else if (!hasNurturingConsent()) {
            <div class="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 mb-4">
              <tas-icon iconName="feather:shield-off" class="text-red-500 shrink-0 mt-0.5" style="font-size:16px"></tas-icon>
              <div>
                <p class="text-xs font-semibold text-red-800">Consentement requis</p>
                <p class="text-xs text-red-700 mt-0.5">
                  Le consentement de communication du prospect n'est pas enregistré ou a été retiré.
                  Vous devez d'abord enregistrer un consentement valide depuis l'onglet
                  <span class="font-medium">Consentement</span> de la fiche lead.
                </p>
                <p class="text-xs text-red-600 mt-1 font-medium">
                  L'action de nurturing est bloquée tant que le consentement n'est pas actif.
                </p>
              </div>
            </div>
          } @else {
            <div class="p-3 rounded-lg bg-green-50 border border-green-200 flex items-center gap-2 mb-4">
              <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:14px"></tas-icon>
              <p class="text-xs text-green-700">Consentement de communication actif.</p>
            </div>

            <p class="text-xs text-slate-500 mb-4">
              Le lead sera placé en séquence de nurturing automatique. Il recevra des communications
              personnalisées jusqu'à ce qu'il soit prêt à reprendre le processus commercial.
            </p>
          }
        }

        <!-- ===== RECYCLE MODE ===== -->
        @if (mode() === 'recycle') {
          <!-- Motif -->
          <tas-form-field>
            <tas-label>Motif du recyclage <span class="text-red-500">*</span></tas-label>
            <tas-select
              [options]="recycleReasonOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionnez un motif"
              [ngModel]="recycleReason()"
              (ngModelChange)="recycleReason.set($event)"
            ></tas-select>
            @if (submitted() && !recycleReason()) {
              <tas-error>Le motif est obligatoire.</tas-error>
            }
          </tas-form-field>

          @if (recycleReason() === 'other') {
            <div class="mt-3">
              <tas-form-field>
                <tas-label>Précisez <span class="text-red-500">*</span></tas-label>
                <textarea
                  tasInput
                  rows="2"
                  placeholder="Raison du recyclage…"
                  [ngModel]="recycleDetail()"
                  (ngModelChange)="recycleDetail.set($event)"
                ></textarea>
                @if (submitted() && recycleReason() === 'other' && !recycleDetail().trim()) {
                  <tas-error>Veuillez préciser le motif.</tas-error>
                }
              </tas-form-field>
            </div>
          }

          <!-- Reactivation date -->
          <div class="mt-3">
            <tas-form-field>
              <tas-label>Date cible de réactivation <span class="text-red-500">*</span></tas-label>
              <input
                tasInput
                type="date"
                [ngModel]="reactivationDate()"
                (ngModelChange)="reactivationDate.set($event)"
              />
              @if (submitted() && !reactivationDate()) {
                <tas-error>La date de réactivation est obligatoire.</tas-error>
              }
            </tas-form-field>
          </div>

          @if (reactivationDate()) {
            <div class="mt-2 p-2.5 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2">
              <tas-icon iconName="feather:calendar" class="text-blue-500" style="font-size:14px"></tas-icon>
              <p class="text-xs text-blue-700">
                Le lead sera marqué <span class="font-semibold">Recyclé</span> et une tâche de
                reprise sera visible à partir du <span class="font-medium">{{ reactivationDate() }}</span>.
              </p>
            </div>
          }
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            [color]="mode() === 'nurture' ? 'primary' : 'primary'"
            type="button"
            [disabled]="isSubmitting() || !canSubmit()"
            (click)="submit()"
          >
            @if (isSubmitting()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
            {{ mode() === 'nurture' ? 'Placer en nurturing' : 'Recycler' }}
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class NurtureRecycleDrawer implements OnInit {
  public readonly data: NurtureRecycleDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<NurtureRecycleResult | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly recycleReasonOptions = RECYCLE_REASON_OPTIONS;

  public mode = signal<Mode>('nurture');
  public isSubmitting = signal(false);
  public submitted = signal(false);

  // Nurture
  public isCheckingConsent = signal(true);
  public hasNurturingConsent = signal(false);

  // Recycle
  public recycleReason = signal('');
  public recycleDetail = signal('');
  public reactivationDate = signal('');

  public readonly canSubmit = computed(() => {
    if (this.mode() === 'nurture') {
      return this.hasNurturingConsent() && !this.isCheckingConsent();
    }
    if (!this.recycleReason()) return false;
    if (this.recycleReason() === 'other' && !this.recycleDetail().trim()) return false;
    if (!this.reactivationDate()) return false;
    return true;
  });

  ngOnInit(): void {
    this._checkConsent();
  }

  public leadDisplayName(): string {
    const l = this.data.lead;
    if (l.fullName) return l.fullName;
    const parts = [l.firstName, l.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : l.phoneNumber ?? l.email ?? 'Lead';
  }

  public submit(): void {
    this.submitted.set(true);
    if (!this.canSubmit()) return;

    this.isSubmitting.set(true);
    const leadId = this.data.lead.id!;

    if (this.mode() === 'nurture') {
      this._leadsApi.nurtureLead(leadId).pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de placer le lead en nurturing.');
          this.isSubmitting.set(false);
          return EMPTY;
        }),
      ).subscribe(() => {
        this._snackbar.success('Lead en nurturing', 'Le lead recevra des communications automatiques.');
        this._dialogRef.close('nurtured');
      });
    } else {
      const reasonLabel = this.recycleReason() === 'other'
        ? this.recycleDetail().trim()
        : RECYCLE_REASON_OPTIONS.find((r) => r.value === this.recycleReason())?.label ?? '';

      this._leadsApi.recycleLead(leadId, {}).pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de recycler le lead.');
          this.isSubmitting.set(false);
          return EMPTY;
        }),
      ).subscribe(() => {
        this._snackbar.success(
          'Lead recyclé',
          `Réactivation prévue le ${this.reactivationDate()}. Motif : ${reasonLabel}`,
        );
        this._dialogRef.close('recycled');
      });
    }
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _checkConsent(): void {
    this.isCheckingConsent.set(true);
    this._leadsApi.listConsents(this.data.lead.id!).pipe(
      catchError(() => of([] as ConsentDto[])),
    ).subscribe((consents) => {
      const hasConsent = (consents ?? []).some(
        (c) => (c.type === 'Communication' || c.type === 'Marketing' || c.type === 'DataCollection')
          && c.status === 'Granted'
          && !c.withdrawnAt,
      );
      this.hasNurturingConsent.set(hasConsent);
      this.isCheckingConsent.set(false);
    });
  }
}
