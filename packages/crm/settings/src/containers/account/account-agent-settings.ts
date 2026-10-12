import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { applyEach, form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgentSettingsDto,
  CrmTaskDtoStatusEnum,
  DelegationDto,
  TasksApiService,
  UpdateMyAgentSettingsRequest,
  UsersApiService,
  WorkingDayDtoDayEnum,
} from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';
import { AccountHeaderState, AgentAvailabilityCode } from './account-navigation';

const AVAILABILITY_OPTIONS: { value: AgentAvailabilityCode; label: string; hint: string }[] = [
  { value: 'Available', label: 'Disponible', hint: 'Je reçois des leads' },
  { value: 'Paused', label: 'En pause', hint: 'Je garde mes tâches' },
  { value: 'Absent', label: 'Absent', hint: 'Congés, formation…' },
];

const DAY_LABELS: Record<string, string | undefined> = {
  Monday: 'Lundi', Tuesday: 'Mardi', Wednesday: 'Mercredi', Thursday: 'Jeudi',
  Friday: 'Vendredi', Saturday: 'Samedi', Sunday: 'Dimanche',
};

/** Langues proposées. Les codes suivent la normalisation serveur (sous-étiquette primaire, minuscules). */
const LANGUAGE_OPTIONS = [
  { code: 'fr', label: 'Français' },
  { code: 'dyu', label: 'Dioula' },
  { code: 'bci', label: 'Baoulé' },
  { code: 'en', label: 'Anglais' },
  { code: 'wo', label: 'Wolof' },
];

const EVENT_LABELS: Record<string, string | undefined> = {
  LeadAssigned: 'Nouveau lead attribué',
  DeadlineApproaching: 'Échéance proche',
  TaskReassignedOrEscalated: 'Tâche réassignée ou escaladée',
  KycCompletedByClient: 'Dossier KYC complété par le client',
};

interface DayRow { day: string; enabled: boolean; start: string; end: string }
interface PreferenceRow { event: string; email: boolean; sms: boolean }

class AgentSettingsFormModel {
  public availability!: string;
  public absenceFrom!: string;
  public absenceTo!: string;
  public replacementUserId!: string;
  public transferTasks!: boolean;
  public days!: DayRow[];
  public maxActiveLeads!: number;
  public languages!: string[];
  public preferences!: PreferenceRow[];

  public static fromDto(dto: AgentSettingsDto): AgentSettingsFormModel {
    const m = new AgentSettingsFormModel();
    m.availability = dto.availability ?? 'Available';
    m.absenceFrom = dto.absence?.from ?? '';
    m.absenceTo = dto.absence?.to ?? '';
    m.replacementUserId = dto.absence?.replacementUserId ?? '';
    m.transferTasks = dto.absence?.transferTasks ?? false;
    m.days = (dto.workingHours ?? []).map((d) => ({
      day: d.day ?? 'Monday',
      enabled: !!d.enabled,
      start: d.start ?? '08:00',
      end: d.end ?? '17:00',
    }));
    m.maxActiveLeads = dto.maxActiveLeads ?? dto.capacityCeiling ?? 30;
    m.languages = [...(dto.spokenLanguages ?? [])];
    m.preferences = (dto.notificationPreferences ?? []).map((p) => ({
      event: p.event ?? '',
      email: !!p.email,
      sms: !!p.sms,
    }));
    return m;
  }
}

/**
 * Paramétrage agent, réglé par l'agent lui-même : disponibilité (avec absence datée et
 * remplaçant), horaires, capacité, langues et notifications. Produits et agence se lisent ici mais
 * restent gérés par l'administrateur.
 *
 * Ce que le serveur fait de ces réglages (`GET/PUT users/me/agent-settings`) : statut, horaires et
 * capacité filtrent le vivier du dispatching ; une absence nouvelle prévient le superviseur et, si
 * demandé, transfère les tâches ouvertes au remplaçant. Les préférences de notification sont
 * enregistrées mais pas encore lues par les envois.
 */
@Component({
  selector: 'account-agent-settings',
  imports: [
    DatePipe,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasIcon,
    TasInput,
    TasSelect,
    TasSpinner,
    TasSwitch,
    FormRoot,
    FormField,
  ],
  templateUrl: './account-agent-settings.html',
})
export class AccountAgentSettings implements OnInit {
  private readonly _usersApi = inject(UsersApiService);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _header = inject(AccountHeaderState);

  public readonly availabilityOptions = AVAILABILITY_OPTIONS;
  public readonly dayLabels = DAY_LABELS;
  public readonly eventLabels = EVENT_LABELS;

  public isLoading = signal(true);
  public loadFailed = signal(false);
  public dto = signal<AgentSettingsDto | null>(null);
  public replacementOptions = signal<{ label: string; value: string }[]>([]);
  public openTasksCount = signal(0);

  public model = signal(AgentSettingsFormModel.fromDto({}));
  public formSchema = form(this.model, (schema) => {
    validate(schema.absenceFrom, (ctx) =>
      ctx.valueOf(schema.availability) === 'Absent' && !ctx.value()
        ? { kind: 'required', message: 'Indiquez le premier jour de l’absence' }
        : null,
    );
    validate(schema.absenceTo, (ctx) => {
      if (ctx.valueOf(schema.availability) !== 'Absent') return null;
      if (!ctx.value()) return { kind: 'required', message: 'Indiquez le dernier jour de l’absence' };
      const from = ctx.valueOf(schema.absenceFrom);
      return from && ctx.value() < from
        ? { kind: 'order', message: 'La fin doit suivre le début' }
        : null;
    });
    validate(schema.replacementUserId, (ctx) =>
      ctx.valueOf(schema.availability) === 'Absent' && ctx.valueOf(schema.transferTasks) && !ctx.value()
        ? { kind: 'required', message: 'Choisissez un remplaçant pour lui transférer vos tâches' }
        : null,
    );
    applyEach(schema.days, (day) => {
      validate(day.end, (ctx) =>
        ctx.valueOf(day.enabled) && ctx.value() <= ctx.valueOf(day.start)
          ? { kind: 'order', message: 'Fin avant début' }
          : null,
      );
    });
    validate(schema.maxActiveLeads, (ctx) => {
      const ceiling = this.dto()?.capacityCeiling ?? 30;
      return ctx.value() < 1 || ctx.value() > ceiling
        ? { kind: 'range', message: `Entre 1 et ${ceiling}` }
        : null;
    });
  });

  // ——— Lectures dérivées ———

  public readonly isAbsent = computed(() => this.model().availability === 'Absent');
  public readonly ceiling = computed(() => this.dto()?.capacityCeiling ?? 30);
  public readonly activeLeads = computed(() => this.dto()?.activeLeadsCount ?? 0);
  public readonly freeSlots = computed(() => Math.max(0, this.model().maxActiveLeads - this.activeLeads()));
  public readonly loadPercent = computed(() =>
    Math.min(100, Math.round((this.activeLeads() / Math.max(1, this.ceiling())) * 100)),
  );
  public readonly capacityPercent = computed(() =>
    Math.min(100, Math.round((this.model().maxActiveLeads / Math.max(1, this.ceiling())) * 100)),
  );
  public readonly languageOptions = computed(() => {
    const known = new Set(LANGUAGE_OPTIONS.map((l) => l.code));
    const extra = this.model().languages.filter((code) => !known.has(code)).map((code) => ({ code, label: code }));
    return [...LANGUAGE_OPTIONS, ...extra];
  });
  public readonly delegations = computed<DelegationDto[]>(() => this.dto()?.delegations ?? []);

  ngOnInit(): void {
    this._load();
  }

  // ——— Gestes qui ne passent pas par un contrôle du formulaire ———

  public setAvailability(value: AgentAvailabilityCode): void {
    this.model.update((m) => ({ ...m, availability: value }));
  }

  public toggleDay(index: number, enabled: boolean): void {
    this.model.update((m) => ({
      ...m,
      days: m.days.map((d, i) => (i === index ? { ...d, enabled } : d)),
    }));
  }

  public stepCapacity(delta: number): void {
    this.model.update((m) => ({
      ...m,
      maxActiveLeads: Math.min(this.ceiling(), Math.max(1, m.maxActiveLeads + delta)),
    }));
  }

  public toggleLanguage(code: string): void {
    this.model.update((m) => ({
      ...m,
      languages: m.languages.includes(code) ? m.languages.filter((c) => c !== code) : [...m.languages, code],
    }));
  }

  public cancel(): void {
    const dto = this.dto();
    if (dto) this.model.set(AgentSettingsFormModel.fromDto(dto));
    this.formSchema().reset();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const request: UpdateMyAgentSettingsRequest = {
        availability: value.availability,
        absence:
          value.availability === 'Absent'
            ? {
                from: value.absenceFrom,
                to: value.absenceTo,
                replacementUserId: value.replacementUserId || null,
                transferTasks: value.transferTasks,
              }
            : undefined,
        workingHours: value.days.map((d) => ({
          day: d.day as WorkingDayDtoDayEnum,
          enabled: d.enabled,
          start: d.start,
          end: d.end,
        })),
        maxActiveLeads: value.maxActiveLeads,
        notificationPreferences: value.preferences,
        spokenLanguages: value.languages,
      };

      const ok = await firstValueFrom(
        this._usersApi.updateMyAgentSettings(request).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Enregistrement impossible', err.error?.detail ?? err.error?.title ?? 'Vos réglages n’ont pas été enregistrés.');
            return of(false);
          }),
        ),
      );
      if (!ok) return;

      this._snackbar.success(
        'Paramétrage enregistré',
        value.availability === 'Absent' && value.transferTasks
          ? 'Votre superviseur est informé et vos tâches en cours passent au remplaçant.'
          : 'Le dispatching tient compte de vos réglages.',
      );
      // Relecture : l'heure de modification, le plafond et les noms viennent du serveur.
      this._load();
    });
  }

  // ——— Chargement ———

  private _load(): void {
    const me = this._auth.connectedUser();
    this.isLoading.set(true);
    this.loadFailed.set(false);

    forkJoin({
      settings: this._usersApi.getMyAgentSettings(),
      users: this._usersApi
        .listUsers('Active', me?.agencyId ?? undefined, undefined, 1, 200)
        .pipe(catchError(() => of({ items: [] }))),
      tasks: this._tasksApi.listCrmTasks(undefined, me?.id).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ settings, users, tasks }) => {
        this.dto.set(settings);
        this.model.set(AgentSettingsFormModel.fromDto(settings));
        this.formSchema().reset();
        this._header.availability.set((settings.availability ?? 'Available') as AgentAvailabilityCode);
        this.replacementOptions.set(
          (users.items ?? [])
            .filter((u) => !!u.id && u.id !== me?.id)
            .map((u) => ({ label: u.fullName || u.email || '', value: u.id! })),
        );
        this.openTasksCount.set(
          (tasks ?? []).filter(
            (t) => t.status === CrmTaskDtoStatusEnum.Pending || t.status === CrmTaskDtoStatusEnum.InProgress,
          ).length,
        );
        this.isLoading.set(false);
      },
      error: () => {
        this.loadFailed.set(true);
        this.isLoading.set(false);
      },
    });
  }
}

export default AccountAgentSettings;
