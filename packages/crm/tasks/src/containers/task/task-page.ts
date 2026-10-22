import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, Observable } from 'rxjs';
import {
  CrmTaskDetailDto,
  TaskAssignmentEntryDto,
  TaskAttachmentDto,
  TaskCommentDto,
  TasksApiService,
  UpdateTaskDetailsRequestPriorityEnum,
  UsersApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PERMISSIONS, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasMultiSelect } from '@talisoft/ui/multi-select';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { ReassignTaskDrawer, ReassignTaskDrawerData } from '../dashboard/reassign-task-drawer';
import { dayKey } from '../dashboard/my-day-meta';
import { fileSize, PRIORITY_LABELS, STATUS_LABELS, subjectRoute, TASK_ERRORS } from './task-meta';

const DATE_TIME = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const PRIORITY_OPTIONS = Object.entries(PRIORITY_LABELS).map(([value, p]) => ({ label: p.label, value }));

class TaskDetailsFormModel {
  public title!: string;
  public description!: string;
  public priority!: string;
  public date!: string;
  public time!: string;

  public static from(t: CrmTaskDetailDto): TaskDetailsFormModel {
    const due = new Date(t.dueAt ?? Date.now());
    return Object.assign(new TaskDetailsFormModel(), {
      title: t.title ?? '',
      description: t.description ?? '',
      priority: t.priority ?? 'Medium',
      date: dayKey(due),
      time: `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`,
    });
  }
}

class CommentFormModel {
  public body!: string;

  public static empty(): CommentFormModel {
    return Object.assign(new CommentFormModel(), { body: '' });
  }
}

class ParticipantsFormModel {
  public userIds!: string[];
}

/**
 * La fiche d'une tâche : ce qu'il faut faire (titre, description, critères), sur quoi, qui la
 * porte et qui la suit, la discussion, les fichiers, les étiquettes et l'historique des
 * assignations. Ouverte à ses personnes, au responsable et au chef d'agence de la personne qui la
 * porte — le serveur décide, l'écran affiche « introuvable » pour les autres.
 *
 * Le fil de commentaires, les critères, les fichiers et l'historique sont rendus en listes courtes
 * plutôt qu'en `tas-table` : un fil en bulles comme celui de WhatsApp, des collections bornées
 * (30 critères, 30 fichiers) éditées en place.
 */
@Component({
  selector: 'task-page',
  templateUrl: './task-page.html',
  imports: [
    RouterLink, FormsModule, FormRoot, FormField, TimeagoPipe,
    Button, TasIcon, TasSpinner, TasFormField, TasLabel, TasError, TasInput, TasSelect, TasMultiSelect,
  ],
})
export class TaskPage implements OnInit {
  private readonly _api = inject(TasksApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _drawer = inject(SideDrawerService);

  public readonly canManage = inject(PermissionsService).can(PERMISSIONS.LEAD_TASK_MANAGE);
  public readonly priorityOptions = PRIORITY_OPTIONS;

  public readonly taskId = signal('');
  public readonly task = signal<CrmTaskDetailDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly notFound = signal(false);
  public readonly busy = signal<string | null>(null);

  public readonly history = signal<TaskAssignmentEntryDto[]>([]);
  public readonly comments = signal<TaskCommentDto[]>([]);
  public readonly olderBefore = signal<string | null>(null);
  public readonly users = signal<Map<string, string>>(new Map());
  public readonly userOptions = computed(() =>
    [...this.users().entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'fr')),
  );

  public readonly editable = computed(() => this.canManage() && !!this.task()?.isOpen);
  public readonly status = computed(() => STATUS_LABELS[this.task()?.status ?? ''] ?? { label: this.task()?.status ?? '', tone: 'bg-slate-100 text-slate-600' });
  public readonly priority = computed(() => PRIORITY_LABELS[this.task()?.priority ?? ''] ?? PRIORITY_LABELS['Medium']);
  public readonly subjectLink = computed(() => subjectRoute(this.task()?.subject?.type, this.task()?.subject?.id));
  public readonly criteriaDone = computed(() => (this.task()?.criteria ?? []).filter((c) => c.isMet).length);
  public readonly isLate = computed(() => !!this.task()?.isOpen && new Date(this.task()!.dueAt!).getTime() < Date.now());

  // ——— Détails ———

  public readonly editingDetails = signal(false);
  public detailsModel = signal(new TaskDetailsFormModel());
  public detailsForm = form(this.detailsModel, (schema) => {
    required(schema.title, { message: 'Le titre est obligatoire' });
    validate(schema.title, (ctx) => (ctx.value().trim().length > 200 ? { kind: 'max', message: '200 caractères au plus' } : null));
    validate(schema.description, (ctx) => (ctx.value().length > 4000 ? { kind: 'max', message: '4 000 caractères au plus' } : null));
    required(schema.date, { message: 'La date est obligatoire' });
    required(schema.time, { message: 'L’heure est obligatoire' });
  });

  // ——— Personnes associées ———

  public readonly editingPeople = signal(false);
  public peopleModel = signal(Object.assign(new ParticipantsFormModel(), { userIds: [] as string[] }));
  public peopleForm = form(this.peopleModel);

  // ——— Critères, étiquettes ———

  public readonly criterionDraft = signal('');
  public readonly tagDraft = signal('');

  // ——— Commentaires ———

  public commentModel = signal(CommentFormModel.empty());
  public commentForm = form(this.commentModel, (schema) => {
    required(schema.body, { message: 'Le commentaire est vide' });
    validate(schema.body, (ctx) => (ctx.value().length > 4000 ? { kind: 'max', message: '4 000 caractères au plus' } : null));
  });
  public readonly editingCommentId = signal<string | null>(null);
  public readonly editingCommentText = signal('');

  ngOnInit(): void {
    this._route.paramMap.subscribe((params) => {
      const id = params.get('taskId') ?? '';
      this.taskId.set(id);
      this.reload();
      this._loadComments();
    });

    this._usersApi.listUsers('Active', undefined, undefined, 1, 500).pipe(catchError(() => EMPTY)).subscribe((res) =>
      this.users.set(new Map((res.items ?? []).filter((u) => u.id).map((u) => [u.id!, u.fullName?.trim() || u.email || '—']))),
    );
  }

  public reload(): void {
    const id = this.taskId();
    this._api.getCrmTaskDetail(id).pipe(
      catchError(() => {
        this.notFound.set(true);
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((task) => {
      this.task.set(task);
      this.notFound.set(false);
      this.isLoading.set(false);
      this._breadcrumb.set([{ label: 'Ma journée', link: ['/tasks/my-day'] }, { label: task.title ?? 'Tâche' }]);
    });

    this._api.getCrmTaskAssignments(id).pipe(catchError(() => EMPTY)).subscribe((h) => this.history.set(h ?? []));
  }

  public userName(id: string | null | undefined): string {
    return id ? this.users().get(id) ?? 'Utilisateur' : 'Personne';
  }

  public when(iso: string | null | undefined): string {
    return iso ? DATE_TIME.format(new Date(iso)) : '';
  }

  public size(bytes: number | null | undefined): string {
    return fileSize(bytes);
  }

  public historyLabel(entry: TaskAssignmentEntryDto): string {
    if (entry.kind === 'Initial') return entry.agentId ? `Confiée à ${this.userName(entry.agentId)}` : 'Créée sans personne désignée';
    if (entry.kind === 'SlaExtended') return `Délai prolongé pour ${this.userName(entry.agentId)}`;
    return `${this.userName(entry.previousAgentId)} → ${this.userName(entry.agentId)}`;
  }

  // ——— Cycle de vie ———

  public start(): void {
    this._run('start', this._api.startCrmTask(this.taskId()), 'Tâche démarrée');
  }

  public complete(): void {
    const task = this.task();
    const missing = (task?.criteria ?? []).length - this.criteriaDone();
    const done = () => this._run('complete', this._api.completeCrmTask(this.taskId()), 'Tâche terminée');
    if (missing <= 0) return done();

    this._confirm.confirm({
      title: 'Terminer la tâche ?',
      message: `${missing} critère${missing > 1 ? 's ne sont' : ' n’est'} pas coché${missing > 1 ? 's' : ''}. Terminer quand même ?`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Terminer' },
      rejectButtonProps: { label: 'Annuler' },
      accept: done,
    });
  }

  public cancelTask(): void {
    this._confirm.confirm({
      title: 'Annuler la tâche ?',
      message: 'Elle sortira des journées de chacun. Les commentaires et les fichiers restent consultables.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Annuler la tâche', theme: 'warn' },
      rejectButtonProps: { label: 'Retour' },
      accept: () => this._run('cancel', this._api.cancelCrmTask(this.taskId()), 'Tâche annulée'),
    });
  }

  public reassign(): void {
    this._api.getCrmTask(this.taskId()).pipe(catchError(() => EMPTY)).subscribe((task) => {
      const ref = this._drawer.open<boolean, ReassignTaskDrawerData, ReassignTaskDrawer>(ReassignTaskDrawer, {
        width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { task },
      });
      ref.closed.subscribe((done) => {
        if (done) this.reload();
      });
    });
  }

  // ——— Détails ———

  public editDetails(): void {
    const task = this.task();
    if (!task) return;
    this.detailsModel.set(TaskDetailsFormModel.from(task));
    this.editingDetails.set(true);
  }

  public saveDetails(): void {
    submit(this.detailsForm, async (field) => {
      const v = field().value();
      const ok = await this._await(this._api.updateCrmTaskDetails(this.taskId(), {
        title: v.title.trim(),
        description: v.description.trim() || null,
        priority: v.priority as UpdateTaskDetailsRequestPriorityEnum,
        dueAt: new Date(`${v.date}T${v.time}`).toISOString(),
      }));
      if (ok) {
        this.editingDetails.set(false);
        this.reload();
      }
    });
  }

  // ——— Personnes associées ———

  public editPeople(): void {
    this.peopleModel.set(Object.assign(new ParticipantsFormModel(), { userIds: (this.task()?.participants ?? []).map((p) => p.id!) }));
    this.editingPeople.set(true);
  }

  public savePeople(): void {
    submit(this.peopleForm, async (field) => {
      const ok = await this._await(this._api.setCrmTaskParticipants(this.taskId(), { userIds: field().value().userIds }));
      if (ok) {
        this.editingPeople.set(false);
        this.reload();
      }
    });
  }

  // ——— Critères ———

  public toggleCriterion(id: string, isMet: boolean): void {
    this._run(`c-${id}`, this._api.updateCrmTaskCriterion(this.taskId(), id, { isMet }));
  }

  public addCriterion(): void {
    const label = this.criterionDraft().trim();
    if (!label) return;
    this._run('add-criterion', this._api.addCrmTaskCriterion(this.taskId(), { label }), undefined, () => this.criterionDraft.set(''));
  }

  public removeCriterion(id: string): void {
    this._run(`c-${id}`, this._api.removeCrmTaskCriterion(this.taskId(), id));
  }

  // ——— Étiquettes ———

  public addTag(): void {
    const tag = this.tagDraft().trim().toLowerCase();
    const tags = this.task()?.tags ?? [];
    if (!tag || tags.includes(tag)) return this.tagDraft.set('');
    this._saveTags([...tags, tag]);
  }

  public removeTag(tag: string): void {
    this._saveTags((this.task()?.tags ?? []).filter((t) => t !== tag));
  }

  private _saveTags(tags: string[]): void {
    this._api.setCrmTaskTags(this.taskId(), { tags }).pipe(catchError((err: HttpErrorResponse) => this._fail(err))).subscribe((saved) => {
      this.task.update((t) => (t ? { ...t, tags: saved } : t));
      this.tagDraft.set('');
    });
  }

  // ——— Commentaires ———

  private _loadComments(before?: string): void {
    this._api.listCrmTaskComments(this.taskId(), before, 30).pipe(catchError(() => EMPTY)).subscribe((page) => {
      const items = page.items ?? [];
      this.comments.update((current) => (before ? [...items, ...current] : items));
      this.olderBefore.set(page.nextBefore ?? null);
    });
  }

  public loadOlder(): void {
    const before = this.olderBefore();
    if (before) this._loadComments(before);
  }

  public sendComment(): void {
    submit(this.commentForm, async (field) => {
      const ok = await this._await(this._api.addCrmTaskComment(this.taskId(), { body: field().value().body.trim() }));
      if (ok) {
        this.commentModel.set(CommentFormModel.empty());
        this._loadComments();
        this.task.update((t) => (t ? { ...t, commentCount: (t.commentCount ?? 0) + 1 } : t));
      }
    });
  }

  public editComment(comment: TaskCommentDto): void {
    this.editingCommentId.set(comment.id ?? null);
    this.editingCommentText.set(comment.body ?? '');
  }

  public saveComment(id: string): void {
    const body = this.editingCommentText().trim();
    if (!body) return;
    this._run(`m-${id}`, this._api.editCrmTaskComment(this.taskId(), id, { body }), undefined, () => {
      this.editingCommentId.set(null);
      this._loadComments();
    }, false);
  }

  public deleteComment(id: string): void {
    this._confirm.confirm({
      title: 'Supprimer ce commentaire ?',
      message: 'Le fil gardera la mention « commentaire supprimé ».',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._run(`m-${id}`, this._api.deleteCrmTaskComment(this.taskId(), id), undefined, () => this._loadComments(), false),
    });
  }

  // ——— Fichiers ———

  public upload(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      this._snackbar.error('Fichier refusé', TASK_ERRORS['TASK_ATTACHMENT_TOO_LARGE']);
      return;
    }

    this.busy.set('upload');
    this._api.addCrmTaskAttachment(this.taskId(), file).pipe(
      catchError((err: HttpErrorResponse) => {
        this.busy.set(null);
        return this._fail(err);
      }),
    ).subscribe((attachment) => {
      this.busy.set(null);
      this.task.update((t) => (t ? { ...t, attachments: [...(t.attachments ?? []), attachment] } : t));
    });
  }

  /** Le client généré type la réponse `object` ; c'est bien un `Blob` qui arrive (`responseType: 'blob'`). */
  public download(attachment: TaskAttachmentDto): void {
    this._api.downloadCrmTaskAttachment(this.taskId(), attachment.id!).pipe(
      catchError(() => {
        this._snackbar.error('Téléchargement impossible', 'Le fichier n’a pas pu être lu.');
        return EMPTY;
      }),
    ).subscribe((body) => {
      const url = URL.createObjectURL(body as unknown as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.fileName ?? 'fichier';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  public removeAttachment(attachment: TaskAttachmentDto): void {
    this._confirm.confirm({
      title: 'Retirer ce fichier ?',
      message: `« ${attachment.fileName} » sera supprimé de la tâche.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._run(`a-${attachment.id}`, this._api.removeCrmTaskAttachment(this.taskId(), attachment.id!)),
    });
  }

  // ——— Outils ———

  /** Un appel, son indicateur, l'erreur en clair, puis la fiche relue. */
  private _run(key: string, call: Observable<unknown>, success?: string, after?: () => void, reload = true): void {
    this.busy.set(key);
    call.pipe(
      catchError((err: HttpErrorResponse) => {
        this.busy.set(null);
        return this._fail(err);
      }),
    ).subscribe({
      complete: () => {
        if (this.busy() !== key) return;
        this.busy.set(null);
        if (success) this._snackbar.success(success, '');
        after?.();
        if (reload) this.reload();
      },
    });
  }

  private async _await(call: Observable<unknown>): Promise<boolean> {
    let ok = true;
    await firstValueFrom(call.pipe(catchError((err: HttpErrorResponse) => {
      ok = false;
      return this._fail(err);
    })), { defaultValue: null });
    return ok;
  }

  private _fail(err: HttpErrorResponse): Observable<never> {
    const code = typeof err.error?.detail === 'string' ? err.error.detail : null;
    this._snackbar.error('Action impossible', (code && TASK_ERRORS[code]) || 'Une erreur est survenue. Réessayez.');
    if (err.status === 404) this.notFound.set(true);
    return EMPTY;
  }

  public back(): void {
    this._router.navigate(['/tasks/my-day']);
  }
}

export default TaskPage;
