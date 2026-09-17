import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import {
  FieldChangedDto,
  StepChangedDto,
  StepSnapshotDto,
  TemplateDiffDto,
  TransitionChangedDto,
  TransitionSnapshotDto,
  WorkflowTemplateDto,
  WorkflowTemplatesApiService,
} from '@sankore/crm-api';

const FIELD_LABELS: Record<string, string> = {
  name: 'Nom',
  description: 'Description',
  approverRoleCode: 'Rôle approbateur',
  timeoutHours: 'Délai (h)',
  eventCode: 'Événement',
  priority: 'Priorité',
  conditionJson: 'Condition',
  fromStepOrder: 'Depuis étape',
  toStepOrder: 'Vers étape',
  toTerminalStatus: 'Statut terminal',
};

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

@Component({
  selector: 'workflow-compare',
  imports: [NgClass, FormsModule, TasCard, TasSpinner, TasIcon, TasFormField, TasLabel, TasSelect],
  template: `
    <div class="pb-6 flex flex-col gap-4">

      <!-- Selector -->
      <tas-card>
        <div class="p-4 flex flex-col gap-3">
          <div>
            <p class="text-sm font-semibold text-slate-700">Comparer les versions</p>
            <p class="text-xs text-slate-400 mt-0.5">
              Sélectionnez un autre modèle pour visualiser les différences d'étapes et de transitions.
            </p>
          </div>

          <tas-form-field>
            <tas-label>Comparer avec</tas-label>
            <tas-select
              [options]="templateOptions()"
              [ngModel]="compareWithId()"
              (ngModelChange)="compareWithId.set($event)"
            ></tas-select>
          </tas-form-field>
        </div>
      </tas-card>

      @if (isLoadingTemplates() || isLoadingDiff()) {
        <div class="flex justify-center py-16">
          <tas-spinner size="8" class="text-primary"></tas-spinner>
        </div>
      } @else if (diff()) {

        <!-- Version header -->
        <div class="flex items-center gap-3 px-1">
          <span class="text-sm font-mono font-medium text-slate-600">v{{ diff()!.fromVersion }}</span>
          <tas-icon iconName="feather:arrow-right" class="text-slate-300" style="font-size:14px"></tas-icon>
          <span class="text-sm font-mono font-medium text-slate-600">v{{ diff()!.toVersion }}</span>
          <span class="text-xs text-slate-400 ml-auto">{{ fromTemplateName() }} → {{ toTemplateName() }}</span>
        </div>

        <!-- Steps diff -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Étapes</p>
          </div>

          @if (hasNoStepChanges()) {
            <p class="text-sm text-slate-400 p-4 text-center">Aucun changement d'étapes.</p>
          } @else {
            <div class="divide-y divide-slate-100">

              @for (step of diff()!.steps?.added ?? []; track step.order) {
                <div class="flex items-start gap-3 px-4 py-3 bg-green-50/40">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-green-100 text-green-600 text-[10px] font-bold flex items-center justify-center mt-0.5">+</span>
                  <div>
                    <p class="text-sm font-medium text-green-800">Étape {{ step.order }} — {{ step.name || '(sans nom)' }}</p>
                    @if (step.description) {
                      <p class="text-xs text-green-600 mt-0.5">{{ step.description }}</p>
                    }
                    <div class="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      @if (step.approverRoleCode) {
                        <span class="text-xs text-slate-500">Rôle : {{ step.approverRoleCode }}</span>
                      }
                      @if (step.timeoutHours) {
                        <span class="text-xs text-slate-500">Délai : {{ step.timeoutHours }}h</span>
                      }
                    </div>
                  </div>
                  <span class="ml-auto shrink-0 text-[10px] font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Ajouté</span>
                </div>
              }

              @for (step of diff()!.steps?.removed ?? []; track step.order) {
                <div class="flex items-start gap-3 px-4 py-3 bg-red-50/40">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-red-100 text-red-500 text-[10px] font-bold flex items-center justify-center mt-0.5">−</span>
                  <div>
                    <p class="text-sm font-medium text-red-800">Étape {{ step.order }} — {{ step.name || '(sans nom)' }}</p>
                    @if (step.description) {
                      <p class="text-xs text-red-500 mt-0.5">{{ step.description }}</p>
                    }
                  </div>
                  <span class="ml-auto shrink-0 text-[10px] font-medium text-red-500 bg-red-100 px-2 py-0.5 rounded-full">Supprimé</span>
                </div>
              }

              @for (step of diff()!.steps?.changed ?? []; track step.order) {
                <div class="flex items-start gap-3 px-4 py-3 bg-amber-50/40">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold flex items-center justify-center mt-0.5">~</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-amber-800">Étape {{ step.order }}</p>
                    <div class="mt-1.5 flex flex-col gap-1">
                      @for (entry of stepChanges(step); track entry.key) {
                        <div class="flex items-baseline gap-2 text-xs">
                          <span class="text-slate-500 shrink-0">{{ fieldLabel(entry.key) }} :</span>
                          <span class="text-red-500 line-through truncate">{{ entry.from ?? '—' }}</span>
                          <tas-icon iconName="feather:arrow-right" class="text-slate-300 shrink-0" style="font-size:10px"></tas-icon>
                          <span class="text-green-600 truncate">{{ entry.to ?? '—' }}</span>
                        </div>
                      }
                    </div>
                  </div>
                  <span class="ml-auto shrink-0 text-[10px] font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Modifié</span>
                </div>
              }

            </div>
          }
        </tas-card>

        <!-- Transitions diff -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Transitions</p>
          </div>

          @if (hasNoTransitionChanges()) {
            <p class="text-sm text-slate-400 p-4 text-center">Aucun changement de transitions.</p>
          } @else {
            <div class="divide-y divide-slate-100">

              @for (tr of diff()!.transitions?.added ?? []; track tr.eventCode) {
                <div class="flex items-start gap-3 px-4 py-3 bg-green-50/40">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-green-100 text-green-600 text-[10px] font-bold flex items-center justify-center mt-0.5">+</span>
                  <div>
                    <p class="text-sm font-medium text-green-800">{{ transitionLabel(tr) }}</p>
                    @if (tr.eventCode) {
                      <p class="text-xs text-green-600 mt-0.5">Événement : {{ tr.eventCode }}</p>
                    }
                  </div>
                  <span class="ml-auto shrink-0 text-[10px] font-medium text-green-600 bg-green-100 px-2 py-0.5 rounded-full">Ajouté</span>
                </div>
              }

              @for (tr of diff()!.transitions?.removed ?? []; track tr.eventCode) {
                <div class="flex items-start gap-3 px-4 py-3 bg-red-50/40">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-red-100 text-red-500 text-[10px] font-bold flex items-center justify-center mt-0.5">−</span>
                  <div>
                    <p class="text-sm font-medium text-red-800">{{ transitionLabel(tr) }}</p>
                    @if (tr.eventCode) {
                      <p class="text-xs text-red-500 mt-0.5">Événement : {{ tr.eventCode }}</p>
                    }
                  </div>
                  <span class="ml-auto shrink-0 text-[10px] font-medium text-red-500 bg-red-100 px-2 py-0.5 rounded-full">Supprimé</span>
                </div>
              }

              @for (tr of diff()!.transitions?.changed ?? []; track tr.key) {
                <div class="flex items-start gap-3 px-4 py-3 bg-amber-50/40">
                  <span class="shrink-0 w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold flex items-center justify-center mt-0.5">~</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-amber-800">{{ tr.key ?? 'Transition' }}</p>
                    <div class="mt-1.5 flex flex-col gap-1">
                      @for (entry of transitionChanges(tr); track entry.key) {
                        <div class="flex items-baseline gap-2 text-xs">
                          <span class="text-slate-500 shrink-0">{{ fieldLabel(entry.key) }} :</span>
                          <span class="text-red-500 line-through truncate">{{ entry.from ?? '—' }}</span>
                          <tas-icon iconName="feather:arrow-right" class="text-slate-300 shrink-0" style="font-size:10px"></tas-icon>
                          <span class="text-green-600 truncate">{{ entry.to ?? '—' }}</span>
                        </div>
                      }
                    </div>
                  </div>
                  <span class="ml-auto shrink-0 text-[10px] font-medium text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">Modifié</span>
                </div>
              }

            </div>
          }
        </tas-card>

      } @else if (compareWithId()) {
        <p class="text-sm text-slate-400 text-center py-8">Impossible de charger la comparaison.</p>
      }

    </div>
  `,
})
export class WorkflowComparePage {
  private readonly _api = inject(WorkflowTemplatesApiService);

  public readonly id = input.required<string>();
  public readonly fieldLabel = fieldLabel;

  public isLoadingTemplates = signal(true);
  public isLoadingDiff = signal(false);
  public templates = signal<WorkflowTemplateDto[]>([]);
  public compareWithId = signal<string>('');
  public diff = signal<TemplateDiffDto | null>(null);

  public templateOptions = computed(() => [
    { label: 'Sélectionner un modèle…', value: '' },
    ...this.templates()
      .filter((t) => t.id !== this.id())
      .map((t) => ({
        label: `${t.name ?? 'Sans nom'} (v${t.version ?? 1})`,
        value: t.id!,
      })),
  ]);

  public fromTemplateName = computed(() => {
    const t = this.templates().find((t) => t.id === this.id());
    return t?.name ?? 'Ce modèle';
  });

  public toTemplateName = computed(() => {
    const t = this.templates().find((t) => t.id === this.compareWithId());
    return t?.name ?? 'Cible';
  });

  public hasNoStepChanges = computed(() => {
    const s = this.diff()?.steps;
    return !s || (
      (s.added?.length ?? 0) === 0 &&
      (s.removed?.length ?? 0) === 0 &&
      (s.changed?.length ?? 0) === 0
    );
  });

  public hasNoTransitionChanges = computed(() => {
    const tr = this.diff()?.transitions;
    return !tr || (
      (tr.added?.length ?? 0) === 0 &&
      (tr.removed?.length ?? 0) === 0 &&
      (tr.changed?.length ?? 0) === 0
    );
  });

  constructor() {
    this._api.listWorkflowTemplates().subscribe({
      next: (result) => {
        this.templates.set(result ?? []);
        this.isLoadingTemplates.set(false);
      },
      error: () => this.isLoadingTemplates.set(false),
    });

    effect(() => {
      const compareWith = this.compareWithId();
      if (!compareWith) {
        this.diff.set(null);
        return;
      }
      this.isLoadingDiff.set(true);
      this._api
        .getTemplateDiff(this.id(), compareWith)
        .pipe(catchError(() => { this.isLoadingDiff.set(false); return EMPTY; }))
        .subscribe((result) => {
          this.diff.set(result);
          this.isLoadingDiff.set(false);
        });
    });
  }

  public stepChanges(step: StepChangedDto): { key: string; from: string | null | undefined; to: string | null | undefined }[] {
    if (!step.changes) return [];
    return Object.entries(step.changes).map(([key, val]) => ({
      key,
      from: (val as FieldChangedDto).from,
      to: (val as FieldChangedDto).to,
    }));
  }

  public transitionChanges(tr: TransitionChangedDto): { key: string; from: string | null | undefined; to: string | null | undefined }[] {
    if (!tr.changes) return [];
    return Object.entries(tr.changes).map(([key, val]) => ({
      key,
      from: (val as FieldChangedDto).from,
      to: (val as FieldChangedDto).to,
    }));
  }

  public transitionLabel(tr: TransitionSnapshotDto): string {
    if (tr.fromStepOrder != null && tr.toStepOrder != null) {
      return `Étape ${tr.fromStepOrder} → Étape ${tr.toStepOrder}`;
    }
    if (tr.fromStepOrder != null && tr.toTerminalStatus) {
      return `Étape ${tr.fromStepOrder} → ${tr.toTerminalStatus}`;
    }
    return tr.eventCode ?? 'Transition';
  }
}

export default WorkflowComparePage;
