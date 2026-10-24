import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { catchError, EMPTY, finalize } from 'rxjs';
import {
  OpportunitiesApiService,
  ProjectQuestionnaireItemDto,
  ProjectQuestionnairesDto,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import {
  HealthConsentDrawer,
  HealthConsentDrawerData,
  HealthConsentDrawerResult,
} from '../edit-lead/health-consent-drawer';
import { formatDay } from '../edit-lead/lead-view.models';
import { ProjectQuestionnaireDrawer, ProjectQuestionnaireDrawerData } from './project-questionnaire-drawer';

interface QuestionnaireRow {
  key: string;
  item: ProjectQuestionnaireItemDto;
  statusLabel: string;
  statusSeverity: Severity;
  /** Ce que l'agent peut faire sur la ligne. */
  action: 'fill' | 'edit' | 'view' | 'consent' | 'none';
  note: string | null;
}

/**
 * Les questionnaires que le produit du projet demande : celui du dossier (l'ancienne
 * « Qualification » du lead) et ceux de chaque personne (santé…), en une seule liste parce qu'une
 * seule règle bloque l'étape « Questionnaires complets » : tout est rempli.
 */
@Component({
  selector: 'project-questionnaires',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasTable, TasTag, Button],
  template: `
    <tas-card class="block" id="questionnaires">
      <div class="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Questionnaires</p>
          @if (data(); as d) {
            <p class="mt-1 text-sm text-slate-600">
              @if (d.planUnavailable) {
                Le catalogue des produits ne répond pas : impossible de savoir ce que ce produit demande.
              } @else if (total() === 0) {
                Ce produit ne demande aucun questionnaire.
              } @else {
                {{ answered() }} sur {{ total() }} rempli{{ answered() > 1 ? 's' : '' }}
                @if (d.isComplete) { — complet }
              }
            </p>
          }
        </div>
        <button tas-button iconButton type="button" aria-label="Rafraîchir les questionnaires" (click)="load()">
          <tas-icon iconName="feather:refresh-cw" style="font-size:14px"></tas-icon>
        </button>
      </div>

      @if (loadFailed()) {
        <div class="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3" role="alert">
          <p class="text-sm text-red-800">Impossible de charger les questionnaires.</p>
          <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else if (rows().length > 0 || isLoading()) {
        <tas-table [data]="rows()" identifierField="key" [config]="tableConfig" [isLoading]="isLoading()" [hasCaption]="false">
          <ng-template #header>
            <tr>
              <th>Questionnaire</th>
              <th>Pour</th>
              <th>Statut</th>
              <th class="hidden md:table-cell">Rempli le</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr>
              <td>
                <p class="text-sm font-medium text-slate-800">{{ row.item.templateName }}</p>
                <p class="text-xs text-slate-500">
                  @if (row.item.isDossier) { Une fois pour tout le dossier }
                  @if (row.item.isHealthQuestionnaire) { Données de santé }
                  @if (!row.item.isExpected) { Plus demandé par ce produit }
                </p>
              </td>
              <td class="text-sm text-slate-700">{{ row.item.subjectLabel }}</td>
              <td>
                <tas-tag [severity]="row.statusSeverity">{{ row.statusLabel }}</tas-tag>
                @if (row.note) { <p class="mt-1 max-w-56 text-xs text-slate-500">{{ row.note }}</p> }
              </td>
              <td class="hidden text-sm tabular-nums text-slate-600 md:table-cell">
                {{ row.item.answeredAt ? formatDay(row.item.answeredAt, true) : '—' }}
              </td>
              <td class="text-right">
                @switch (row.action) {
                  @case ('consent') {
                    <button tas-outlined-button color="primary" type="button" class="text-xs" (click)="recordConsent(row.item)">Recueillir le consentement</button>
                  }
                  @case ('fill') {
                    <button tas-raised-button color="primary" type="button" class="text-xs" (click)="open(row.item, false)">Remplir</button>
                  }
                  @case ('edit') {
                    <button tas-text-button color="primary" type="button" class="text-xs" (click)="open(row.item, false)">Modifier</button>
                  }
                  @case ('view') {
                    <button tas-text-button color="primary" type="button" class="text-xs" (click)="open(row.item, true)">Voir</button>
                  }
                }
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </tas-card>
  `,
})
export class ProjectQuestionnaires {
  public readonly projectId = input.required<string>();
  /** Le projet est ouvert et l'agent a le droit de le modifier. */
  public readonly canEdit = input(false);
  /** Après chaque enregistrement : l'étape refusée peut maintenant passer. */
  public readonly changed = output<void>();

  private readonly _api = inject(OpportunitiesApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _canRecordConsent = inject(PermissionsService).can('lead:consent:record');

  public readonly formatDay = formatDay;
  public readonly data = signal<ProjectQuestionnairesDto | null>(null);
  public readonly isLoading = signal(false);
  public readonly loadFailed = signal(false);

  public readonly tableConfig: TableConfig = {
    property: 'questionnaires',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25] },
  };

  private readonly _expected = computed(() => (this.data()?.items ?? []).filter((i) => i.isExpected));
  public readonly total = computed(() => this._expected().length);
  public readonly answered = computed(() => this._expected().filter((i) => i.status === 'Completed').length);

  public readonly rows = computed<QuestionnaireRow[]>(() =>
    (this.data()?.items ?? []).map((item) => ({
      key: `${item.templateId}::${item.subjectType}::${item.subjectId}`,
      item,
      ...this._state(item),
    })),
  );

  constructor() {
    effect(() => {
      if (this.projectId()) this.load();
    });
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._api
      .getProjectQuestionnaires(this.projectId())
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((data) => this.data.set(data));
  }

  public open(item: ProjectQuestionnaireItemDto, readOnly: boolean): void {
    const ref = this._sideDrawer.open<boolean, ProjectQuestionnaireDrawerData, ProjectQuestionnaireDrawer>(
      ProjectQuestionnaireDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { projectId: this.projectId(), item, respondents: this.data()?.respondents ?? [], readOnly },
      },
    );
    ref.closed.subscribe((saved) => {
      if (!saved) return;
      this.load();
      this.changed.emit();
    });
  }

  public recordConsent(item: ProjectQuestionnaireItemDto): void {
    const leadId = this.data()?.leadId;
    if (!leadId) return;

    const ref = this._sideDrawer.open<HealthConsentDrawerResult | null, HealthConsentDrawerData, HealthConsentDrawer>(
      HealthConsentDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: {
          leadId,
          subjectType: item.subjectType ?? '',
          subjectId: item.subjectId!,
          subjectLabel: item.subjectLabel ?? '',
          isMinor: item.isMinor === true,
          givenByOptions: (this.data()?.respondents ?? [])
            .filter((r) => r.id !== item.subjectId)
            .map((r) => ({ value: r.id!, label: r.label ?? 'Répondant' })),
        },
      },
    );
    ref.closed.subscribe((result) => {
      if (result) this.load();
    });
  }

  private _state(item: ProjectQuestionnaireItemDto): Omit<QuestionnaireRow, 'key' | 'item'> {
    const done = item.status === 'Completed';
    const canEdit = this.canEdit();
    const needsConsent = item.isHealthQuestionnaire === true && !item.hasHealthConsent;

    if (done) {
      const note = item.inheritedFromLead ? 'Répondu sur le lead' : null;
      if (canEdit && item.isExpected && !needsConsent) {
        return { statusLabel: 'Rempli', statusSeverity: 'success', action: 'edit', note };
      }
      return { statusLabel: 'Rempli', statusSeverity: 'success', action: item.answers ? 'view' : 'none', note };
    }

    if (needsConsent) {
      if (!item.canRecordHealthConsent) {
        return {
          statusLabel: 'Consentement requis',
          statusSeverity: 'error',
          action: 'none',
          note: 'Ce projet n’a pas de lead : le consentement santé ne peut pas encore être recueilli ici.',
        };
      }
      return {
        statusLabel: 'Consentement requis',
        statusSeverity: 'error',
        action: canEdit && this._canRecordConsent() ? 'consent' : 'none',
        note: null,
      };
    }

    return { statusLabel: 'À remplir', statusSeverity: 'warning', action: canEdit ? 'fill' : 'none', note: null };
  }
}
