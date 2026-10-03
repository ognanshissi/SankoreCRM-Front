import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
  form,
  FormField,
  FormRoot,
  minLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDatePicker } from '@talisoft/ui/date-picker';
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
  UpdateClientSensitiveRequest,
  UpdateClientSensitiveRequestIdentityDocumentTypeEnum,
} from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  IDENTITY_DOCUMENT_OPTIONS,
  IDENTITY_DOCUMENT_ORDER,
  identityDocumentLabel,
  identityDocumentToName,
  isLegalClient,
} from '../../models/client-labels';

export interface EditClientSensitiveDrawerData {
  client: ClientDetailDto;
}

/** Longueur minimale du motif : un « maj » ne dit rien à qui relira la piste d'audit. */
const REASON_MIN_LENGTH = 10;

function todayISODate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Ramène `ClientDetailDto.identityDocumentType` au nom attendu par les options : le contrat
 * renvoie tantôt le nom, tantôt l'index, et la requête d'écriture attend l'index.
 */
function documentTypeName(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value);
  if (IDENTITY_DOCUMENT_ORDER.includes(raw)) return raw;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 && index < IDENTITY_DOCUMENT_ORDER.length
    ? (IDENTITY_DOCUMENT_ORDER[index] as string)
    : '';
}

/** Erreur de champ d'adresse : requis dès qu'une autre partie de l'adresse est renseignée. */
function addressFieldError(
  label: string,
  value: string,
  allParts: (string | null | undefined)[],
): { kind: string; message: string } | null {
  if (value) return null;
  return allParts.some(Boolean)
    ? { kind: 'required', message: `${label} est obligatoire pour enregistrer une adresse` }
    : null;
}

export class EditClientSensitiveFormModel {
  public reason!: string;
  public firstName!: string;
  public lastName!: string;
  public maidenName!: string;
  public identityDocumentType!: string;
  public identityDocumentNumber!: string;
  public identityDocumentIssuedOn!: string;
  public identityDocumentExpiresOn!: string;
  public street!: string;
  public city!: string;
  public state!: string;
  public zipCode!: string;
  public country!: string;

  public static fromClient(client: ClientDetailDto): EditClientSensitiveFormModel {
    const model = new EditClientSensitiveFormModel();
    model.reason = '';
    model.firstName = client.firstName ?? '';
    model.lastName = client.lastName ?? '';
    model.maidenName = client.maidenName ?? '';
    model.identityDocumentType = documentTypeName(client.identityDocumentType);
    // Le numéro de pièce n'est lisible que masqué : le champ part vide et n'est envoyé que
    // s'il est renseigné, faute de quoi l'ouverture du formulaire effacerait le numéro.
    model.identityDocumentNumber = '';
    model.identityDocumentIssuedOn = client.identityDocumentIssuedOn?.slice(0, 10) ?? '';
    model.identityDocumentExpiresOn = client.identityDocumentExpiresOn?.slice(0, 10) ?? '';
    // L'adresse postale n'est pas exposée en lecture par `ClientDetailDto` : ces champs
    // restent vides et ne partent qu'en bloc, pour remplacer l'adresse existante.
    model.street = '';
    model.city = '';
    model.state = '';
    model.zipCode = '';
    model.country = '';
    return model;
  }
}

@Component({
  selector: 'edit-client-sensitive-drawer',
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
    TasDatePicker,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:lock" style="font-size:18px"></tas-icon>
          <span>Modifier les données sensibles</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="mb-5 p-3 rounded-lg border border-amber-300 bg-amber-50">
          <div class="flex items-start gap-2">
            <tas-icon
              iconName="feather:shield"
              class="text-amber-600 mt-0.5"
              style="font-size:16px"
            ></tas-icon>
            <div class="text-sm">
              <p class="font-medium text-amber-900">Modification tracée</p>
              <p class="text-amber-800">
                Le nom, la pièce d'identité et l'adresse sont des données sensibles. Chaque
                changement est journalisé avec votre identité et votre motif, et peut déclencher
                une nouvelle revue KYC du client.
              </p>
            </div>
          </div>
        </div>

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
              <p class="text-sm font-medium text-slate-600 mb-3">Identité</p>
              <div class="flex flex-col gap-4">
                <div class="grid grid-cols-2 gap-3">
                  <tas-form-field>
                    <tas-label>Prénom</tas-label>
                    <input tasInput type="text" placeholder="Prénom" [formField]="formSchema.firstName" />
                  </tas-form-field>

                  <tas-form-field>
                    <tas-label>Nom</tas-label>
                    <input tasInput type="text" placeholder="Nom de famille" [formField]="formSchema.lastName" />
                  </tas-form-field>
                </div>

                <tas-form-field>
                  <tas-label>Nom de jeune fille</tas-label>
                  <input tasInput type="text" placeholder="Nom de naissance" [formField]="formSchema.maidenName" />
                </tas-form-field>
              </div>
            </div>

            <div class="border-t border-gray-200 pt-4">
              <p class="text-sm font-medium text-slate-600 mb-3">Pièce d'identité</p>
              <div class="flex flex-col gap-4">
                <div class="grid grid-cols-2 gap-3">
                  <tas-form-field>
                    <tas-label>Type de pièce</tas-label>
                    <tas-select
                      [options]="documentTypeOptions"
                      placeholder="Sélectionnez un type"
                      [formField]="formSchema.identityDocumentType"
                    ></tas-select>
                  </tas-form-field>

                  <tas-form-field>
                    <tas-label>Numéro</tas-label>
                    <input
                      tasInput
                      type="text"
                      placeholder="Numéro de la pièce"
                      [formField]="formSchema.identityDocumentNumber"
                    />
                    <tas-hint>
                      Laissez vide pour conserver le numéro actuel ({{ currentDocumentNumber }}).
                    </tas-hint>
                  </tas-form-field>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <tas-date-picker
                      mode="date"
                      placeholder="Sélectionnez une date"
                      [formField]="formSchema.identityDocumentIssuedOn">
                      Délivrée le
                    </tas-date-picker>
                    @if (formSchema.identityDocumentIssuedOn().touched() && formSchema.identityDocumentIssuedOn().invalid()) {
                      <tas-error>{{ formSchema.identityDocumentIssuedOn().errors()[0].message }}</tas-error>
                    }
                  </div>

                  <div>
                    <tas-date-picker
                      mode="date"
                      placeholder="Sélectionnez une date"
                      [formField]="formSchema.identityDocumentExpiresOn">
                      Expire le
                    </tas-date-picker>
                    @if (formSchema.identityDocumentExpiresOn().touched() && formSchema.identityDocumentExpiresOn().invalid()) {
                      <tas-error>{{ formSchema.identityDocumentExpiresOn().errors()[0].message }}</tas-error>
                    }
                  </div>
                </div>
              </div>
            </div>
          }

          <div [class.border-t]="!isLegal" [class.border-gray-200]="!isLegal" [class.pt-4]="!isLegal">
            <p class="text-sm font-medium text-slate-600 mb-3">Adresse postale</p>
            <p class="text-xs text-slate-400 mb-3">
              Renseignez ces champs uniquement pour remplacer l'adresse postale du client :
              l'adresse actuelle n'est pas lisible ici et un envoi partiel l'écraserait.
            </p>
            <div class="flex flex-col gap-4">
              <tas-form-field>
                <tas-label>Rue</tas-label>
                <input tasInput type="text" placeholder="Rue, quartier, lot" [formField]="formSchema.street" />
                @if (formSchema.street().touched() && formSchema.street().invalid()) {
                  <tas-error>{{ formSchema.street().errors()[0].message }}</tas-error>
                }
              </tas-form-field>

              <div class="grid grid-cols-2 gap-3">
                <tas-form-field>
                  <tas-label>Ville</tas-label>
                  <input tasInput type="text" placeholder="Ville" [formField]="formSchema.city" />
                  @if (formSchema.city().touched() && formSchema.city().invalid()) {
                    <tas-error>{{ formSchema.city().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>

                <tas-form-field>
                  <tas-label>Région ou district</tas-label>
                  <input tasInput type="text" placeholder="Région" [formField]="formSchema.state" />
                </tas-form-field>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <tas-form-field>
                  <tas-label>Code postal</tas-label>
                  <input tasInput type="text" placeholder="Code postal" [formField]="formSchema.zipCode" />
                </tas-form-field>

                <tas-form-field>
                  <tas-label>Pays</tas-label>
                  <input tasInput type="text" placeholder="Pays" [formField]="formSchema.country" />
                  @if (formSchema.country().touched() && formSchema.country().invalid()) {
                    <tas-error>{{ formSchema.country().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              </div>
            </div>
          </div>

          <div class="border-t border-gray-200 pt-4">
            <tas-form-field>
              <tas-label>Motif de la modification <span class="text-functional-error">*</span></tas-label>
              <textarea
                tasInput
                rows="3"
                placeholder="Expliquez pourquoi ces données changent (pièce renouvelée, erreur de saisie, mariage…)"
                [formField]="formSchema.reason"
              ></textarea>
              @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
                <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
              }
              <tas-hint>Ce motif est conservé dans l'historique du client.</tas-hint>
            </tas-form-field>
          </div>

          @if (isLegal) {
            <p class="text-xs text-slate-400">
              La raison sociale, le numéro d'immatriculation et l'identifiant fiscal ne font pas
              partie du contrat de modification sensible : seule l'adresse postale est modifiable
              ici.
            </p>
          }
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
          Enregistrer la modification
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class EditClientSensitiveDrawer {
  public readonly data: EditClientSensitiveDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _store = inject(ClientDetailStore);
  private readonly _snackbar = inject(SnackbarService);

  public readonly documentTypeOptions = IDENTITY_DOCUMENT_OPTIONS;
  public readonly isLegal = isLegalClient(this.data.client.clientType);
  public readonly currentDocumentNumber =
    this.data.client.identityDocumentNumberMasked || 'non renseigné';

  /** Saisie à recopier après un conflit de version : le drawer ne se ferme pas. */
  public readonly conflict = signal<{
    entries: { label: string; value: string }[];
    reloaded: boolean;
  } | null>(null);

  /** `form()` écrit dans `model` : la référence de comparaison doit vivre à part. */
  private readonly _initial = EditClientSensitiveFormModel.fromClient(this.data.client);

  public model = signal(EditClientSensitiveFormModel.fromClient(this.data.client));

  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    minLength(schema.reason, REASON_MIN_LENGTH, {
      message: `Détaillez le motif (${REASON_MIN_LENGTH} caractères minimum)`,
    });

    validate(schema.identityDocumentIssuedOn, (ctx) => {
      const value = ctx.value();
      if (!value) return null;
      return value > todayISODate()
        ? { kind: 'max', message: 'La date de délivrance ne peut pas être dans le futur' }
        : null;
    });

    validate(schema.identityDocumentExpiresOn, (ctx) => {
      const value = ctx.value();
      const issuedOn = ctx.valueOf(schema.identityDocumentIssuedOn);
      if (!value || !issuedOn) return null;
      return value <= issuedOn
        ? {
            kind: 'min',
            message: "La date d'expiration doit suivre la date de délivrance",
          }
        : null;
    });

    // Une adresse partielle serait enregistrée telle quelle et remplacerait l'adresse
    // complète : dès qu'un champ est rempli, la rue, la ville et le pays deviennent requis.
    validate(schema.street, (ctx) =>
      addressFieldError('La rue', ctx.value(), [
        ctx.value(),
        ctx.valueOf(schema.city),
        ctx.valueOf(schema.state),
        ctx.valueOf(schema.zipCode),
        ctx.valueOf(schema.country),
      ]),
    );
    validate(schema.city, (ctx) =>
      addressFieldError('La ville', ctx.value(), [
        ctx.value(),
        ctx.valueOf(schema.street),
        ctx.valueOf(schema.state),
        ctx.valueOf(schema.zipCode),
        ctx.valueOf(schema.country),
      ]),
    );
    validate(schema.country, (ctx) =>
      addressFieldError('Le pays', ctx.value(), [
        ctx.value(),
        ctx.valueOf(schema.street),
        ctx.valueOf(schema.city),
        ctx.valueOf(schema.state),
        ctx.valueOf(schema.zipCode),
      ]),
    );
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const clientId = this.data.client.id;
      if (!clientId) return;

      const initial = this._initial;
      const request: UpdateClientSensitiveRequest = { reason: value.reason.trim() };
      const version = this._store.version();
      if (version !== null) request.expectedVersion = version;

      // Comme pour la mise à jour non sensible, seuls les champs réellement changés partent :
      // un champ que le formulaire ne sait pas lire (numéro de pièce, adresse) ne doit jamais
      // être écrasé par une valeur vide.
      const changed: string[] = [];
      if (!this.isLegal) {
        if (value.firstName !== initial.firstName) {
          request.firstName = value.firstName || null;
          changed.push('firstName');
        }
        if (value.lastName !== initial.lastName) {
          request.lastName = value.lastName || null;
          changed.push('lastName');
        }
        if (value.maidenName !== initial.maidenName) {
          request.maidenName = value.maidenName || null;
          changed.push('maidenName');
        }
        if (value.identityDocumentType !== initial.identityDocumentType) {
          const documentType = identityDocumentToName(value.identityDocumentType);
          request.identityDocumentType =
            documentType === null
              ? null
              : (documentType as UpdateClientSensitiveRequestIdentityDocumentTypeEnum);
          changed.push('identityDocumentType');
        }
        if (value.identityDocumentNumber !== '') {
          request.identityDocumentNumber = value.identityDocumentNumber;
          changed.push('identityDocumentNumber');
        }
        if (value.identityDocumentIssuedOn !== initial.identityDocumentIssuedOn) {
          request.identityDocumentIssuedOn = value.identityDocumentIssuedOn || null;
          changed.push('identityDocumentIssuedOn');
        }
        if (value.identityDocumentExpiresOn !== initial.identityDocumentExpiresOn) {
          request.identityDocumentExpiresOn = value.identityDocumentExpiresOn || null;
          changed.push('identityDocumentExpiresOn');
        }
      }

      if (value.street || value.city || value.state || value.zipCode || value.country) {
        request.address = {
          street: value.street || null,
          city: value.city || null,
          state: value.state || null,
          zipCode: value.zipCode || null,
          country: value.country || null,
        };
        changed.push('address');
      }

      if (changed.length === 0) {
        this._snackbar.info(
          'Aucune modification',
          "Renseignez au moins un champ sensible avant d'enregistrer.",
        );
        return;
      }

      const saved = await firstValueFrom(
        this._clientsApi.updateClientSensitive(clientId, request).pipe(
          // La réponse liste les champs modifiés, mais un corps vide résoudrait sur `null` :
          // on ne se sert que du fait que l'appel a abouti.
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
          'Données sensibles mises à jour',
          'La modification est enregistrée et tracée dans l’historique du client.',
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

  private _openConflict(value: EditClientSensitiveFormModel): void {
    const entries: { label: string; value: string }[] = [];
    if (!this.isLegal) {
      entries.push(
        { label: 'Prénom', value: value.firstName || '—' },
        { label: 'Nom', value: value.lastName || '—' },
        { label: 'Nom de jeune fille', value: value.maidenName || '—' },
        {
          label: 'Type de pièce',
          value: value.identityDocumentType
            ? identityDocumentLabel(value.identityDocumentType)
            : '—',
        },
        {
          label: 'Numéro de pièce',
          value: value.identityDocumentNumber || 'Inchangé',
        },
        { label: 'Délivrée le', value: value.identityDocumentIssuedOn || '—' },
        { label: 'Expire le', value: value.identityDocumentExpiresOn || '—' },
      );
    }
    const address = [value.street, value.city, value.state, value.zipCode, value.country]
      .filter(Boolean)
      .join(', ');
    entries.push(
      { label: 'Adresse postale', value: address || 'Inchangée' },
      { label: 'Motif', value: value.reason },
    );
    this.conflict.set({ entries, reloaded: false });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return "Vous n'avez pas le droit de modifier les données sensibles de ce client.";
    }
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return firstError ?? error.error?.title ?? 'Impossible de mettre à jour ces données.';
  }
}
