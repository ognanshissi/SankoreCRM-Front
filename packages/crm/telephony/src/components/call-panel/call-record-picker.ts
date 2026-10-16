import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ClientsApiService, LeadsApiService } from '@sankore/crm-api';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { EMPTY, Subject, catchError, debounceTime, map, switchMap } from 'rxjs';
import {
  TELEPHONY_ENTITY_TYPES,
  TelephonyEntityType,
  telephonyEntityTypeLabel,
} from '../../data-access/telephony-referential';

export interface PickedRecord {
  readonly entityType: TelephonyEntityType;
  readonly entityId: string;
  readonly displayName: string;
}

const RESULT_LIMIT = 8;

/**
 * Choix d'une fiche à rattacher à un appel, depuis le panneau d'appel (TEL-F-05).
 *
 * **La recherche se fait sur le NOM, jamais sur le numéro, et c'est une limite assumée de
 * l'API** : aucune lecture téléphonique ne renvoie de numéro d'appelant, donc il n'y a
 * rien à préremplir. L'agent tape le nom que son correspondant vient de lui donner. Un
 * `searchClients(phone: …)` serait pourtant la recherche naturelle ici — elle est
 * impossible faute de numéro côté front.
 *
 * La barre de recherche reste en signaux + `[ngModel]` : c'est l'exception explicite du
 * dépôt pour les champs de recherche, qui n'ont ni validation ni soumission.
 *
 * Ce n'est pas une liste au sens de la règle `tas-table` : les résultats sont le groupe
 * d'options d'un champ — on en choisit un pour remplir le rattachement, et rien n'est
 * affiché de la fiche au-delà de quoi la reconnaître.
 */
@Component({
  selector: 'lib-call-record-picker',
  imports: [
    FormsModule,
    TasFormField,
    TasLabel,
    TasHint,
    TasInput,
    TasSelect,
    TasSpinner,
    TasIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      <tas-form-field>
        <tas-label>Type de fiche</tas-label>
        <tas-select
          [options]="typeOptions"
          optionLabel="label"
          optionValue="value"
          [ngModel]="type()"
          (ngModelChange)="onTypeChange($event)"
        ></tas-select>
      </tas-form-field>

      <tas-form-field>
        <tas-label>Rechercher la fiche</tas-label>
        <input
          tasInput
          type="text"
          placeholder="Nom du correspondant…"
          [ngModel]="query()"
          (ngModelChange)="onQueryChange($event)"
        />
        <tas-hint>
          La recherche porte sur le nom : aucun numéro d'appelant n'est transmis au
          navigateur.
        </tas-hint>
      </tas-form-field>

      @if (isSearching()) {
        <div class="flex justify-center py-4">
          <tas-spinner size="5" class="text-primary"></tas-spinner>
        </div>
      } @else if (searchError()) {
        <p class="text-xs text-functional-error">{{ searchError() }}</p>
      } @else if (hasSearched() && results().length === 0) {
        <p class="text-xs text-slate-500">
          Aucune fiche ne correspond. Essayez une autre orthographe, ou créez un lead.
        </p>
      } @else if (results().length > 0) {
        <ul class="flex flex-col gap-1" role="listbox" aria-label="Fiches trouvées">
          @for (result of results(); track result.entityId) {
            <li>
              <button
                type="button"
                role="option"
                [attr.aria-selected]="false"
                class="w-full text-left px-2.5 py-2 rounded-lg border border-slate-200 hover:border-primary/50 hover:bg-primary/5 flex items-center gap-2"
                (click)="picked.emit(result)"
              >
                <tas-icon
                  iconName="feather:user"
                  class="text-slate-400"
                  style="font-size:13px"
                ></tas-icon>
                <span class="text-sm text-slate-800 truncate">{{ result.displayName }}</span>
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class CallRecordPicker {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly picked = output<PickedRecord>();

  public readonly typeOptions = TELEPHONY_ENTITY_TYPES.map((value) => ({
    label: telephonyEntityTypeLabel(value),
    value,
  }));

  public readonly type = signal<TelephonyEntityType>('Lead');
  public readonly query = signal('');
  public readonly results = signal<PickedRecord[]>([]);
  public readonly isSearching = signal(false);
  public readonly hasSearched = signal(false);
  public readonly searchError = signal<string | null>(null);

  /** Frappes regroupées avant l'appel réseau : sans ça, une requête par caractère. */
  private readonly _search$ = new Subject<void>();

  public constructor() {
    this._search$
      .pipe(
        debounceTime(300),
        switchMap(() => this._search()),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((results) => {
        this.results.set(results);
        this.isSearching.set(false);
        this.hasSearched.set(true);
      });
  }

  public onTypeChange(value: string | null): void {
    this.type.set((value as TelephonyEntityType | null) ?? 'Lead');
    this.results.set([]);
    this.hasSearched.set(false);

    if (this.query().trim().length >= 2) {
      this.isSearching.set(true);
      this._search$.next();
    }
  }

  public onQueryChange(value: string | null): void {
    this.query.set(value ?? '');
    this.searchError.set(null);

    if (this.query().trim().length < 2) {
      this.results.set([]);
      this.hasSearched.set(false);
      this.isSearching.set(false);

      return;
    }

    this.isSearching.set(true);
    this._search$.next();
  }

  private _search() {
    const term = this.query().trim();
    const type = this.type();

    if (type === 'Customer') {
      return this._clientsApi
        .searchClients(
          undefined,
          undefined,
          undefined,
          term,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          1,
          RESULT_LIMIT,
        )
        .pipe(
          map((page) =>
            (page.items ?? [])
              .filter((item) => !!item.id)
              .map<PickedRecord>((item) => ({
                entityType: 'Customer',
                entityId: item.id as string,
                displayName:
                  item.displayName || item.clientNumber || 'Client sans nom',
              })),
          ),
          catchError((error: HttpErrorResponse) => this._onSearchError(error)),
        );
    }

    return this._leadsApi
      .listLeads(1, RESULT_LIMIT, undefined, undefined, undefined, undefined, undefined, term)
      .pipe(
        map((page) =>
          (page.items ?? [])
            .filter((item) => !!item.id)
            .map<PickedRecord>((item) => ({
              entityType: 'Lead',
              entityId: item.id as string,
              displayName:
                item.fullName ||
                [item.firstName, item.lastName].filter(Boolean).join(' ') ||
                'Lead sans nom',
            })),
        ),
        catchError((error: HttpErrorResponse) => this._onSearchError(error)),
      );
  }

  private _onSearchError(error: HttpErrorResponse) {
    this.isSearching.set(false);
    this.hasSearched.set(true);
    this.searchError.set(
      error?.status === 403
        ? "Vous n'avez pas le droit de rechercher dans ce type de fiche."
        : 'La recherche a échoué. Réessayez dans un instant.',
    );

    return EMPTY;
  }
}
