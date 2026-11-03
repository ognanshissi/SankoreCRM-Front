import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  AttentionItemDto,
  CircuitHealthDto,
  WorkflowAnalyticsApiService,
  WorkflowHealthDto,
  WorkflowInstancesApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { entityTypeLabel } from '../workflow-shared';
import { CancelInstanceDrawer, ReassignStepDrawer } from './health-action-drawers';

const PERIODS = [7, 30, 90] as const;
const STUCK_THRESHOLD_HOURS = 48;
/** En dessous, un circuit est montré même sans étape en retard aujourd'hui. */
const KEPT_RATE_FLOOR = 0.9;

/** « 26 h », « 3 j 4 h » : un retard se lit en jours dès qu'il les dépasse. */
function duration(hours: number | null | undefined): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest ? `${days} j ${rest} h` : `${days} j`;
}

function percent(rate: number | null | undefined): string {
  return rate == null ? '—' : `${Math.round(rate * 100)} %`;
}

/** L'écran du dossier quand le module ne l'a pas donné. */
function recordLink(item: AttentionItemDto): string | null {
  if (item.recordLink) return item.recordLink;
  switch (item.entityType) {
    case 'Lead': return `/leads/${item.entityId}`;
    case 'Opportunity': return `/leads/projets/${item.entityId}`;
    case 'Account': return `/customers/${item.entityId}`;
    case 'KycFile': return `/kyc/${item.entityId}`;
    default: return null;
  }
}

/**
 * « Santé des workflows », refondue « à traiter d'abord » (choix du propriétaire, 2026-11-03) : en
 * tête ce qui attend quelqu'un — étapes en retard, puis étapes qui attendent depuis plus de 48 h —,
 * chaque dossier nommé avec qui doit agir, et les actions sur place (relancer, réaffecter, ouvrir le
 * dossier, annuler). Dessous, la santé par circuit, versions regroupées, les circuits sans souci
 * repliés. L'ancien écran commençait par des circuits à 0 % et montrait des identifiants.
 */
@Component({
  selector: 'workflow-analytics-global',
  imports: [
    RouterLink, Button, TasCard, TasIcon, Menu, MenuItem, TasMenuTrigger, TasSpinner, TasTable, TimeagoPipe,
  ],
  template: `
    <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
      <div>
        <h1 class="text-lg font-semibold text-slate-800">Santé des workflows</h1>
        <p class="text-sm text-slate-500 mt-0.5">Ce qui attend une décision maintenant, puis l'état de chaque circuit.</p>
      </div>
      <div class="flex items-center gap-2">
        <div class="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Période des délais">
          @for (p of periods; track p) {
            <button type="button" class="rounded-md px-3 py-1 text-sm font-medium transition-colors"
                    [class]="days() === p ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-50'"
                    [attr.aria-pressed]="days() === p" (click)="setDays(p)">{{ p }} j</button>
          }
        </div>
        <button tas-button iconButton type="button" title="Actualiser" (click)="load()" [disabled]="isLoading()">
          <tas-icon iconName="feather:refresh-cw" style="font-size:14px"></tas-icon>
        </button>
      </div>
    </div>

    @if (isLoading() && !health()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else if (health(); as h) {
      <div class="flex flex-col gap-5">
        <!-- Indicateurs -->
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <tas-card class="block">
            <div class="p-4">
              <p class="text-xs text-slate-500">Étapes en retard</p>
              <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="h.overdueCount ? 'text-red-600' : 'text-slate-800'">{{ h.overdueCount }}</p>
              <p class="text-xs text-slate-400">délai dépassé, non décidées</p>
            </div>
          </tas-card>
          <tas-card class="block">
            <div class="p-4">
              <p class="text-xs text-slate-500">En attente prolongée</p>
              <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="h.stuckCount ? 'text-amber-600' : 'text-slate-800'">{{ h.stuckCount }}</p>
              <p class="text-xs text-slate-400">sans décision depuis plus de {{ h.stuckThresholdHours }} h</p>
            </div>
          </tas-card>
          <tas-card class="block">
            <div class="p-4">
              <p class="text-xs text-slate-500">Circuits en cours</p>
              <p class="mt-1 text-2xl font-semibold text-slate-800 tabular-nums">{{ h.activeInstances }}</p>
              <p class="text-xs text-slate-400">dossiers dans un circuit</p>
            </div>
          </tas-card>
          <tas-card class="block">
            <div class="p-4">
              <p class="text-xs text-slate-500">Délais tenus</p>
              <p class="mt-1 text-2xl font-semibold tabular-nums" [class]="keptTone(h.slaKeptRate)">{{ percent(h.slaKeptRate) }}</p>
              <p class="text-xs text-slate-400">
                @if (h.slaSteps) { {{ h.slaSteps - (h.slaBreached ?? 0) }} étapes sur {{ h.slaSteps }}, {{ h.days }} derniers jours } @else { aucune étape avec délai sur {{ h.days }} jours }
              </p>
            </div>
          </tas-card>
        </div>

        <!-- À traiter -->
        <section>
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <h2 class="text-sm font-semibold text-slate-800">
              À traiter
              @if (attention().length) { <span class="ml-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 tabular-nums">{{ attention().length }}</span> }
            </h2>
            <p class="text-xs text-slate-400">Au {{ h.asOf | dateTimeAgo }}</p>
          </div>
          @if (attention().length) {
            <tas-table [data]="attention()" identifierField="instanceStepId" [config]="attentionTable" [hasCaption]="false">
              <ng-template #header>
                <tr class="text-left text-xs font-medium text-slate-500">
                  <th class="py-2.5">Étape</th>
                  <th class="py-2.5">Dossier</th>
                  <th class="py-2.5">Qui doit agir</th>
                  <th class="py-2.5">Attente</th>
                  <th class="py-2.5 text-right"><span class="sr-only">Actions</span></th>
                </tr>
              </ng-template>
              <ng-template #body let-item>
                <tr class="align-top">
                  <td class="py-3">
                    <a class="font-medium text-slate-800 hover:text-primary" [routerLink]="['/settings/workflows/instances', item.instanceId]">{{ item.stepName }}</a>
                    <p class="text-xs text-slate-500">{{ item.circuit }}</p>
                  </td>
                  <td class="py-3">
                    @if (link(item); as url) {
                      <a class="text-sm font-medium text-primary hover:underline" [routerLink]="url">{{ item.recordLabel || 'Ouvrir le dossier' }}</a>
                    } @else {
                      <span class="text-sm text-slate-700">{{ item.recordLabel || '—' }}</span>
                    }
                    <p class="text-xs text-slate-500">{{ entityTypeLabel(item.entityType) }}</p>
                  </td>
                  <td class="py-3 text-sm text-slate-700">
                    @if (item.assignedTo) {
                      {{ item.assignedTo }}
                      @if (item.approverRole) { <p class="text-xs text-slate-500">confiée · rôle {{ item.approverRole }}</p> }
                    } @else if (item.approverRole) {
                      {{ item.approverRole }}
                      <p class="text-xs text-slate-500">tout titulaire du rôle</p>
                    } @else {
                      <span class="text-slate-400">Personne de désigné</span>
                    }
                  </td>
                  <td class="py-3">
                    @if (item.kind === 'Overdue') {
                      <span class="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 whitespace-nowrap">
                        <tas-icon iconName="feather:alert-circle" style="font-size:11px"></tas-icon>
                        Retard {{ duration(item.overdueHours) }}
                      </span>
                    } @else {
                      <span class="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 whitespace-nowrap">
                        <tas-icon iconName="feather:clock" style="font-size:11px"></tas-icon>
                        Attend depuis {{ duration(item.waitingHours) }}
                      </span>
                    }
                    @if (item.escalations) {
                      <p class="mt-1 text-xs text-slate-500">Escaladée {{ item.escalations }} fois</p>
                    }
                  </td>
                  <td class="py-3">
                    <div class="flex items-center justify-end gap-1.5">
                      @if (canAssign()) {
                        <button tas-outlined-button color="primary" size="small" type="button" class="bg-white"
                                [disabled]="busy() === item.instanceStepId" (click)="remind(item)" title="Prévenir qui doit agir">
                          <tas-icon iconName="feather:bell" style="font-size:12px"></tas-icon>&nbsp;Relancer
                        </button>
                        <button tas-outlined-button color="primary" size="small" type="button" class="bg-white" (click)="reassign(item)">
                          <tas-icon iconName="feather:user-check" style="font-size:12px"></tas-icon>&nbsp;Réaffecter
                        </button>
                      }
                      <button tas-button iconButton type="button" TasMenuTrigger [panel]="rowMenu" aria-label="Autres actions">
                        <tas-icon iconName="feather:more-horizontal" style="font-size:14px"></tas-icon>
                      </button>
                      <ng-template #rowMenu>
                        <tas-menu>
                          <tas-menu-item>
                            <a class="flex w-full items-center gap-2 text-slate-700" [routerLink]="['/settings/workflows/instances', item.instanceId]">
                              <tas-icon iconName="feather:git-pull-request" class="text-slate-400" style="font-size:13px"></tas-icon> Voir le circuit
                            </a>
                          </tas-menu-item>
                          @if (link(item); as url) {
                            <tas-menu-item>
                              <a class="flex w-full items-center gap-2 text-slate-700" [routerLink]="url">
                                <tas-icon iconName="feather:external-link" class="text-slate-400" style="font-size:13px"></tas-icon> Ouvrir le dossier
                              </a>
                            </tas-menu-item>
                          }
                          @if (canCancel()) {
                            <tas-menu-item>
                              <button type="button" class="flex w-full items-center gap-2 text-red-600" (click)="cancel(item)">
                                <tas-icon iconName="feather:x-circle" style="font-size:13px"></tas-icon> Annuler le circuit
                              </button>
                            </tas-menu-item>
                          }
                        </tas-menu>
                      </ng-template>
                    </div>
                  </td>
                </tr>
              </ng-template>
            </tas-table>
          } @else {
            <tas-card class="block">
              <div class="flex items-center gap-3 p-5">
                <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:20px"></tas-icon>
                <div>
                  <p class="text-sm font-medium text-slate-800">Rien à traiter</p>
                  <p class="text-xs text-slate-500">Aucune étape en retard, aucune qui attend depuis plus de {{ h.stuckThresholdHours }} h.</p>
                </div>
              </div>
            </tas-card>
          }
        </section>

        <!-- Santé par circuit -->
        <section>
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <h2 class="text-sm font-semibold text-slate-800">Santé par circuit</h2>
            <p class="text-xs text-slate-400">Délais tenus sur {{ h.days }} jours</p>
          </div>
          @if (visibleCircuits().length) {
            <tas-table [data]="visibleCircuits()" identifierField="templateId" [config]="circuitTable" [hasCaption]="false">
              <ng-template #header>
                <tr class="text-left text-xs font-medium text-slate-500">
                  <th class="py-2.5">Circuit</th>
                  <th class="py-2.5 text-right">En cours</th>
                  <th class="py-2.5 text-right">En retard</th>
                  <th class="py-2.5 text-right">En attente</th>
                  <th class="py-2.5">Délais tenus</th>
                  <th class="w-8"></th>
                </tr>
              </ng-template>
              <ng-template #body let-c>
                <tr class="cursor-pointer hover:bg-slate-50" [routerLink]="['/settings/workflows', c.templateId]">
                  <td class="py-3">
                    <p class="text-sm font-medium text-slate-800">{{ c.name }}</p>
                    <p class="text-xs text-slate-500">
                      {{ entityTypeLabel(c.entityType) }}
                      @if (c.versions > 1) { · {{ c.versions }} versions }
                      @if (!c.isActive) { · inactif }
                    </p>
                  </td>
                  <td class="py-3 text-right text-sm tabular-nums text-slate-700">{{ c.activeInstances }}</td>
                  <td class="py-3 text-right text-sm tabular-nums" [class]="c.overdue ? 'font-semibold text-red-600' : 'text-slate-400'">{{ c.overdue }}</td>
                  <td class="py-3 text-right text-sm tabular-nums" [class]="c.stuck ? 'font-semibold text-amber-600' : 'text-slate-400'">{{ c.stuck }}</td>
                  <td class="py-3">
                    @if (c.slaKeptRate != null) {
                      <div class="flex items-center gap-2">
                        <div class="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div class="h-full rounded-full" [class]="barTone(c.slaKeptRate)" [style.width.%]="c.slaKeptRate * 100"></div>
                        </div>
                        <span class="text-sm tabular-nums" [class]="keptTone(c.slaKeptRate)">{{ percent(c.slaKeptRate) }}</span>
                        <span class="text-xs text-slate-400">({{ c.slaSteps }})</span>
                      </div>
                    } @else {
                      <span class="text-xs text-slate-400">aucun délai sur la période</span>
                    }
                  </td>
                  <td class="py-3 text-right"><tas-icon iconName="feather:chevron-right" class="text-slate-300" style="font-size:14px"></tas-icon></td>
                </tr>
              </ng-template>
            </tas-table>
          }
          @if (hiddenCircuits() > 0) {
            <button type="button" class="mt-2 text-sm font-medium text-primary hover:underline" (click)="showAllCircuits.set(true)">
              Afficher {{ hiddenCircuits() > 1 ? 'les ' + hiddenCircuits() + ' circuits sans souci' : 'le circuit sans souci' }}
            </button>
          } @else if (showAllCircuits() && problemCircuits().length && problemCircuits().length < h.circuits!.length) {
            <button type="button" class="mt-2 text-sm font-medium text-primary hover:underline" (click)="showAllCircuits.set(false)">
              Ne montrer que les circuits à surveiller
            </button>
          }
        </section>
      </div>
    }
  `,
})
export class WorkflowAnalyticsGlobalPage implements OnInit {
  private readonly _analyticsApi = inject(WorkflowAnalyticsApiService);
  private readonly _instancesApi = inject(WorkflowInstancesApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canAssign = this._permissions.can('workflow:step:assign');
  public readonly canCancel = this._permissions.can('workflow:cancel');

  public readonly periods = PERIODS;
  public readonly entityTypeLabel = entityTypeLabel;
  public readonly duration = duration;
  public readonly percent = percent;
  public readonly link = recordLink;

  public isLoading = signal(true);
  public days = signal<number>(30);
  public health = signal<WorkflowHealthDto | null>(null);
  /** L'étape dont la relance part, pour ne pas l'envoyer deux fois d'un double clic. */
  public busy = signal<string | null>(null);
  public showAllCircuits = signal(false);

  public readonly attention = computed(() => this.health()?.attention ?? []);
  public readonly problemCircuits = computed(() =>
    (this.health()?.circuits ?? []).filter(
      (c) => (c.overdue ?? 0) + (c.stuck ?? 0) > 0 || (c.slaKeptRate != null && c.slaKeptRate < KEPT_RATE_FLOOR),
    ),
  );
  /** Les circuits à surveiller ; tous quand aucun ne l'est, ou à la demande. */
  public readonly visibleCircuits = computed<CircuitHealthDto[]>(() => {
    const all = this.health()?.circuits ?? [];
    return this.showAllCircuits() || !this.problemCircuits().length ? all : this.problemCircuits();
  });
  public readonly hiddenCircuits = computed(() => (this.health()?.circuits?.length ?? 0) - this.visibleCircuits().length);

  public readonly attentionTable: TableConfig = {
    property: 'instanceStepId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25, 50] },
  };
  public readonly circuitTable: TableConfig = {
    property: 'templateId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25, 50] },
  };

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Workflows', link: ['/settings/workflows'] },
      { label: 'Santé' },
    ]);
    this.load();
  }

  public setDays(days: number): void {
    this.days.set(days);
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this._analyticsApi.getWorkflowHealth(this.days(), STUCK_THRESHOLD_HOURS).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'La santé des workflows n\'a pas pu être chargée.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((health) => {
      this.health.set(health);
      this.isLoading.set(false);
    });
  }

  public remind(item: AttentionItemDto): void {
    this.busy.set(item.instanceStepId ?? null);
    this._instancesApi.remindWorkflowStep(item.instanceId!, item.instanceStepId!).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Relance impossible', err.error?.error || 'La relance n\'a pas pu être envoyée.');
        this.busy.set(null);
        return EMPTY;
      }),
    ).subscribe((res) => {
      this.busy.set(null);
      const n = res.reminded ?? 0;
      if (n) this._snackbar.success('Relance envoyée', n > 1 ? `${n} personnes prévenues.` : 'La personne a été prévenue.');
      else this._snackbar.info('Personne à relancer', 'Aucune personne ne tient cette étape : réaffectez-la.');
    });
  }

  public reassign(item: AttentionItemDto): void {
    const ref = this._sideDrawer.open<boolean, AttentionItemDto, ReassignStepDrawer>(ReassignStepDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: item,
    });
    ref.closed.subscribe((done) => {
      if (!done) return;
      this._snackbar.success('Étape réaffectée', 'La personne choisie a été prévenue.');
      this.load();
    });
  }

  public cancel(item: AttentionItemDto): void {
    const ref = this._sideDrawer.open<boolean, AttentionItemDto, CancelInstanceDrawer>(CancelInstanceDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: item,
    });
    ref.closed.subscribe((done) => {
      if (!done) return;
      this._snackbar.success('Circuit annulé', 'Il ne retient plus le dossier.');
      this.load();
    });
  }

  public keptTone(rate: number | null | undefined): string {
    if (rate == null) return 'text-slate-800';
    if (rate >= KEPT_RATE_FLOOR) return 'text-green-700';
    if (rate >= 0.7) return 'text-amber-600';
    return 'text-red-600';
  }

  public barTone(rate: number): string {
    if (rate >= KEPT_RATE_FLOOR) return 'bg-green-500';
    if (rate >= 0.7) return 'bg-amber-500';
    return 'bg-red-500';
  }
}

export default WorkflowAnalyticsGlobalPage;
