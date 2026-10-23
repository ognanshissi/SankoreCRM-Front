import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { form, FormField, FormRoot, maxLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, finalize, firstValueFrom, Observable } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import {
  PlatformSupportTicketDetail,
  SupportApiService,
  SupportAssignee,
  SupportMessageResponse,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@sankore/crm-admin-api';
import {
  describeSupportError,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITY_OPTIONS,
  SUPPORT_STATUS_OPTIONS,
  SUPPORT_STATUS_STYLE,
  supportStatusStyle,
} from '../support-referential';

class ReplyFormModel {
  public body!: string;
  public internal!: boolean;
  public nextStatus!: string;

  public static instantiate(): ReplyFormModel {
    const m = new ReplyFormModel();
    m.body = '';
    m.internal = false;
    // Répondre, c'est le plus souvent attendre le client : le défaut du registre, rendu visible.
    m.nextStatus = SupportTicketStatus.WaitingOnTenant;
    return m;
  }
}

/**
 * Un ticket vu de la plateforme : le fil complet, notes internes comprises (jamais montrées au
 * tenant, le registre les filtre), le contexte technique joint à l'ouverture, et les réglages
 * d'opérateur — assignation, priorité, statut. Le fil est rendu en bulles, comme côté CRM.
 */
@Component({
  templateUrl: './platform-support-ticket.html',
  imports: [
    DatePipe, FormsModule, RouterLink, FormRoot, FormField,
    Button, TasFormField, TasLabel, TasHint, TasError, TasIcon, TasInput, TasSelect, TasSpinner,
  ],
})
export class PlatformSupportTicket implements OnInit {
  private readonly _api = inject(SupportApiService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly statusOptions = SUPPORT_STATUS_OPTIONS;
  public readonly replyStatusOptions = SUPPORT_STATUS_OPTIONS.filter((o) => o.value !== SupportTicketStatus.New);
  public readonly priorityOptions = SUPPORT_PRIORITY_OPTIONS;
  public readonly statusStyles = SUPPORT_STATUS_STYLE;
  public readonly categoryLabels = SUPPORT_CATEGORY_LABELS;

  public readonly ticketId = signal('');
  public readonly data = signal<PlatformSupportTicketDetail | null>(null);
  public readonly assignees = signal<SupportAssignee[]>([]);
  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly busy = signal(false);

  public readonly ticket = computed(() => this.data()?.detail?.ticket ?? null);
  public readonly status = computed(() => supportStatusStyle(this.ticket()?.status));
  public readonly isClosed = computed(() => this.ticket()?.status === SupportTicketStatus.Closed);
  public readonly assigneeOptions = computed(() => [
    { label: 'Personne', value: '' },
    ...this.assignees().map((a) => ({ label: a.fullName ?? a.email ?? '', value: a.id ?? '' })),
  ]);

  public replyModel = signal(ReplyFormModel.instantiate());
  public replyForm = form(this.replyModel, (schema) => {
    required(schema.body, { message: 'Le message est vide' });
    maxLength(schema.body, 10000, { message: '10 000 caractères au plus' });
  });

  public ngOnInit(): void {
    this._api.listSupportAssignees().pipe(catchError(() => EMPTY)).subscribe((a) => this.assignees.set(a ?? []));
    this._route.paramMap.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((params) => {
      this.ticketId.set(params.get('ticketId') ?? '');
      this.isLoading.set(true);
      this.load();
    });
  }

  public load(): void {
    this.loadError.set(null);
    this._api
      .getPlatformSupportTicket(this.ticketId())
      .pipe(
        catchError((err) => {
          this.loadError.set(describeSupportError(err, 'Le ticket n’a pas pu être chargé.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((data) => this.data.set(data));
  }

  public authorLabel(m: SupportMessageResponse): string {
    if (m.authorKind === 'System') return 'Clôture automatique';
    return m.authorName ?? '';
  }

  public isTenant(m: SupportMessageResponse): boolean {
    return m.authorKind === 'Tenant';
  }

  public handleReply(): void {
    submit(this.replyForm, async (field) => {
      const v = field().value();
      const ok = await this._run(
        this._api.replyPlatformSupportTicket(this.ticketId(), {
          body: v.body.trim(),
          internal: v.internal,
          nextStatus: v.internal ? undefined : (v.nextStatus as SupportTicketStatus),
        }),
        v.internal ? 'Note interne ajoutée.' : 'Réponse envoyée au demandeur.',
      );
      if (ok) {
        this.replyModel.set(ReplyFormModel.instantiate());
        this.replyForm().reset();
      }
    });
  }

  public changeStatus(status: string | null): void {
    if (!status || status === this.ticket()?.status) return;
    void this._run(
      this._api.changeSupportTicketStatus(this.ticketId(), { status: status as SupportTicketStatus }),
      `Statut : ${SUPPORT_STATUS_STYLE[status as SupportTicketStatus].label}.`,
    );
  }

  public changePriority(priority: string | null): void {
    if (!priority || priority === this.ticket()?.priority) return;
    void this._run(this._api.changeSupportTicketPriority(this.ticketId(), { priority: priority as SupportTicketPriority }));
  }

  public assign(adminId: string | null): void {
    if ((adminId || null) === (this.ticket()?.assignedAdminId ?? null)) return;
    void this._run(this._api.assignSupportTicket(this.ticketId(), { adminId: adminId || null }), 'Assignation enregistrée.');
  }

  private async _run(call: Observable<unknown>, success?: string): Promise<boolean> {
    this.busy.set(true);
    const ok = await firstValueFrom(
      call.pipe(
        catchError((err) => {
          this._snackbar.error('Support', describeSupportError(err, 'L’opération a échoué.'));
          return EMPTY;
        }),
      ),
      { defaultValue: 'failed' as const },
    ).then((r) => r !== 'failed');
    this.busy.set(false);
    if (ok && success) this._snackbar.success('Support', success);
    // Rechargé dans les deux cas : un refus vient souvent d'un ticket qui a bougé entre-temps.
    this.load();
    return ok;
  }
}

export default PlatformSupportTicket;
