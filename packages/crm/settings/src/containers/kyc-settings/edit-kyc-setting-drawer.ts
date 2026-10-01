import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { KYCSettingsApiService } from '@sankore/crm-api';
import {
  KYC_SETTING_BOOLEAN_OPTIONS,
  KycSettingRow,
  kycSettingDisplayValue,
} from './kyc-settings.model';

export interface EditKycSettingDrawerData {
  setting: KycSettingRow;
}

class EditKycSettingFormModel {
  public value!: string;

  public static fromSetting(setting: KycSettingRow): EditKycSettingFormModel {
    const model = new EditKycSettingFormModel();
    // Le contrat ne transporte que du texte, quel que soit `valueType` : le champ reste une chaîne
    // et la conversion n'a lieu qu'à la validation.
    model.value = setting.value;
    return model;
  }
}

/**
 * Modification d'un paramètre KYC du tenant (`PUT /kyc-settings/{key}`).
 *
 * **La validation côté écran ne duplique pas celle du serveur, elle la précède.** Le serveur vérifie
 * le type *et* une plage par nature de paramètre — un plafond positif, un pourcentage 1..100, une
 * fenêtre de flux 1..365 jours, une périodicité de revue 1..30 ans, 1..10 tentatives de comparaison
 * faciale. Ces plages sont attachées à des familles de paramètres que **rien dans le contrat ne
 * permet de rattacher à une clé** : `KycSettingDto` n'expose ni minimum ni maximum, et la liste des
 * clés n'est pas déclarée. Réécrire ces bornes ici supposerait donc deviner à quelle famille
 * appartient chaque clé, et refuserait à tort une valeur légitime le jour où le backend en ajoute
 * une. L'écran se limite à ce qu'il sait vraiment : la valeur est obligatoire et doit être du bon
 * type. Le hors-plage revient en 400 `KYC_SETTING_VALUE_OUT_OF_RANGE`, affiché tel quel.
 */
@Component({
  selector: 'edit-kyc-setting-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    Button,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Modifier le paramètre</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p class="font-mono text-xs text-slate-700 break-all">{{ setting.key }}</p>
            @if (setting.description) {
              <p class="mt-1 text-xs text-slate-500">{{ setting.description }}</p>
            }
          </div>

          @if (setting.kind === 'boolean') {
            <tas-form-field>
              <tas-label>Valeur <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="booleanOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Choisissez une valeur"
                [formField]="formSchema.value"
              ></tas-select>
              @if (formSchema.value().touched() && formSchema.value().invalid()) {
                <tas-error>{{ formSchema.value().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          } @else {
            <tas-form-field>
              <tas-label>Valeur <span class="text-functional-error">*</span></tas-label>
              <!--
                L'attribut type est écrit en dur dans chaque branche, jamais lié : le sélecteur de
                TasInput est une liste de input[tasInput][type=…], donc un type dynamique ne matche
                aucune de ses entrées et l'input sortirait sans style ni liaison au form-field.
              -->
              @if (setting.kind === 'text') {
                <input
                  tasInput
                  type="text"
                  [attr.aria-label]="'Valeur du paramètre ' + setting.key"
                  [formField]="formSchema.value"
                />
              } @else {
                <input
                  tasInput
                  type="number"
                  [attr.step]="setting.kind === 'decimal' ? 'any' : '1'"
                  [attr.aria-label]="'Valeur du paramètre ' + setting.key"
                  [formField]="formSchema.value"
                />
              }
              @if (formSchema.value().touched() && formSchema.value().invalid()) {
                <tas-error>{{ formSchema.value().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>Type attendu : {{ setting.kindLabel }}.</tas-hint>
              }
            </tas-form-field>
          }

          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span class="text-slate-500">
              Valeur d'usine : <span class="font-medium text-slate-700">{{ setting.displayDefaultValue }}</span>
            </span>
            @if (!isAtDefault()) {
              <button tas-text-button type="button" (click)="useDefault()">
                Reprendre la valeur d'usine
              </button>
            }
          </div>

          <!--
            Avertissement du contrat, pas une précaution de style : changer un plafond du palier
            simplifié purge les plafonds en cache de TOUS les clients du tenant, donc l'effet est
            immédiat et global. L'agent doit le savoir avant de valider, pas après.
          -->
          <div class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <tas-icon
              iconName="feather:alert-triangle"
              class="mt-0.5 shrink-0 text-amber-600"
              style="font-size:14px"
            ></tas-icon>
            <p class="text-xs text-amber-800">
              La modification s'applique immédiatement à tout le tenant et elle est tracée. Changer
              un plafond du palier simplifié recalcule les plafonds de tous les clients.
            </p>
          </div>

          @if (submitError()) {
            <p class="text-sm text-functional-error">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">
          Annuler
        </button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting() || isUnchanged()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class EditKycSettingDrawer {
  private readonly _data: EditKycSettingDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _settingsApi = inject(KYCSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly setting = this._data.setting;
  public readonly booleanOptions = KYC_SETTING_BOOLEAN_OPTIONS;

  public readonly submitError = signal<string | null>(null);

  public model = signal(EditKycSettingFormModel.fromSetting(this._data.setting));

  public formSchema = form(this.model, (schema) => {
    validate(schema.value, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (!raw) return { kind: 'required', message: 'La valeur est obligatoire' };

      switch (this.setting.kind) {
        case 'boolean':
          return raw === 'true' || raw === 'false'
            ? null
            : { kind: 'type', message: 'Choisissez Oui ou Non' };
        case 'integer':
          return /^-?\d+$/.test(raw)
            ? null
            : { kind: 'type', message: 'Ce paramètre attend un nombre entier' };
        case 'decimal':
          return Number.isFinite(Number(raw))
            ? null
            : { kind: 'type', message: 'Ce paramètre attend un nombre' };
        default:
          return null;
      }
    });
  });

  public readonly isUnchanged = computed(
    () => (this.formSchema.value().value() ?? '').trim() === this.setting.value.trim(),
  );

  public readonly isAtDefault = computed(
    () => (this.formSchema.value().value() ?? '').trim() === this.setting.defaultValue.trim(),
  );

  public useDefault(): void {
    this.formSchema.value().value.set(this.setting.defaultValue);
  }

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const result = await firstValueFrom(
        this._settingsApi
          .updateKycSetting(this.setting.key, { value: value.value.trim() })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const message = this._errorMessage(error);
              this.submitError.set(message);
              this._snackbar.error('Modification refusée', message);
              return EMPTY;
            }),
          ),
      );

      if (!result) return;

      this._snackbar.success(
        'Paramètre enregistré',
        `${this.setting.key} vaut désormais ${kycSettingDisplayValue(result.value, this.setting.kind)}.`,
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  /**
   * Les deux codes du contrat sont distingués, parce qu'ils n'appellent pas la même réaction : une
   * clé inconnue veut dire que la liste affichée est périmée (il faut recharger), un hors-plage que
   * la valeur saisie est à corriger. Le `detail` du serveur porte la borne : on le montre plutôt
   * que de le remplacer par un message générique.
   */
  private _errorMessage(error: HttpErrorResponse): string {
    switch (error.status) {
      case 404:
        return "Ce paramètre n'existe plus côté serveur. Rechargez la liste.";
      case 400:
        return (
          error.error?.detail ??
          error.error?.title ??
          "La valeur est hors des limites admises pour ce paramètre."
        );
      case 403:
        return "Vous n'avez pas le droit de modifier les paramètres KYC.";
      default:
        return error.error?.detail ?? "Le paramètre n'a pas pu être enregistré.";
    }
  }
}
