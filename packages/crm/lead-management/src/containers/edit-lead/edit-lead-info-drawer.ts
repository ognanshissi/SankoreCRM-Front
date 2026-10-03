import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
  email,
  form,
  FormField,
  FormRoot,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
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
  AgenciesApiService,
  LeadDto,
  LeadsApiService,
  ProductsApiService,
  UpdateLeadRequest,
  UpdateLeadRequestGenderEnum,
} from '@sankore/crm-api';
import { CURRENCY_OPTIONS } from '../create-lead/create-lead';

export interface EditLeadInfoDrawerData {
  lead: LeadDto;
}

/**
 * Genres, aux **noms** du contrat (`UpdateLeadRequestGenderEnum`).
 *
 * Les valeurs étaient les indices `'0'..'3'`, convertis à la soumission par
 * `Number(value.gender) as UpdateLeadRequestGenderEnum`. L'énumération est devenue une énumération
 * de chaînes : `Number('Male')` rend `NaN`, sérialisé en `null`. Le genre n'était donc plus jamais
 * enregistré, et le transtypage empêchait le compilateur de le dire.
 *
 * `LeadDto.gender` reste un `string` libre au contrat : `genderFromLead` accepte les deux formes.
 */
export const GENDER_OPTIONS = [
  { label: 'Non précisé', value: UpdateLeadRequestGenderEnum.Unknown },
  { label: 'Masculin', value: UpdateLeadRequestGenderEnum.Male },
  { label: 'Féminin', value: UpdateLeadRequestGenderEnum.Female },
  { label: 'Autre', value: UpdateLeadRequestGenderEnum.Other },
];

/** Ordre des anciens indices numériques, pour relire une fiche écrite avant la bascule. */
const GENDER_BY_INDEX = [
  UpdateLeadRequestGenderEnum.Unknown,
  UpdateLeadRequestGenderEnum.Male,
  UpdateLeadRequestGenderEnum.Female,
  UpdateLeadRequestGenderEnum.Other,
];

/**
 * Ramène `LeadDto.gender` au nom du contrat. Le serveur a renvoyé des indices (« 1 ») avant la
 * bascule et renvoie des noms (« Male ») après : les deux sont acceptés, et une valeur inconnue
 * donne une chaîne vide plutôt qu'une sélection fausse.
 */
export function genderFromLead(gender: string | null | undefined): string {
  if (gender == null || gender === '') return '';
  const raw = String(gender);
  if (GENDER_OPTIONS.some((o) => o.value === raw)) return raw;
  const index = Number(raw);
  return Number.isInteger(index) && GENDER_BY_INDEX[index] ? GENDER_BY_INDEX[index] : '';
}

/** `UpdateLeadRequest.preferredLanguage` est une chaîne libre ; on reprend les valeurs de
 *  `UpdateCompanyInfoCommand.defaultLanguage`, seul endroit du contrat où elles sont énumérées. */
export const LANGUAGE_OPTIONS = [
  // `tas-select` n'offre pas de bouton d'effacement : sans une option à valeur vide, une langue
  // choisie par erreur ne pourrait plus être retirée.
  { label: 'Non précisée', value: '' },
  { label: 'Français', value: 'Fr' },
  { label: 'Anglais', value: 'En' },
];

/** Même convention que `GENDER_OPTIONS` : `LeadDto.gender` arrive en chaîne numérique. */
export function genderLabel(gender: string | null | undefined): string {
  const normalised = genderFromLead(gender);
  if (!normalised) return '—';
  return GENDER_OPTIONS.find((o) => o.value === normalised)?.label ?? normalised;
}

function todayISODate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export class EditLeadInfoFormModel {
  public firstName!: string;
  public lastName!: string;
  public email!: string;
  public gender!: string;
  public dateOfBirth!: string;
  public interestedProduct!: string;
  public desiredAmount!: string;
  public desiredCurrency!: string;
  public preferredLanguage!: string;
  public campaign!: string;
  public preferredAgencyId!: string;
  public comment!: string;

  public static fromLead(lead: LeadDto): EditLeadInfoFormModel {
    const m = new EditLeadInfoFormModel();
    m.firstName = lead.firstName ?? '';
    m.lastName = lead.lastName ?? '';
    m.email = lead.email ?? '';
    m.gender = genderFromLead(lead.gender);
    m.dateOfBirth = lead.dateOfBirth ?? '';
    m.interestedProduct = lead.interestedProduct ?? '';
    m.desiredAmount =
      lead.desiredAmount?.amount != null ? String(lead.desiredAmount.amount) : '';
    m.desiredCurrency = lead.desiredAmount?.currency ?? 'XOF';
    m.preferredLanguage = lead.preferredLanguage ?? '';
    m.campaign = lead.campaign ?? '';
    m.preferredAgencyId = lead.preferredAgencyId ?? '';
    m.comment = lead.comment ?? '';
    return m;
  }
}

@Component({
  selector: 'edit-lead-info-drawer',
  templateUrl: './edit-lead-info-drawer.html',
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
})
export class EditLeadInfoDrawer {
  public readonly data: EditLeadInfoDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly genderOptions = GENDER_OPTIONS;
  public readonly languageOptions = LANGUAGE_OPTIONS;
  public readonly currencyOptions = CURRENCY_OPTIONS;

  public agencies = signal<{ label: string; value: string }[]>([]);

  private readonly _products = toSignal(
    this._productsApiService.listProducts().pipe(
      map((products) =>
        (products ?? []).map((p) => ({
          label: p.name ?? p.code ?? '',
          value: p.code ?? '',
        })),
      ),
      catchError(() => EMPTY),
    ),
    { initialValue: [] as { label: string; value: string }[] },
  );

  // Un lead capturé hors catalogue peut porter un produit qui n'est plus (ou pas) dans la liste :
  // sans cette option de repli, le select afficherait le placeholder tout en renvoyant l'ancienne
  // valeur à la soumission — l'utilisateur croirait le champ vide.
  public readonly productOptions = computed(() => {
    const options = this._products();
    const current = this.data.lead.interestedProduct;
    if (!current || options.some((o) => o.value === current)) return options;
    return [{ label: current, value: current }, ...options];
  });

  public model = signal(EditLeadInfoFormModel.fromLead(this.data.lead));

  public formSchema = form(this.model, (schema) => {
    email(schema.email, { message: 'Adresse e-mail invalide' });

    validate(schema.dateOfBirth, (ctx) => {
      const value = ctx.value();
      if (!value) return null;
      return value > todayISODate()
        ? { kind: 'max', message: 'La date de naissance ne peut pas être dans le futur' }
        : null;
    });

    validate(schema.desiredAmount, (ctx) => {
      const value = ctx.value();
      if (!value) return null;
      const amount = Number(value);
      return Number.isNaN(amount) || amount < 0
        ? { kind: 'min', message: 'Le montant doit être un nombre positif' }
        : null;
    });

    validate(schema.desiredCurrency, (ctx) => {
      if (ctx.valueOf(schema.desiredAmount) && !ctx.value()) {
        return { kind: 'required', message: 'La devise est obligatoire avec un montant' };
      }
      return null;
    });
  });

  constructor() {
    this._loadAgencies();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const lead = this.data.lead;

      const nameChanged =
        value.firstName !== (lead.firstName ?? '') ||
        value.lastName !== (lead.lastName ?? '');
      const derivedFullName = [value.firstName, value.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();

      // `PUT /leads/{id}` remplace tout le contrat : un champ que le formulaire n'expose pas doit
      // être renvoyé tel quel. Sans `latitude`/`longitude`, on effacerait les coordonnées posées
      // par une activité de type visite ; et `fullName` n'est réécrit que si le nom a bougé, pour
      // ne pas écraser un nom complet issu d'un import qui ne se réduit pas à « prénom + nom ».
      const request: UpdateLeadRequest = {
        fullName: nameChanged && derivedFullName ? derivedFullName : lead.fullName ?? null,
        firstName: value.firstName || null,
        lastName: value.lastName || null,
        email: value.email || null,
        gender: (value.gender || null) as UpdateLeadRequestGenderEnum | null,
        dateOfBirth: value.dateOfBirth || null,
        interestedProduct: value.interestedProduct || null,
        desiredAmount: value.desiredAmount ? Number(value.desiredAmount) : null,
        desiredCurrency: value.desiredAmount ? value.desiredCurrency || null : null,
        preferredLanguage: value.preferredLanguage || null,
        campaign: value.campaign || null,
        comment: value.comment || null,
        latitude: lead.latitude ?? null,
        longitude: lead.longitude ?? null,
        preferredAgencyId: value.preferredAgencyId || null,
        expectedUpdatedAt: lead.updatedAt ?? null,
      };

      const saved = await firstValueFrom(
        this._leadsApiService.updateLead(lead.id!, request).pipe(
          // 204 No Content : sans ce `map`, `firstValueFrom` résout sur `null` et le succès
          // serait indiscernable d'une erreur avalée.
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
      );

      if (saved) {
        this._snackbar.success(
          'Informations mises à jour',
          'La fiche du lead a été enregistrée.',
        );
        this._dialogRef.close(true);
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 409) {
      return 'La fiche a été modifiée entre-temps. Rechargez la page avant de réessayer.';
    }
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return firstError ?? error.error?.title ?? 'Impossible de mettre à jour le lead.';
  }

  private _loadAgencies(): void {
    this._agenciesApiService
      .listAgencies(false, 1, 200)
      .pipe(
        map((res) => [
          // Même raison que LANGUAGE_OPTIONS : permettre de retirer l'agence préférée.
          { label: 'Aucune agence préférée', value: '' },
          ...(res.items ?? []).map((a) => ({
            label: a.name ?? '',
            value: a.id ?? '',
          })),
        ]),
        catchError(() => EMPTY),
      )
      .subscribe((options) => this.agencies.set(options));
  }
}
