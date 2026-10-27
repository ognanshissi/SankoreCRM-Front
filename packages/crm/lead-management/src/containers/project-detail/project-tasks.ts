import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { OpportunitiesApiService, ProjectTaskDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { NewTaskDrawer, NewTaskDrawerData, STATUS_LABELS } from '@sankore/crm/tasks';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { formatDay } from '../edit-lead/lead-view.models';

type TaskRow = {
  id: string;
  title: string;
  holder: string;
  dueLabel: string;
  overdue: boolean;
  closed: boolean;
  statusLabel: string;
  statusTone: string;
};

/**
 * Les tâches du projet (propriétaire, 2026-10-27) : celles que l'agent peut ouvrir — le serveur
 * filtre par la règle de toutes les tâches —, les ouvertes d'abord par échéance. « Nouvelle tâche »
 * ouvre le tiroir de Ma journée, le projet déjà choisi comme sujet.
 */
@Component({
  selector: 'project-tasks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Button, TasCard, TasIcon, TasTable],
  template: `
    <tas-card class="block" id="project-tasks">
      <div class="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div>
          <h2 class="text-base font-semibold text-slate-900">Tâches</h2>
          <p class="text-xs text-slate-500">
            @if (openCount() > 0) {
              {{ openCount() }} à faire
            } @else if (tasks().length > 0) {
              Toutes faites
            } @else {
              Ce qu'il y a à faire sur ce projet, et pour qui.
            }
          </p>
        </div>
        @if (canCreate()) {
          <button tas-outlined-button color="primary" type="button" (click)="create()">
            <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon> Nouvelle tâche
          </button>
        }
      </div>

      @if (loadFailed()) {
        <div class="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 px-4 py-3" role="alert">
          <p class="text-sm text-red-800">Les tâches n'ont pas pu être chargées.</p>
          <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else if (!isLoading() && rows().length === 0) {
        <p class="px-5 pb-5 text-sm text-slate-400">Aucune tâche sur ce projet.</p>
      } @else {
        <tas-table [data]="rows()" identifierField="id" [config]="tableConfig()" [isLoading]="isLoading()" [hasCaption]="false">
          <ng-template #header>
            <tr>
              <th>Tâche</th>
              <th class="hidden sm:table-cell">Pour</th>
              <th>Échéance</th>
              <th class="hidden sm:table-cell">Statut</th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr>
              <td class="py-2.5">
                <a [routerLink]="['/tasks', row.id]" class="text-sm font-medium hover:text-primary hover:underline"
                   [class]="row.closed ? 'text-slate-500 line-through' : 'text-slate-800'">{{ row.title }}</a>
                <span class="block text-xs text-slate-500 sm:hidden">{{ row.holder }} · {{ row.statusLabel }}</span>
              </td>
              <td class="hidden text-sm text-slate-600 sm:table-cell">{{ row.holder }}</td>
              <td class="text-sm tabular-nums" [class]="row.overdue ? 'font-semibold text-red-700' : 'text-slate-600'">{{ row.dueLabel }}</td>
              <td class="hidden sm:table-cell">
                <span class="rounded-full px-2 py-0.5 text-xs font-semibold" [class]="row.statusTone">{{ row.statusLabel }}</span>
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </tas-card>
  `,
})
export class ProjectTasks {
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);

  public readonly projectId = input.required<string>();
  public readonly projectTitle = input('');

  public readonly canCreate = this._permissions.can('lead:task:manage');

  public readonly tasks = signal<ProjectTaskDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);

  public readonly openCount = computed(() => this.tasks().filter((t) => !isClosed(t.status)).length);

  public readonly rows = computed<TaskRow[]>(() => {
    const now = Date.now();
    return this.tasks().map((t) => {
      const closed = isClosed(t.status);
      const status = STATUS_LABELS[t.status ?? ''] ?? { label: t.status ?? '', tone: 'bg-slate-100 text-slate-600' };
      return {
        id: t.id ?? '',
        title: t.title ?? '',
        holder: t.assignedAgentName ?? (t.assignedAgentId ? 'Utilisateur inconnu' : 'Personne'),
        dueLabel: closed && t.completedAt ? `Faite le ${formatDay(t.completedAt, true)}` : formatDay(t.dueAt, true),
        overdue: !closed && !!t.dueAt && new Date(t.dueAt).getTime() < now,
        closed,
        statusLabel: status.label,
        statusTone: status.tone,
      };
    });
  });

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'project-tasks',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25], totalElements: this.rows().length },
  }));

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) untracked(() => this.load());
    });
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._api
      .listProjectTasks(this.projectId())
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((tasks) => this.tasks.set(tasks ?? []));
  }

  public create(): void {
    this._sideDrawer
      .open<string, NewTaskDrawerData, NewTaskDrawer>(NewTaskDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { subject: { type: 'project', id: this.projectId(), label: this.projectTitle() } },
      })
      .closed.subscribe((id) => {
        if (id) this.load();
      });
  }
}

function isClosed(status: string | null | undefined): boolean {
  return status === 'Completed' || status === 'Cancelled';
}
