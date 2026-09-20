import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  ExecutionMonitorDto,
  OverdueStepDto,
  SlaDashboardDto,
  StuckInstanceDto,
  WorkflowAnalyticsApiService,
  WorkflowInstancesApiService,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { entityTypeLabel } from '../workflow-shared';

function pct(n: number | undefined): string {
  if (!n) return '0%';
  return `${Math.round(n * 100)}%`;
}

function hours(n: number | undefined): string {
  if (!n) return '—';
  if (n < 1) return `${Math.round(n * 60)} min`;
  return `${n.toFixed(1)} h`;
}

function breachSeverity(rate: number | undefined): Severity {
  if (!rate) return 'success';
  if (rate >= 0.5) return 'error';
  if (rate >= 0.2) return 'warning';
  return 'info';
}

@Component({
  selector: 'workflow-analytics-global',
  imports: [
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TimeagoPipe,
  ],
  template: `
    <!-- Header -->
    <div class="flex items-start justify-between mb-5">
      <div>
        <h1 class="text-lg font-semibold text-slate-800">Santé des workflows</h1>
        <p class="text-sm text-slate-400 mt-0.5">Vue globale SLA, files d'attente et instances bloquées.</p>
      </div>
      <button
        tas-button
        iconButton
        type="button"
        title="Actualiser"
        (click)="load()"
        [disabled]="isLoading()"
      >
        <tas-icon iconName="feather:refresh-cw" iconSize="sm"></tas-icon>
      </button>
    </div>

    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="flex flex-col gap-4">

        <!-- ── SLA section ───────────────────────────────────────────────── -->
        <div class="grid grid-cols-3 gap-4">
          <tas-card>
            <div class="p-4 flex flex-col gap-1">
              <p class="text-xs text-slate-400">Étapes en retard</p>
              <p class="text-2xl font-semibold tabular-nums"
                [class.text-red-600]="(sla()?.overdueSteps?.length ?? 0) > 0"
                [class.text-slate-800]="(sla()?.overdueSteps?.length ?? 0) === 0"
              >
                {{ sla()?.overdueSteps?.length ?? 0 }}
              </p>
            </div>
          </tas-card>
          <tas-card>
            <div class="p-4 flex flex-col gap-1">
              <p class="text-xs text-slate-400">Instances actives</p>
              <p class="text-2xl font-semibold text-slate-800 tabular-nums">
                {{ totalActive() }}
              </p>
            </div>
          </tas-card>
          <tas-card>
            <div class="p-4 flex flex-col gap-1">
              <p class="text-xs text-slate-400">Instances bloquées</p>
              <p class="text-2xl font-semibold tabular-nums"
                [class.text-amber-600]="(monitor()?.stuckInstances?.length ?? 0) > 0"
                [class.text-slate-800]="(monitor()?.stuckInstances?.length ?? 0) === 0"
              >
                {{ monitor()?.stuckInstances?.length ?? 0 }}
              </p>
            </div>
          </tas-card>
        </div>

        <!-- SLA by template -->
        @if ((sla()?.byTemplate?.length ?? 0) > 0) {
          <tas-card>
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Taux de dépassement SLA par modèle</p>
            </div>
            <div class="divide-y divide-slate-100">
              @for (t of sla()!.byTemplate!; track t.templateId) {
                <div
                  class="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  (click)="navigateToTemplate(t.templateId)"
                >
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">{{ t.templateName || '(modèle)' }}</p>
                    <p class="text-xs text-slate-400 mt-0.5">{{ t.breachedSteps ?? 0 }} / {{ t.totalSteps ?? 0 }} étapes dépassées</p>
                  </div>
                  <tas-tag [severity]="breachSeverity(t.breachRate)">{{ pct(t.breachRate) }}</tas-tag>
                  <tas-icon iconName="feather:chevron-right" class="text-slate-300 shrink-0" style="font-size:14px"></tas-icon>
                </div>
              }
            </div>
          </tas-card>
        }

        <!-- Overdue steps -->
        @if ((sla()?.overdueSteps?.length ?? 0) > 0) {
          <tas-card>
            <div class="p-4 border-b border-slate-100 flex items-center gap-2">
              <tas-icon iconName="feather:alert-circle" class="text-red-500" style="font-size:14px"></tas-icon>
              <p class="text-sm font-semibold text-slate-700">Étapes en retard</p>
            </div>
            <div class="divide-y divide-slate-100">
              @for (s of sla()!.overdueSteps!; track s.stepId) {
                <div
                  class="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  (click)="navigateToInstance(s)"
                >
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">{{ s.stepName || '(étape)' }}</p>
                    <p class="text-xs text-slate-400 mt-0.5">
                      {{ entityTypeLabel(s.entityType) }} · {{ s.entityId }}
                      @if (s.approverRoleCode) {
                        · Rôle : {{ s.approverRoleCode }}
                      }
                    </p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="text-xs font-medium text-red-600">+{{ hours(s.overdueByHours) }}</p>
                    <p class="text-[10px] text-slate-400">de retard</p>
                  </div>
                  <tas-icon iconName="feather:chevron-right" class="text-slate-300 shrink-0" style="font-size:14px"></tas-icon>
                </div>
              }
            </div>
          </tas-card>
        }

        <!-- Execution monitor -->
        @if ((monitor()?.byTemplate?.length ?? 0) > 0) {
          <tas-card>
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">File d'attente par modèle</p>
              @if (monitor()?.asOf) {
                <p class="text-xs text-slate-400 mt-0.5">Au {{ monitor()!.asOf! | dateTimeAgo }}</p>
              }
            </div>
            <div class="divide-y divide-slate-100">
              @for (q of monitor()!.byTemplate!; track q.templateId) {
                <div
                  class="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  (click)="navigateToTemplate(q.templateId)"
                >
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">{{ q.templateName || '(modèle)' }}</p>
                    <p class="text-xs text-slate-400 mt-0.5">
                      {{ q.activeInstances ?? 0 }} actives · {{ q.queueDepth ?? 0 }} en file
                    </p>
                  </div>
                  <div class="shrink-0 flex items-center gap-1.5">
                    @if ((q.queueDepth ?? 0) > 0) {
                      <span class="text-xs font-semibold text-amber-600 tabular-nums">{{ q.queueDepth }}</span>
                      <tas-icon iconName="feather:clock" class="text-amber-400" style="font-size:12px"></tas-icon>
                    }
                  </div>
                  <tas-icon iconName="feather:chevron-right" class="text-slate-300 shrink-0" style="font-size:14px"></tas-icon>
                </div>
              }
            </div>
          </tas-card>
        }

        <!-- Stuck instances -->
        @if ((monitor()?.stuckInstances?.length ?? 0) > 0) {
          <tas-card>
            <div class="p-4 border-b border-slate-100 flex items-center gap-2">
              <tas-icon iconName="feather:pause-circle" class="text-amber-500" style="font-size:14px"></tas-icon>
              <p class="text-sm font-semibold text-slate-700">Instances bloquées</p>
              <p class="text-xs text-slate-400 ml-auto">Seuil : {{ monitor()?.stuckThresholdHours ?? 48 }}h</p>
            </div>
            <div class="divide-y divide-slate-100">
              @for (s of monitor()!.stuckInstances!; track s.instanceId) {
                <div
                  class="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  (click)="navigateToStuckInstance(s)"
                >
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">
                      {{ s.templateName || '(modèle)' }} — {{ entityTypeLabel(s.entityType) }}
                    </p>
                    <p class="text-xs text-slate-400 font-mono truncate mt-0.5">{{ s.entityId }}</p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="text-xs font-medium text-amber-600">{{ hours(s.stuckForHours) }}</p>
                    <p class="text-[10px] text-slate-400">bloqué</p>
                  </div>
                  <tas-icon iconName="feather:chevron-right" class="text-slate-300 shrink-0" style="font-size:14px"></tas-icon>
                </div>
              }
            </div>
          </tas-card>
        }

        @if (!sla()?.byTemplate?.length && !monitor()?.stuckInstances?.length) {
          <tas-card>
            <div class="p-10 text-center">
              <tas-icon iconName="feather:check-circle" class="text-green-400" style="font-size:32px"></tas-icon>
              <p class="text-sm font-medium text-slate-700 mt-3">Aucun problème détecté</p>
              <p class="text-xs text-slate-400 mt-1">Tous les workflows sont dans les délais.</p>
            </div>
          </tas-card>
        }

      </div>
    }
  `,
})
export class WorkflowAnalyticsGlobalPage implements OnInit {
  private readonly _analyticsApi = inject(WorkflowAnalyticsApiService);
  private readonly _instancesApi = inject(WorkflowInstancesApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly entityTypeLabel = entityTypeLabel;
  public readonly pct = pct;
  public readonly hours = hours;
  public readonly breachSeverity = breachSeverity;

  public isLoading = signal(true);
  public sla = signal<SlaDashboardDto | null>(null);
  public monitor = signal<ExecutionMonitorDto | null>(null);

  public totalActive = () =>
    (this.monitor()?.byTemplate ?? []).reduce((sum, q) => sum + (q.activeInstances ?? 0), 0);

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Workflows', link: ['/settings/workflows'] },
      { label: 'Santé' },
    ]);
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    forkJoin({
      sla: this._analyticsApi.getSlaDashboard(),
      monitor: this._analyticsApi.getExecutionMonitor(),
    }).subscribe({
      next: ({ sla, monitor }) => {
        this.sla.set(sla);
        this.monitor.set(monitor);
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }

  public navigateToTemplate(templateId: string | undefined): void {
    if (templateId) this._router.navigate(['/settings/workflows', templateId]);
  }

  public navigateToInstance(step: OverdueStepDto): void {
    if (!step.instanceId) return;
    this._instancesApi.getWorkflowInstance(step.instanceId).subscribe({
      next: (instance) => {
        if (instance.templateId) {
          this._router.navigate(['/settings/workflows', instance.templateId, 'instances', step.instanceId]);
        }
      },
    });
  }

  public navigateToStuckInstance(s: StuckInstanceDto): void {
    if (s.templateId && s.instanceId) {
      this._router.navigate(['/settings/workflows', s.templateId, 'instances', s.instanceId]);
    }
  }
}

export default WorkflowAnalyticsGlobalPage;
