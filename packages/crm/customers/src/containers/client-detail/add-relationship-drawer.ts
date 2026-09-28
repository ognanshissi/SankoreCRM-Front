import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import {
  form,
  FormField,
  FormRoot,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  firstValueFrom,
  of,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import {
  AddRelationshipRequest,
  AddRelationshipRequestTypeEnum,
  ClientRelationshipsApiService,
  ClientSearchItemDto,
  ClientsApiService,
} from '@sankore/crm-api';
import { clientTypeLabel } from '../../models/client-labels';

/**
 * Libellés des types de relation.
 *
 * `RelationshipDto.type` et `AddRelationshipRequest.type` énumèrent tous deux les mêmes huit
 * valeurs en clair — pas de décalage chaîne/entier ici, contrairement au reste du module.
 *
 * Ces constantes vivent dans le drawer et non dans l'onglet : `relations.ts` importe déjà le
 * drawer pour l'ouvrir, et les placer là-bas créerait un cycle d'imports entre les deux
 * fichiers, dont la résolution dépendrait de l'ordre d'évaluation des modules.
 */
export const RELATIONSHIP_TYPE_LABELS: Record<string, string> = {
  Spouse: 'Conjoint',
  Child: 'Enfant',
  Dependent: 'Personne à charge',
  Parent: 'Parent',
  Sibling: 'Frère ou sœur',
  Guarantor: 'Garant',
  Proxy: 'Mandataire',
  Other: 'Autre',
};

export function relationshipTypeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return RELATIONSHIP_TYPE_LABELS[value] ?? value;
}

/** `tas-select` ne travaille qu'avec des chaînes : les valeurs du contrat le sont déjà. */
export const RELATIONSHIP_TYPE_OPTIONS = Object.entries(RELATIONSHIP_TYPE_LABELS).map(
  ([value, label]) => ({ label, value }),
);

export interface AddRelationshipDrawerData {
  /** Client dont on complète les relations : il est exclu des résultats de recherche. */
  clientId: string;
  clientDisplayName: string;
}

/**
 * Formulaire d'ajout d'une relation.
 *
 * `mode` fait partie du modèle et non d'un signal à côté : les règles « un client rattaché »
 * et « un nom de personne externe » s'excluent, et le contrat refuse les deux ensemble
 * (`Provide either relatedClientId or externalFullName, never both`). En passant `mode` par
 * le formulaire, les validateurs conditionnels lisent la bascule via `ctx.valueOf(...)` au
 * lieu de dépendre d'un état que `form()` ne voit pas.
 */
export class AddRelationshipFormModel {
  public mode!: 'client' | 'external';
  public type!: string;
  public relatedClientId!: string;
  /** Affichage seul : le libellé du client retenu, jamais envoyé. */
  public relatedClientLabel!: string;
  public externalFullName!: string;
  public externalPhoneNumber!: string;
  public externalDateOfBirth!: string;
  public externalDocumentNumber!: string;

  public static instantiate(): AddRelationshipFormModel {
    const m = new AddRelationshipFormModel();
    m.mode = 'client';
    m.type = '';
    m.relatedClientId = '';
    m.relatedClientLabel = '';
    m.externalFullName = '';
    m.externalPhoneNumber = '';
    m.externalDateOfBirth = '';
    m.externalDocumentNumber = '';
    return m;
  }
}

@Component({
  selector: 'add-relationship-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasSpinner,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasDatePicker,
    FormsModule,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:link" style="font-size:18px"></tas-icon>
          <span>Ajouter une relation</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <p class="text-sm text-slate-500">
            Vous rattachez une relation à {{ data.clientDisplayName }}.
          </p>

          <tas-form-field>
            <tas-label>Type de relation <span class="text-functional-error">*</span></tas-label>
            <tas-select
              [options]="typeOptions"
              placeholder="Choisissez un type"
              [formField]="formSchema.type"
            ></tas-select>
            @if (formSchema.type().touched() && formSchema.type().invalid()) {
              <tas-error>{{ formSchema.type().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <div class="flex gap-2">
            <button
              tas-outlined-button
              type="button"
              [color]="isClientMode() ? 'primary' : 'neutral'"
              (click)="selectMode('client')"
            >
              Rechercher un client
            </button>
            <button
              tas-outlined-button
              type="button"
              [color]="isClientMode() ? 'neutral' : 'primary'"
              (click)="selectMode('external')"
            >
              Saisir une personne externe
            </button>
          </div>

          @if (isClientMode()) {
            <div class="flex flex-col gap-3">
              <tas-form-field>
                <tas-label>Client à rattacher <span class="text-functional-error">*</span></tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="Nom, raison sociale…"
                  [ngModel]="searchTerm()"
                  (ngModelChange)="onSearchTermChange($event)"
                  [ngModelOptions]="{ standalone: true }"
                />
                <tas-hint>Tapez au moins deux caractères pour lancer la recherche.</tas-hint>
              </tas-form-field>

              @if (selectedClientLabel()) {
                <div
                  class="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 p-3"
                >
                  <div class="text-sm">
                    <p class="font-medium text-slate-700">{{ selectedClientLabel() }}</p>
                    <p class="text-xs text-slate-500">Client retenu</p>
                  </div>
                  <button
                    tas-text-button
                    color="warn"
                    type="button"
                    (click)="clearSelectedClient()"
                  >
                    Retirer
                  </button>
                </div>
              }

              @if (isSearching()) {
                <div class="flex justify-center py-4">
                  <tas-spinner size="6" class="text-primary"></tas-spinner>
                </div>
              } @else if (results().length > 0) {
                <ul class="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  @for (candidate of results(); track candidate.id) {
                    <li>
                      <button
                        type="button"
                        class="flex w-full items-center justify-between p-3 text-left hover:bg-slate-50"
                        (click)="selectClient(candidate)"
                      >
                        <span class="text-sm">
                          <span class="block font-medium text-slate-700">
                            {{ candidate.displayName || '—' }}
                          </span>
                          <span class="block text-xs text-slate-500">
                            {{ candidate.clientNumber || '—' }} ·
                            {{ clientTypeLabel(candidate.clientType) }}
                          </span>
                        </span>
                        <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
                      </button>
                    </li>
                  }
                </ul>
              } @else if (hasSearched() && searchTerm().trim().length >= 2) {
                <p class="text-sm text-slate-500">Aucun client ne correspond à cette recherche.</p>
              }

              @if (formSchema.relatedClientId().touched() && formSchema.relatedClientId().invalid()) {
                <p class="text-xs text-functional-error">
                  {{ formSchema.relatedClientId().errors()[0].message }}
                </p>
              }
            </div>
          } @else {
            <div class="flex flex-col gap-4">
              <tas-form-field>
                <tas-label>
                  Nom complet <span class="text-functional-error">*</span>
                </tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="Prénom et nom"
                  [formField]="formSchema.externalFullName"
                />
                @if (
                  formSchema.externalFullName().touched() && formSchema.externalFullName().invalid()
                ) {
                  <tas-error>{{ formSchema.externalFullName().errors()[0].message }}</tas-error>
                }
              </tas-form-field>

              <div class="grid grid-cols-2 gap-3">
                <tas-form-field>
                  <tas-label>Téléphone</tas-label>
                  <input
                    tasInput
                    type="tel"
                    placeholder="+225 01 02 03 04 05"
                    [formField]="formSchema.externalPhoneNumber"
                  />
                </tas-form-field>

                <div>
                  <tas-date-picker
                    mode="date"
                    placeholder="Sélectionnez une date"
                    [formField]="formSchema.externalDateOfBirth">
                    Date de naissance
                  </tas-date-picker>
                  @if (
                    formSchema.externalDateOfBirth().touched() &&
                    formSchema.externalDateOfBirth().invalid()
                  ) {
                    <tas-error>{{ formSchema.externalDateOfBirth().errors()[0].message }}</tas-error>
                  }
                </div>
              </div>

              <tas-form-field>
                <tas-label>Numéro de pièce d'identité</tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="Numéro du document"
                  [formField]="formSchema.externalDocumentNumber"
                />
                <tas-hint>
                  Le numéro est chiffré côté serveur et ne revient que masqué.
                </tas-hint>
              </tas-form-field>
            </div>
          }

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
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          Ajouter la relation
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class AddRelationshipDrawer {
  public readonly data: AddRelationshipDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _relationshipsApi = inject(ClientRelationshipsApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly typeOptions = RELATIONSHIP_TYPE_OPTIONS;
  public readonly clientTypeLabel = clientTypeLabel;

  public readonly searchTerm = signal('');
  public readonly results = signal<ClientSearchItemDto[]>([]);
  public readonly isSearching = signal(false);
  public readonly hasSearched = signal(false);
  public readonly submitError = signal<string | null>(null);

  private readonly _search$ = new Subject<string>();

  public model = signal(AddRelationshipFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.type, { message: 'Le type de relation est obligatoire' });

    validate(schema.relatedClientId, (ctx) => {
      if (ctx.valueOf(schema.mode) !== 'client') return null;
      return ctx.value()
        ? null
        : { kind: 'required', message: 'Choisissez un client dans les résultats de recherche' };
    });

    validate(schema.externalFullName, (ctx) => {
      if (ctx.valueOf(schema.mode) !== 'external') return null;
      return ctx.value().trim()
        ? null
        : { kind: 'required', message: 'Le nom complet est obligatoire' };
    });

    validate(schema.externalDateOfBirth, (ctx) => {
      const value = ctx.value();
      if (!value) return null;
      return value > todayISODate()
        ? { kind: 'max', message: 'La date de naissance ne peut pas être dans le futur' }
        : null;
    });
  });

  public readonly isClientMode = computed(() => this.formSchema.mode().value() === 'client');
  public readonly selectedClientLabel = computed(() =>
    this.formSchema.relatedClientLabel().value(),
  );

  constructor() {
    // La recherche de client est une barre de recherche : elle reste en signaux + ngModel
    // debouncés, et seul le client retenu entre dans le formulaire.
    this._search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((term) => {
          this.isSearching.set(term.trim().length >= 2);
          if (term.trim().length < 2) {
            this.results.set([]);
            this.hasSearched.set(false);
          }
        }),
        switchMap((term) => {
          if (term.trim().length < 2) return of(null);
          return this._clientsApi
            .searchClients(
              undefined,
              undefined,
              undefined,
              term.trim(),
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              1,
              10,
            )
            .pipe(
              catchError(() => {
                this._snackbar.error('Erreur', 'La recherche de clients a échoué.');
                return of(null);
              }),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((page) => {
        this.isSearching.set(false);
        if (!page) return;
        this.hasSearched.set(true);
        // Le contrat refuse une relation d'un client vers lui-même
        // (SELF_RELATIONSHIP_FORBIDDEN) : autant ne pas le proposer.
        this.results.set((page.items ?? []).filter((c) => c.id !== this.data.clientId));
      });
  }

  public onSearchTermChange(term: string): void {
    this.searchTerm.set(term);
    this._search$.next(term);
  }

  public selectMode(mode: 'client' | 'external'): void {
    if (this.formSchema.mode().value() === mode) return;
    this.formSchema.mode().value.set(mode);
    this.submitError.set(null);
    // Les deux saisies s'excluent : on vide celle qu'on quitte pour ne jamais envoyer les deux.
    if (mode === 'client') {
      this.formSchema.externalFullName().value.set('');
      this.formSchema.externalPhoneNumber().value.set('');
      this.formSchema.externalDateOfBirth().value.set('');
      this.formSchema.externalDocumentNumber().value.set('');
    } else {
      this.clearSelectedClient();
    }
  }

  public selectClient(candidate: ClientSearchItemDto): void {
    this.formSchema.relatedClientId().value.set(candidate.id ?? '');
    this.formSchema
      .relatedClientLabel()
      .value.set(
        [candidate.displayName, candidate.clientNumber].filter(Boolean).join(' · ') || 'Client',
      );
    this.results.set([]);
    this.searchTerm.set('');
    this.hasSearched.set(false);
  }

  public clearSelectedClient(): void {
    this.formSchema.relatedClientId().value.set('');
    this.formSchema.relatedClientLabel().value.set('');
  }

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const isClient = value.mode === 'client';

      const request: AddRelationshipRequest = {
        type: value.type as AddRelationshipRequestTypeEnum,
        relatedClientId: isClient ? value.relatedClientId : null,
        externalFullName: isClient ? null : value.externalFullName.trim(),
        externalPhoneNumber: isClient ? null : value.externalPhoneNumber.trim() || null,
        externalDateOfBirth: isClient ? null : value.externalDateOfBirth || null,
        externalDocumentNumber: isClient ? null : value.externalDocumentNumber.trim() || null,
      };

      const result = await firstValueFrom(
        this._relationshipsApi.addClientRelationship(this.data.clientId, request).pipe(
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Erreur', message);
            return EMPTY;
          }),
        ),
      );

      if (result) {
        this._snackbar.success('Relation ajoutée', 'La relation a été enregistrée.');
        this._dialogRef.close(true);
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    switch (body?.code) {
      case 'SELF_RELATIONSHIP_FORBIDDEN':
        return 'Un client ne peut pas être mis en relation avec lui-même.';
      case 'CLIENT_READ_ONLY':
        return 'Cette fiche est archivée ou fusionnée : elle ne se modifie plus.';
    }
    if (error.status === 403) {
      return "Vous n'avez pas le droit de modifier les relations de ce client.";
    }
    if (error.status === 404) {
      return "Le client à rattacher est introuvable dans votre périmètre d'agence.";
    }
    const firstValidation = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
    return (
      firstValidation ?? body?.detail ?? body?.title ?? "Impossible d'ajouter cette relation."
    );
  }
}

function todayISODate(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default AddRelationshipDrawer;
