import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, firstValueFrom, map, of, Subject, switchMap, tap } from 'rxjs';
import {
  ClientsApiService,
  CreateTaskRequestEntityTypeEnum,
  CreateTaskRequestPriorityEnum,
  CreateTaskRequestTypeEnum,
  LeadsApiService,
  TasksApiService,
  UsersApiService,
} from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { addDays, dayKey } from '../dashboard/my-day-meta';
import { TASK_ERRORS, TaskSubjectType } from './task-meta';

export interface NewTaskDrawerData {
  /** Un sujet déjà choisi — la tâche est créée depuis sa fiche. */
  subject?: { type: TaskSubjectType; id: string; label: string };
}

interface SubjectCandidate {
  id: string;
  label: string;
  detail: string;
}

const SUBJECT_OPTIONS: { label: string; value: TaskSubjectType }[] = [
  { label: 'Rien', value: 'none' },
  { label: 'Un lead', value: 'lead' },
  { label: 'Un client', value: 'client' },
  { label: 'Un dossier KYC', value: 'kyc' },
];

const PRIORITY_OPTIONS = [
  { label: 'Basse', value: CreateTaskRequestPriorityEnum.Low },
  { label: 'Normale', value: CreateTaskRequestPriorityEnum.Medium },
  { label: 'Haute', value: CreateTaskRequestPriorityEnum.High },
  { label: 'Critique', value: CreateTaskRequestPriorityEnum.Critical },
];

const ENTITY_TYPES: Record<Exclude<TaskSubjectType, 'none'>, CreateTaskRequestEntityTypeEnum> = {
  lead: CreateTaskRequestEntityTypeEnum.Lead,
  client: CreateTaskRequestEntityTypeEnum.Client,
  kyc: CreateTaskRequestEntityTypeEnum.KycFile,
  project: CreateTaskRequestEntityTypeEnum.Project,
};

class NewTaskFormModel {
  public title!: string;
  public date!: string;
  public time!: string;
  public priority!: string;
  public holderId!: string;
  public participantIds!: string[];
  public subjectType!: TaskSubjectType;
  public subjectId!: string;
  public subjectLabel!: string;
  public description!: string;

  public static instantiate(me: string, subject?: NewTaskDrawerData['subject']): NewTaskFormModel {
    const m = new NewTaskFormModel();
    m.title = '';
    // Demain à 9 h : une tâche se crée rarement pour dans l'heure.
    m.date = dayKey(addDays(new Date(), 1));
    m.time = '09:00';
    m.priority = CreateTaskRequestPriorityEnum.Medium;
    m.holderId = me;
    m.participantIds = [];
    m.subjectType = subject?.type ?? 'none';
    m.subjectId = subject?.id ?? '';
    m.subjectLabel = subject?.label ?? '';
    m.description = '';
    return m;
  }
}

/**
 * Nouvelle tâche, depuis « Ma journée » : pour soi par défaut, ou pour un collègue ; sur un lead,
 * un client, un dossier KYC ou rien ; avec ses critères (ce que « fait » veut dire), une
 * description, des collègues associés et des étiquettes.
 *
 * Un dossier KYC se retrouve par son client : on cherche le client, on retient son dossier.
 * Les critères et les étiquettes sont des collections éditées en place, hors du formulaire — la
 * même exception que les éditeurs d'étapes ou de questions.
 */
@Component({
  selector: 'new-task-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-task-drawer.html',
  imports: [
    FormsModule, FormRoot, FormField,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle,
    TasFormField, TasLabel, TasHint, TasError, TasInput, TasDatePicker, TasSelect, TasMultiSelect, TasIcon, TasSpinner, Button,
  ],
})
export class NewTaskDrawer {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<string>>(DialogRef);
  private readonly _data = inject<NewTaskDrawerData | null>(DIALOG_DATA, { optional: true });
  private readonly _me = inject(AuthenticationService).connectedUser()?.id ?? '';

  /** « Un projet » seulement depuis la page d'un projet : aucune recherche de projet n'existe ici. */
  public readonly subjectOptions =
    this._data?.subject?.type === 'project' ? [...SUBJECT_OPTIONS, { label: 'Un projet', value: 'project' as const }] : SUBJECT_OPTIONS;
  public readonly priorityOptions = PRIORITY_OPTIONS;
  public readonly minDate = dayKey(Date.now());
  public readonly subjectLocked = !!this._data?.subject;

  public model = signal(NewTaskFormModel.instantiate(this._me, this._data?.subject));

  public formSchema = form(this.model, (schema) => {
    required(schema.title, { message: 'Le titre est obligatoire' });
    validate(schema.title, (ctx) => (ctx.value().trim().length > 200 ? { kind: 'max', message: '200 caractères au plus' } : null));
    required(schema.date, { message: 'La date est obligatoire' });
    required(schema.time, { message: 'L’heure est obligatoire' });
    validate(schema.time, (ctx) => {
      const date = ctx.valueOf(schema.date);
      if (!date || !ctx.value()) return null;
      return new Date(`${date}T${ctx.value()}`).getTime() > Date.now() ? null : { kind: 'min', message: 'Cette échéance est déjà passée' };
    });
    required(schema.holderId, { message: 'Choisissez qui s’en charge' });
    validate(schema.description, (ctx) => (ctx.value().length > 4000 ? { kind: 'max', message: '4 000 caractères au plus' } : null));
    validate(schema.subjectId, (ctx) => {
      const type = ctx.valueOf(schema.subjectType);
      if (type === 'none' || ctx.value()) return null;
      return { kind: 'required', message: 'Choisissez dans les résultats' };
    });
  });

  public readonly subjectType = computed(() => this.formSchema.subjectType().value());
  public readonly subjectLabel = computed(() => this.formSchema.subjectLabel().value());
  public readonly searchLabel = computed(() =>
    this.subjectType() === 'lead' ? 'Rechercher un lead' : this.subjectType() === 'client' ? 'Rechercher un client' : 'Rechercher le client du dossier',
  );

  // ——— Personnes ———

  public readonly userOptions = signal<{ label: string; value: string }[]>([]);
  public readonly holderOptions = computed(() => [{ label: 'Moi', value: this._me }, ...this.userOptions()]);
  public readonly isLoadingUsers = signal(true);

  // ——— Critères et étiquettes ———

  public readonly criteria = signal<string[]>([]);
  public readonly criterionDraft = signal('');
  public readonly tags = signal<string[]>([]);
  public readonly tagDraft = signal('');

  // ——— Recherche du sujet ———

  public readonly searchTerm = signal('');
  public readonly results = signal<SubjectCandidate[]>([]);
  public readonly isSearching = signal(false);
  public readonly hasSearched = signal(false);
  public readonly submitError = signal<string | null>(null);
  private readonly _search$ = new Subject<string>();

  constructor() {
    this._usersApi
      .listUsers('Active', undefined, undefined, 1, 500)
      .pipe(catchError(() => {
        this._snackbar.error('Erreur', 'La liste des collègues n’a pas pu être chargée.');
        return of({ items: [] });
      }))
      .subscribe((res) => {
        this.userOptions.set(
          (res.items ?? [])
            .filter((u) => u.id && u.id !== this._me)
            .map((u) => ({ label: u.fullName?.trim() || u.email || '—', value: u.id! }))
            .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
        );
        this.isLoadingUsers.set(false);
      });

    this._search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((term) => {
          this.isSearching.set(term.trim().length >= 2);
          if (term.trim().length < 2) {
            this.results.set([]);
            this.hasSearched.set(false);
          }
        }),
        switchMap((term) => (term.trim().length < 2 ? of(null) : this._searchSubjects(term.trim()))),
        takeUntilDestroyed(),
      )
      .subscribe((candidates) => {
        this.isSearching.set(false);
        if (!candidates) return;
        this.hasSearched.set(true);
        this.results.set(candidates);
      });
  }

  private _searchSubjects(term: string) {
    if (this.subjectType() === 'lead') {
      return this._leadsApi.listLeads(1, 8, undefined, undefined, undefined, undefined, undefined, term).pipe(
        map((page) => (page.items ?? []).filter((l) => l.id).map((l) => ({
          id: l.id!,
          label: l.fullName?.trim() || [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Lead sans nom',
          detail: [l.phoneNumber, l.interestedProduct && l.interestedProduct !== 'Unknown' ? l.interestedProduct : null].filter(Boolean).join(' · '),
        }))),
        catchError(() => {
          this._snackbar.error('Erreur', 'La recherche de leads a échoué.');
          return of(null);
        }),
      );
    }

    const kyc = this.subjectType() === 'kyc';
    return this._clientsApi.searchClients(undefined, undefined, undefined, term, undefined, undefined, undefined, undefined, undefined, 1, 8).pipe(
      map((page) => (page.items ?? [])
        // Pour un dossier KYC, seuls les clients qui en ont un.
        .filter((c) => c.id && (!kyc || c.kyc?.kycFileId))
        .map((c) => ({
          id: kyc ? c.kyc!.kycFileId! : c.id!,
          label: kyc ? `Dossier KYC · ${c.displayName?.trim() || 'Client'}` : c.displayName?.trim() || 'Client',
          detail: [c.clientNumber, kyc ? c.kyc?.stage : c.agencyName].filter(Boolean).join(' · '),
        }))),
      catchError(() => {
        this._snackbar.error('Erreur', 'La recherche de clients a échoué.');
        return of(null);
      }),
    );
  }

  public setSubjectType(type: TaskSubjectType): void {
    if (this.subjectLocked || this.subjectType() === type) return;
    this.formSchema.subjectType().value.set(type);
    this.clearSubject();
    this.searchTerm.set('');
    this.results.set([]);
    this.hasSearched.set(false);
  }

  public onSearchTermChange(term: string): void {
    this.searchTerm.set(term);
    this._search$.next(term);
  }

  public selectSubject(candidate: SubjectCandidate): void {
    this.formSchema.subjectId().value.set(candidate.id);
    this.formSchema.subjectLabel().value.set(candidate.label);
    this.results.set([]);
  }

  public clearSubject(): void {
    this.formSchema.subjectId().value.set('');
    this.formSchema.subjectLabel().value.set('');
  }

  public addCriterion(): void {
    const label = this.criterionDraft().trim();
    if (!label || this.criteria().length >= 30) return;
    this.criteria.update((list) => [...list, label.slice(0, 300)]);
    this.criterionDraft.set('');
  }

  public removeCriterion(index: number): void {
    this.criteria.update((list) => list.filter((_, i) => i !== index));
  }

  public addTag(): void {
    const tag = this.tagDraft().trim().toLowerCase().slice(0, 50);
    if (tag && !this.tags().includes(tag) && this.tags().length < 20) this.tags.update((list) => [...list, tag]);
    this.tagDraft.set('');
  }

  public removeTag(tag: string): void {
    this.tags.update((list) => list.filter((t) => t !== tag));
  }

  public handleSubmit(): void {
    // Un critère tapé mais pas encore ajouté compte : personne ne s'attend à le perdre.
    this.addCriterion();
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const v = field().value();
      const type = v.subjectType === 'none' ? null : ENTITY_TYPES[v.subjectType];

      const id = await firstValueFrom(
        this._tasksApi.createCrmTask({
          type: CreateTaskRequestTypeEnum.Generic,
          priority: v.priority as CreateTaskRequestPriorityEnum,
          title: v.title.trim(),
          dueAt: new Date(`${v.date}T${v.time}`).toISOString(),
          assignedAgentId: v.holderId,
          description: v.description.trim() || null,
          entityType: type,
          entityId: type ? v.subjectId : null,
          participantIds: v.participantIds.filter((p) => p !== v.holderId),
          criteria: this.criteria(),
          tags: this.tags(),
        }).pipe(
          catchError((err: HttpErrorResponse) => {
            this.submitError.set(TASK_ERRORS[err.error?.detail] ?? 'La tâche n’a pas pu être créée.');
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (id) {
        this._snackbar.success('Tâche créée', v.holderId === this._me ? 'Elle est dans votre journée.' : 'La personne choisie en est prévenue.');
        this._dialogRef.close(id);
      }
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
