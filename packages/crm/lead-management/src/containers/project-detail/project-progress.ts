import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { OpportunityDto, ProjectStepDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { currentStep, projectSteps, stageMeta } from '../edit-lead/opportunities/opportunity.model';

/**
 * La frise des étapes et ce que l'étape en cours demande avant qu'on la quitte — ses points à
 * cocher et son circuit de validation (propriétaire, 2026-10-27 : l'étape en cours seulement,
 * pas ce qu'exigera la suivante ; les refus du serveur restent le garde-fou pour le reste).
 *
 * Les écritures remontent à la page : c'est elle qui relit le projet et traduit les refus d'étape.
 */
@Component({
  selector: 'project-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Button, TasCard, TasIcon],
  template: `
    @let p = project();
    <tas-card class="block">
      <div class="p-5">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Avancement</p>
          @if (stepIndex() >= 0) {
            <p class="text-xs text-slate-500">Étape {{ stepIndex() + 1 }} sur {{ steps().length }}</p>
          }
        </div>

        <div class="mt-3 grid grid-cols-2 gap-2 md:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]" role="radiogroup" [attr.aria-label]="'Étape de ' + p.title">
          @for (step of steps(); track step.id; let i = $index) {
            @let state = i < stepIndex() ? 'done' : i === stepIndex() ? 'current' : 'todo';
            <button type="button" role="radio"
                    class="flex flex-col rounded-lg border p-2.5 text-left transition-colors disabled:cursor-default"
                    [class]="state === 'current' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-slate-200 bg-white hover:border-primary/40'"
                    [attr.aria-checked]="state === 'current'"
                    [disabled]="!canManage() || busy()"
                    (click)="move.emit(step)">
              <span class="flex items-center gap-2">
                <span class="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
                      [class]="state === 'done' ? 'bg-primary text-white' : state === 'current' ? 'border-2 border-primary text-primary' : 'border border-slate-300 text-slate-500'">
                  @if (state === 'done') {
                    <tas-icon iconName="feather:check" iconClass="!size-3"></tas-icon>
                  } @else {
                    {{ i + 1 }}
                  }
                </span>
                <span class="min-w-0 truncate text-sm font-semibold" [class]="state === 'current' ? 'text-primary' : 'text-slate-800'">{{ step.label }}</span>
              </span>
              <span class="mt-1 block text-xs text-slate-500">{{ phaseLabel(step.phase) }}@if (tracksForecast()) { · {{ step.probability }} %}</span>
              @if (requirements(step); as reqs) {
                @if (reqs.length) {
                  <span class="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
                    @for (r of reqs; track r.label) {
                      <span class="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600" [title]="r.title">
                        <tas-icon [iconName]="r.icon" iconClass="!size-3"></tas-icon>{{ r.label }}
                      </span>
                    }
                  </span>
                }
              }
            </button>
          }
        </div>
      </div>

      <!-- Pour avancer : ce que l'étape en cours demande avant qu'on la quitte -->
      @if (current(); as step) {
        <div id="exit-conditions" class="border-t border-slate-100 px-5 py-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <p class="text-sm font-semibold text-slate-900">Pour quitter « {{ step.label }} »</p>
            @if (exit().total) {
              <p class="text-xs font-semibold tabular-nums" [class]="exit().done === exit().total ? 'text-primary' : 'text-slate-600'">
                {{ exit().done }} sur {{ exit().total }}
              </p>
            }
          </div>

          @if (!exit().total) {
            <p class="mt-1 text-sm text-slate-500">Rien n'est exigé pour quitter cette étape : passez à la suivante quand le client est prêt.</p>
          } @else {
            <ul class="mt-2 flex flex-col gap-1">
              @for (item of exit().checklist; track item.id) {
                <li>
                  <label class="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                         [class]="item.done ? 'text-slate-500 line-through' : 'text-slate-800'">
                    <input type="checkbox" class="mt-0.5 size-4 accent-current text-primary"
                           [checked]="item.done" [disabled]="!canManage() || busy()"
                           (change)="toggle.emit({ itemId: item.id, done: !item.done })" />
                    {{ item.label }}
                  </label>
                </li>
              }

              @if (exit().workflow; as wf) {
                <li class="flex flex-wrap items-start gap-2.5 rounded-lg px-2 py-1.5">
                  <tas-icon [iconName]="wf.icon" style="font-size:16px" class="mt-0.5 shrink-0" [class]="wf.tone"></tas-icon>
                  <div class="min-w-48 flex-1">
                    <p class="text-sm font-medium" [class]="wf.state === 'Approved' ? 'text-slate-500' : 'text-slate-800'">
                      Circuit de validation : <span [class]="wf.tone">{{ wf.label }}</span>
                    </p>
                    <p class="text-xs text-slate-500">
                      @switch (wf.state) {
                        @case ('Approved') { Le projet peut passer à la suite. }
                        @case ('Refused') { Relancez le circuit une fois le dossier repris, ou marquez le projet perdu. }
                        @case ('NotStarted') { Le circuit démarre quand le projet arrive sur l'étape ; lancez-le si l'étape a été atteinte autrement. }
                        @case ('Unknown') { Le module de validation ne répond pas : le projet reste sur l'étape tant que l'approbation n'est pas confirmée. }
                        @default {
                          @if (wf.startedAt) { Lancé le {{ wf.startedAt | date: 'd MMM y, HH:mm' }}. }
                          Les validateurs le traitent depuis leur file des workflows.
                        }
                      }
                    </p>
                    <div class="mt-1 flex flex-wrap items-center gap-3">
                      @if (hasValidations()) {
                        <button type="button" class="text-xs font-semibold text-primary hover:underline" (click)="showValidations.emit()">Voir les validations</button>
                      }
                      @if (canManage() && (wf.state === 'Refused' || wf.state === 'NotStarted')) {
                        <button tas-outlined-button color="primary" type="button" [disabled]="busy()" (click)="restartWorkflow.emit()">
                          {{ wf.state === 'Refused' ? 'Relancer le circuit' : 'Lancer le circuit' }}
                        </button>
                      }
                    </div>
                  </div>
                </li>
              }
            </ul>
          }
        </div>
      }
    </tas-card>
  `,
})
export class ProjectProgress {
  public readonly project = input.required<OpportunityDto>();
  public readonly canManage = input(false);
  public readonly busy = input(false);
  public readonly hasValidations = input(false);

  public readonly move = output<ProjectStepDto>();
  public readonly toggle = output<{ itemId: string; done: boolean }>();
  public readonly restartWorkflow = output<void>();
  public readonly showValidations = output<void>();

  public readonly steps = computed(() => projectSteps(this.project()));
  public readonly current = computed(() => currentStep(this.project()));
  public readonly stepIndex = computed(() => {
    const step = this.current();
    return step ? this.steps().findIndex((s) => s.id === step.id) : -1;
  });
  /** Faux pour un parcours vendu au rendez-vous : ni probabilité ni clôture prévue à l'écran. */
  public readonly tracksForecast = computed(() => this.project().tracksForecast !== false);

  /** Les points à cocher de l'étape en cours, et l'état de son circuit — lancé à l'arrivée, approuvé avant de repartir. */
  public readonly exit = computed(() => {
    const step = this.current();
    const project = this.project();
    const ticked = new Set(project.checkedChecklistItemIds ?? []);
    const checklist = (step?.checklist ?? []).map((i) => ({ id: i.id ?? '', label: i.label ?? '', done: ticked.has(i.id ?? '') }));
    const runs = (project.workflowRuns ?? []).filter((r) => r.stepId === step?.id);
    const run = runs.length ? runs[runs.length - 1] : null;
    const workflow = step?.workflowCircuit ? workflowMeta(run?.state ?? 'NotStarted', run?.startedAt ?? null) : null;
    const done = checklist.filter((i) => i.done).length + (workflow?.state === 'Approved' ? 1 : 0);
    return { checklist, workflow, done, total: checklist.length + (workflow ? 1 : 0) };
  });

  public phaseLabel(phase: string | null | undefined): string {
    return stageMeta(phase)?.label ?? '';
  }

  /** Ce que chaque étape demande, en abrégé ; l'infobulle dit quand. */
  public requirements(step: ProjectStepDto): { icon: string; label: string; title: string }[] {
    const reqs: { icon: string; label: string; title: string }[] = [];
    if (step.opensClientFile) {
      reqs.push({ icon: 'feather:user-plus', label: 'Dossier client', title: "Le dossier client doit être ouvert pour atteindre l'étape" });
    }
    if (step.isApproval) {
      reqs.push({ icon: 'feather:shield', label: 'Approbation', title: "Le dossier KYC du client doit être validé pour atteindre l'étape" });
    }
    if (step.requiresQuestionnaires) {
      reqs.push({ icon: 'feather:clipboard', label: 'Questionnaires', title: "Les questionnaires doivent être remplis pour atteindre l'étape" });
    }
    const fields = step.requiredFieldKeys?.length ?? 0;
    if (fields) {
      reqs.push({ icon: 'feather:edit-3', label: `${fields} champ${fields > 1 ? 's' : ''}`, title: `${fields} champ${fields > 1 ? 's' : ''} à renseigner pour atteindre l'étape` });
    }
    const points = step.checklist?.length ?? 0;
    if (points) {
      reqs.push({ icon: 'feather:check-square', label: `${points} point${points > 1 ? 's' : ''}`, title: `${points} point${points > 1 ? 's' : ''} à cocher pour quitter l'étape` });
    }
    if (step.workflowCircuit) {
      reqs.push({ icon: 'feather:git-pull-request', label: 'Validation', title: "Un circuit de validation démarre à l'arrivée et doit approuver avant de repartir" });
    }
    return reqs;
  }
}

function workflowMeta(state: string, startedAt: string | null) {
  switch (state) {
    case 'Approved':
      return { state, startedAt, label: 'approuvé', tone: 'text-primary', icon: 'feather:check-circle' };
    case 'Refused':
      return { state, startedAt, label: 'refusé', tone: 'text-red-700', icon: 'feather:x-circle' };
    case 'NotStarted':
      return { state, startedAt, label: 'pas encore lancé', tone: 'text-amber-700', icon: 'feather:circle' };
    case 'Unknown':
      return { state, startedAt, label: 'état illisible', tone: 'text-amber-700', icon: 'feather:help-circle' };
    default:
      return { state, startedAt, label: 'en attente', tone: 'text-slate-700', icon: 'feather:clock' };
  }
}
