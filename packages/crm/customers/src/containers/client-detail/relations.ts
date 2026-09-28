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
import { catchError, EMPTY, finalize } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { PermissionsService } from '@sankore/crm/common';
import { ClientRelationshipsApiService, RelationshipDto } from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  AddRelationshipDrawer,
  AddRelationshipDrawerData,
  relationshipTypeLabel,
} from './add-relationship-drawer';

/**
 * Regroupement des relations par catégorie.
 *
 * Le contrat n'expose **aucune notion de catégorie** : `RelationshipDto.type` énumère huit
 * types à plat (Spouse, Child, Dependent, Guarantor, Proxy, Parent, Sibling, Other). Les trois
 * catégories demandées par US-M01-FE-14 sont donc une convention de présentation posée ici, et
 * « Autres » recueille `Other` pour qu'aucune relation ne disparaisse de l'écran si le serveur
 * renvoie un type que ce tableau ne connaît pas.
 */
interface RelationshipCategory {
  key: string;
  label: string;
  icon: string;
  types: string[];
}

const RELATIONSHIP_CATEGORIES: RelationshipCategory[] = [
  {
    key: 'family',
    label: 'Famille',
    icon: 'feather:users',
    types: ['Spouse', 'Child', 'Dependent', 'Parent', 'Sibling'],
  },
  { key: 'guarantors', label: 'Garants', icon: 'feather:shield', types: ['Guarantor'] },
  { key: 'proxies', label: 'Mandataires', icon: 'feather:user-check', types: ['Proxy'] },
  { key: 'others', label: 'Autres', icon: 'feather:more-horizontal', types: ['Other'] },
];

interface RelationshipGroup {
  key: string;
  label: string;
  icon: string;
  items: RelationshipDto[];
}

@Component({
  selector: 'client-relations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasSpinner, TasTag, Button, Anchor, RouterLink],
  template: `
    <div class="flex flex-col gap-4">
      <tas-card class="block">
        <div class="flex items-center justify-between gap-3 p-4">
          <div>
            <p class="text-sm font-medium text-slate-700">Relations</p>
            <p class="text-xs text-slate-500">
              {{ activeCount() }} relation(s) active(s)
              @if (closedRelationships().length > 0) {
                · {{ closedRelationships().length }} clôturée(s)
              }
            </p>
          </div>
          @if (canUpdate() && !store.isReadOnly()) {
            <button tas-raised-button color="primary" type="button" (click)="openAddDrawer()">
              <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
              Ajouter une relation
            </button>
          }
        </div>
      </tas-card>

      @if (isLoading()) {
        <div class="flex justify-center py-16">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else {
        @if (activeCount() === 0) {
          <tas-card class="block">
            <div class="p-10 text-center">
              <p class="text-sm font-medium text-slate-700">Aucune relation active</p>
              <p class="mt-1 text-sm text-slate-500">
                Rattachez un conjoint, un garant ou un mandataire pour compléter cette fiche.
              </p>
            </div>
          </tas-card>
        } @else {
          @for (group of activeGroups(); track group.key) {
            <tas-card class="block">
              <div class="flex items-center gap-2 border-b border-slate-200 p-4">
                <tas-icon [iconName]="group.icon" style="font-size:16px" class="text-primary"></tas-icon>
                <p class="text-sm font-medium text-slate-700">{{ group.label }}</p>
                <span class="text-xs text-slate-500 tabular-nums">({{ group.items.length }})</span>
              </div>
              <ul class="divide-y divide-slate-100">
                @for (relation of group.items; track relation.id) {
                  <li class="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        @if (relation.relatedClientId) {
                          <a
                            tas-text-button
                            color="primary"
                            [routerLink]="['/customers', relation.relatedClientId]"
                          >
                            {{ relation.relatedClientDisplayName || 'Fiche client' }}
                          </a>
                        } @else {
                          <span class="text-sm font-medium text-slate-700">
                            {{ relation.externalFullName || '—' }}
                          </span>
                        }
                        <tas-tag severity="info">{{ typeLabel(relation.type) }}</tas-tag>
                      </div>
                      <p class="mt-1 text-xs text-slate-500">
                        @if (relation.relatedClientId) {
                          Client {{ relation.relatedClientNumber || '—' }}
                        } @else {
                          Personne externe
                          @if (relation.maskedExternalPhone) {
                            · {{ relation.maskedExternalPhone }}
                          }
                          @if (relation.maskedExternalDateOfBirth) {
                            · né(e) le {{ relation.maskedExternalDateOfBirth }}
                          }
                        }
                        · depuis le {{ formatDate(relation.validFrom) }}
                      </p>
                    </div>

                    @if (canUpdate() && !store.isReadOnly()) {
                      <button
                        tas-outlined-button
                        color="warn"
                        type="button"
                        [disabled]="closingId() === relation.id"
                        [isLoading]="closingId() === relation.id"
                        (click)="confirmClose(relation)"
                      >
                        Clôturer
                      </button>
                    }
                  </li>
                }
              </ul>
            </tas-card>
          }
        }

        @if (closedRelationships().length > 0) {
          <tas-card class="block">
            <div class="flex items-center gap-2 border-b border-slate-200 p-4">
              <tas-icon iconName="feather:archive" style="font-size:16px" class="text-slate-400"></tas-icon>
              <p class="text-sm font-medium text-slate-700">Relations clôturées</p>
              <span class="text-xs text-slate-500 tabular-nums">
                ({{ closedRelationships().length }})
              </span>
            </div>
            <ul class="divide-y divide-slate-100">
              @for (relation of closedRelationships(); track relation.id) {
                <li class="p-4">
                  <div class="flex items-center gap-2">
                    @if (relation.relatedClientId) {
                      <a
                        tas-text-button
                        color="primary"
                        [routerLink]="['/customers', relation.relatedClientId]"
                      >
                        {{ relation.relatedClientDisplayName || 'Fiche client' }}
                      </a>
                    } @else {
                      <span class="text-sm font-medium text-slate-500">
                        {{ relation.externalFullName || '—' }}
                      </span>
                    }
                    <tas-tag severity="neutral">{{ typeLabel(relation.type) }}</tas-tag>
                  </div>
                  <p class="mt-1 text-xs text-slate-500">
                    Du {{ formatDate(relation.validFrom) }} au {{ formatDate(relation.validTo) }}
                    @if (relation.closeReason) {
                      · {{ relation.closeReason }}
                    }
                  </p>
                </li>
              }
            </ul>
          </tas-card>
        }
      }
    </div>
  `,
})
export class ClientRelationshipsPage {
  protected readonly store = inject(ClientDetailStore);
  private readonly _relationshipsApi = inject(ClientRelationshipsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _confirm = inject(ConfirmDialogService);

  protected readonly canUpdate = this._permissions.can('customers:update');

  protected readonly relationships = signal<RelationshipDto[]>([]);
  protected readonly isLoading = signal(true);
  protected readonly closingId = signal<string | null>(null);

  protected readonly typeLabel = relationshipTypeLabel;

  protected readonly activeRelationships = computed(() =>
    this.relationships().filter((r) => this._isActive(r)),
  );
  protected readonly closedRelationships = computed(() =>
    this.relationships()
      .filter((r) => !this._isActive(r))
      .sort((a, b) => (b.validTo ?? '').localeCompare(a.validTo ?? '')),
  );
  protected readonly activeCount = computed(() => this.activeRelationships().length);

  protected readonly activeGroups = computed<RelationshipGroup[]>(() => {
    const active = this.activeRelationships();
    const known = new Set(RELATIONSHIP_CATEGORIES.flatMap((c) => c.types));
    return RELATIONSHIP_CATEGORIES.map((category) => ({
      key: category.key,
      label: category.label,
      icon: category.icon,
      items: active.filter((r) => {
        const type = r.type ? String(r.type) : '';
        // Un type inconnu du tableau tombe dans « Autres » plutôt que de disparaître.
        return category.key === 'others'
          ? category.types.includes(type) || !known.has(type)
          : category.types.includes(type);
      }),
    })).filter((group) => group.items.length > 0);
  });

  constructor() {
    // La coquille fournit le client : l'onglet attend son identifiant sans le recharger.
    effect(() => {
      const clientId = this.store.clientId();
      if (clientId) this._load(clientId);
    });
  }

  protected openAddDrawer(): void {
    const client = this.store.client();
    if (!client?.id) return;

    const data: AddRelationshipDrawerData = {
      clientId: client.id,
      clientDisplayName: client.displayName ?? 'ce client',
    };

    // Sans argument de type, `C` est inféré depuis le composant : en fournir un seul figerait
    // `C` sur son défaut `TasSideDrawer` et le drawer ne correspondrait plus au paramètre attendu.
    const ref = this._sideDrawer.open(AddRelationshipDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((added) => {
      if (added !== true) return;
      this._load(data.clientId);
      // Un lien Child ou Dependent recalcule `dependentsCount` côté serveur : sans ce
      // rafraîchissement, l'en-tête de la fiche resterait sur l'ancien compte.
      this.store.reload().subscribe();
    });
  }

  protected confirmClose(relation: RelationshipDto): void {
    const clientId = this.store.clientId();
    if (!clientId || !relation.id) return;

    const who = relation.relatedClientDisplayName ?? relation.externalFullName ?? 'cette relation';
    this._confirm.confirm({
      title: 'Clôturer la relation',
      message: `La relation avec ${who} passera dans l'historique et restera consultable. Confirmez-vous ?`,
      closable: true,
      icon: 'feather:alert-triangle',
      acceptButtonProps: { label: 'Clôturer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler', theme: 'primary' },
      accept: () => this._close(clientId, relation.id as string),
    });
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

  private _isActive(relation: RelationshipDto): boolean {
    // `isActive` est optionnel dans le contrat : `validTo` reste le juge de paix.
    return relation.isActive ?? !relation.validTo;
  }

  private _load(clientId: string): void {
    this.isLoading.set(true);
    this._relationshipsApi
      .listClientRelationships(clientId, true)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de charger les relations du client.');
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((items) => this.relationships.set(items ?? []));
  }

  private _close(clientId: string, relationshipId: string): void {
    this.closingId.set(relationshipId);
    this._relationshipsApi
      .closeClientRelationship(clientId, relationshipId, 'Clôturée depuis la fiche client')
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const body = error.error as { detail?: string; title?: string } | undefined;
          this._snackbar.error(
            'Erreur',
            body?.detail ?? body?.title ?? 'Impossible de clôturer cette relation.',
          );
          return EMPTY;
        }),
        finalize(() => this.closingId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Relation clôturée', "Elle figure désormais dans l'historique.");
        this._load(clientId);
        this.store.reload().subscribe();
      });
  }
}

export default ClientRelationshipsPage;
