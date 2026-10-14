import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import {
  LeadsApiService,
  ProductDto,
  ProductDtoCategoryEnum,
  QualificationTemplateDto,
} from '@sankore/crm-api';
import { productCategoryLabel } from '@sankore/crm/common';
import {
  isInsuranceCategory,
  statusLabel,
  statusSeverity,
} from '../qualification-templates/qualification-template.models';

/**
 * Les questionnaires de qualification rattachés à une ligne de produit.
 *
 * <p>
 * <b>Extrait de BeneficiaryPolicyEditor</b>, où il formait la seconde carte. Les deux vivaient
 * dans le même composant parce qu'ils s'affichaient l'un sous l'autre ; ce sont deux volets
 * distincts depuis le passage en onglets, et surtout deux choses de nature différente — l'une est
 * une politique qu'on écrit sur le produit, l'autre une LISTE EN LECTURE de questionnaires dont le
 * rattachement se règle ailleurs. Les garder ensemble obligeait un composant de huit cents lignes
 * à porter un LeadsApiService qui ne servait qu'au second tiers de son gabarit.
 * </p>
 *
 * <p>
 * Aucune écriture ici : le rattachement se fait sur le questionnaire lui-même, via sa catégorie et
 * son produit. Ce volet dit ce qui s'appliquera, et renvoie là où ça se change.
 * </p>
 */
@Component({
  selector: 'qualification-templates-panel',
  imports: [RouterLink, TasIcon, TasTag, Button, TasTable],
  template: `
    <h2 class="text-xl font-bold text-primary">Questionnaires de qualification</h2>
    <p class="text-sm text-slate-600 mt-1">
      Questionnaires de la catégorie « {{ categoryLabel() }} ». Le rattachement se règle sur le
      questionnaire lui-même, via sa catégorie et son produit.
    </p>

    @if (templatesFailed()) {
      <div class="flex items-start gap-3 mt-4">
        <tas-icon
          iconName="feather:alert-triangle"
          class="text-functional-error"
          style="font-size:16px"
        ></tas-icon>
        <div>
          <p class="text-sm text-slate-700">
            Impossible de charger les questionnaires.
          </p>
          <button
            tas-text-button
            color="primary"
            type="button"
            class="text-xs"
            (click)="reloadTemplates()"
          >
            Réessayer
          </button>
        </div>
      </div>
    } @else {
      <div class="mt-4">
        <tas-table
          [data]="templates()"
          [config]="tableConfig"
          [isLoading]="templatesLoading()"
          [hasCaption]="false"
        >
          <ng-template #header>
            <tr>
              <th scope="col">Questionnaire</th>
              <th scope="col">Portée</th>
              <th scope="col">Statut</th>
              <th scope="col"></th>
            </tr>
          </ng-template>

          <ng-template #body let-item>
            <tr class="hover:bg-slate-50">
              <td class="py-3">
                <div class="text-sm font-medium text-slate-800">
                  {{ item.name ?? 'Questionnaire' }}
                </div>
                <div class="text-xs text-slate-400">
                  version {{ item.version ?? 1 }}
                </div>
              </td>
              <td>
                <tas-tag
                  [severity]="item.productCode === code() ? 'success' : 'neutral'"
                >
                  {{ templateScope(item) }}
                </tas-tag>
              </td>
              <td>
                <tas-tag [severity]="templateStatusSeverity(item.status)">
                  {{ templateStatusLabel(item.status) }}
                </tas-tag>
              </td>
              <td class="text-right">
                <a
                  [routerLink]="[
                    '/settings/qualification-templates',
                    item.id,
                    'edit'
                  ]"
                  class="text-xs text-primary hover:underline"
                  [attr.aria-label]="
                    'Ouvrir le questionnaire ' + (item.name ?? '')
                  "
                >
                  Ouvrir
                </a>
              </td>
            </tr>
          </ng-template>
        </tas-table>
      </div>
    }

    <div class="mt-4">
      @if (isInsurance()) {
        <div
          class="rounded-lg border border-slate-200 bg-slate-50 p-3 flex gap-2.5"
        >
          <tas-icon
            iconName="feather:heart"
            class="text-slate-400 shrink-0 mt-0.5"
            style="font-size:14px"
          ></tas-icon>
          <p class="text-xs text-slate-500">
            Catégorie d'assurance : un questionnaire santé peut être rattaché à
            cette ligne de produit. Le marquage « questionnaire santé » se
            fait sur le questionnaire, à l'écran « Formulaires ».
          </p>
        </div>
      } @else {
        <div
          class="rounded-lg border border-slate-200 bg-slate-50 p-3 flex gap-2.5"
        >
          <tas-icon
            iconName="feather:info"
            class="text-slate-400 shrink-0 mt-0.5"
            style="font-size:14px"
          ></tas-icon>
          <p class="text-xs text-slate-500">
            Les questionnaires santé ne sont proposés que pour les catégories
            d'assurance.
          </p>
        </div>
      }
    </div>
  `,
})
export class QualificationTemplatesPanel {
  private readonly _leadsApi = inject(LeadsApiService);

  public readonly product = input<ProductDto | null>(null);

  public readonly templateStatusLabel = statusLabel;
  public readonly templateStatusSeverity = statusSeverity;

  /**
   * Pagination côté client : l'endpoint rend tous les questionnaires d'une catégorie, et une
   * catégorie en compte des dizaines au plus. Le mode serveur demanderait une pagination que le
   * contrat n'offre pas sur cette route.
   */
  public readonly tableConfig: TableConfig = {
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  };

  public readonly templates = signal<QualificationTemplateDto[]>([]);
  public readonly templatesLoading = signal(false);
  public readonly templatesFailed = signal(false);

  public readonly code = computed(() => this.product()?.code ?? null);

  public readonly categoryLabel = computed(() =>
    productCategoryLabel(this.product()?.category),
  );

  public readonly isInsurance = computed(() =>
    isInsuranceCategory(this.product()?.category),
  );

  constructor() {
    // Rechargé quand la catégorie change, et non une fois au montage : les volets sont masqués
    // par `hidden` et non détruits, donc ce composant est monté avant que le produit n'arrive —
    // un chargement unique au constructeur ne verrait jamais de catégorie.
    effect(() => this._loadTemplates(this.product()?.category ?? null));
  }

  /** Ce questionnaire vise-t-il ce produit, un autre, ou toute la catégorie. */
  public templateScope(template: QualificationTemplateDto): string {
    if (!template.productCode) return 'Toute la catégorie';
    return template.productCode === this.code() ? 'Ce produit' : 'Autre produit';
  }

  public reloadTemplates(): void {
    this._loadTemplates(this.product()?.category ?? null);
  }

  private _loadTemplates(category: string | null): void {
    if (!category) {
      this.templates.set([]);
      return;
    }

    this.templatesLoading.set(true);
    this.templatesFailed.set(false);

    this._leadsApi
      // Le filtre productCategory de cet endpoint est une chaîne au contrat, pas un entier :
      // l'enum de lecture s'y applique directement.
      .listQualificationTemplates(undefined, category as ProductDtoCategoryEnum)
      .pipe(
        catchError(() => {
          this.templatesFailed.set(true);
          this.templatesLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((templates) => {
        this.templates.set(templates ?? []);
        this.templatesLoading.set(false);
      });
  }
}
