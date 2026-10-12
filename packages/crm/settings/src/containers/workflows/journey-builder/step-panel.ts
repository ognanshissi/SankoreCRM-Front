import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { disabled, form, FormField, FormRoot, required } from '@angular/forms/signals';
import { catchError, concatMap, debounceTime, EMPTY, Subject, tap } from 'rxjs';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { UpdateStepRequest, UpdateStepRequestKindEnum, WorkflowStepDto, WorkflowTemplatesApiService } from '@sankore/crm-api';
import {
  CHANNEL_OPTIONS,
  Escalation,
  ESCALATION_OPTIONS,
  hasAssignee,
  KYC_CONTROLS,
  KYC_LEVEL_OPTIONS,
  KycLevel,
  parseStepConfig,
  serializeStepConfig,
  SLA_OPTIONS,
  STEP_KIND_META,
  StepConfig,
  StepKind,
  stepKind,
  TARGET_OPTIONS,
} from './journey-model';

class StepFormModel {
  public name!: string;
  public description!: string;
  public approverRoleCode!: string;
  public timeoutHours!: string;
  public kycLevel!: string;
  public escalation!: string;
  public channel!: string;
  public target!: string;
  public isBlocking!: boolean;

  public static fromStep(step: WorkflowStepDto): StepFormModel {
    const config = parseStepConfig(step.configJson);
    const m = new StepFormModel();
    m.name = step.name ?? '';
    m.description = step.description ?? '';
    m.approverRoleCode = step.approverRoleCode ?? '';
    m.timeoutHours = step.timeoutHours != null ? String(step.timeoutHours) : '';
    m.kycLevel = config.kycLevel ?? 'Full';
    m.escalation = config.escalation ?? 'none';
    m.channel = config.channel ?? 'Email';
    m.target = config.target ?? 'Insurance';
    m.isBlocking = !!step.isBlocking;
    return m;
  }
}

/**
 * Propriétés de l'étape sélectionnée. Chaque modification est enregistrée d'elle-même après une
 * courte pause, comme le reste du constructeur : il n'y a pas de bouton « Enregistrer » qu'on
 * oublierait avant de publier.
 */
@Component({
  selector: 'journey-step-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasFormField, TasLabel, TasError, TasInput, TasSelect, TasIcon, TasSpinner, TasSwitch, FormRoot, FormField],
  templateUrl: './step-panel.html',
})
export class JourneyStepPanel {
  private readonly _api = inject(WorkflowTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public templateId = input.required<string>();
  public step = input.required<WorkflowStepDto>();
  public roleOptions = input<{ label: string; value: string }[]>([]);
  public readOnly = input(false);

  public updated = output<WorkflowStepDto>();
  public deleteRequested = output<WorkflowStepDto>();

  public readonly kycLevelOptions = KYC_LEVEL_OPTIONS;
  public readonly escalationOptions = ESCALATION_OPTIONS;
  public readonly slaOptions = SLA_OPTIONS;
  public readonly channelOptions = CHANNEL_OPTIONS;
  public readonly targetOptions = TARGET_OPTIONS;
  public readonly StepKind = StepKind;

  public isSaving = signal(false);

  public model = linkedSignal({
    source: () => this.step().id,
    computation: () => StepFormModel.fromStep(this.step()),
  });
  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: "Le nom de l'étape est obligatoire" });
    // Une version publiée ne se modifie pas : le serveur le refuserait de toute façon.
    disabled(schema, () => this.readOnly());
  });

  public readonly kind = computed(() => stepKind(this.step()));
  public readonly meta = computed(() => STEP_KIND_META[this.kind()]);
  public readonly withAssignee = computed(() => hasAssignee(this.kind()));
  public readonly controls = computed(() => KYC_CONTROLS[(this.model().kycLevel as KycLevel) || 'Full'] ?? []);

  private readonly _changes$ = new Subject<StepFormModel>();
  /** Dernier état connu du serveur pour l'étape affichée, pour n'envoyer que de vraies modifications. */
  private _lastSaved = '';
  private _lastSavedFor: string | undefined;

  constructor() {
    effect(() => {
      const model = this.model();
      const stepId = this.step().id;
      const snapshot = JSON.stringify(model);
      // Premier passage pour une étape : c'est l'état serveur, rien à enregistrer.
      if (this._lastSavedFor !== stepId) {
        this._lastSavedFor = stepId;
        this._lastSaved = snapshot;
        return;
      }
      if (snapshot !== this._lastSaved) this._changes$.next(model);
    });

    // `concatMap` et non `switchMap` : annuler un PUT déjà parti ne l'annule pas côté serveur, et
    // l'ordre d'arrivée des réponses deviendrait celui de l'écran.
    this._changes$
      .pipe(
        debounceTime(600),
        concatMap((model) => this._save(model)),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe();
  }

  private _save(model: StepFormModel) {
    if (this.readOnly() || this.formSchema().invalid()) return EMPTY;
    const step = this.step();
    const request = this._toRequest(step, model);
    this.isSaving.set(true);
    return this._api.updateWorkflowStep(this.templateId(), step.id!, request).pipe(
      tap(() => {
        this.isSaving.set(false);
        this._lastSaved = JSON.stringify(model);
        this.updated.emit({
          ...step,
          name: request.name,
          description: request.description,
          approverRoleCode: request.approverRoleCode,
          timeoutHours: request.timeoutHours,
          configJson: request.configJson || null,
          isBlocking: request.isBlocking ?? false,
        });
      }),
      catchError((err: HttpErrorResponse) => {
        this.isSaving.set(false);
        this._snackbar.error('Erreur', err.error?.detail ?? err.error?.title ?? "L'étape n'a pas pu être enregistrée.");
        return EMPTY;
      }),
    );
  }

  public setBlocking(value: boolean): void {
    this.model.update((m) => ({ ...m, isBlocking: value }));
  }

  private _toRequest(step: WorkflowStepDto, model: StepFormModel): UpdateStepRequest {
    const kind = stepKind(step);
    // La branche est posée à l'insertion et n'est pas éditée ici : on la conserve telle quelle.
    const config: StepConfig = { branch: parseStepConfig(step.configJson).branch };
    if (kind === StepKind.KycCheck) config.kycLevel = model.kycLevel as KycLevel;
    if (hasAssignee(kind)) config.escalation = model.escalation as Escalation;
    if (kind === StepKind.Notification) config.channel = model.channel as StepConfig['channel'];
    if (kind === StepKind.IntegrationAction) config.target = model.target as StepConfig['target'];

    return {
      name: model.name.trim(),
      description: model.description.trim() || null,
      approverRoleCode: hasAssignee(kind) ? model.approverRoleCode || null : null,
      timeoutHours: model.timeoutHours ? +model.timeoutHours : null,
      // Mêmes valeurs dans les deux énumérations générées (ajout et mise à jour) : seul le nom diffère.
      kind: kind as unknown as UpdateStepRequestKindEnum,
      configJson: serializeStepConfig(config),
      isBlocking: model.isBlocking,
    };
  }
}
