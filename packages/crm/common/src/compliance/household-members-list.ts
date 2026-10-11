import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { HouseholdMemberView } from './household-view';
import { pepLinkLabel } from './compliance-labels';
import { ComplianceConfigService } from '../services/compliance-config.service';

/**
 * Liste des membres du foyer, partagée par l'onglet Foyer du lead et celui du
 * client (BNF-F-03, BNF-F-09 : « réutilisation, aucune duplication »).
 *
 * Purement présentationnelle : elle reçoit des `HouseholdMemberView` et n'émet
 * que des intentions. Chaque côté garde son API d'écriture, son drawer et ses
 * confirmations — ce sont les seules choses qui diffèrent réellement entre un
 * foyer de lead et un foyer de client.
 *
 * Le rendu « cartes sur mobile, tableau sur écran large » exigé par BNF-F-03 est
 * obtenu dans une seule `tas-table` : une cellule carte en `sm:hidden` et les
 * cellules de colonnes en `hidden sm:table-cell`. C'est ce qui permet de garder la
 * pagination, l'état de chargement et l'état vide du composant du kit tout en
 * tenant 360 px, au lieu de refaire une pile de `div` qui n'a rien de tout ça.
 */
@Component({
  selector: 'household-members-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasTable, TasCard, TasIcon, TasTag, Button],
  template: `
    @if (members().length === 0 && !isLoading()) {
      <tas-card class="block">
        <div class="p-8 text-center">
          <tas-icon iconName="feather:users" class="text-slate-300" style="font-size:28px"></tas-icon>
          <p class="text-sm font-medium text-slate-700 mt-2">{{ emptyTitle() }}</p>
          <p class="text-sm text-slate-500 mt-1">{{ emptyMessage() }}</p>
        </div>
      </tas-card>
    } @else {
      <tas-table
        [data]="members()"
        identifierField="memberId"
        [config]="tableConfig"
        [isLoading]="isLoading()"
      >
        <ng-template #header>
          <tr>
            <th class="hidden sm:table-cell">Membre</th>
            <th class="hidden sm:table-cell">Lien</th>
            <th class="hidden sm:table-cell">Âge</th>
            @if (pepEnabled()) {
              <th class="hidden sm:table-cell">PPE</th>
            }
            @if (showDesignations()) {
              <th class="hidden sm:table-cell">Désignations</th>
            }
            <th class="hidden sm:table-cell"></th>
          </tr>
        </ng-template>

        <ng-template #body let-item>
          <tr [class.opacity-60]="!item.isActive">
            <!-- Carte, sous 640 px -->
            <td class="sm:hidden" [attr.colspan]="columnCount()">
              <div class="p-3 flex flex-col gap-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">{{ item.displayName }}</p>
                    <p class="text-xs text-slate-500">
                      {{ item.typeLabel }}@if (item.unionLabel) { — {{ item.unionLabel }} }
                      @if (item.age !== null) { · {{ item.age }} ans }
                    </p>
                  </div>
                  <div class="flex flex-col items-end gap-1 shrink-0">
                    @if (!item.isActive) {
                      <tas-tag severity="neutral">Retiré</tas-tag>
                    }
                    @if (item.isPepExposed && pepEnabled()) {
                      <tas-tag severity="warning">PPE</tas-tag>
                    }
                    @if (item.fromLead) {
                      <tas-tag severity="info">Repris du lead</tas-tag>
                    }
                  </div>
                </div>

                @if (item.usesPrincipalAddress) {
                  <p class="text-xs text-slate-500">Même adresse que le principal</p>
                } @else if (item.city) {
                  <p class="text-xs text-slate-500">{{ item.city }}</p>
                }

                @if (showDesignations() && item.designations.length > 0) {
                  <ul class="flex flex-col gap-1">
                    @for (d of item.designations; track d.holdingId + d.roleLabel) {
                      <li class="text-xs text-slate-600 flex items-center gap-1 flex-wrap">
                        <span class="font-medium">{{ d.productLabel }}</span>
                        <span>— {{ d.roleLabel }}</span>
                        @if (d.toReview) { <tas-tag severity="warning">À revoir</tas-tag> }
                      </li>
                    }
                  </ul>
                }

                @if (item.isActive) {
                  <div class="flex flex-wrap items-center gap-2 pt-1">
                    @if (canEdit()) {
                      <button tas-outlined-button color="primary" type="button" class="text-xs"
                              (click)="edit.emit(item)">
                        <tas-icon iconName="feather:edit-2" style="font-size:12px"></tas-icon>
                        Modifier
                      </button>
                      @if (pepEnabled()) {
                        <button tas-outlined-button color="primary" type="button" class="text-xs"
                                (click)="editPep.emit(item)">
                          <tas-icon iconName="feather:flag" style="font-size:12px"></tas-icon>
                          PPE
                        </button>
                      }
                      <button tas-text-button color="warn" type="button" class="text-xs"
                              (click)="remove.emit(item)">
                        Retirer
                      </button>
                    }
                  </div>
                }

                @if (!item.isActive && item.removalReason) {
                  <p class="text-xs text-slate-500">Motif du retrait : {{ item.removalReason }}</p>
                }
              </div>
            </td>

            <!-- Colonnes, à partir de 640 px -->
            <td class="hidden sm:table-cell py-3">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-slate-800">{{ item.displayName }}</span>
                @if (!item.isActive) { <tas-tag severity="neutral">Retiré</tas-tag> }
                @if (item.fromLead) { <tas-tag severity="info">Repris du lead</tas-tag> }
              </div>
              @if (item.usesPrincipalAddress) {
                <p class="text-xs text-slate-400">Même adresse que le principal</p>
              } @else if (item.city) {
                <p class="text-xs text-slate-400">{{ item.city }}</p>
              }
            </td>

            <td class="hidden sm:table-cell">
              <span class="text-sm text-slate-700">{{ item.typeLabel }}</span>
              @if (item.unionLabel) {
                <span class="block text-xs text-slate-400">{{ item.unionLabel }}</span>
              }
            </td>

            <td class="hidden sm:table-cell">
              <span class="text-sm text-slate-700 tabular-nums">
                {{ item.age !== null ? item.age + ' ans' : '—' }}
              </span>
            </td>

            @if (pepEnabled()) {
              <td class="hidden sm:table-cell">
                @if (item.isPepExposed) {
                  <tas-tag severity="warning">Exposé</tas-tag>
                  @if (canReadPep() && item.pep.link) {
                    <span class="block text-xs text-slate-400">{{ linkLabel(item.pep.link) }}</span>
                  }
                } @else {
                  <span class="text-sm text-slate-400">Non</span>
                }
              </td>
            }

            @if (showDesignations()) {
              <td class="hidden sm:table-cell">
                @if (item.designations.length === 0) {
                  <span class="text-sm text-slate-400">—</span>
                } @else {
                  <ul class="flex flex-col gap-1">
                    @for (d of item.designations; track d.holdingId + d.roleLabel) {
                      <li class="text-xs text-slate-600 flex items-center gap-1 flex-wrap">
                        <span class="font-medium">{{ d.productLabel }}</span>
                        <span>— {{ d.roleLabel }}</span>
                        @if (d.toReview) { <tas-tag severity="warning">À revoir</tas-tag> }
                      </li>
                    }
                  </ul>
                }
              </td>
            }

            <td class="hidden sm:table-cell text-right">
              @if (item.isActive && canEdit()) {
                <div class="flex items-center justify-end gap-1">
                  <button tas-button iconButton type="button"
                          [attr.aria-label]="'Modifier ' + item.displayName"
                          (click)="edit.emit(item)">
                    <tas-icon iconName="feather:edit-2" style="font-size:13px"></tas-icon>
                  </button>
                  @if (pepEnabled()) {
                    <button tas-button iconButton type="button"
                            [attr.aria-label]="'Statut PPE de ' + item.displayName"
                            (click)="editPep.emit(item)">
                      <tas-icon iconName="feather:flag" style="font-size:13px"></tas-icon>
                    </button>
                  }
                  <button tas-button iconButton type="button"
                          [attr.aria-label]="'Retirer ' + item.displayName"
                          (click)="remove.emit(item)">
                    <tas-icon iconName="feather:user-minus" style="font-size:13px"></tas-icon>
                  </button>
                </div>
              } @else if (!item.isActive && item.removalReason) {
                <span class="text-xs text-slate-400">{{ item.removalReason }}</span>
              }
            </td>
          </tr>
        </ng-template>
      </tas-table>
    }
  `,
})
export class HouseholdMembersList {
  private readonly _complianceConfig = inject(ComplianceConfigService);

  /**
   * Vigilance PPE du tenant. Lue ici et non passée en entrée : c'est un réglage
   * d'établissement, pas une propriété du foyer affiché, et les deux onglets Foyer
   * (lead et client) devraient sinon la répéter à l'identique.
   */
  public readonly pepEnabled = this._complianceConfig.pepEnabled;

  public readonly members = input.required<HouseholdMemberView[]>();
  public readonly isLoading = input(false);
  public readonly canEdit = input(false);
  /** Sans ce droit, seul le badge d'exposition est montré, jamais le détail. */
  public readonly canReadPep = input(true);
  public readonly showDesignations = input(false);
  public readonly emptyTitle = input('Aucun membre dans le foyer');
  public readonly emptyMessage = input(
    'Ajoutez le conjoint ou un enfant pour constituer le foyer.',
  );

  public readonly edit = output<HouseholdMemberView>();
  public readonly remove = output<HouseholdMemberView>();
  public readonly editPep = output<HouseholdMemberView>();

  /**
   * Pagination désactivée : un foyer tient sur un écran, et la pagination
   * serveur du composant n'a pas de pendant côté API — le foyer arrive entier.
   */
  public readonly tableConfig: TableConfig = {
    property: 'members',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 50,
      pageSizeOptions: [50],
    },
  };

  /**
   * Nombre de colonnes réellement rendues, pour le `colspan` de la cellule carte : membre,
   * lien, âge, actions, plus la PPE et les désignations quand elles sont affichées. Un
   * `colspan` figé décalerait la carte dès qu'une colonne disparaît.
   */
  public readonly columnCount = computed(
    () => 4 + (this.pepEnabled() ? 1 : 0) + (this.showDesignations() ? 1 : 0),
  );

  constructor() {
    this._complianceConfig.load();
  }

  public linkLabel(link: string | null): string {
    return pepLinkLabel(link);
  }
}
