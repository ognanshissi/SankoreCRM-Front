import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { disabled, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, of } from 'rxjs';
import { QuillModule } from 'ngx-quill';
import {
  ConnectedAccountDto,
  ConnectedAccountsApiService,
  ConnectedMailboxApiService,
  MailMessageDto,
  MailTemplateDto,
  MailTemplatesApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { addressesOf, BLOCKED_EXTENSIONS, htmlToText, MAIL_SEND_ERRORS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, splitAddresses } from './mail-labels';

export type MailComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface MailComposeDrawerData {
  mode?: MailComposeMode;
  /** Le message auquel on répond, ou qu'on transfère. */
  source?: MailMessageDto | null;
  /** La boîte qui envoie ; à défaut celle du message source, sinon la première. */
  accountId?: string | null;
  to?: string[];
  subject?: string;
  /** Le lead ou le client à qui l'on écrit : ce qui remplit les variables d'un modèle. */
  context?: { leadId?: string | null; clientId?: string | null };
  /**
   * Un client désigné par sa fiche : son adresse est masquée à l'écran, c'est le serveur qui la lit
   * à l'envoi et l'ajoute à « À » — comme le numéro pour un appel. Le tiroir n'en voit que la forme
   * masquée.
   */
  client?: { id: string; name: string; maskedEmail?: string | null } | null;
}

const QUILL_MODULES = {
  toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['blockquote', 'link'], ['clean']],
};

class ComposeFormModel {
  public accountId!: string;
  public to!: string;
  public cc!: string;
  public bcc!: string;
  public subject!: string;
  public body!: string;
  /** Pas envoyé : le modèle qu'on applique au texte. */
  public templateId!: string;
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
    FormField, FormRoot, QuillModule, Button, TasError, TasFormField, TasHint, TasLabel, TasIcon, TasInput, TasSelect, TasTitle,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
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

            @if (templates().length > 0) {
              <div class="flex flex-wrap items-end gap-2">
                <tas-form-field class="min-w-56 flex-1">
                  <tas-label>Partir d’un modèle</tas-label>
                  <tas-select [options]="templateOptions()" [formField]="formSchema.templateId" placeholder="Choisir un modèle"></tas-select>
                </tas-form-field>
                <button tas-outlined-button color="primary" type="button" [disabled]="!model().templateId || applying()" [isLoading]="applying()" (click)="applyTemplate()">
                  Appliquer
                </button>
              </div>
              @if (missing().length > 0) {
                <p class="-mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  Sans valeur ici, laissé vide dans le texte : {{ missing().join(', ') }}. Relisez avant d’envoyer.
                </p>
              }
            }

            <div class="flex flex-col gap-1">
              <span class="text-sm font-medium text-slate-700">Message</span>
              <quill-editor
                [formField]="formSchema.body"
                [modules]="quillModules"
                theme="snow"
                placeholder="Votre message…"
                [styles]="{ minHeight: '14rem' }"
              ></quill-editor>
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

              <label class="inline-flex w-fit cursor-pointer items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                <tas-icon iconName="feather:paperclip" iconClass="!size-3.5"></tas-icon> Joindre des fichiers
                <input type="file" multiple class="sr-only" (change)="addFiles($any($event.target))" />
              </label>
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
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="primary" type="button"
                [disabled]="formSchema().invalid() || formSchema().submitting() || !!attachmentError() || accountOptions().length === 0"
                [isLoading]="formSchema().submitting()" (click)="send()">
          <tas-icon iconName="feather:send"></tas-icon> Envoyer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class MailComposeDrawer implements OnInit {
  public readonly data: MailComposeDrawerData = inject(DIALOG_DATA) ?? {};

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _accountsApi = inject(ConnectedAccountsApiService);
  private readonly _mailApi = inject(ConnectedMailboxApiService);
  private readonly _templatesApi = inject(MailTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly quillModules = QUILL_MODULES;
  public readonly mode: MailComposeMode = this.data.mode ?? 'new';

  public readonly loadingAccounts = signal(true);
  public readonly accounts = signal<ConnectedAccountDto[]>([]);
  public readonly templates = signal<MailTemplateDto[]>([]);
  public readonly applying = signal(false);
  public readonly missing = signal<string[]>([]);
  public readonly files = signal<File[]>([]);
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

  public readonly templateOptions = computed(() => this.templates().map((t) => ({ label: t.name ?? '', value: t.id ?? '' })));

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

  ngOnInit(): void {
    this.forwardIds.set(new Set(this.forwardable().map((a) => a.id!)));
    if (this.model().cc) this.showCopies.set(true);

    this._accountsApi.listMyConnectedAccounts().pipe(catchError(() => of({ accounts: [] }))).subscribe((result) => {
      this.accounts.set(result.accounts ?? []);
      this.loadingAccounts.set(false);

      // La boîte demandée, celle du message source, sinon la première qui peut envoyer.
      const wanted = this.data.accountId ?? this.data.source?.accountId;
      const options = this.accountOptions();
      const chosen = options.find((o) => o.value === wanted)?.value ?? options[0]?.value ?? '';
      this.model.update((m) => ({ ...m, accountId: chosen }));
    });

    this._templatesApi.listMailTemplates(false).pipe(catchError(() => of([]))).subscribe((list) => this.templates.set(list ?? []));
  }

  /** Remplace le texte (et l'objet, hors réponse) par le modèle rempli pour ce destinataire ; la citation d'origine reste dessous. */
  public async applyTemplate(): Promise<void> {
    const id = this.model().templateId;
    if (!id) return;
    this.applying.set(true);

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

    this.applying.set(false);
    if (!rendered) return;

    this.missing.set(rendered.missing ?? []);
    // Une réponse garde son objet « RE: … » : les messageries regroupent aussi par objet, et celui du
    // modèle sortirait la réponse de sa conversation chez le destinataire.
    this.model.update((m) => ({
      ...m,
      subject: this.isReply() ? m.subject : rendered.subject ?? m.subject,
      body: (rendered.body ?? '') + this._quote(),
    }));
  }

  public addFiles(input: HTMLInputElement): void {
    const added = Array.from(input.files ?? []);
    this.files.update((list) => [...list, ...added]);
    input.value = '';
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

  public send(): void {
    this.submitError.set(null);

    submit(this.formSchema, async () => {
      const m = this.model();
      const forwarded = this.forwardable().filter((a) => this.forwardIds().has(a.id!)).map((a) => a.id!);

      // `map(() => true)` : la route répond 202 sans corps, le client généré émet `null`.
      const sent = await firstValueFrom(
        this._mailApi
          .sendMail(
            m.accountId,
            splitAddresses(m.to),
            splitAddresses(m.cc),
            splitAddresses(m.bcc),
            m.subject.trim(),
            m.body,
            this.isReply() ? this.data.source?.id ?? undefined : undefined,
            this.mode === 'forward' ? this.data.source?.id ?? undefined : undefined,
            forwarded,
            this.files(),
            this.data.client?.id,
          )
          .pipe(
            map(() => true),
            catchError((err: HttpErrorResponse) => {
              this.submitError.set(sendError(err));
              return of(false);
            }),
          ),
      );

      if (!sent) return;
      this._snackbar.success('E-mail envoyé', 'Il apparaîtra dans la conversation dans quelques instants s’il concerne un lead ou un client.');
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _initialModel(): ComposeFormModel {
    const source = this.data.source;
    const mode = this.data.mode ?? 'new';
    const subject = source?.subject ?? this.data.subject ?? '';

    let to = (this.data.to ?? []).join(', ');
    let cc = '';

    if (source && (mode === 'reply' || mode === 'replyAll')) {
      // Répondre à son propre message envoyé, c'est écrire à nouveau à ses destinataires.
      to = source.direction === 'Sent' ? addressesOf(source.to).join(', ') : source.from?.address ?? '';
      if (mode === 'replyAll') {
        const own = (source.direction === 'Sent' ? source.from?.address : undefined)?.toLowerCase();
        const others = [...addressesOf(source.to), ...addressesOf(source.cc)].filter(
          (a) => a.toLowerCase() !== own && !splitAddresses(to).some((t) => t.toLowerCase() === a.toLowerCase()),
        );
        cc = others.join(', ');
      }
    }

    return Object.assign(new ComposeFormModel(), {
      accountId: '',
      to,
      cc,
      bcc: '',
      subject: !source ? subject : mode === 'forward' ? prefixed('TR', subject) : prefixed('RE', subject),
      body: this._quote(),
      templateId: '',
    });
  }

  /** La citation du message d'origine, sous le texte : en texte simple, l'éditeur ne garderait pas sa mise en page. */
  private _quote(): string {
    const source = this.data.source;
    if (!source) return '';

    const text = escape(source.bodyIsHtml ? htmlToText(source.body ?? '') : source.body ?? '').replace(/\n/g, '<br>');
    const when = source.sentAt ? new Date(source.sentAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const who = escape(source.from?.name ? `${source.from.name} <${source.from.address}>` : source.from?.address ?? '');

    const header = this.mode === 'forward'
      ? `<p>---------- Message transféré ----------<br>De : ${who}<br>Date : ${when}<br>Objet : ${escape(source.subject ?? '')}<br>À : ${escape(addressesOf(source.to).join(', '))}</p>`
      : `<p>Le ${when}, ${who} a écrit :</p>`;

    return `<p><br></p>${header}<blockquote>${text}</blockquote>`;
  }
}

function prefixed(prefix: 'RE' | 'TR', subject: string): string {
  return new RegExp(`^\\s*${prefix}\\s*:`, 'i').test(subject) ? subject : `${prefix}: ${subject}`;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
