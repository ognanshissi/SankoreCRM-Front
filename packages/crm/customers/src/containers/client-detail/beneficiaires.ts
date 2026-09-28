import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  finalize,
  of,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { PermissionsService } from '@sankore/crm/common';
import {
  BeneficialOwnerDto,
  BeneficialOwnerInput,
  BeneficialOwnerInputControlTypeEnum,
  ClientSearchItemDto,
  ClientsApiService,
  LegalEntitiesApiService,
} from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import { CONTROL_TYPE_OPTIONS, controlTypeLabel } from '../../models/client-labels';

/**
 * Seuil de détention au-delà duquel un bénéficiaire est « significatif ».
 *
 * Le contrat le décrit comme un réglage de tenant (`beneficial-owner-threshold`, défaut 25) mais
 * ne l'expose par aucun endpoint : la valeur est donc reprise en dur côté front, uniquement pour
 * prévenir l'utilisateur avant l'envoi. Le serveur reste l'autorité — s'il refuse avec
 * MANAGER_BENEFICIAL_OWNER_REQUIRED, l'erreur est affichée telle quelle.
 */
const BENEFICIAL_OWNER_THRESHOLD = 25;

/** Une ligne de l'éditeur. `key` n'est qu'une clé de suivi locale, jamais envoyée. */
interface OwnerRow {
  key: string;
  linkedClientId: string;
  linkedClientLabel: string;
  externalFullName: string;
  externalNationality: string;
  externalDateOfBirth: string;
  externalDocumentNumber: string;
  /** Texte : un input rend du texte, la conversion se fait à l'envoi. */
  ownershipPercentage: string;
  controlType: string;
}

let rowCounter = 0;
function nextRowKey(): string {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

@Component({
  selector: 'client-beneficiaires',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasCard,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    Anchor,
    RouterLink,
    TasFormField,
    TasLabel,
    TasHint,
    TasInput,
    TasSelect,
    TasDatePicker,
    FormsModule,
  ],
  template: `
    <div class="flex flex-col gap-4">
      <tas-card class="block">
        <div class="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p class="text-sm font-medium text-slate-700">Bénéficiaires effectifs</p>
            <p class="text-xs text-slate-500">
              {{ activeOwners().length }} bénéficiaire(s) actif(s) · total déclaré
              <span class="tabular-nums font-medium">{{ formatPercent(activeTotal()) }}</span>
            </p>
          </div>
          @if (canDeclare() && !store.isReadOnly() && !isEditing()) {
            <button tas-raised-button color="primary" type="button" (click)="startEditing()">
              <tas-icon iconName="feather:edit-2" style="font-size:14px"></tas-icon>
              Modifier la structure
            </button>
          }
        </div>
      </tas-card>

      @if (isLoading()) {
        <div class="flex justify-center py-16">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else if (isEditing()) {
        <!-- ——— Éditeur de la structure ——— -->
        <tas-card class="block">
          <div class="border-b border-slate-200 p-4">
            <p class="text-sm font-medium text-slate-700">Déclarer la structure complète</p>
            <p class="mt-1 text-xs text-slate-500">
              La déclaration remplace la structure : un bénéficiaire retiré de cette liste est
              clôturé, jamais supprimé, et reste visible dans l'historique.
            </p>
          </div>

          <div class="flex flex-col gap-4 p-4">
            @for (row of rows(); track row.key; let index = $index) {
              <div
                class="rounded-lg border p-4"
                [class.border-slate-200]="!rowError(row.key)"
                [class.border-functional-error]="!!rowError(row.key)"
              >
                <div class="mb-3 flex items-center justify-between gap-2">
                  <p class="text-xs font-medium text-slate-500">Bénéficiaire {{ index + 1 }}</p>
                  <button
                    tas-text-button
                    color="warn"
                    type="button"
                    iconButton
                    (click)="removeRow(row.key)"
                  >
                    <tas-icon iconName="feather:trash-2" style="font-size:14px"></tas-icon>
                  </button>
                </div>

                <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <tas-form-field>
                    <tas-label>Type de contrôle <span class="text-functional-error">*</span></tas-label>
                    <tas-select
                      [options]="controlTypeOptions"
                      placeholder="Choisissez un type"
                      [ngModel]="row.controlType"
                      (ngModelChange)="patchRow(row.key, { controlType: $event })"
                    ></tas-select>
                  </tas-form-field>

                  <tas-form-field>
                    <tas-label>Pourcentage de détention</tas-label>
                    <input
                      tasInput
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      placeholder="0"
                      [ngModel]="row.ownershipPercentage"
                      (ngModelChange)="setPercentage(row.key, $event)"
                    />
                    <tas-hint>Entre 0 et 100.</tas-hint>
                  </tas-form-field>

                  <div class="flex items-end">
                    @if (row.linkedClientId) {
                      <div class="w-full rounded-lg border border-primary/40 bg-primary/5 p-2">
                        <p class="text-xs text-slate-500">Client rattaché</p>
                        <div class="flex items-center justify-between gap-2">
                          <span class="truncate text-sm font-medium text-slate-700">
                            {{ row.linkedClientLabel || 'Client' }}
                          </span>
                          <button
                            tas-text-button
                            color="warn"
                            type="button"
                            (click)="unlinkClient(row.key)"
                          >
                            Détacher
                          </button>
                        </div>
                      </div>
                    } @else {
                      <button
                        tas-outlined-button
                        color="primary"
                        type="button"
                        (click)="openPicker(row.key)"
                      >
                        Rattacher un client
                      </button>
                    }
                  </div>
                </div>

                @if (!row.linkedClientId) {
                  <div class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <tas-form-field>
                      <tas-label>Nom complet <span class="text-functional-error">*</span></tas-label>
                      <input
                        tasInput
                        type="text"
                        placeholder="Prénom et nom"
                        [ngModel]="row.externalFullName"
                        (ngModelChange)="patchRow(row.key, { externalFullName: $event })"
                      />
                    </tas-form-field>

                    <tas-form-field>
                      <tas-label>Nationalité</tas-label>
                      <input
                        tasInput
                        type="text"
                        placeholder="Ivoirienne"
                        [ngModel]="row.externalNationality"
                        (ngModelChange)="patchRow(row.key, { externalNationality: $event })"
                      />
                    </tas-form-field>

                    <div>
                      <tas-date-picker
                        mode="date"
                        placeholder="Sélectionnez une date"
                        [ngModel]="row.externalDateOfBirth"
                        (ngModelChange)="setDateOfBirth(row.key, $event)">
                        Date de naissance
                      </tas-date-picker>
                    </div>

                    <tas-form-field>
                      <tas-label>Numéro de pièce d'identité</tas-label>
                      <input
                        tasInput
                        type="text"
                        placeholder="Numéro du document"
                        [ngModel]="row.externalDocumentNumber"
                        (ngModelChange)="patchRow(row.key, { externalDocumentNumber: $event })"
                      />
                    </tas-form-field>
                  </div>
                }

                @if (rowError(row.key)) {
                  <p class="mt-3 text-xs text-functional-error">{{ rowError(row.key) }}</p>
                }

                @if (pickerRowKey() === row.key) {
                  <div class="mt-3 rounded-lg border border-slate-200 p-3">
                    <tas-form-field>
                      <tas-label>Rechercher un client</tas-label>
                      <input
                        tasInput
                        type="text"
                        placeholder="Nom, raison sociale…"
                        [ngModel]="searchTerm()"
                        (ngModelChange)="onSearchTermChange($event)"
                      />
                      <tas-hint>Tapez au moins deux caractères.</tas-hint>
                    </tas-form-field>

                    @if (isSearching()) {
                      <div class="flex justify-center py-3">
                        <tas-spinner size="6" class="text-primary"></tas-spinner>
                      </div>
                    } @else if (results().length > 0) {
                      <ul class="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                        @for (candidate of results(); track candidate.id) {
                          <li>
                            <button
                              type="button"
                              class="flex w-full items-center justify-between p-2 text-left hover:bg-slate-50"
                              (click)="linkClient(row.key, candidate)"
                            >
                              <span class="text-sm">
                                <span class="block font-medium text-slate-700">
                                  {{ candidate.displayName || '—' }}
                                </span>
                                <span class="block text-xs text-slate-500">
                                  {{ candidate.clientNumber || '—' }}
                                </span>
                              </span>
                              <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
                            </button>
                          </li>
                        }
                      </ul>
                    } @else if (hasSearched()) {
                      <p class="mt-2 text-sm text-slate-500">Aucun client ne correspond.</p>
                    }

                    <button
                      tas-text-button
                      color="neutral"
                      type="button"
                      class="mt-2"
                      (click)="closePicker()"
                    >
                      Fermer la recherche
                    </button>
                  </div>
                }
              </div>
            }

            <div>
              <button tas-outlined-button color="primary" type="button" (click)="addRow()">
                <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
                Ajouter un bénéficiaire
              </button>
            </div>

            <!-- Total en temps réel : c'est la règle la plus souvent enfreinte, elle doit se voir
                 avant l'envoi et non dans un message d'erreur du serveur. -->
            <div
              class="flex items-center justify-between rounded-lg border p-3"
              [class.bg-slate-50]="!isTotalExceeded()"
              [class.border-slate-200]="!isTotalExceeded()"
              [class.border-functional-error]="isTotalExceeded()"
            >
              <span class="text-sm text-slate-600">Total des détentions déclarées</span>
              <span
                class="text-sm font-medium tabular-nums"
                [class.text-slate-700]="!isTotalExceeded()"
                [class.text-functional-error]="isTotalExceeded()"
              >
                {{ formatPercent(editedTotal()) }} / 100 %
              </span>
            </div>

            <tas-form-field>
              <tas-label>Motif de la déclaration</tas-label>
              <input
                tasInput
                type="text"
                placeholder="Mise à jour annuelle, entrée d'un nouvel associé…"
                [ngModel]="reason()"
                (ngModelChange)="reason.set($event)"
              />
              <tas-hint>Le motif est conservé dans la piste d'audit.</tas-hint>
            </tas-form-field>

            @if (globalError()) {
              <div class="rounded-lg border border-functional-error p-3">
                <p class="text-sm text-functional-error">{{ globalError() }}</p>
              </div>
            }

            <p class="text-xs text-slate-500">
              La date de naissance et la pièce d'identité d'un bénéficiaire externe reviennent
              masquées du serveur : si vous le conservez dans la déclaration, saisissez-les de
              nouveau pour ne pas les perdre.
            </p>
          </div>

          <div class="flex justify-end gap-2 border-t border-slate-200 p-4">
            <button
              tas-outlined-button
              color="primary"
              type="button"
              [disabled]="isSaving()"
              (click)="cancelEditing()"
            >
              Annuler
            </button>
            @if (canDeclare() && !store.isReadOnly()) {
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="isSaving()"
                [isLoading]="isSaving()"
                (click)="save()"
              >
                Enregistrer la structure
              </button>
            }
          </div>
        </tas-card>
      } @else {
        <!-- ——— Bénéficiaires actifs ——— -->
        <tas-card class="block">
          <div class="flex items-center gap-2 border-b border-slate-200 p-4">
            <tas-icon iconName="feather:users" style="font-size:16px" class="text-primary"></tas-icon>
            <p class="text-sm font-medium text-slate-700">Bénéficiaires actifs</p>
          </div>

          @if (activeOwners().length === 0) {
            <div class="p-10 text-center">
              <p class="text-sm font-medium text-slate-700">Aucun bénéficiaire effectif déclaré</p>
              <p class="mt-1 text-sm text-slate-500">
                La structure de détention reste à renseigner pour cette personne morale.
              </p>
            </div>
          } @else {
            <ul class="divide-y divide-slate-100">
              @for (owner of activeOwners(); track owner.id) {
                <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      @if (owner.linkedClientId) {
                        <a
                          tas-text-button
                          color="primary"
                          [routerLink]="['/customers', owner.linkedClientId]"
                        >
                          {{ owner.linkedClientDisplayName || 'Fiche client' }}
                        </a>
                      } @else {
                        <span class="text-sm font-medium text-slate-700">
                          {{ owner.externalFullName || '—' }}
                        </span>
                      }
                      <tas-tag [severity]="ownerSeverity(owner)">
                        {{ controlLabel(owner.controlType) }}
                      </tas-tag>
                    </div>
                    <p class="mt-1 text-xs text-slate-500">
                      @if (owner.linkedClientId) {
                        Client {{ owner.linkedClientNumber || '—' }}
                      } @else {
                        Personne externe
                        @if (owner.externalNationality) {
                          · {{ owner.externalNationality }}
                        }
                        @if (owner.externalDateOfBirthMasked) {
                          · né(e) le {{ owner.externalDateOfBirthMasked }}
                        }
                        @if (owner.externalDocumentNumberMasked) {
                          · pièce {{ owner.externalDocumentNumberMasked }}
                        }
                      }
                      · depuis le {{ formatDate(owner.validFrom) }}
                    </p>
                  </div>

                  <span class="text-sm font-medium tabular-nums text-slate-700">
                    {{ formatPercent(owner.ownershipPercentage) }}
                  </span>
                </li>
              }
            </ul>
            <div
              class="flex items-center justify-between border-t border-slate-200 p-4 text-sm"
              [class.text-functional-error]="activeTotal() > 100"
            >
              <span class="text-slate-600">Total des détentions</span>
              <span class="font-medium tabular-nums">{{ formatPercent(activeTotal()) }}</span>
            </div>
          }
        </tas-card>

        <!-- ——— Historique ——— -->
        <tas-card class="block">
          <div class="flex items-center gap-2 border-b border-slate-200 p-4">
            <tas-icon
              iconName="feather:archive"
              style="font-size:16px"
              class="text-slate-400"
            ></tas-icon>
            <p class="text-sm font-medium text-slate-700">Historique</p>
            <span class="text-xs text-slate-500 tabular-nums">({{ closedOwners().length }})</span>
          </div>

          @if (closedOwners().length === 0) {
            <div class="p-6 text-sm text-slate-500">
              Aucun bénéficiaire clôturé pour l'instant.
            </div>
          } @else {
            <ul class="divide-y divide-slate-100">
              @for (owner of closedOwners(); track owner.id) {
                <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      @if (owner.linkedClientId) {
                        <a
                          tas-text-button
                          color="primary"
                          [routerLink]="['/customers', owner.linkedClientId]"
                        >
                          {{ owner.linkedClientDisplayName || 'Fiche client' }}
                        </a>
                      } @else {
                        <span class="text-sm font-medium text-slate-500">
                          {{ owner.externalFullName || '—' }}
                        </span>
                      }
                      <tas-tag severity="neutral">{{ controlLabel(owner.controlType) }}</tas-tag>
                    </div>
                    <p class="mt-1 text-xs text-slate-500">
                      Du {{ formatDate(owner.validFrom) }} au {{ formatDate(owner.validTo) }}
                    </p>
                  </div>
                  <span class="text-sm tabular-nums text-slate-500">
                    {{ formatPercent(owner.ownershipPercentage) }}
                  </span>
                </li>
              }
            </ul>
          }
        </tas-card>
      }
    </div>
  `,
})
export class ClientBeneficialOwnersPage {
  protected readonly store = inject(ClientDetailStore);
  private readonly _legalEntitiesApi = inject(LegalEntitiesApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);

  /**
   * Déclarer la structure de détention passe par `POST /clients/{id}/beneficial-owners`, que le
   * contrat protège par `customers:update_sensitive` et non par `customers:update` : un conseiller
   * qui peut corriger une adresse n'a pas pour autant le droit de toucher aux bénéficiaires
   * effectifs. La traduction du 403 reste en filet, au cas où le serveur refuse quand même.
   */
  protected readonly canDeclare = this._permissions.can('customers:update_sensitive');

  protected readonly controlTypeOptions = CONTROL_TYPE_OPTIONS;
  protected readonly controlLabel = controlTypeLabel;

  protected readonly owners = signal<BeneficialOwnerDto[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly isSaving = signal(false);

  protected readonly isEditing = signal(false);
  protected readonly rows = signal<OwnerRow[]>([]);
  protected readonly reason = signal('');
  /** Erreurs rattachées à une ligne : clé de ligne -> message. */
  protected readonly rowErrors = signal<Record<string, string>>({});
  protected readonly globalError = signal<string | null>(null);

  protected readonly pickerRowKey = signal<string | null>(null);
  protected readonly searchTerm = signal('');
  protected readonly results = signal<ClientSearchItemDto[]>([]);
  protected readonly isSearching = signal(false);
  protected readonly hasSearched = signal(false);

  private readonly _search$ = new Subject<string>();

  protected readonly activeOwners = computed(() =>
    this.owners().filter((o) => o.isActive ?? !o.validTo),
  );
  protected readonly closedOwners = computed(() =>
    this.owners()
      .filter((o) => !(o.isActive ?? !o.validTo))
      .sort((a, b) => (b.validTo ?? '').localeCompare(a.validTo ?? '')),
  );

  protected readonly activeTotal = computed(() =>
    this.activeOwners().reduce((sum, o) => sum + (o.ownershipPercentage ?? 0), 0),
  );
  protected readonly editedTotal = computed(() =>
    this.rows().reduce((sum, row) => sum + (parsePercent(row.ownershipPercentage) ?? 0), 0),
  );
  protected readonly isTotalExceeded = computed(() => this.editedTotal() > 100);

  constructor() {
    effect(() => {
      const clientId = this.store.clientId();
      if (clientId) this._load(clientId);
    });

    // La recherche de client à rattacher est une barre de recherche : signaux + ngModel debouncés.
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
        this.results.set((page.items ?? []).filter((c) => c.id !== this.store.clientId()));
      });
  }

  // ——— Édition ———

  protected startEditing(): void {
    this.rows.set(
      this.activeOwners().map((owner) => ({
        key: nextRowKey(),
        linkedClientId: owner.linkedClientId ?? '',
        linkedClientLabel:
          [owner.linkedClientDisplayName, owner.linkedClientNumber].filter(Boolean).join(' · ') ||
          '',
        externalFullName: owner.externalFullName ?? '',
        externalNationality: owner.externalNationality ?? '',
        // Les valeurs masquées ne se renvoient pas : les champs repartent vides, et un texte
        // sous l'éditeur prévient qu'il faut les ressaisir pour les conserver.
        externalDateOfBirth: '',
        externalDocumentNumber: '',
        ownershipPercentage:
          owner.ownershipPercentage != null ? String(owner.ownershipPercentage) : '',
        controlType: owner.controlType ?? '',
      })),
    );
    this.reason.set('');
    this.rowErrors.set({});
    this.globalError.set(null);
    this.closePicker();
    this.isEditing.set(true);
  }

  protected cancelEditing(): void {
    this.isEditing.set(false);
    this.rows.set([]);
    this.rowErrors.set({});
    this.globalError.set(null);
    this.closePicker();
  }

  protected addRow(): void {
    this.rows.update((rows) => [
      ...rows,
      {
        key: nextRowKey(),
        linkedClientId: '',
        linkedClientLabel: '',
        externalFullName: '',
        externalNationality: '',
        externalDateOfBirth: '',
        externalDocumentNumber: '',
        ownershipPercentage: '',
        controlType: '',
      },
    ]);
  }

  protected removeRow(key: string): void {
    this.rows.update((rows) => rows.filter((row) => row.key !== key));
    this._clearRowError(key);
    if (this.pickerRowKey() === key) this.closePicker();
  }

  protected patchRow(key: string, changes: Partial<OwnerRow>): void {
    this.rows.update((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...changes } : row)),
    );
    this._clearRowError(key);
  }

  protected rowError(key: string): string | null {
    return this.rowErrors()[key] ?? null;
  }

  /**
   * `input[type=number]` passe par `NumberValueAccessor` : `ngModelChange` émet un nombre (ou
   * `null` quand le champ est vidé), alors que la ligne garde le pourcentage en texte. Sans cette
   * conversion, `parsePercent` recevrait un nombre et `.trim()` planterait à la validation.
   */
  protected setPercentage(key: string, value: unknown): void {
    this.patchRow(key, { ownershipPercentage: value == null ? '' : String(value) });
  }

  /** `tas-date-picker` rend `string | null` en mode `date` ; la ligne attend une chaîne. */
  protected setDateOfBirth(key: string, value: unknown): void {
    this.patchRow(key, {
      externalDateOfBirth: typeof value === 'string' ? value : '',
    });
  }

  // ——— Rattachement d'un client ———

  protected openPicker(key: string): void {
    this.pickerRowKey.set(key);
    this.searchTerm.set('');
    this.results.set([]);
    this.hasSearched.set(false);
  }

  protected closePicker(): void {
    this.pickerRowKey.set(null);
    this.searchTerm.set('');
    this.results.set([]);
    this.hasSearched.set(false);
  }

  protected onSearchTermChange(term: string): void {
    this.searchTerm.set(term);
    this._search$.next(term);
  }

  protected linkClient(key: string, candidate: ClientSearchItemDto): void {
    // Le contrat impose l'un ou l'autre : rattacher un client vide la saisie externe.
    this.patchRow(key, {
      linkedClientId: candidate.id ?? '',
      linkedClientLabel:
        [candidate.displayName, candidate.clientNumber].filter(Boolean).join(' · ') || 'Client',
      externalFullName: '',
      externalNationality: '',
      externalDateOfBirth: '',
      externalDocumentNumber: '',
    });
    this.closePicker();
  }

  protected unlinkClient(key: string): void {
    this.patchRow(key, { linkedClientId: '', linkedClientLabel: '' });
  }

  // ——— Enregistrement ———

  protected save(): void {
    const clientId = this.store.clientId();
    if (!clientId) return;

    if (!this._validate()) {
      this._snackbar.error(
        'Déclaration incomplète',
        'Corrigez les lignes signalées avant d’enregistrer.',
      );
      return;
    }

    const owners: BeneficialOwnerInput[] = this.rows().map((row) => {
      const percentage = parsePercent(row.ownershipPercentage);
      return row.linkedClientId
        ? {
            linkedClientId: row.linkedClientId,
            ownershipPercentage: percentage ?? 0,
            controlType: row.controlType as BeneficialOwnerInputControlTypeEnum,
          }
        : {
            externalFullName: row.externalFullName.trim(),
            externalNationality: row.externalNationality.trim() || null,
            externalDateOfBirth: row.externalDateOfBirth || null,
            externalDocumentNumber: row.externalDocumentNumber.trim() || null,
            ownershipPercentage: percentage ?? 0,
            controlType: row.controlType as BeneficialOwnerInputControlTypeEnum,
          };
    });

    this.isSaving.set(true);
    this._legalEntitiesApi
      .declareBeneficialOwners(clientId, { owners, reason: this.reason().trim() || null })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._applyApiErrors(error);
          return EMPTY;
        }),
        finalize(() => this.isSaving.set(false)),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Structure enregistrée',
          'Les bénéficiaires effectifs ont été mis à jour.',
        );
        this.isEditing.set(false);
        this.rows.set([]);
        this.rowErrors.set({});
        this.globalError.set(null);
        // Un 200 ne prouve pas que tout est passé : on relit la structure servie.
        this._load(clientId);
      });
  }

  /**
   * Règles vérifiées avant l'envoi, chacune rattachée à la ligne concernée quand elle en a une.
   * Le serveur applique les mêmes règles (OWNERSHIP_EXCEEDS_100,
   * MANAGER_BENEFICIAL_OWNER_REQUIRED) ; les vérifier ici évite un aller-retour et surtout un
   * message global qui ne dit pas quelle ligne corriger.
   */
  private _validate(): boolean {
    const rows = this.rows();
    const errors: Record<string, string> = {};
    let globalError: string | null = null;

    for (const row of rows) {
      const messages: string[] = [];

      if (!row.controlType) {
        messages.push('Choisissez un type de contrôle.');
      }
      if (!row.linkedClientId && !row.externalFullName.trim()) {
        messages.push('Rattachez un client ou saisissez le nom du bénéficiaire.');
      }

      const raw = row.ownershipPercentage.trim();
      const percentage = parsePercent(raw);
      if (raw !== '' && percentage === null) {
        messages.push('Le pourcentage doit être un nombre.');
      } else if (percentage !== null && (percentage < 0 || percentage > 100)) {
        messages.push('Le pourcentage doit être compris entre 0 et 100.');
      } else if (
        raw === '' &&
        (row.controlType === 'Ownership' || row.controlType === 'VotingRights')
      ) {
        messages.push('Indiquez le pourcentage détenu pour ce type de contrôle.');
      }

      if (messages.length > 0) errors[row.key] = messages.join(' ');
    }

    if (this.editedTotal() > 100) {
      globalError = `Le total des détentions atteint ${formatPercentValue(
        this.editedTotal(),
      )} : il ne peut pas dépasser 100 %.`;
    }

    const reachesThreshold = rows.some(
      (row) => (parsePercent(row.ownershipPercentage) ?? 0) >= BENEFICIAL_OWNER_THRESHOLD,
    );
    const hasManager = rows.some((row) => row.controlType === 'Manager');
    if (!reachesThreshold && !hasManager) {
      const message = `Aucun bénéficiaire n'atteint le seuil de ${BENEFICIAL_OWNER_THRESHOLD} % : désignez au moins un dirigeant principal (type de contrôle « Dirigeant »).`;
      globalError = globalError ? `${globalError} ${message}` : message;
    }

    this.rowErrors.set(errors);
    this.globalError.set(globalError);
    return Object.keys(errors).length === 0 && !globalError;
  }

  /**
   * Les erreurs de validation du serveur arrivent indexées (`owners[0].ownershipPercentage`) :
   * les afficher sur la ligne concernée est la seule façon de rendre le message actionnable —
   * un toast global obligerait à relire les huit lignes une par une.
   */
  private _applyApiErrors(error: HttpErrorResponse): void {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    const rows = this.rows();
    const rowErrors: Record<string, string> = {};
    let matched = false;

    for (const [path, messages] of Object.entries(body?.errors ?? {})) {
      const index = Number(/\[(\d+)\]/.exec(path)?.[1]);
      const row = Number.isInteger(index) ? rows[index] : undefined;
      const text = messages.join(' ');
      if (row) {
        matched = true;
        rowErrors[row.key] = rowErrors[row.key] ? `${rowErrors[row.key]} ${text}` : text;
      }
    }

    this.rowErrors.set(rowErrors);

    // Une erreur déjà posée sur une ligne ne se répète pas en haut du formulaire : l'utilisateur
    // la lit là où il doit corriger.
    let global: string | null = this._codeMessage(body?.code);
    if (!global && error.status === 403) {
      global =
        "Vous n'avez pas le droit de déclarer les bénéficiaires effectifs de ce client (permission customers:update_sensitive).";
    }
    if (!global && !matched) {
      const firstValidation: string | undefined = Object.values(body?.errors ?? {}).flat()[0];
      global =
        firstValidation ??
        body?.detail ??
        body?.title ??
        "Impossible d'enregistrer la structure.";
    }

    this.globalError.set(global);
    this._snackbar.error(
      'Erreur',
      global ?? 'La déclaration a été refusée : consultez les messages sur les lignes.',
    );
  }

  private _codeMessage(code: string | undefined): string | null {
    switch (code) {
      case 'OWNERSHIP_EXCEEDS_100':
        return 'Le serveur refuse la déclaration : le total des détentions dépasse 100 %.';
      case 'MANAGER_BENEFICIAL_OWNER_REQUIRED':
        return "Aucun bénéficiaire n'atteint le seuil de détention : désignez un dirigeant principal.";
      case 'CLIENT_NOT_LEGAL_ENTITY':
        return 'Seule une personne morale déclare des bénéficiaires effectifs.';
      case 'CLIENT_READ_ONLY':
        return 'Cette fiche est archivée ou fusionnée : elle ne se modifie plus.';
      default:
        return null;
    }
  }

  private _clearRowError(key: string): void {
    if (!this.rowErrors()[key]) return;
    this.rowErrors.update((errors) => {
      const next = { ...errors };
      delete next[key];
      return next;
    });
  }

  // ——— Affichage ———

  protected ownerSeverity(owner: BeneficialOwnerDto): 'primary' | 'info' {
    return (owner.ownershipPercentage ?? 0) >= BENEFICIAL_OWNER_THRESHOLD ? 'primary' : 'info';
  }

  protected formatPercent(value: number | null | undefined): string {
    if (value == null) return '—';
    return `${formatPercentValue(value)} %`;
  }

  /**
   * Les dates du contrat arrivent en `yyyy-MM-dd` : `DatePipe` les interprète en UTC et peut
   * afficher la veille selon le fuseau, alors que le découpage de la chaîne ne décale rien.
   */
  protected formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  private _load(clientId: string): void {
    this.isLoading.set(true);
    this._legalEntitiesApi
      .listBeneficialOwners(clientId, true)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de charger les bénéficiaires effectifs.');
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((items) => this.owners.set(items ?? []));
  }
}

/** `null` quand la saisie n'est pas un nombre : on distingue « vide » de « invalide » en amont. */
function parsePercent(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function formatPercentValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export default ClientBeneficialOwnersPage;
