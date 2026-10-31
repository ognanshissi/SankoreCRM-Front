import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
  form,
  FormField,
  FormRoot,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { COUNTRIES, CountryDef, phoneErrorMessage, TasInputPhone } from '@talisoft/ui/input-phone';
import {
  AddContactPointRequest,
  AddContactPointRequestTypeEnum,
  AddContactPointResult,
  ClientContactPointsApiService,
} from '@sankore/crm-api';

export interface AddContactPointDrawerData {
  clientId: string;
  /** Type présélectionné quand l'utilisateur part d'une section précise de l'onglet. */
  initialType?: AddContactPointRequestTypeEnum;
  /** Types qui ont déjà une coordonnée active : le premier d'un type devient principal d'office. */
  activeTypes?: string[];
}

/**
 * Le pays d'un numéro tel que `tas-input-phone` le rend (« +2250769738964 ») : l'indicatif le plus
 * long qui convient, et le numéro national derrière. Le composant porte la liste des pays (UEMOA
 * d'abord) et le choix du pays ; ce tiroir avait les siens — un sélecteur à part et un champ qui
 * refusait le « + » d'un numéro collé avec son indicatif.
 */
function splitPhone(value: string): { country: CountryDef | null; national: string } {
  const country = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => value.startsWith(c.dial)) ?? null;
  return { country, national: country ? value.slice(country.dial.length) : value };
}

export const CONTACT_POINT_TYPE_OPTIONS = [
  { label: 'Téléphone', value: AddContactPointRequestTypeEnum.Phone },
  { label: 'Adresse e-mail', value: AddContactPointRequestTypeEnum.Email },
  { label: 'Adresse postale', value: AddContactPointRequestTypeEnum.Address },
];

/** Un e-mail « suffisamment correct » : le serveur reste l'autorité finale. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class AddContactPointFormModel {
  public type!: AddContactPointRequestTypeEnum;
  /** Au format international, tel que le composant téléphone le rend. */
  public phoneNumber!: string;
  public email!: string;
  public address!: string;
  public label!: string;
  public makePrimary!: boolean;

  public static instantiate(
    initialType: AddContactPointRequestTypeEnum,
  ): AddContactPointFormModel {
    const model = new AddContactPointFormModel();
    model.type = initialType;
    model.phoneNumber = '';
    model.email = '';
    model.address = '';
    model.label = '';
    model.makePrimary = false;
    return model;
  }
}

@Component({
  selector: 'add-contact-point-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasInputPhone,
    TasCheckbox,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Ajouter une coordonnée</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Type de coordonnée <span class="text-functional-error">*</span></tas-label>
            <tas-select
              [options]="typeOptions"
              placeholder="Choisissez un type"
              [formField]="formSchema.type"
            ></tas-select>
          </tas-form-field>

          @if (isPhone()) {
            <tas-form-field>
              <tas-label>Numéro de téléphone <span class="text-functional-error">*</span></tas-label>
              <tas-input-phone defaultCountry="CI" [formField]="formSchema.phoneNumber"></tas-input-phone>
              @if (formSchema.phoneNumber().touched() && formSchema.phoneNumber().invalid()) {
                <tas-error>{{ phoneErrorMessage(formSchema.phoneNumber().errors()) }}</tas-error>
              } @else {
                <tas-hint>Choisissez le pays à gauche (UEMOA en premier), ou collez le numéro avec son indicatif.</tas-hint>
              }
            </tas-form-field>
          }

          @if (isEmail()) {
            <tas-form-field>
              <tas-label>Adresse e-mail <span class="text-functional-error">*</span></tas-label>
              <input
                tasInput
                type="email"
                autocomplete="off"
                placeholder="nom@exemple.com"
                [formField]="formSchema.email"
              />
              @if (formSchema.email().touched() && formSchema.email().invalid()) {
                <tas-error>{{ formSchema.email().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }

          @if (isAddress()) {
            <tas-form-field>
              <tas-label>Adresse postale <span class="text-functional-error">*</span></tas-label>
              <input
                tasInput
                type="text"
                placeholder="Quartier, rue, ville, pays"
                [formField]="formSchema.address"
              />
              @if (formSchema.address().touched() && formSchema.address().invalid()) {
                <tas-error>{{ formSchema.address().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }

          <tas-form-field>
            <tas-label>Libellé</tas-label>
            <input
              tasInput
              type="text"
              [placeholder]="labelPlaceholder()"
              [formField]="formSchema.label"
            />
            <tas-hint>Facultatif : aide à distinguer plusieurs coordonnées du même type.</tas-hint>
          </tas-form-field>

          @if (firstOfItsType()) {
            <div class="flex items-start gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
              <tas-icon
                iconName="feather:info"
                class="text-slate-500 mt-0.5"
                style="font-size:14px"
              ></tas-icon>
              <p class="text-xs text-slate-600">
                C'est la première coordonnée active de ce type : elle devient automatiquement la
                principale.
              </p>
            </div>
          } @else {
            <tas-checkbox [formField]="formSchema.makePrimary">
              <span class="text-sm text-slate-700">En faire la coordonnée principale</span>
            </tas-checkbox>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="handleSubmit()"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
          >
            Ajouter
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class AddContactPointDrawer {
  public readonly data: AddContactPointDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<AddContactPointResult>);
  private readonly _contactPointsApi = inject(ClientContactPointsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly typeOptions = CONTACT_POINT_TYPE_OPTIONS;

  public model = signal(
    AddContactPointFormModel.instantiate(
      this.data.initialType ?? AddContactPointRequestTypeEnum.Phone,
    ),
  );

  public formSchema = form(this.model, (schema) => {
    required(schema.type, { message: 'Le type de coordonnée est obligatoire' });

    // Le format dépend de l'indicatif choisi : c'est le critère 3 de l'US.
    validate(schema.phoneNumber, (ctx) => {
      if (ctx.valueOf(schema.type) !== AddContactPointRequestTypeEnum.Phone) return null;
      const value = (ctx.value() ?? '').trim();
      if (!value) {
        return { kind: 'required', message: 'Le numéro de téléphone est obligatoire' };
      }
      const { country, national } = splitPhone(value);
      if (!country || !/^\d+$/.test(national)) {
        return { kind: 'pattern', message: 'Le numéro ne doit contenir que des chiffres' };
      }
      if (!country.pattern.test(national)) {
        const expected = country.placeholder ? ` Exemple : ${country.placeholder}.` : '';
        return {
          kind: 'pattern',
          message: `Ce numéro ne correspond pas au format attendu pour ${country.name} (${country.dial}).${expected}`,
        };
      }
      return null;
    });

    validate(schema.email, (ctx) => {
      if (ctx.valueOf(schema.type) !== AddContactPointRequestTypeEnum.Email) return null;
      const value = (ctx.value() ?? '').trim();
      if (!value) {
        return { kind: 'required', message: "L'adresse e-mail est obligatoire" };
      }
      return EMAIL_PATTERN.test(value)
        ? null
        : { kind: 'email', message: 'Adresse e-mail invalide' };
    });

    validate(schema.address, (ctx) => {
      if (ctx.valueOf(schema.type) !== AddContactPointRequestTypeEnum.Address) return null;
      const value = (ctx.value() ?? '').trim();
      if (!value) {
        return { kind: 'required', message: "L'adresse postale est obligatoire" };
      }
      return value.length >= 5
        ? null
        : { kind: 'minLength', message: 'Précisez davantage l\'adresse (5 caractères minimum)' };
    });
  });

  public readonly phoneErrorMessage = phoneErrorMessage;

  public readonly selectedType = computed(() => this.formSchema.type().value());
  public readonly isPhone = computed(
    () => this.selectedType() === AddContactPointRequestTypeEnum.Phone,
  );
  public readonly isEmail = computed(
    () => this.selectedType() === AddContactPointRequestTypeEnum.Email,
  );
  public readonly isAddress = computed(
    () => this.selectedType() === AddContactPointRequestTypeEnum.Address,
  );

  public readonly labelPlaceholder = computed(() => {
    if (this.isEmail()) return 'Professionnel, personnel…';
    if (this.isAddress()) return 'Domicile, bureau…';
    return 'Mobile, domicile, bureau…';
  });

  /** Aucune coordonnée active de ce type : le serveur la promeut principale d'office. */
  public readonly firstOfItsType = computed(
    () => !(this.data.activeTypes ?? []).includes(String(this.selectedType())),
  );

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const request: AddContactPointRequest = {
        type: value.type,
        value: this._buildValue(value),
        label: value.label.trim() || null,
        // Inutile de le demander quand c'est la première du type : le serveur s'en charge.
        makePrimary: this.firstOfItsType() ? true : value.makePrimary,
      };

      const result = await firstValueFrom(
        this._contactPointsApi.addClientContactPoint(this.data.clientId, request).pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
      );

      if (!result) return;

      if (result.alreadyExisted) {
        this._snackbar.info(
          'Coordonnée déjà enregistrée',
          "Cette valeur figure déjà sur la fiche : rien n'a été ajouté.",
        );
      } else {
        this._snackbar.success('Coordonnée ajoutée', 'La coordonnée a été enregistrée.');
      }
      this._dialogRef.close(result);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _buildValue(value: AddContactPointFormModel): string {
    switch (value.type) {
      case AddContactPointRequestTypeEnum.Phone:
        return value.phoneNumber.trim();
      case AddContactPointRequestTypeEnum.Email:
        return value.email.trim();
      default:
        return value.address.trim();
    }
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return (
      firstError ?? error.error?.title ?? "Impossible d'ajouter cette coordonnée."
    );
  }
}
