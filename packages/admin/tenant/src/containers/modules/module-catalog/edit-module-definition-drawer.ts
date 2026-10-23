import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, maxLength, pattern, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { ModuleCatalogApiService, ModuleDefinitionResponse } from '@sankore/crm-admin-api';
import { describeModuleError } from '../module-referential';

/** Même règle que le serveur : positif, deux décimales au plus, virgule ou point. */
const PRICE_PATTERN = /^\d+([.,]\d{1,2})?$/;

class ModuleDefinitionFormModel {
  public label!: string;
  public description!: string;
  public monthlyPrice!: string;
  public currency!: string;
  public isAvailable!: boolean;

  public static from(definition: ModuleDefinitionResponse): ModuleDefinitionFormModel {
    const m = new ModuleDefinitionFormModel();
    m.label = definition.label ?? '';
    m.description = definition.description ?? '';
    m.monthlyPrice = String(definition.monthlyPrice ?? 0);
    m.currency = definition.currency ?? 'XOF';
    m.isAvailable = definition.isAvailable ?? false;
    return m;
  }
}

/**
 * Libellé, prix et disponibilité d'un module. Un nouveau prix vaut pour les demandes suivantes :
 * chaque abonnement garde celui que le tenant a accepté, copié sur sa ligne.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasHint, TasError, TasInput, TasCheckbox, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Modifier le module</TasTitle>
        <p class="text-sm text-slate-500 font-mono">{{ definition.code }}</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Libellé <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" [formField]="formSchema.label" />
            @if (formSchema.label().touched() && formSchema.label().invalid()) {
              <tas-error>{{ formSchema.label().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Description</tas-label>
            <textarea tasInput rows="4" [formField]="formSchema.description"></textarea>
            @if (formSchema.description().touched() && formSchema.description().invalid()) {
              <tas-error>{{ formSchema.description().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Affichée aux administrateurs des tenants sur leur page « Modules ».</tas-hint>
            }
          </tas-form-field>

          <div class="grid grid-cols-[1fr_8rem] gap-3">
            <tas-form-field>
              <tas-label>Prix mensuel <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" inputmode="decimal" [formField]="formSchema.monthlyPrice" />
              @if (formSchema.monthlyPrice().touched() && formSchema.monthlyPrice().invalid()) {
                <tas-error>{{ formSchema.monthlyPrice().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
            <tas-form-field>
              <tas-label>Devise <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" [formField]="formSchema.currency" />
              @if (formSchema.currency().touched() && formSchema.currency().invalid()) {
                <tas-error>{{ formSchema.currency().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </div>

          <p class="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Le nouveau prix s’applique aux demandes suivantes. Les abonnements en cours et les demandes
            déjà envoyées gardent le prix que le tenant a accepté.
          </p>

          <div class="rounded-xl border border-slate-200 p-4">
            <tas-checkbox [formField]="formSchema.isAvailable">Proposé à la souscription</tas-checkbox>
            <p class="text-xs text-slate-500 mt-1.5 ml-6">
              Décoché, les tenants voient le module sans pouvoir le demander. Les abonnements actifs ne
              sont pas touchés, et vous pouvez toujours l’activer directement depuis la fiche d’un tenant.
            </p>
          </div>

          @if (serverError()) {
            <p role="alert" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{{ serverError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                [disabled]="formSchema().invalid() || formSchema().submitting()"
                [isLoading]="formSchema().submitting()">
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class EditModuleDefinitionDrawer {
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(ModuleCatalogApiService);
  public readonly definition = inject<ModuleDefinitionResponse>(DIALOG_DATA);

  public serverError = signal<string | null>(null);

  public model = signal(ModuleDefinitionFormModel.from(this.definition));
  public formSchema = form(this.model, (schema) => {
    required(schema.label, { message: 'Le libellé est obligatoire' });
    maxLength(schema.label, 100, { message: '100 caractères au plus' });
    maxLength(schema.description, 1000, { message: '1 000 caractères au plus' });
    required(schema.monthlyPrice, { message: 'Le prix est obligatoire' });
    pattern(schema.monthlyPrice, PRICE_PATTERN, { message: 'Un montant positif, deux décimales au plus' });
    required(schema.currency, { message: 'La devise est obligatoire' });
    pattern(schema.currency, /^[A-Za-z]{3}$/, { message: 'Un code ISO de 3 lettres (XOF)' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      this.serverError.set(null);
      const v = field().value();
      const saved = await firstValueFrom(
        this._api
          .updateModuleDefinition(this.definition.code!, {
            label: v.label.trim(),
            description: v.description.trim(),
            monthlyPrice: Number(v.monthlyPrice.replace(',', '.')),
            currency: v.currency.trim().toUpperCase(),
            isAvailable: v.isAvailable,
          })
          .pipe(
            map(() => true),
            catchError((err) => {
              this.serverError.set(describeModuleError(err, 'Le module n’a pas pu être enregistré.'));
              return EMPTY;
            }),
          ),
        { defaultValue: false },
      );
      if (saved) this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
