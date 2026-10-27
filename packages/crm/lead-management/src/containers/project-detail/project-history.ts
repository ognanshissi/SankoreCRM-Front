import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { OpportunitiesApiService, ProjectHistoryDto } from '@sankore/crm-api';
import { projectAmountLabel } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { formatAmount, formatDay } from '../edit-lead/lead-view.models';

type HistoryRow = {
  id: string;
  icon: string;
  tone: string;
  text: string;
  note: string | null;
  link: unknown[] | null;
  author: string;
  at: string | null;
};

/**
 * L'historique du projet (propriétaire, 2026-10-27), le plus récent d'abord : ce qui a changé, de
 * quoi à quoi, qui et quand. Les valeurs sont celles que le serveur a gardées au moment du
 * changement — une étape renommée depuis garde ici son ancien nom, c'est voulu.
 */
@Component({
  selector: 'project-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, RouterLink, Button, TasCard, TasIcon, TasTable],
  template: `
    <tas-card class="block" id="project-history">
      <div class="p-5 pb-3">
        <h2 class="text-base font-semibold text-slate-900">Historique</h2>
        <p class="text-xs text-slate-500">Ce qui a changé sur le projet, qui l'a fait et quand — le plus récent d'abord.</p>
      </div>

      @if (loadFailed()) {
        <div class="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3" role="alert">
          <p class="text-sm text-red-800">L'historique n'a pas pu être chargé.</p>
          <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else if (!isLoading() && rows().length === 0) {
        <p class="px-5 pb-5 text-sm text-slate-400">Rien n'est encore arrivé à ce projet.</p>
      } @else {
        <tas-table [data]="rows()" identifierField="id" [config]="tableConfig()" [isLoading]="isLoading()" [hasCaption]="false">
          <ng-template #body let-row>
            <tr>
              <td class="py-2.5">
                <div class="flex items-start gap-3">
                  <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full" [class]="row.tone">
                    <tas-icon [iconName]="row.icon" iconClass="!size-3.5"></tas-icon>
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm text-slate-800">
                      {{ row.text }}
                      @if (row.link) {
                        <a [routerLink]="row.link" class="ms-1 text-xs font-semibold text-primary hover:underline">Voir le contrat</a>
                      }
                    </p>
                    @if (row.note) {
                      <p class="mt-0.5 text-xs text-slate-600">« {{ row.note }} »</p>
                    }
                    <p class="mt-0.5 text-xs text-slate-500">{{ row.author }} · {{ row.at | date: 'dd/MM/yyyy à HH:mm' }}</p>
                  </div>
                </div>
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </tas-card>
  `,
})
export class ProjectHistory {
  private readonly _api = inject(OpportunitiesApiService);

  public readonly projectId = input.required<string>();
  /** La dernière écriture du projet : quand elle change, l'historique a une ligne de plus. */
  public readonly refreshKey = input<string | null | undefined>(null);
  public readonly clientId = input<string | null>(null);
  public readonly amountKind = input<string | null | undefined>(null);

  public readonly entries = signal<ProjectHistoryDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);

  public readonly rows = computed<HistoryRow[]>(() => this.entries().map((e) => this._toRow(e)));

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'project-history',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25, 50], totalElements: this.rows().length },
  }));

  constructor() {
    effect(() => {
      const id = this.projectId();
      this.refreshKey();
      if (id) untracked(() => this.load());
    });
  }

  public load(): void {
    this.loadFailed.set(false);
    this._api
      .getProjectHistory(this.projectId())
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((entries) => this.entries.set(entries ?? []));
  }

  private _toRow(e: ProjectHistoryDto): HistoryRow {
    const row = (icon: string, tone: string, text: string, note: string | null = null, link: unknown[] | null = null): HistoryRow => ({
      id: e.id ?? '',
      icon,
      tone,
      text,
      note,
      link,
      author: e.actorName ?? (e.reconstructed ? 'Reconstitué — auteur inconnu' : 'Système'),
      at: e.at ?? null,
    });
    const neutral = 'bg-slate-100 text-slate-600';

    switch (e.kind) {
      case 'Created':
        return row('feather:plus', 'bg-primary/10 text-primary', e.detail ? `Projet créé · ${e.detail}` : 'Projet créé');
      case 'StepChanged':
        return row('feather:arrow-right', 'bg-indigo-50 text-indigo-700',
          e.from ? `Étape : « ${e.from} » → « ${e.to} »` : `Étape : « ${e.to} »`);
      case 'AmountChanged': {
        const label = projectAmountLabel(this.amountKind());
        const money = (v: string | null | undefined) => (v ? formatAmount(Number(v), e.detail) : 'à préciser');
        return row('feather:dollar-sign', neutral, `${label} : ${money(e.from)} → ${money(e.to)}`);
      }
      case 'ProductChanged':
        return row('feather:package', neutral, `Produit : ${e.from ?? 'à préciser'} → ${e.to ?? 'à préciser'}`);
      case 'CloseDateChanged': {
        const day = (v: string | null | undefined) => (v ? formatDay(v, true) : 'non définie');
        return row('feather:calendar', neutral, `Clôture prévue : ${day(e.from)} → ${day(e.to)}`);
      }
      case 'TemplateVersionChanged':
        return row('feather:git-branch', 'bg-sky-50 text-sky-700',
          `Parcours « ${e.detail ?? ''} » : version ${e.from ?? '—'} → version ${e.to ?? '—'}`);
      case 'Won':
        return row('feather:check-circle', 'bg-green-100 text-green-800', 'Projet gagné', e.detail ?? null);
      case 'Lost':
        return row('feather:x-circle', 'bg-red-100 text-red-700', 'Projet perdu', e.detail ?? null);
      case 'HoldingOpened': {
        const clientId = this.clientId();
        return row('feather:file-text', 'bg-green-100 text-green-800', 'Contrat ouvert', null,
          clientId && e.relatedId ? ['/customers', clientId, 'contrats', `holding:${e.relatedId}`] : null);
      }
      case 'WorkflowRestarted':
        return row('feather:refresh-cw', 'bg-amber-50 text-amber-700',
          e.to ? `Circuit de validation relancé · étape « ${e.to} »` : 'Circuit de validation relancé');
      default:
        return row('feather:circle', neutral, String(e.kind ?? ''));
    }
  }
}
