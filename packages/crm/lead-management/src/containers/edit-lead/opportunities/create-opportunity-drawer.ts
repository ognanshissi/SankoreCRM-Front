import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { FormFieldReferenceTargetEnum, LeadDto, OpportunitiesApiService } from '@sankore/crm-api';
import { currencyUnit, EntityFormReferences, projectCreationRules, projectSaveErrorMessage, TenantProvider } from '@sankore/crm/common';
import { amountText, parseAmount } from '../lead-view.models';

export interface CreateOpportunityDrawerData {
  lead: LeadDto;
}

/** Le produit vaut son LIBELLÉ : c'est ce que la clôture résout contre le catalogue. */
class CreateOpportunityFormModel {
  public title!: string;
  public description!: string;
  public product!: string;
  public amount!: string;
  public expectedCloseDate!: string;

  public static fromLead(lead: LeadDto, productLabel: string): CreateOpportunityFormModel {
    const m = new CreateOpportunityFormModel();
    m.title = '';
    // Ce que le prospect a dit, tel quel : c'est la « demande du prospect » de la carte.
    m.description = lead.comment?.trim() ?? '';
    m.product = productLabel;
    m.amount = amountText(lead.desiredAmount?.amount);
    m.expectedCloseDate = '';
    return m;
  }
}

/** Création d'une opportunité depuis la fiche lead. L'étape de départ est fixée par le serveur. */
@Component({
  selector: 'create-opportunity-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasDatePicker,
    TasSelect,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Nouveau projet</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-4">
          <tas-form-field>
            <tas-label>Titre <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Ex. Crédit pour un chantier à Daloa" [formField]="formSchema.title" />
            @if (formSchema.title().touched() && formSchema.title().invalid()) {
              <tas-error>{{ formSchema.title().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Besoin exprimé</tas-label>
            <textarea tasInput rows="3" placeholder="Ce que le prospect a demandé, avec ses mots" [formField]="formSchema.description"></textarea>
            @if (formSchema.description().touched() && formSchema.description().invalid()) {
              <tas-error>{{ formSchema.description().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Produit</tas-label>
            <tas-select [options]="productOptions()" placeholder="À préciser" [formField]="formSchema.product"></tas-select>
            <tas-hint>Laissez « À préciser » si le besoin n'est pas encore rattaché à un produit.</tas-hint>
          </tas-form-field>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <tas-form-field>
              <tas-label>{{ rules.amountLabel() }} ({{ currencyUnit(currency()) }})</tas-label>
              <input tasInput type="text" inputmode="numeric" placeholder="Ex. 5 000 000" [formField]="formSchema.amount" />
              @if (formSchema.amount().touched() && formSchema.amount().invalid()) {
                <tas-error>{{ formSchema.amount().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
            @if (rules.tracksForecast()) {
              <div>
                <tas-date-picker mode="date" [formField]="formSchema.expectedCloseDate">
                  {{ rules.criticalCloseDate() ? 'Date limite de clôture' : 'Clôture prévue' }}
                  @if (rules.criticalCloseDate()) { <span class="text-functional-error">*</span> }
                </tas-date-picker>
                @if (formSchema.expectedCloseDate().touched() && formSchema.expectedCloseDate().invalid()) {
                  <tas-error>{{ formSchema.expectedCloseDate().errors()[0].message }}</tas-error>
                } @else if (rules.criticalCloseDate()) {
                  <tas-hint>Une échéance pour ce produit : au-delà, l'accord ne sert plus au client.</tas-hint>
                }
              </div>
            }
          </div>

          @if (rules.tracksForecast()) {
            <p class="text-xs text-slate-500">
              Le projet démarre sur la première étape de son parcours : la probabilité suit ensuite l'étape.
            </p>
          }

          @if (submitError(); as message) {
            <p class="text-sm text-functional-error" role="alert">{{ message }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()"
                  (click)="handleSubmit()">
            Créer le projet
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CreateOpportunityDrawer {
  public readonly data: CreateOpportunityDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<string | false>);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  /** La monnaie de l'institution : celle des totaux et des nouveaux montants. */
  public readonly currency = inject(TenantProvider).currency;
  public readonly currencyUnit = currencyUnit;
  private readonly _references = inject(EntityFormReferences);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _products = toSignal(this._references.options(FormFieldReferenceTargetEnum.Product), {
    initialValue: [],
  });

  public readonly productOptions = computed(() => [
    { value: '', label: 'À préciser' },
    ...this._products().map((p) => ({ value: p.label, label: p.label })),
  ]);

  public readonly submitError = signal<string | null>(null);

  public model = signal(CreateOpportunityFormModel.fromLead(this.data.lead, ''));
  /** Le gabarit du produit choisi : nom du montant, date critique. */
  public readonly rules = projectCreationRules(() => this.model().product);

  public formSchema = form(this.model, (schema) => {
    required(schema.title, { message: 'Le titre est obligatoire' });
    required(schema.expectedCloseDate, {
      message: 'Obligatoire pour ce produit',
      when: () => this.rules.criticalCloseDate() && this.rules.tracksForecast(),
    });
    maxLength(schema.title, 200, { message: 'Le titre ne peut pas dépasser 200 caractères' });
    maxLength(schema.description, 2000, { message: 'Le besoin ne peut pas dépasser 2 000 caractères' });
    validate(schema.amount, (ctx) => {
      const amount = parseAmount(ctx.value());
      return amount !== null && (Number.isNaN(amount) || amount <= 0)
        ? { kind: 'amount', message: 'Saisissez un montant positif, en chiffres' }
        : null;
    });
  });

  constructor() {
    // Le lead porte le CODE du produit (`interestedProduct`) ; l'opportunité, son libellé. La
    // correspondance n'est connue qu'une fois le catalogue chargé.
    const code = this.data.lead.interestedProduct;
    this._references.options(FormFieldReferenceTargetEnum.Product).subscribe((products) => {
      const label = products.find((p) => p.value === code)?.label;
      if (label && !this.formSchema.product().dirty()) this.formSchema.product().value.set(label);
    });
  }

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const amount = parseAmount(value.amount);
      const id = await firstValueFrom(
        this._opportunitiesApi.createOpportunity({
          leadId: this.data.lead.id!,
          title: value.title.trim(),
          product: value.product || null,
          description: value.description.trim() || null,
          estimatedAmount: amount,
          estimatedCurrency: amount !== null ? this.currency() : null,
          expectedCloseDate: value.expectedCloseDate && this.rules.tracksForecast() ? `${value.expectedCloseDate}T12:00:00Z` : null,
          ownerId: this.data.lead.currentAssignedId ?? this.data.lead.ownerId ?? null,
        }).pipe(
          map((created) => created || null),
          catchError((error: HttpErrorResponse) => {
            const message = projectSaveErrorMessage(error, 'Impossible de créer le projet.');
            this.submitError.set(message);
            this._snackbar.error('Erreur', message);
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!id) return;
      this._snackbar.success('Projet créé', `« ${value.title.trim()} » est ajouté au lead.`);
      this._dialogRef.close(id);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
