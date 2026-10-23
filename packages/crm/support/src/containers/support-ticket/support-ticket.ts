import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { form, FormField, FormRoot, maxLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, Observable } from 'rxjs';
import { SupportApiService, SupportMessageDto, SupportTicketDto } from '@sankore/crm-api';
import { BreadcrumbService, PERMISSIONS, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, STATUS_SEVERITIES, supportErrorMessage } from '../../support-meta';

class ReplyFormModel {
  public body!: string;

  public static instantiate(): ReplyFormModel {
    const m = new ReplyFormModel();
    m.body = '';
    return m;
  }
}

/**
 * Un ticket et son fil avec l'équipe Sankoré. Le fil est rendu en bulles, hors tas-table
 * (choix du propriétaire, comme le fil WhatsApp) : c'est une conversation, pas une liste.
 * Ce que l'utilisateur peut faire (répondre, clore, rouvrir) vient du serveur.
 */
@Component({
  templateUrl: './support-ticket.html',
  imports: [
    DatePipe, LowerCasePipe, RouterLink, FormRoot, FormField,
    Button, TasCard, TasFormField, TasLabel, TasError, TasInput, TasIcon, TasSpinner, TasTag,
  ],
})
export class SupportTicketPage implements OnInit {
  private readonly _supportApi = inject(SupportApiService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly canWrite = inject(PermissionsService).can(PERMISSIONS.SUPPORT_CREATE);
  public readonly statusLabels = STATUS_LABELS;
  public readonly statusSeverities = STATUS_SEVERITIES;
  public readonly priorityLabels = PRIORITY_LABELS;
  public readonly categoryLabels = CATEGORY_LABELS;

  public readonly ticketId = signal('');
  public readonly detail = signal<SupportTicketDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly notFound = signal(false);
  public readonly busy = signal(false);

  public readonly ticket = computed(() => this.detail()?.ticket ?? null);
  public readonly messages = computed(() => this.detail()?.messages ?? []);

  public replyModel = signal(ReplyFormModel.instantiate());
  public replyForm = form(this.replyModel, (schema) => {
    required(schema.body, { message: 'Le message est vide' });
    maxLength(schema.body, 10000, { message: '10 000 caractères au plus' });
  });

  ngOnInit(): void {
    this._route.paramMap.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((params) => {
      this.ticketId.set(params.get('ticketId') ?? '');
      this.isLoading.set(true);
      this._load();
    });
  }

  public refresh(): void {
    this._load();
  }

  public isStatusChange(m: SupportMessageDto): boolean {
    return m.kind === 'StatusChange';
  }

  /** « Équipe Sankoré » plutôt qu'un prénom seul : l'utilisateur sait qui lui répond. */
  public authorLabel(m: SupportMessageDto): string {
    if (m.isMine) return 'Vous';
    if (m.authorKind === 'Platform') return `${m.authorName} · Équipe Sankoré`;
    if (m.authorKind === 'System') return 'Sankoré';
    return m.authorName ?? '';
  }

  public handleReply(): void {
    submit(this.replyForm, async (field) => {
      const body = field().value().body.trim();
      const done = await this._send(this._supportApi.replySupportTicket(this.ticketId(), { body }));
      if (done) {
        this.replyModel.set(ReplyFormModel.instantiate());
        this.replyForm().reset();
      }
    });
  }

  public close(): void {
    this._confirm.confirm({
      title: 'Clore le ticket ?',
      message: 'Le support ne le traitera plus. Vous pourrez le rouvrir si le problème revient.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Clore' },
      rejectButtonProps: { label: 'Retour' },
      accept: () => void this._send(this._supportApi.closeSupportTicket(this.ticketId()), 'Ticket clos'),
    });
  }

  public reopen(): void {
    void this._send(this._supportApi.reopenSupportTicket(this.ticketId()), 'Ticket rouvert');
  }

  private async _send(call: Observable<unknown>, success?: string): Promise<boolean> {
    this.busy.set(true);
    const ok = await firstValueFrom(
      call.pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Support', supportErrorMessage(err.error?.error));
          return EMPTY;
        }),
      ),
      { defaultValue: 'failed' as const },
    ).then((r) => r !== 'failed');
    this.busy.set(false);
    if (ok) {
      if (success) this._snackbar.success('Support', success);
      this._load();
    }
    return ok;
  }

  private _load(): void {
    this._supportApi
      .getSupportTicket(this.ticketId())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isLoading.set(false);
          if (err.status === 404) this.notFound.set(true);
          else this._snackbar.error('Support', supportErrorMessage(err.error?.error));
          return EMPTY;
        }),
      )
      .subscribe((detail) => {
        this.detail.set(detail);
        this.notFound.set(false);
        this.isLoading.set(false);
        this._breadcrumb.set([
          { label: 'Support', link: ['/support'] },
          { label: detail.ticket?.reference ?? 'Ticket' },
        ]);
      });
  }
}

export default SupportTicketPage;
