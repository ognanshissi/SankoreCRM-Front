import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY, finalize, forkJoin, of } from 'rxjs';
import { ProductDto, ProductsApiService, ProjectTemplateDto, ProjectTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService, productCategoryLabel, projectAmountLabel } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Router } from '@angular/router';
import { phaseLabel, projectTemplateError } from './project-steps.models';
import { DEFAULT_TEMPLATE, NEW_TEMPLATE } from './project-template-page';

interface TemplateRow {
  key: string;
  template: ProjectTemplateDto;
  name: string;
  scopeLabel: string;
  scopeDetail: string;
  isBuiltIn: boolean;
  tracksForecast: boolean;
  criticalCloseDate: boolean;
  amountKind: string;
  steps: {
    label: string; phase: string; probability: number; opensClientFile: boolean; isApproval: boolean;
    requiresQuestionnaires: boolean; checklistCount: number; workflowCircuit: string | null;
  }[];
  updatedAt: string | null;
}

/**
 * Paramètres › Étapes des projets. Un projet suit le gabarit de son produit, sinon celui de sa
 * famille, sinon le parcours par défaut — qui reproduit les cinq étapes d'avant tant que le tenant
 * ne l'a pas modifié. Remplace l'ancien écran « Étapes du pipeline », qui n'écrivait que dans le
 * navigateur.
 */
@Component({
  selector: 'project-steps-page',
  imports: [DatePipe, Button, TasIcon, TasTable],
  template: `
    <div class="flex flex-col gap-4 pb-6">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-lg font-semibold text-slate-800">Étapes des projets</h1>
          <p class="mt-0.5 max-w-2xl text-sm text-slate-500">
            Un projet suit le gabarit de son produit, sinon celui de sa famille, sinon le parcours par défaut.
            Chaque étape se range dans une phase de l'entonnoir, que les rapports continuent de lire.
          </p>
        </div>
        @if (canManage()) {
          <button tas-raised-button color="primary" type="button" (click)="openNew()">
            <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
            Nouveau gabarit
          </button>
        }
      </div>

      @if (loadError()) {
        <div role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <p class="text-sm text-red-800">{{ loadError() }}</p>
          <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else {
        <tas-table [data]="rows()" identifierField="key" [config]="tableConfig" [hasCaption]="false" [isLoading]="isLoading()">
          <ng-template #header>
            <tr class="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <th class="py-2.5 pl-4">Gabarit</th>
              <th class="py-2.5">S'applique à</th>
              <th class="py-2.5">Étapes</th>
              <th class="py-2.5 pr-4 text-right">Modifié</th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr class="cursor-pointer align-top transition-colors hover:bg-slate-50" (click)="open(row)">
              <td class="py-3 pl-4">
                <p class="text-sm font-semibold text-slate-800">{{ row.name }}</p>
                @if (row.isBuiltIn) {
                  <p class="text-xs text-slate-500">Standard, jamais modifié</p>
                }
                <p class="text-xs text-slate-500">
                  {{ row.amountKind }}@if (!row.tracksForecast) { · sans prévision }@if (row.criticalCloseDate) { · <span class="font-semibold text-[#b4532a]">date critique</span> }
                </p>
              </td>
              <td class="py-3">
                <p class="text-sm text-slate-700">{{ row.scopeLabel }}</p>
                @if (row.scopeDetail) {
                  <p class="text-xs text-slate-500">{{ row.scopeDetail }}</p>
                }
              </td>
              <td class="py-3">
                <ol class="flex flex-wrap items-center gap-1 text-xs">
                  @for (step of row.steps; track $index; let last = $last) {
                    <li class="flex items-center gap-1">
                      <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-slate-700" [title]="phaseLabel(step.phase) + ' · ' + step.probability + ' %'">
                        @if (step.opensClientFile) {
                          <tas-icon iconName="feather:user-plus" style="font-size:11px" aria-label="Ouvre le dossier client"></tas-icon>
                        }
                        @if (step.isApproval) {
                          <tas-icon iconName="feather:shield" style="font-size:11px" aria-label="Étape d'approbation"></tas-icon>
                        }
                        @if (step.requiresQuestionnaires) {
                          <tas-icon iconName="feather:clipboard" style="font-size:11px" aria-label="Questionnaires complets"></tas-icon>
                        }
                        @if (step.checklistCount) {
                          <tas-icon iconName="feather:check-square" style="font-size:11px" [attr.aria-label]="step.checklistCount + ' points à vérifier'"></tas-icon>
                        }
                        @if (step.workflowCircuit) {
                          <tas-icon iconName="feather:git-pull-request" style="font-size:11px" aria-label="Circuit de validation"></tas-icon>
                        }
                        {{ step.label }}
                      </span>
                      @if (!last) {
                        <tas-icon iconName="feather:chevron-right" class="text-slate-300" style="font-size:12px"></tas-icon>
                      }
                    </li>
                  }
                </ol>
              </td>
              <td class="py-3 pr-4 text-right text-xs text-slate-500 tabular-nums">
                {{ row.updatedAt ? (row.updatedAt | date: 'd MMM y') : '—' }}
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </div>
  `,
})
export class ProjectStepsPage implements OnInit {
  private readonly _api = inject(ProjectTemplatesApiService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly canManage = this._permissions.can('lead:pipeline-stage:manage');
  public readonly phaseLabel = phaseLabel;

  public readonly templates = signal<ProjectTemplateDto[]>([]);
  public readonly products = signal<ProductDto[]>([]);
  public readonly isLoading = signal(false);
  public readonly loadError = signal<string | null>(null);

  public readonly tableConfig: TableConfig = {
    property: 'key',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [50], totalElements: 0 },
  };

  public readonly rows = computed<TemplateRow[]>(() => {
    const names = new Map(this.products().map((p) => [(p.code ?? '').toUpperCase(), p.name ?? '']));
    return this.templates().map((t) => ({
      key: t.id ?? 'built-in-default',
      template: t,
      name: t.name ?? '',
      scopeLabel: t.scope === 'Product' ? 'Un produit' : t.scope === 'Category' ? 'Une famille' : 'Tous les autres projets',
      scopeDetail:
        t.scope === 'Product'
          ? `${t.productName ?? names.get((t.productCode ?? '').toUpperCase()) ?? t.productCode}`
          : t.scope === 'Category'
            ? productCategoryLabel(t.category)
            : 'Produit sans gabarit, ou à préciser',
      isBuiltIn: !!t.isBuiltIn,
      tracksForecast: t.tracksForecast !== false,
      criticalCloseDate: !!t.criticalCloseDate,
      amountKind: projectAmountLabel(t.amountKind),
      steps: (t.steps ?? []).map((s) => ({
        label: s.label ?? '',
        phase: s.phase ?? '',
        probability: s.probability ?? 0,
        opensClientFile: !!s.opensClientFile,
        isApproval: !!s.isApproval,
        requiresQuestionnaires: !!s.requiresQuestionnaires,
        checklistCount: s.checklist?.length ?? 0,
        workflowCircuit: s.workflowCircuit ?? null,
      })),
      updatedAt: t.updatedAt ?? null,
    }));
  });

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: 'Étapes des projets' }]);
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    forkJoin({
      templates: this._api.listProjectTemplates(),
      // Sans catalogue lisible, l'écran reste utilisable : seuls les choix de portée manquent.
      products: this._productsApi.listProducts().pipe(catchError(() => of([] as ProductDto[]))),
    })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(projectTemplateError(error, 'Les gabarits n’ont pas pu être chargés.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe(({ templates, products }) => {
        this.templates.set(templates ?? []);
        this.products.set(products ?? []);
      });
  }

  public open(row: TemplateRow): void {
    // Le parcours par défaut n'a pas d'id tant que le tenant ne l'a pas modifié.
    void this._router.navigate(['/settings/project-steps', row.template.id ?? DEFAULT_TEMPLATE]);
  }

  public openNew(): void {
    void this._router.navigate(['/settings/project-steps', NEW_TEMPLATE]);
  }
}

export default ProjectStepsPage;
