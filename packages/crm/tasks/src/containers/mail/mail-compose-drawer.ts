import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal, untracked, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { disabled, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { ConnectedMailboxApiService, MailMessageDto, MailTemplateDto, MailTemplatesApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService, TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import {
  BLOCKED_EXTENSIONS,
  MAIL_SEND_ERRORS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  htmlToText,
  prefixedSubject,
  quoteHtml,
  replyRecipients,
  scheduleLabel,
  signatureBlock,
  splitAddresses,
  toEmailHtml,
} from './mail-labels';
import { MailAccountsStore } from './mail-accounts.store';
import { MailComposerActions } from './mail-composer-actions';
import { MailEditor } from './mail-editor';
import { MailScheduledStore } from './mail-scheduled.store';
import { MailSignatureDrawer, MailSignatureDrawerData } from './mail-signature-drawer';

export type MailComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface MailComposeDrawerData {
  mode?: MailComposeMode;
  /** Le message auquel on répond, ou qu'on transfère. */
  source?: MailMessageDto | null;
  /** La boîte qui envoie ; à défaut celle du message source, sinon la première. */
  accountId?: string | null;
  to?: string[];
  cc?: string[];
  subject?: string;
  /** Un texte déjà commencé — la réponse rapide du fil, ouverte en grand —, citation comprise. */
  body?: string;
  /** Les fichiers déjà joints à ce texte. */
  files?: File[];
  /** Le lead ou le client à qui l'on écrit : ce qui remplit les variables d'un modèle. */
  context?: { leadId?: string | null; clientId?: string | null };
  /**
   * Un client désigné par sa fiche : son adresse est masquée à l'écran, c'est le serveur qui la lit
   * à l'envoi et l'ajoute à « À » — comme le numéro pour un appel. Le tiroir n'en voit que la forme
   * masquée.
   */
  client?: { id: string; name: string; maskedEmail?: string | null } | null;
}

class ComposeFormModel {
  public accountId!: string;
  public to!: string;
  public cc!: string;
  public bcc!: string;
  public subject!: string;
  public body!: string;
}

/**
 * Le tiroir de rédaction (messagerie connectée, lot 5) : nouveau message, réponse, réponse à
 * tous, transfert. Il part de la boîte de l'agent ; une réponse part de la boîte qui a reçu le
 * message et reste dans sa conversation. Exporté par la lib : les fiches lead et client
 * l'ouvrent avec le destinataire et le contexte déjà remplis (lot 6).
 */
@Component({
  selector: 'mail-compose-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField, FormRoot, Button, TasError, TasFormField, TasHint, TasLabel, TasIcon, TasInput, TasSelect, TasTitle,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, MailEditor, MailComposerActions,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>{{ title() }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (accountOptions().length === 0 && !loadingAccounts()) {
          <div class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
            Aucune boîte mail n’est connectée et active. Connectez-en une dans Mon compte › Agendas et messagerie.
          </div>
        } @else {
          <form [formRoot]="formSchema" class="flex flex-col gap-4">
            <tas-form-field>
              <tas-label>De</tas-label>
              <tas-select [options]="accountOptions()" [formField]="formSchema.accountId"></tas-select>
              @if (isReply()) { <tas-hint>Une réponse part de la boîte qui a reçu le message.</tas-hint> }
            </tas-form-field>

            @if (data.client; as c) {
              <div class="flex flex-col gap-1">
                <span class="text-sm font-medium text-slate-700">À</span>
                <span class="inline-flex w-fit max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                  <tas-icon iconName="feather:user" iconClass="!size-3.5"></tas-icon>
                  <span class="truncate font-semibold">{{ c.name }}</span>
                  @if (c.maskedEmail) { <span class="truncate text-xs text-primary/80">{{ c.maskedEmail }}</span> }
                </span>
              </div>
            }

            <tas-form-field>
              <tas-label>{{ data.client ? 'Autres destinataires' : 'À' }}</tas-label>
              <input tasInput type="text" autocomplete="off" placeholder="adresse@exemple.com, autre@exemple.com" [formField]="formSchema.to" />
              @if (formSchema.to().touched() && formSchema.to().invalid()) {
                <tas-error>{{ formSchema.to().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            @if (showCopies()) {
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <tas-form-field>
                  <tas-label>Cc</tas-label>
                  <input tasInput type="text" autocomplete="off" [formField]="formSchema.cc" />
                  @if (formSchema.cc().touched() && formSchema.cc().invalid()) {
                    <tas-error>{{ formSchema.cc().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Cci</tas-label>
                  <input tasInput type="text" autocomplete="off" [formField]="formSchema.bcc" />
                  @if (formSchema.bcc().touched() && formSchema.bcc().invalid()) {
                    <tas-error>{{ formSchema.bcc().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              </div>
            } @else {
              <button tas-text-button color="primary" type="button" class="-mt-2 self-start" (click)="showCopies.set(true)">Ajouter Cc / Cci</button>
            }

            <tas-form-field>
              <tas-label>Objet</tas-label>
              <input tasInput type="text" [formField]="formSchema.subject" />
              @if (formSchema.subject().touched() && formSchema.subject().invalid()) {
                <tas-error>{{ formSchema.subject().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            @if (missing().length > 0) {
              <p class="-mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Sans valeur ici, laissé vide dans le texte : {{ missing().join(', ') }}. Relisez avant d’envoyer.
              </p>
            }

            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium text-slate-700">Message</span>
              <div class="rounded-xl border border-slate-200 pt-1 [--mail-editor-min:14rem] [--mail-editor-max:28rem] focus-within:border-primary/50">
                <mail-editor [formField]="formSchema.body" [toolbar]="toolbar()" placeholder="Votre message…"></mail-editor>
              </div>
            </div>

            <!-- Pièces jointes -->
            <div class="flex flex-col gap-2">
              @if (forwardable().length > 0) {
                <p class="text-xs font-medium text-slate-600">Pièces jointes du message transféré</p>
                @for (a of forwardable(); track a.id) {
                  <label class="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" class="h-4 w-4 accent-primary" [checked]="forwardIds().has(a.id!)" (change)="toggleForward(a.id!, $any($event.target).checked)" />
                    <tas-icon iconName="feather:paperclip" iconClass="!size-3" class="text-slate-400"></tas-icon>
                    <span class="truncate">{{ a.name }}</span>
                    <span class="shrink-0 text-xs text-slate-400 tabular-nums">{{ size(a.size) }}</span>
                  </label>
                }
              }

              @for (f of files(); track $index) {
                <div class="flex items-center gap-2 text-sm text-slate-700">
                  <tas-icon iconName="feather:paperclip" iconClass="!size-3" class="text-slate-400"></tas-icon>
                  <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
                  <span class="shrink-0 text-xs text-slate-400 tabular-nums">{{ size(f.size) }}</span>
                  <button tas-button iconButton type="button" [attr.aria-label]="'Retirer ' + f.name" (click)="removeFile($index)">
                    <tas-icon iconName="feather:x" iconClass="!size-3"></tas-icon>
                  </button>
                </div>
              }

              @if (attachmentError()) {
                <p class="text-xs text-functional-error" role="alert">{{ attachmentError() }}</p>
              }
            </div>

            @if (submitError()) {
              <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{{ submitError() }}</p>
            }
          </form>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <mail-composer-actions
          class="w-full"
          [canSend]="!formSchema().invalid() && !attachmentError() && accountOptions().length > 0"
          [sending]="formSchema().submitting()"
          [templates]="templates()"
          [hasSignature]="!!signature()"
          [(toolbar)]="toolbar"
          (send)="send($event)"
          (files)="addFiles($event)"
          (link)="editor()?.openLink()"
          (emoji)="editor()?.insertText($event)"
          (signature)="editor()?.insertHtml(signature()!)"
          (editSignature)="editSignature()"
          (template)="applyTemplate($event)"
          (discard)="close()"
        ></mail-composer-actions>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class MailComposeDrawer implements OnInit {
  public readonly data: MailComposeDrawerData = inject(DIALOG_DATA) ?? {};

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _mailApi = inject(ConnectedMailboxApiService);
  private readonly _templatesApi = inject(MailTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _store = inject(MailAccountsStore);
  private readonly _scheduled = inject(MailScheduledStore);

  public readonly editor = viewChild(MailEditor);
  public readonly mode: MailComposeMode = this.data.mode ?? 'new';

  public readonly loadingAccounts = computed(() => !this._store.loaded());
  public readonly accounts = this._store.accounts;
  public readonly templates = signal<MailTemplateDto[]>([]);
  /** La barre de mise en forme : ouverte d'emblée dans le tiroir, qui a la place. */
  public readonly toolbar = signal(true);
  public readonly missing = signal<string[]>([]);
  public readonly files = signal<File[]>(this.data.files ?? []);
  public readonly forwardIds = signal<Set<string>>(new Set());
  public readonly submitError = signal<string | null>(null);
  public readonly showCopies = signal(false);

  public readonly isReply = computed(() => this.mode === 'reply' || this.mode === 'replyAll');

  public readonly title = computed(() =>
    ({ new: 'Nouvel e-mail', reply: 'Répondre', replyAll: 'Répondre à tous', forward: 'Transférer' })[this.mode],
  );

  /** Les boîtes qui peuvent envoyer : messagerie active, compte en état. */
  public readonly accountOptions = computed(() =>
    this.accounts()
      .filter((a) => a.mailEnabled && a.status !== 'NeedsReconnect')
      .map((a) => ({ label: a.label === a.email ? a.email ?? '' : `${a.label} — ${a.email}`, value: a.id ?? '' })),
  );

  public readonly signature = computed(() => this._store.signatureOf(this.model().accountId));

  /** Le texte tant que l'agent n'y a pas touché : la signature suit la boîte choisie dans « De ». */
  private _untouchedBody: string | null = null;

  public readonly forwardable = computed(() =>
    this.mode === 'forward' ? (this.data.source?.attachments ?? []).filter((a) => !a.isInline) : [],
  );

  public readonly attachmentError = computed(() => {
    const forwarded = this.forwardable().filter((a) => this.forwardIds().has(a.id!));
    const count = this.files().length + forwarded.length;
    const bytes = this.files().reduce((s, f) => s + f.size, 0) + forwarded.reduce((s, a) => s + (a.size ?? 0), 0);

    if (count > MAX_ATTACHMENTS) return `${MAX_ATTACHMENTS} pièces jointes au plus.`;
    if (bytes > MAX_ATTACHMENT_BYTES) return 'Les pièces jointes dépassent 20 Mo au total.';
    const blocked = this.files().find((f) => BLOCKED_EXTENSIONS.some((ext) => f.name.toLowerCase().endsWith(ext)));
    return blocked ? `« ${blocked.name} » : les fichiers exécutables ne peuvent pas être envoyés.` : null;
  });

  public model = signal<ComposeFormModel>(this._initialModel());

  public formSchema = form(this.model, (schema) => {
    required(schema.accountId, { message: 'Choisissez la boîte qui envoie' });
    disabled(schema.accountId, () => this.isReply());
    required(schema.subject, { message: 'L’objet est obligatoire' });
    validate(schema.to, (ctx) => {
      const m = this.model();
      if (!this.data.client && splitAddresses(ctx.value()).length + splitAddresses(m.cc).length + splitAddresses(m.bcc).length === 0)
        return { kind: 'required', message: 'Au moins un destinataire' };
      return invalidAddress(ctx.value());
    });
    validate(schema.cc, (ctx) => invalidAddress(ctx.value()));
    validate(schema.bcc, (ctx) => invalidAddress(ctx.value()));
  });

  constructor() {
    // La boîte demandée, celle du message source, sinon la première qui peut envoyer — dès que la
    // liste des boîtes est là.
    effect(() => {
      const options = this.accountOptions();
      untracked(() => {
        if (this.model().accountId || options.length === 0) return;
        const wanted = this.data.accountId ?? this.data.source?.accountId;
        const chosen = options.find((o) => o.value === wanted)?.value ?? options[0].value;
        this.model.update((m) => ({ ...m, accountId: chosen }));
      });
    });

    // La signature de la boîte qui envoie, sous le texte, tant que l'agent n'a rien écrit. Un texte
    // repris de la réponse rapide (`data.body`) a déjà la sienne.
    effect(() => {
      const signature = this.signature();
      untracked(() => {
        if (this.data.body !== undefined) return;
        const body = this.model().body;
        if (this._untouchedBody !== null ? body !== this._untouchedBody : htmlToText(body) !== htmlToText(this._quote())) return;
        const next = signatureBlock(signature) + this._quote();
        this._untouchedBody = next;
        this.model.update((m) => ({ ...m, body: next }));
      });
    });
  }

  ngOnInit(): void {
    this.forwardIds.set(new Set(this.forwardable().map((a) => a.id!)));
    if (this.model().cc) this.showCopies.set(true);

    this._store.load();
    this._templatesApi.listMailTemplates(false).pipe(catchError(() => of([]))).subscribe((list) => this.templates.set(list ?? []));
  }

  /** Remplace le texte (et l'objet, hors réponse) par le modèle rempli pour ce destinataire ; la citation d'origine reste dessous. */
  public async applyTemplate(template: MailTemplateDto): Promise<void> {
    const id = template.id;
    if (!id) return;

    const rendered = await firstValueFrom(
      this._mailApi
        .renderMailTemplate(id, {
          leadId: this.data.context?.leadId ?? null,
          clientId: this.data.context?.clientId ?? null,
          accountId: this.model().accountId || null,
        })
        .pipe(
          catchError(() => {
            this._snackbar.error('Modèle non appliqué', 'Le modèle n’a pas pu être rempli.');
            return of(null);
          }),
        ),
    );

    if (!rendered) return;

    this.missing.set(rendered.missing ?? []);
    // Une réponse garde son objet « RE: … » : les messageries regroupent aussi par objet, et celui du
    // modèle sortirait la réponse de sa conversation chez le destinataire.
    this.model.update((m) => ({
      ...m,
      subject: this.isReply() ? m.subject : rendered.subject ?? m.subject,
      body: (rendered.body ?? '') + signatureBlock(this.signature()) + this._quote(),
    }));
  }

  public addFiles(added: File[]): void {
    this.files.update((list) => [...list, ...added]);
  }

  public removeFile(index: number): void {
    this.files.update((list) => list.filter((_, i) => i !== index));
  }

  public toggleForward(id: string, checked: boolean): void {
    this.forwardIds.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  public size(bytes: number | null | undefined): string {
    const n = bytes ?? 0;
    if (n < 1024) return `${n} o`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
    return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  }

  /** @param at `null` : maintenant ; une date : programmé (« Programmer l'envoi »). */
  public send(at: Date | null): void {
    this.submitError.set(null);

    submit(this.formSchema, async () => {
      const m = this.model();
      const forwarded = this.forwardable().filter((a) => this.forwardIds().has(a.id!)).map((a) => a.id!);

      const sent = await firstValueFrom(
        this._mailApi
          .sendMail(
            m.accountId,
            splitAddresses(m.to),
            splitAddresses(m.cc),
            splitAddresses(m.bcc),
            m.subject.trim(),
            toEmailHtml(m.body),
            this.isReply() ? this.data.source?.id ?? undefined : undefined,
            this.mode === 'forward' ? this.data.source?.id ?? undefined : undefined,
            forwarded,
            this.files(),
            this.data.client?.id,
            at?.toISOString(),
          )
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this.submitError.set(sendError(err));
              return of(undefined);
            }),
          ),
      );

      if (sent === undefined) return;
      if (at) {
        this._snackbar.success('Envoi programmé', `L’e-mail partira ${scheduleLabel(at)}. Vous pouvez l’annuler dans « Programmés ».`);
        this._scheduled.refresh();
      } else {
        this._snackbar.success('E-mail envoyé', 'Il apparaîtra dans la conversation dans quelques instants s’il concerne un lead ou un client.');
      }
      this._dialogRef.close(!at);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  public editSignature(): void {
    const accountId = this.model().accountId;
    if (!accountId) return;
    const account = this.accounts().find((a) => a.id === accountId);
    this._drawer.open<string | null, MailSignatureDrawerData, MailSignatureDrawer>(MailSignatureDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { accountId, email: account?.email ?? '', signature: this.signature() },
    });
  }

  private _initialModel(): ComposeFormModel {
    const source = this.data.source;
    const mode = this.data.mode ?? 'new';
    const subject = source?.subject ?? this.data.subject ?? '';

    let to = (this.data.to ?? []).join(', ');
    let cc = (this.data.cc ?? []).join(', ');

    if (source && (mode === 'reply' || mode === 'replyAll')) {
      const recipients = replyRecipients(source, mode === 'replyAll');
      to = recipients.to.join(', ');
      cc = recipients.cc.join(', ');
    }

    return Object.assign(new ComposeFormModel(), {
      accountId: '',
      to,
      cc,
      bcc: '',
      subject: !source ? subject : mode === 'forward' ? prefixedSubject('TR', subject) : prefixedSubject('RE', subject),
      body: this.data.body ?? this._quote(),
    });
  }

  private _quote(): string {
    const source = this.data.source;
    return source ? quoteHtml(source, this.mode === 'forward' ? 'forward' : 'reply') : '';
  }
}

const ADDRESS = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

function invalidAddress(value: string): { kind: string; message: string } | null {
  const bad = splitAddresses(value).find((a) => !ADDRESS.test(a));
  return bad ? { kind: 'email', message: `« ${bad} » n’est pas une adresse valide` } : null;
}

function sendError(err: HttpErrorResponse): string {
  if (err.status === 429) return 'Trop d’envois rapprochés : patientez une minute.';
  const code = typeof err.error?.detail === 'string' ? err.error.detail : null;
  return (code && MAIL_SEND_ERRORS[code]) || 'L’e-mail n’a pas pu être envoyé. Réessayez.';
}
