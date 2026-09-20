import { Component, computed, inject, signal, DestroyRef } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, filter, map, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag, Severity } from '@talisoft/ui/tag';
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
import { LeadsApiService, DuplicateMatchResult } from '@sankore/crm-api';
import { DuplicateWarningBanner, AuthenticationService } from '@sankore/crm/common';
import {
  OpportunityDto,
  OpportunityStore,
  STAGE_OPTIONS,
} from './opportunity.model';

export interface CreateOpportunityDrawerData {
  leadId: string;
  leadName: string;
}

const CURRENCY_OPTIONS = [
  { label: 'XOF', value: 'XOF' },
  { label: 'EUR', value: 'EUR' },
  { label: 'USD', value: 'USD' },
];

@Component({
  selector: 'create-opportunity-drawer',
  imports: [
    FormsModule,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasIcon, TasSpinner, TasTag, Button,
    TasFormField, TasLabel, TasError, TasInput, TasSelect,
    TasTitle, DuplicateWarningBanner,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Nouvelle opportunité</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Lead context -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-sm font-medium text-slate-800">Lead : {{ data.leadName }}</p>
        </div>

        <!-- Client search (reuses dedup from M13-002) -->
        <div class="mb-4">
          <tas-form-field>
            <tas-label>Recherche client existant</tas-label>
            <input
              tasInput
              type="text"
              placeholder="Téléphone ou nom du client..."
              [ngModel]="clientSearch()"
              (ngModelChange)="clientSearch.set($event)"
            />
          </tas-form-field>
          @if (isCheckingDuplicates()) {
            <div class="mt-1 flex items-center gap-1">
              <tas-spinner size="3" class="text-primary"></tas-spinner>
              <span class="text-xs text-slate-400">Recherche en cours…</span>
            </div>
          }
          <duplicate-warning-banner
            [duplicates]="duplicates()"
            (viewDuplicate)="onViewDuplicate($event)"
          ></duplicate-warning-banner>
        </div>

        <!-- Title -->
        <tas-form-field>
          <tas-label>Titre <span class="text-red-500">*</span></tas-label>
          <input
            tasInput
            type="text"
            placeholder="Ex : Prêt immobilier — M. Diallo"
            [ngModel]="title()"
            (ngModelChange)="title.set($event)"
          />
          @if (submitted() && !title().trim()) {
            <tas-error>Le titre est obligatoire.</tas-error>
          }
        </tas-form-field>

        <!-- Stage -->
        <div class="mt-3">
          <tas-form-field>
            <tas-label>Étape</tas-label>
            <tas-select
              [options]="stageOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Sélectionnez une étape"
              [ngModel]="stage()"
              (ngModelChange)="stage.set($event)"
            ></tas-select>
          </tas-form-field>
        </div>

        <!-- Amount + Currency -->
        <div class="mt-3 grid grid-cols-3 gap-2">
          <div class="col-span-2">
            <tas-form-field>
              <tas-label>Montant</tas-label>
              <input
                tasInput
                type="number"
                placeholder="Ex : 5000000"
                min="0"
                [ngModel]="amount()"
                (ngModelChange)="amount.set($event)"
              />
            </tas-form-field>
          </div>
          <tas-form-field>
            <tas-label>Devise</tas-label>
            <tas-select
              [options]="currencyOptions"
              optionLabel="label"
              optionValue="value"
              [ngModel]="currency()"
              (ngModelChange)="currency.set($event)"
            ></tas-select>
          </tas-form-field>
        </div>

        <!-- Amount preview -->
        @if (amount()) {
          <div class="mt-2 p-2 rounded bg-slate-50 text-xs text-slate-600">
            Montant : <span class="font-semibold">{{ formattedAmount() }}</span>
          </div>
        }

        <!-- Probability -->
        <div class="mt-3">
          <tas-form-field>
            <tas-label>Probabilité (%)</tas-label>
            <input
              tasInput
              type="number"
              min="0"
              max="100"
              placeholder="Ex : 60"
              [ngModel]="probability()"
              (ngModelChange)="probability.set($event)"
            />
          </tas-form-field>
        </div>

        <!-- Expected close -->
        <div class="mt-3">
          <tas-form-field>
            <tas-label>Date de clôture prévue</tas-label>
            <input
              tasInput
              type="date"
              [ngModel]="expectedCloseDate()"
              (ngModelChange)="expectedCloseDate.set($event)"
            />
          </tas-form-field>
        </div>

        <!-- Description -->
        <div class="mt-3">
          <tas-form-field>
            <tas-label>Description</tas-label>
            <textarea
              tasInput
              rows="3"
              placeholder="Détails de l'opportunité…"
              [ngModel]="description()"
              (ngModelChange)="description.set($event)"
            ></textarea>
          </tas-form-field>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="isSubmitting()"
            (click)="submit()"
          >
            @if (isSubmitting()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
            Créer l'opportunité
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CreateOpportunityDrawer {
  public readonly data: CreateOpportunityDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<OpportunityDto | false>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _router = inject(Router);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly stageOptions = STAGE_OPTIONS;
  public readonly currencyOptions = CURRENCY_OPTIONS;

  public title = signal('');
  public description = signal('');
  public stage = signal('Prospection');
  public amount = signal<number | null>(null);
  public currency = signal('XOF');
  public probability = signal<number | null>(null);
  public expectedCloseDate = signal('');
  public isSubmitting = signal(false);
  public submitted = signal(false);

  // Dedup search
  public clientSearch = signal('');
  public duplicates = signal<DuplicateMatchResult[]>([]);
  public isCheckingDuplicates = signal(false);

  public readonly formattedAmount = computed(() => {
    const amt = this.amount();
    const cur = this.currency();
    if (!amt) return '';
    try {
      return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur || 'XOF' }).format(amt);
    } catch {
      return `${amt.toLocaleString('fr-FR')} ${cur}`;
    }
  });

  constructor() {
    // Duplicate check on client search (same pattern as create-lead / M13-002)
    toObservable(this.clientSearch).pipe(
      takeUntilDestroyed(this._destroyRef),
      map((q) => (q ?? '').replace(/[^0-9+a-zA-ZÀ-ÿ ]/g, '').trim()),
      filter((q) => q.length >= 3),
      debounceTime(400),
      distinctUntilChanged(),
      tap(() => this.isCheckingDuplicates.set(true)),
      switchMap((q) => {
        const isPhone = /^\+?\d/.test(q);
        return this._leadsApi.findLeadDuplicates(
          isPhone ? q : undefined,
          undefined, undefined, undefined,
          isPhone ? undefined : q,
        ).pipe(catchError(() => of([] as DuplicateMatchResult[])));
      }),
    ).subscribe((results) => {
      this.duplicates.set(results);
      this.isCheckingDuplicates.set(false);
    });
  }

  public onViewDuplicate(leadId: string): void {
    this._dialogRef.close(false);
    this._router.navigate(['/leads', leadId]);
  }

  public submit(): void {
    this.submitted.set(true);
    if (!this.title().trim()) return;

    this.isSubmitting.set(true);

    const opp = OpportunityStore.create({
      leadId: this.data.leadId,
      title: this.title().trim(),
      description: this.description().trim() || null,
      value: this.amount() ? { amount: this.amount()!, currency: this.currency() || 'XOF' } : undefined,
      probability: this.probability() ?? undefined,
      stage: this.stage() as any,
      expectedCloseDate: this.expectedCloseDate() || null,
    });

    this.isSubmitting.set(false);
    this._snackbar.success('Opportunité créée', `« ${opp.title} » ajoutée.`);
    this._dialogRef.close(opp);
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
