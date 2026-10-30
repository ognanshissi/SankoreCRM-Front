import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  LeadDto,
  LeadsApiService,
  LogActivityRequestOutcomeEnum,
  LogActivityRequestTypeEnum,
  TasksApiService,
} from '@sankore/crm-api';
import {
  computeSla,
  fmtDur,
  journeyIndex,
  LEAD_JOURNEY,
  leadDisplayName,
  taskActionLabel,
  triggerLabel,
  typeLabel,
  workStatusLabel,
} from './task-meta';
import { SYSTEM_TASK_TYPES } from '@sankore/crm/common';

/** Types pour lesquels l'agent doit dire comment l'échange s'est terminé avant de clore. */
const TYPES_REQUIRING_RESULT = new Set<string>([
  SYSTEM_TASK_TYPES.FirstContact,
  SYSTEM_TASK_TYPES.Qualification,
  SYSTEM_TASK_TYPES.SlaFollowUp,
]);

const OUTCOME_OPTIONS: { label: string; value: string }[] = [
  { label: 'Intéressé, rendez-vous fixé', value: LogActivityRequestOutcomeEnum.Rescheduled },
  { label: 'Intéressé, à recontacter',    value: LogActivityRequestOutcomeEnum.Interested },
  { label: 'Joint',                       value: LogActivityRequestOutcomeEnum.Reached },
  { label: 'Rappel demandé',              value: LogActivityRequestOutcomeEnum.Callback },
  { label: 'Pas de réponse',              value: LogActivityRequestOutcomeEnum.NoAnswer },
  { label: 'Messagerie vocale',           value: LogActivityRequestOutcomeEnum.Voicemail },
  { label: 'Pas intéressé',               value: LogActivityRequestOutcomeEnum.NotInterested },
];

class CompleteTaskFormModel {
  public outcome!: string;
  public note!: string;

  public static instantiate(): CompleteTaskFormModel {
    const m = new CompleteTaskFormModel();
    m.outcome = '';
    m.note = '';
    return m;
  }
}

const HOUR_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * Panneau de travail d'une tâche, à droite de la liste « Mes tâches ». L'agent y clôt la tâche sans
 * quitter l'écran : le résultat d'appel et la note sont enregistrés comme activité du lead, seul
 * endroit où le contrat les garde — `POST /tasks/{id}/complete` ne prend pas de corps.
 */
@Component({
  selector: 'task-work-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon, TasFormField, TasLabel, TasError, TasInput, TasSelect, FormRoot, FormField],
  templateUrl: './task-work-panel.html',
})
export class TaskWorkPanel {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public task = input.required<CrmTaskDto>();
  public lead = input<LeadDto | null>(null);
  public agentName = input('');
  public now = input(Date.now());

  public completed = output<CrmTaskDto>();
  public reassignRequested = output<CrmTaskDto>();
  public openLeadRequested = output<string>();

  public readonly outcomeOptions = OUTCOME_OPTIONS;
  public readonly journey = LEAD_JOURNEY;
  public readonly typeLabel = typeLabel;

  // Repart d'un formulaire vierge à chaque changement de tâche : la note d'une tâche ne doit pas
  // suivre l'agent sur la suivante.
  public model = linkedSignal({
    source: () => this.task().id,
    computation: () => CompleteTaskFormModel.instantiate(),
  });
  public formSchema = form(this.model, (schema) => {
    validate(schema.outcome, (ctx) =>
      this.requiresResult() && !ctx.value()
        ? { kind: 'required', message: "Indiquez le résultat de l'appel" }
        : null,
    );
  });

  public readonly requiresResult = computed(() => TYPES_REQUIRING_RESULT.has(this.task().type ?? ''));
  public readonly isOpen = computed(
    () =>
      this.task().status === CrmTaskDtoStatusEnum.Pending ||
      this.task().status === CrmTaskDtoStatusEnum.InProgress,
  );
  public readonly sla = computed(() => computeSla(this.task(), this.now()));
  public readonly actionLabel = computed(() => taskActionLabel(this.task()));
  public readonly leadName = computed(() => leadDisplayName(this.lead()));
  public readonly leadSubtitle = computed(() => {
    const lead = this.lead();
    if (!lead) return '';
    return [lead.interestedProduct, lead.leadSourceLabel ?? lead.source, lead.phoneNumber]
      .filter((v) => !!v?.trim())
      .join(' · ');
  });
  public readonly journeyStep = computed(() => journeyIndex(this.lead()?.pipelineStage));

  /**
   * Chronologie reconstituée à partir des horodatages de la tâche : le contrat n'expose pas
   * d'historique dédié, on n'affiche donc que ce qu'on sait.
   */
  public readonly history = computed(() => {
    const task = this.task();
    const now = this.now();
    const entries: { at: Date; label: string }[] = [];
    if (task.createdAt) {
      const by = task.triggerEventType ? `automatiquement (${triggerLabel(task.triggerEventType)})` : '';
      entries.push({ at: new Date(task.createdAt), label: `Tâche créée ${by}`.trim() });
      if (this.agentName()) entries.push({ at: new Date(task.createdAt), label: `Assignée à ${this.agentName()}` });
    }
    if (task.startedAt) entries.push({ at: new Date(task.startedAt), label: 'Tâche démarrée' });
    const deadline = task.slaDeadline ?? task.dueAt;
    if (deadline) {
      const d = new Date(deadline);
      const closedAt = task.completedAt ? new Date(task.completedAt).getTime() : now;
      if (d.getTime() < closedAt) entries.push({ at: d, label: 'Échéance dépassée' });
    }
    if (task.completedAt) entries.push({ at: new Date(task.completedAt), label: `Tâche ${workStatusLabel(task.status).toLowerCase()}` });
    return entries
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((e) => ({ time: HOUR_FMT.format(e.at), label: e.label }));
  });

  public overdueBy(): string {
    return fmtDur(Math.abs(this.sla().remainingMs));
  }

  public handleComplete(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const task = this.task();
      if (!value || !task.id) return;

      const done = await firstValueFrom(
        this._tasksApi.completeCrmTask(task.id).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Erreur', err.error?.title ?? 'Impossible de terminer la tâche.');
            return of(false);
          }),
        ),
      );
      if (!done) return;

      const note = value.note.trim();
      if (task.leadId && (value.outcome || note)) {
        // La tâche est déjà close : un échec ici ne doit pas la faire paraître ouverte, seulement
        // prévenir que le compte rendu est à ressaisir sur la fiche du lead.
        const logged = await firstValueFrom(
          this._leadsApi
            .logLeadActivity(task.leadId, {
              type: LogActivityRequestTypeEnum.Call,
              subject: `${this.actionLabel()} — tâche terminée`,
              notes: note || null,
              outcome: (value.outcome as LogActivityRequestOutcomeEnum) || null,
            })
            .pipe(
              map(() => true),
              catchError(() => of(false)),
            ),
        );
        if (!logged) {
          this._snackbar.info('Tâche terminée', "Le résultat de l'appel n'a pas pu être enregistré sur le lead.");
          this.completed.emit(task);
          return;
        }
      }

      this._snackbar.success('Tâche terminée', 'La tâche a été clôturée.');
      this.completed.emit(task);
    });
  }
}
