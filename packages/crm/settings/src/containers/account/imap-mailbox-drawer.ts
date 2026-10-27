import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { email, form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { ConnectedAccountDto, ConnectedAccountsApiService, ImapMailboxRequest, MailServerTestResult } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { MAIL_PRESETS, MailPreset, MAILBOX_ERRORS, mailboxErrorMessage } from './connected-mailbox.labels';

export interface ImapMailboxDrawerData {
  /** La boîte à modifier, ou rien pour en connecter une. */
  account: ConnectedAccountDto | null;
}

const SECURITY_OPTIONS = [
  { label: 'SSL / TLS', value: 'Ssl' },
  { label: 'STARTTLS', value: 'StartTls' },
];

const IMAP_PORTS = [{ label: '993', value: '993' }, { label: '143', value: '143' }];
const SMTP_PORTS = ['465', '587', '25', '2525'].map((p) => ({ label: p, value: p }));
/** Pas une chaîne vide : `tas-select` la prend pour « rien de choisi » et affiche son invite. */
const OTHER = 'other';

/** Ports en chaînes : `tas-select` travaille en chaînes, la conversion se fait à l'envoi. */
class ImapMailboxFormModel {
  public email!: string;
  public displayName!: string;
  public label!: string;
  public preset!: string;
  public imapHost!: string;
  public imapPort!: string;
  public imapSecurity!: string;
  public smtpHost!: string;
  public smtpPort!: string;
  public smtpSecurity!: string;
  public username!: string;
  public password!: string;

  public static instantiate(account: ConnectedAccountDto | null): ImapMailboxFormModel {
    const server = account?.mailServer;
    return Object.assign(new ImapMailboxFormModel(), {
      email: account?.email ?? '',
      displayName: account?.displayName ?? '',
      label: account?.label ?? '',
      preset: OTHER,
      imapHost: server?.imapHost ?? '',
      imapPort: String(server?.imapPort ?? 993),
      imapSecurity: server?.imapSecurity ?? 'Ssl',
      smtpHost: server?.smtpHost ?? '',
      smtpPort: String(server?.smtpPort ?? 465),
      smtpSecurity: server?.smtpSecurity ?? 'Ssl',
      // Le mot de passe stocké n'est jamais renvoyé : vide = garder celui du coffre (modification).
      username: server?.username ?? '',
      password: '',
    });
  }
}

/**
 * Connecter (ou modifier) une boîte IMAP/SMTP — messagerie connectée, lot 4. Le serveur essaie les
 * DEUX serveurs avant d'enregistrer ; « Tester la connexion » fait le même essai sans rien
 * enregistrer, pour corriger un réglage sans perdre le formulaire.
 */
@Component({
  selector: 'imap-mailbox-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField, FormRoot, Button, TasError, TasHint, TasLabel, TasFormField, TasIcon, TasInput, TasInputPassword, TasSelect,
    TasTitle, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>{{ data.account ? 'Modifier la boîte mail' : 'Connecter une boîte mail (IMAP)' }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <p class="mb-4 text-xs text-slate-500">
          Pour une messagerie autre que Microsoft ou Google : celle de votre hébergeur ou de votre domaine. Le mot de passe est
          conservé chiffré dans le coffre ; seuls les e-mails échangés avec vos leads et clients sont gardés, et vous seul les lisez.
        </p>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <section class="flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Adresse e-mail <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="email" autocomplete="off" [formField]="formSchema.email" (blur)="suggestPreset()" />
              @if (formSchema.email().touched() && formSchema.email().invalid()) {
                <tas-error>{{ formSchema.email().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <tas-form-field>
                <tas-label>Nom affiché aux destinataires</tas-label>
                <input tasInput type="text" placeholder="Ex. Awa Koné — Agence Plateau" [formField]="formSchema.displayName" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Nom de la boîte dans SANKORÉ</tas-label>
                <input tasInput type="text" placeholder="Ex. Cabinet" [formField]="formSchema.label" />
              </tas-form-field>
            </div>
          </section>

          <section class="flex flex-col gap-4 border-t border-slate-100 pt-4">
            <tas-form-field>
              <tas-label>Fournisseur</tas-label>
              <tas-select [options]="presetOptions" [formField]="formSchema.preset"></tas-select>
              @if (presetHint()) {
                <tas-hint>{{ presetHint() }}</tas-hint>
              } @else {
                <tas-hint>Pour Outlook ou Microsoft 365, utilisez plutôt le bouton « Microsoft » : il ne demande pas de mot de passe.</tas-hint>
              }
            </tas-form-field>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
              <tas-form-field>
                <tas-label>Serveur de réception (IMAP) <span class="text-functional-error">*</span></tas-label>
                <input tasInput type="text" placeholder="imap.exemple.com" autocomplete="off" [formField]="formSchema.imapHost" />
                @if (formSchema.imapHost().touched() && formSchema.imapHost().invalid()) {
                  <tas-error>{{ formSchema.imapHost().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
              <tas-form-field>
                <tas-label>Port</tas-label>
                <tas-select [options]="imapPorts" [formField]="formSchema.imapPort"></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Sécurité</tas-label>
                <tas-select [options]="securityOptions" [formField]="formSchema.imapSecurity"></tas-select>
              </tas-form-field>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
              <tas-form-field>
                <tas-label>Serveur d’envoi (SMTP) <span class="text-functional-error">*</span></tas-label>
                <input tasInput type="text" placeholder="smtp.exemple.com" autocomplete="off" [formField]="formSchema.smtpHost" />
                @if (formSchema.smtpHost().touched() && formSchema.smtpHost().invalid()) {
                  <tas-error>{{ formSchema.smtpHost().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
              <tas-form-field>
                <tas-label>Port</tas-label>
                <tas-select [options]="smtpPorts" [formField]="formSchema.smtpPort"></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Sécurité</tas-label>
                <tas-select [options]="securityOptions" [formField]="formSchema.smtpSecurity"></tas-select>
              </tas-form-field>
            </div>
          </section>

          <section class="flex flex-col gap-4 border-t border-slate-100 pt-4">
            <tas-form-field>
              <tas-label>Identifiant</tas-label>
              <input tasInput type="text" autocomplete="off" [placeholder]="formSchema.email().value() || 'Votre adresse, le plus souvent'" [formField]="formSchema.username" />
              <tas-hint>Laissé vide : l’adresse e-mail.</tas-hint>
            </tas-form-field>

            <tas-input-password [formField]="formSchema.password">
              Mot de passe @if (!data.account) { <span class="text-functional-error">*</span> }
            </tas-input-password>
            @if (formSchema.password().touched() && formSchema.password().invalid()) {
              <tas-error>{{ formSchema.password().errors()[0].message }}</tas-error>
            } @else if (data.account) {
              <tas-hint>Laissé vide : le mot de passe enregistré est conservé.</tas-hint>
            }
          </section>

          @if (testResult(); as r) {
            <div class="flex items-start gap-2 rounded-lg px-3 py-2 text-sm" role="status"
                 [class]="r.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'">
              <tas-icon [iconName]="r.ok ? 'feather:check-circle' : 'feather:alert-circle'" iconClass="!size-4" class="mt-0.5 shrink-0"></tas-icon>
              <span>{{ r.ok ? 'Les deux serveurs ont accepté la connexion.' : testMessage(r) }}</span>
            </div>
          }

          @if (submitError()) {
            <p class="text-xs text-functional-error" role="alert">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button tas-outlined-button color="primary" type="button" [disabled]="formSchema().invalid() || testing() || formSchema().submitting()"
                [isLoading]="testing()" (click)="test()">
          <tas-icon iconName="feather:zap"></tas-icon> Tester la connexion
        </button>
        <button tas-raised-button color="primary" type="button" [disabled]="formSchema().invalid() || testing() || formSchema().submitting()"
                [isLoading]="formSchema().submitting()" (click)="handleSubmit()">
          <tas-icon iconName="feather:link"></tas-icon> {{ data.account ? 'Enregistrer' : 'Connecter' }}
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ImapMailboxDrawer {
  public readonly data: ImapMailboxDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<ConnectedAccountDto | null>);
  private readonly _api = inject(ConnectedAccountsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly securityOptions = SECURITY_OPTIONS;
  public readonly imapPorts = IMAP_PORTS;
  public readonly smtpPorts = SMTP_PORTS;
  public readonly presetOptions = [{ label: 'Autre (saisie manuelle)', value: OTHER }, ...MAIL_PRESETS.map((p) => ({ label: p.label, value: p.value }))];

  public readonly testing = signal(false);
  public readonly testResult = signal<MailServerTestResult | null>(null);
  public readonly submitError = signal<string | null>(null);
  public readonly presetHint = signal<string | null>(null);

  public model = signal(ImapMailboxFormModel.instantiate(this.data.account));

  public formSchema = form(this.model, (schema) => {
    required(schema.email, { message: 'L’adresse est obligatoire' });
    email(schema.email, { message: 'Adresse e-mail invalide' });
    required(schema.imapHost, { message: 'Le serveur IMAP est obligatoire' });
    required(schema.smtpHost, { message: 'Le serveur SMTP est obligatoire' });
    // Obligatoire pour connecter ; en modification, vide garde celui du coffre.
    validate(schema.password, (ctx) =>
      !this.data.account && !ctx.value() ? { kind: 'required', message: 'Le mot de passe est obligatoire' } : null,
    );
  });

  constructor() {
    // Choisir un fournisseur remplit ses serveurs ; « Autre » laisse la saisie telle quelle.
    effect(() => {
      const preset = this.formSchema.preset().value();
      untracked(() => this.applyPreset(preset));
    });
  }

  /** Le domaine de l'adresse désigne un fournisseur connu : ses réglages sont proposés, sans écraser une saisie. */
  public suggestPreset(): void {
    const domain = this.model().email.split('@')[1]?.trim().toLowerCase();
    const preset = MAIL_PRESETS.find((p) => domain && p.domains.includes(domain));
    if (preset && !this.model().imapHost && !this.model().smtpHost) this.applyPreset(preset.value);
  }

  public applyPreset(value: string): void {
    const preset: MailPreset | undefined = MAIL_PRESETS.find((p) => p.value === value);
    this.presetHint.set(preset?.hint ?? null);
    if (!preset) return;

    this.model.update((m) => ({
      ...m,
      preset: preset.value,
      imapHost: preset.imapHost,
      imapPort: String(preset.imapPort),
      imapSecurity: preset.imapSecurity,
      smtpHost: preset.smtpHost,
      smtpPort: String(preset.smtpPort),
      smtpSecurity: preset.smtpSecurity,
    }));
    this.testResult.set(null);
  }

  public testMessage(result: MailServerTestResult): string {
    return (result.code && MAILBOX_ERRORS[result.code]) || 'La connexion a échoué.';
  }

  public async test(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    this.submitError.set(null);

    const result = await firstValueFrom(
      this._api.testImapMailbox(this._request(), this.data.account?.id ?? undefined).pipe(
        catchError((err: HttpErrorResponse) => {
          this.submitError.set(mailboxErrorMessage(err, 'Le test n’a pas pu être lancé.'));
          return EMPTY;
        }),
      ),
      { defaultValue: null },
    );

    this.testResult.set(result);
    this.testing.set(false);
  }

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async () => {
      const request = this._request();
      const call = this.data.account ? this._api.updateImapMailbox(this.data.account.id!, request) : this._api.connectImapMailbox(request);

      const saved = await firstValueFrom(
        call.pipe(
          catchError((err: HttpErrorResponse) => {
            this.submitError.set(mailboxErrorMessage(err, 'La boîte n’a pas pu être enregistrée.'));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success(
        this.data.account ? 'Boîte mise à jour' : 'Boîte connectée',
        'Les e-mails échangés avec vos leads et clients des 30 derniers jours sont lus dans quelques instants.',
      );
      this._dialogRef.close(saved);
    });
  }

  public close(): void {
    this._dialogRef.close(null);
  }

  private _request(): ImapMailboxRequest {
    const m = this.model();
    const address = m.email.trim();
    return {
      email: address,
      displayName: m.displayName.trim() || null,
      label: m.label.trim() || null,
      imapHost: m.imapHost.trim(),
      imapPort: Number(m.imapPort),
      imapSecurity: m.imapSecurity,
      smtpHost: m.smtpHost.trim(),
      smtpPort: Number(m.smtpPort),
      smtpSecurity: m.smtpSecurity,
      username: m.username.trim() || address,
      password: m.password || null,
    };
  }
}
