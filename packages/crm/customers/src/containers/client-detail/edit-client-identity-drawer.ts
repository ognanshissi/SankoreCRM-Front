import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  ClientDetailDto,
  ClientsApiService,
  UpdateClientRequest,
  UpdateClientRequestMaritalStatusEnum,
} from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import { isLegalClient, MARITAL_STATUS_OPTIONS } from '../../models/client-labels';

export interface EditClientIdentityDrawerData {
  client: ClientDetailDto;
}

/**
 * `preferredLanguage` est une chaîne libre dans le contrat : ces valeurs reprennent celles de
 * `UpdateCompanyInfoCommand.defaultLanguage`, seul endroit où le contrat les énumère.
 * L'option vide existe parce que `tas-select` n'offre pas de bouton d'effacement.
 */
export const LANGUAGE_OPTIONS = [
  { label: 'Non précisée', value: '' },
  { label: 'Français', value: 'Fr' },
  { label: 'Anglais', value: 'En' },
];

export function preferredLanguageLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return LANGUAGE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

const CURRENCY_OPTIONS = [
  { label: 'XOF', value: 'XOF' },
  { label: 'EUR', value: 'EUR' },
  { label: 'USD', value: 'USD' },
];

export class EditClientIdentityFormModel {
  public profession!: string;
  public employer!: string;
  public maritalStatus!: string;
  public declaredIncome!: string;
  public declaredIncomeCurrency!: string;
  public preferredLanguage!: string;

  public static fromClient(client: ClientDetailDto): EditClientIdentityFormModel {
    const model = new EditClientIdentityFormModel();
    model.profession = client.profession ?? '';
    model.employer = client.employer ?? '';
    // `maritalStatus` arrive en chaîne, tantôt numérique tantôt nommée, alors que la requête
    // attend un entier 0..4 : on ne présélectionne que ce que le select sait afficher.
    const marital = client.maritalStatus != null ? String(client.maritalStatus) : '';
    model.maritalStatus = MARITAL_STATUS_OPTIONS.some((o) => o.value === marital)
      ? marital
      : '';
    // Le revenu déclaré n'est lisible que masqué : le champ part vide et n'est envoyé que s'il
    // est renseigné, sinon un formulaire ouvert puis enregistré effacerait le montant.
    model.declaredIncome = '';
    model.declaredIncomeCurrency = client.declaredIncomeCurrency ?? 'XOF';
    model.preferredLanguage = client.preferredLanguage ?? '';
    return model;
  }
}

@Component({
  selector: 'edit-client-identity-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:edit-2" style="font-size:18px"></tas-icon>
          <span>Modifier les informations du client</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (conflict(); as pending) {
          <div class="mb-5 p-3 rounded-lg border border-amber-300 bg-amber-50">
            <div class="flex items-start gap-2">
              <tas-icon
                iconName="feather:alert-triangle"
                class="text-amber-600 mt-0.5"
                style="font-size:16px"
              ></tas-icon>
              <div class="text-sm">
                <p class="font-medium text-amber-900">
                  La fiche a été modifiée par quelqu'un d'autre
                </p>
                <p class="text-amber-800">
                  Votre saisie est conservée ci-dessous. Rechargez la fiche, vérifiez vos
                  valeurs, puis enregistrez à nouveau.
                </p>
                @if (pending.reloaded) {
                  <p class="text-amber-900 font-medium mt-1">
                    Fiche rechargée. Vous pouvez enregistrer à nouveau.
                  </p>
                }
              </div>
            </div>

            <dl class="mt-3 text-sm bg-white rounded-md border border-amber-200 divide-y divide-amber-100">
              @for (entry of pending.entries; track entry.label) {
                <div class="flex gap-3 px-3 py-1.5">
                  <dt class="text-slate-500 w-48 shrink-0">{{ entry.label }}</dt>
                  <dd class="text-slate-800 font-medium break-words">{{ entry.value }}</dd>
                </div>
              }
            </dl>

            <div class="flex items-center gap-2 mt-3">
              <button tas-raised-button color="primary" type="button" (click)="reloadClient()">
                <tas-icon iconName="feather:refresh-cw" style="font-size:13px"></tas-icon>
                Recharger la fiche
              </button>
              <button tas-outlined-button color="primary" type="button" (click)="copyEntries()">
                <tas-icon iconName="feather:copy" style="font-size:13px"></tas-icon>
                Copier ma saisie
              </button>
            </div>
          </div>
        }

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          @if (!isLegal) {
            <div>
              <p class="text-sm font-medium text-slate-600 mb-3">Situation familiale et professionnelle</p>
              <div class="flex flex-col gap-4">
                <tas-form-field>
                  <tas-label>Situation familiale</tas-label>
                  <tas-select
                    [options]="maritalStatusOptions"
                    placeholder="Sélectionnez une situation"
                    [formField]="formSchema.maritalStatus"
                  ></tas-select>
                </tas-form-field>

                <div class="grid grid-cols-2 gap-3">
                  <tas-form-field>
                    <tas-label>Profession</tas-label>
                    <input tasInput type="text" placeholder="Profession" [formField]="formSchema.profession" />
                  </tas-form-field>

                  <tas-form-field>
                    <tas-label>Employeur</tas-label>
                    <input tasInput type="text" placeholder="Employeur" [formField]="formSchema.employer" />
                  </tas-form-field>
                </div>
              </div>
            </div>
          }

          <div [class.border-t]="!isLegal" [class.border-gray-200]="!isLegal" [class.pt-4]="!isLegal">
            <p class="text-sm font-medium text-slate-600 mb-3">Revenu déclaré</p>
            <div class="grid grid-cols-2 gap-3">
              <tas-form-field>
                <tas-label>Montant</tas-label>
                <input tasInput type="number" placeholder="0" [formField]="formSchema.declaredIncome" />
                @if (formSchema.declaredIncome().touched() && formSchema.declaredIncome().invalid()) {
                  <tas-error>{{ formSchema.declaredIncome().errors()[0].message }}</tas-error>
                }
                <tas-hint>Laissez vide pour conserver le montant actuel, qui n'est pas lisible ici.</tas-hint>
              </tas-form-field>

              <tas-form-field>
                <tas-label>Devise</tas-label>
                <tas-select
                  [options]="currencyOptions"
                  placeholder="Devise"
                  [formField]="formSchema.declaredIncomeCurrency"
                ></tas-select>
                @if (formSchema.declaredIncomeCurrency().touched() && formSchema.declaredIncomeCurrency().invalid()) {
                  <tas-error>{{ formSchema.declaredIncomeCurrency().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
            </div>
          </div>

          <div class="border-t border-gray-200 pt-4">
            <p class="text-sm font-medium text-slate-600 mb-3">Préférences</p>
            <tas-form-field>
              <tas-label>Langue préférée</tas-label>
              <tas-select
                [options]="languageOptions"
                placeholder="Langue de contact"
                [formField]="formSchema.preferredLanguage"
              ></tas-select>
            </tas-form-field>
          </div>

          <p class="text-xs text-slate-400">
            Le nom, la pièce d'identité et l'adresse sont des données sensibles : leur
            modification passe par une fenêtre dédiée qui exige un motif. Le genre, le lieu de
            naissance, la nationalité, la filiation et le nombre de personnes à charge ne font
            pas partie du contrat de mise à jour.
          </p>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class EditClientIdentityDrawer {
  public readonly data: EditClientIdentityDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _store = inject(ClientDetailStore);
  private readonly _snackbar = inject(SnackbarService);

  public readonly maritalStatusOptions = MARITAL_STATUS_OPTIONS;
  public readonly currencyOptions = CURRENCY_OPTIONS;
  public readonly languageOptions = LANGUAGE_OPTIONS;

  public readonly isLegal = isLegalClient(this.data.client.clientType);

  /**
   * Saisie à recopier après un conflit de version. Le drawer reste ouvert : le fermer
   * reviendrait à perdre ce que l'utilisateur vient de taper.
   */
  public readonly conflict = signal<{
    entries: { label: string; value: string }[];
    reloaded: boolean;
  } | null>(null);

  /**
   * Valeurs de départ, conservées à part : `form()` écrit dans le signal `model`, si bien que
   * `this.model()` renvoie la saisie en cours et ne peut pas servir de référence de comparaison.
   */
  private readonly _initial = EditClientIdentityFormModel.fromClient(this.data.client);

  public model = signal(EditClientIdentityFormModel.fromClient(this.data.client));

  public formSchema = form(this.model, (schema) => {
    validate(schema.declaredIncome, (ctx) => {
      const value = ctx.value();
      if (!value) return null;
      const amount = Number(value);
      return Number.isNaN(amount) || amount < 0
        ? { kind: 'min', message: 'Le revenu doit être un nombre positif' }
        : null;
    });

    validate(schema.declaredIncomeCurrency, (ctx) => {
      if (ctx.valueOf(schema.declaredIncome) && !ctx.value()) {
        return { kind: 'required', message: 'La devise est obligatoire avec un montant' };
      }
      return null;
    });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const client = this.data.client;
      const clientId = client.id;
      if (!clientId) return;

      const request: UpdateClientRequest = {};
      const version = this._store.version();
      if (version !== null) request.expectedVersion = version;

      // `PATCH /clients/{id}` accepte `null` pour effacer un champ : n'envoyer que ce qui a
      // changé évite d'effacer une valeur que le formulaire ne sait pas lire (le revenu est
      // masqué) ou qu'un autre utilisateur vient de renseigner.
      const initial = this._initial;
      const changed: string[] = [];
      if (value.profession !== initial.profession) {
        request.profession = value.profession || null;
        changed.push('profession');
      }
      if (value.employer !== initial.employer) {
        request.employer = value.employer || null;
        changed.push('employer');
      }
      if (value.maritalStatus !== initial.maritalStatus) {
        request.maritalStatus =
          value.maritalStatus === ''
            ? null
            : (Number(value.maritalStatus) as UpdateClientRequestMaritalStatusEnum);
        changed.push('maritalStatus');
      }
      if (value.declaredIncome !== '') {
        request.declaredIncome = Number(value.declaredIncome);
        request.declaredIncomeCurrency = value.declaredIncomeCurrency || null;
        changed.push('declaredIncome');
      } else if (value.declaredIncomeCurrency !== initial.declaredIncomeCurrency) {
        request.declaredIncomeCurrency = value.declaredIncomeCurrency || null;
        changed.push('declaredIncomeCurrency');
      }
      if (value.preferredLanguage !== initial.preferredLanguage) {
        request.preferredLanguage = value.preferredLanguage || null;
        changed.push('preferredLanguage');
      }

      if (changed.length === 0) {
        this._snackbar.info('Aucune modification', "Rien n'a été changé dans le formulaire.");
        return;
      }

      const saved = await firstValueFrom(
        this._clientsApi.updateClient(clientId, request).pipe(
          // Réponse sans contenu : sans ce `map`, `firstValueFrom` résout sur `null` et un
          // succès serait indiscernable d'une erreur avalée.
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            if (error.status === 409) {
              this._openConflict(value);
            } else {
              this._snackbar.error('Erreur', this._errorMessage(error));
            }
            return EMPTY;
          }),
        ),
      );

      if (saved) {
        this.conflict.set(null);
        this._snackbar.success(
          'Informations mises à jour',
          'La fiche du client a été enregistrée.',
        );
        this._dialogRef.close(true);
      }
    });
  }

  public reloadClient(): void {
    this._store.reload().subscribe(() => {
      this.conflict.update((c) => (c ? { ...c, reloaded: true } : c));
      this._snackbar.info(
        'Fiche rechargée',
        'Comparez votre saisie aux valeurs à jour avant d’enregistrer.',
      );
    });
  }

  public copyEntries(): void {
    const pending = this.conflict();
    if (!pending) return;
    const text = pending.entries.map((e) => `${e.label} : ${e.value}`).join('\n');
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      this._snackbar.info(
        'Copie indisponible',
        'Sélectionnez les valeurs affichées pour les copier.',
      );
      return;
    }
    clipboard
      .writeText(text)
      .then(() =>
        this._snackbar.success('Saisie copiée', 'Vos valeurs sont dans le presse-papiers.'),
      )
      .catch(() =>
        this._snackbar.error(
          'Copie impossible',
          'Sélectionnez les valeurs affichées pour les copier.',
        ),
      );
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _openConflict(value: EditClientIdentityFormModel): void {
    const entries: { label: string; value: string }[] = [];
    if (!this.isLegal) {
      entries.push(
        {
          label: 'Situation familiale',
          value:
            this.maritalStatusOptions.find((o) => o.value === value.maritalStatus)?.label ??
            'Non précisée',
        },
        { label: 'Profession', value: value.profession || '—' },
        { label: 'Employeur', value: value.employer || '—' },
      );
    }
    entries.push(
      {
        label: 'Revenu déclaré',
        value: value.declaredIncome
          ? `${value.declaredIncome} ${value.declaredIncomeCurrency}`.trim()
          : 'Inchangé',
      },
      { label: 'Langue préférée', value: preferredLanguageLabel(value.preferredLanguage) },
    );
    this.conflict.set({ entries, reloaded: false });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return firstError ?? error.error?.title ?? 'Impossible de mettre à jour le client.';
  }
}
