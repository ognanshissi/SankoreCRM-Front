import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnInit, output, signal, untracked, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { ConnectedMailboxApiService, MailMessageDto, MailTemplateDto, MailTemplatesApiService } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { MailAccountsStore } from './mail-accounts.store';
import { MailComposeDrawer, MailComposeDrawerData } from './mail-compose-drawer';
import { MailComposerActions } from './mail-composer-actions';
import { MailEditor } from './mail-editor';
import {
  BLOCKED_EXTENSIONS,
  htmlToText,
  MAIL_SEND_ERRORS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  prefixedSubject,
  quoteHtml,
  replyRecipients,
  scheduleLabel,
  signatureBlock,
  toEmailHtml,
} from './mail-labels';
import { MailScheduledStore } from './mail-scheduled.store';
import { MailSignatureDrawer, MailSignatureDrawerData } from './mail-signature-drawer';

class ReplyFormModel {
  public body = '';
}

/**
 * La réponse rapide, en bas du fil : au dernier message, depuis la boîte qui l'a reçu, avec la
 * signature de cette boîte et la citation d'origine ajoutée à l'envoi comme dans le tiroir. La
 * barre d'actions est celle de Gmail (mise en forme, pièce jointe, lien, émoji, signature, envoi
 * programmé). Pour un Cc ou un objet changé, « Ouvrir en grand » passe le texte au tiroir.
 */
@Component({
  selector: 'mail-reply-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, TasIcon, MailEditor, MailComposerActions],
  template: `
    <form [formRoot]="formSchema" class="rounded-xl border border-slate-200 bg-white transition-colors focus-within:border-primary/50">
      <div class="flex items-center gap-2 rounded-t-xl bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
        <span class="min-w-0 flex-1 truncate">
          À : {{ recipients().to.join(', ') }}
          @if (recipients().cc.length > 0) { <span class="text-slate-400">· Cc : {{ recipients().cc.join(', ') }}</span> }
        </span>
        @if (canReplyAll()) {
          <button type="button" class="shrink-0 font-medium text-primary hover:underline" (click)="replyAll.update((v) => !v)">
            {{ replyAll() ? 'Répondre à l’expéditeur seul' : 'Répondre à tous' }}
          </button>
        }
        <button type="button" class="grid size-6 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                aria-label="Ouvrir en grand" title="Ouvrir en grand (Cc, objet)" (click)="expand()">
          <tas-icon iconName="feather:maximize-2" iconClass="!size-3"></tas-icon>
        </button>
      </div>

      <mail-editor [formField]="formSchema.body" [toolbar]="toolbar()" placeholder="Votre réponse…"></mail-editor>

      @if (files().length > 0) {
        <div class="flex flex-wrap gap-1.5 px-3 pb-2">
          @for (f of files(); track $index) {
            <span class="inline-flex max-w-56 items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs text-slate-700">
              <tas-icon iconName="feather:paperclip" iconClass="!size-3" class="shrink-0 text-slate-400"></tas-icon>
              <span class="truncate">{{ f.name }}</span>
              <button type="button" class="grid size-4 place-items-center rounded-full hover:bg-slate-200" [attr.aria-label]="'Retirer ' + f.name" (click)="removeFile($index)">
                <tas-icon iconName="feather:x" iconClass="!size-2.5"></tas-icon>
              </button>
            </span>
          }
        </div>
      }

      @if (attachmentError() || submitError()) {
        <p class="mx-3 mb-2 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-800" role="alert">{{ attachmentError() || submitError() }}</p>
      }

      <mail-composer-actions
        class="border-t border-slate-100 px-2 py-1.5"
        [canSend]="!isEmpty() && !attachmentError()"
        [sending]="formSchema().submitting()"
        [templates]="templates()"
        [hasSignature]="!!signature()"
        [(toolbar)]="toolbar"
        discardLabel="Effacer la réponse"
        (send)="send($event)"
        (files)="addFiles($event)"
        (link)="editor()?.openLink()"
        (emoji)="editor()?.insertText($event)"
        (signature)="editor()?.insertHtml(signature()!)"
        (editSignature)="editSignature()"
        (template)="applyTemplate($event)"
        (discard)="reset()"
      ></mail-composer-actions>
    </form>
  `,
})
export class MailReplyBox implements OnInit {
  private readonly _mailApi = inject(ConnectedMailboxApiService);
  private readonly _templatesApi = inject(MailTemplatesApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _accounts = inject(MailAccountsStore);
  private readonly _scheduled = inject(MailScheduledStore);

  public readonly editor = viewChild(MailEditor);

  /** Le message auquel on répond : le dernier du fil. */
  public readonly source = input.required<MailMessageDto>();
  /** Le lead ou le client de la conversation : ce qui remplit un modèle. */
  public readonly context = input<{ leadId?: string | null; clientId?: string | null }>({});

  /** La réponse est partie : le fil doit se relire. */
  public readonly sent = output<void>();

  public readonly replyAll = signal(false);
  public readonly toolbar = signal(false);
  public readonly templates = signal<MailTemplateDto[]>([]);
  public readonly files = signal<File[]>([]);
  public readonly submitError = signal<string | null>(null);

  public readonly model = signal(new ReplyFormModel());
  public readonly formSchema = form(this.model);

  /** Le texte de départ — la signature de la boîte, ou rien : ce que la corbeille remet. */
  private readonly _initial = signal('');

  public readonly signature = computed(() => this._accounts.signatureOf(this.source().accountId));
  public readonly recipients = computed(() => replyRecipients(this.source(), this.replyAll()));
  public readonly canReplyAll = computed(() => replyRecipients(this.source(), true).cc.length > 0);

  /** Rien d'écrit : vide, ou seulement la signature posée au départ. */
  public readonly isEmpty = computed(() => {
    const text = htmlToText(this.model().body);
    return text.length === 0 || text === htmlToText(this._initial());
  });

  public readonly attachmentError = computed(() => {
    const files = this.files();
    if (files.length > MAX_ATTACHMENTS) return `${MAX_ATTACHMENTS} pièces jointes au plus.`;
    if (files.reduce((s, f) => s + f.size, 0) > MAX_ATTACHMENT_BYTES) return 'Les pièces jointes dépassent 20 Mo au total.';
    const blocked = files.find((f) => BLOCKED_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)));
    return blocked ? `« ${blocked.name} » : les fichiers exécutables ne peuvent pas être envoyés.` : null;
  });

  constructor() {
    // La signature arrive avec la liste des boîtes : posée tant que rien n'a été écrit.
    effect(() => {
      const block = signatureBlock(this.signature());
      untracked(() => {
        const body = this.model().body;
        if (htmlToText(body).length > 0 && body !== this._initial()) return;
        this._initial.set(block);
        this.model.set(Object.assign(new ReplyFormModel(), { body: block }));
      });
    });
  }

  ngOnInit(): void {
    this._accounts.load();
    this._templatesApi.listMailTemplates(false).pipe(catchError(() => of([]))).subscribe((list) => this.templates.set(list ?? []));
  }

  public async applyTemplate(template: MailTemplateDto): Promise<void> {
    if (!template.id) return;
    const rendered = await firstValueFrom(
      this._mailApi
        .renderMailTemplate(template.id, {
          leadId: this.context().leadId ?? null,
          clientId: this.context().clientId ?? null,
          accountId: this.source().accountId ?? null,
        })
        .pipe(catchError(() => of(null))),
    );

    if (!rendered) {
      this._snackbar.error('Modèle non appliqué', 'Le modèle n’a pas pu être rempli.');
      return;
    }
    // L'objet reste « RE: … » : celui du modèle sortirait la réponse de sa conversation.
    this.model.set(Object.assign(new ReplyFormModel(), { body: (rendered.body ?? '') + signatureBlock(this.signature()) }));
    const missing = rendered.missing ?? [];
    if (missing.length > 0) this._snackbar.info('À relire', `Sans valeur ici, laissé vide : ${missing.join(', ')}.`);
  }

  public addFiles(added: File[]): void {
    this.files.update((list) => [...list, ...added]);
  }

  public removeFile(index: number): void {
    this.files.update((list) => list.filter((_, i) => i !== index));
  }

  public reset(): void {
    this.model.set(Object.assign(new ReplyFormModel(), { body: this._initial() }));
    this.files.set([]);
    this.submitError.set(null);
    this.replyAll.set(false);
  }

  /** @param at `null` : maintenant ; une date : programmé. */
  public send(at: Date | null): void {
    this.submitError.set(null);
    const source = this.source();
    const { to, cc } = this.recipients();

    submit(this.formSchema, async () => {
      const outcome = await firstValueFrom(
        this._mailApi
          .sendMail(
            source.accountId!,
            to,
            cc,
            [],
            prefixedSubject('RE', source.subject ?? ''),
            toEmailHtml(this.model().body + quoteHtml(source, 'reply')),
            source.id!,
            undefined,
            [],
            this.files(),
            undefined,
            at?.toISOString(),
          )
          .pipe(
            catchError((err: HttpErrorResponse) => {
              const code = typeof err.error?.detail === 'string' ? err.error.detail : null;
              this.submitError.set(
                err.status === 429 ? 'Trop d’envois rapprochés : patientez une minute.' : (code && MAIL_SEND_ERRORS[code]) || 'La réponse n’a pas pu partir. Réessayez.',
              );
              return of(undefined);
            }),
          ),
      );

      if (outcome === undefined) return;
      if (at) {
        this._snackbar.success('Envoi programmé', `La réponse partira ${scheduleLabel(at)}. Vous pouvez l’annuler dans « Programmés ».`);
        this._scheduled.refresh();
      } else {
        this._snackbar.success('Réponse envoyée', 'Elle apparaîtra dans la conversation dans quelques instants.');
        this.sent.emit();
      }
      this.reset();
    });
  }

  public editSignature(): void {
    const source = this.source();
    const account = this._accounts.accounts().find((a) => a.id === source.accountId);
    this._drawer
      .open<string | null, MailSignatureDrawerData, MailSignatureDrawer>(MailSignatureDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { accountId: source.accountId!, email: account?.email ?? '', signature: this.signature() },
      })
      .closed.subscribe(() => this.editor()?.focus());
  }

  /** Le tiroir complet, avec ce qui est déjà écrit — citation comprise, comme il l'aurait faite. */
  public expand(): void {
    const source = this.source();
    this._drawer
      .open<boolean, MailComposeDrawerData, MailComposeDrawer>(MailComposeDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: {
          mode: this.replyAll() ? 'replyAll' : 'reply',
          source,
          body: this.model().body + quoteHtml(source, 'reply'),
          files: this.files(),
          context: this.context(),
        },
      })
      .closed.subscribe((sent) => {
        if (!sent) return;
        this.reset();
        this.sent.emit();
      });
  }
}
