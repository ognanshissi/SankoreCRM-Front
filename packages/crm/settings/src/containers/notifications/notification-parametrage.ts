import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { NotificationSettingsApiService, NotificationSettingsDto } from '@sankore/crm-api';

const EMAIL_PROVIDER_OPTIONS = [
  { label: 'Plateforme (défaut)', value: 'Platform' },
  { label: 'SMTP', value: 'Smtp' },
  { label: 'SendGrid', value: 'SendGrid' },
  { label: 'Mailgun', value: 'Mailgun' },
  { label: 'Amazon SES', value: 'AmazonSes' },
];

const SMS_PROVIDER_OPTIONS = [
  { label: 'Twilio', value: 'Twilio' },
  { label: 'Vonage (Nexmo)', value: 'Vonage' },
  { label: 'Infobip', value: 'Infobip' },
  { label: 'Orange SMS API', value: 'OrangeSms' },
];

@Component({
  selector: 'notification-parametrage',
  imports: [
    FormsModule, DecimalPipe, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasSwitch, TasFormField, TasLabel, TasInput, TasSelect,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">
        <!-- Save button -->
        <div class="flex justify-end">
          <button tas-raised-button color="primary" type="button" [disabled]="isSaving()" (click)="save()">
            @if (isSaving()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
            <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
            Enregistrer
          </button>
        </div>

        <!-- Email provider -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:mail" class="text-indigo-500" style="font-size:14px"></tas-icon>
              Fournisseur e-mail
            </p>
          </div>
          <div class="p-4 flex flex-col gap-3">
            <tas-form-field>
              <tas-label>Type de fournisseur</tas-label>
              <tas-select [options]="emailProviderOptions" optionLabel="label" optionValue="value"
                placeholder="Sélectionnez" [ngModel]="providerType()" (ngModelChange)="providerType.set($event)"></tas-select>
            </tas-form-field>
            <div class="flex items-center gap-3">
              <tas-switch [checked]="useDefault()" ariaLabel="Utiliser le fournisseur par défaut"
                (toggle)="useDefault.set($event)"></tas-switch>
              <span class="text-sm text-slate-600">Utiliser le fournisseur plateforme par défaut</span>
            </div>
            @if (!useDefault()) {
              <div class="grid grid-cols-2 gap-3">
                <tas-form-field>
                  <tas-label>Domaine d'envoi</tas-label>
                  <input tasInput type="text" placeholder="Ex : mail.monentreprise.com"
                    [ngModel]="sendingDomain()" (ngModelChange)="sendingDomain.set($event)" />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Référence credentials (vault)</tas-label>
                  <input tasInput type="text" placeholder="Ex : smtp/prod-credentials"
                    [ngModel]="credentialPath()" (ngModelChange)="credentialPath.set($event)" />
                </tas-form-field>
              </div>
            }
          </div>
        </tas-card>

        <!-- Email sender -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:at-sign" class="text-slate-400" style="font-size:14px"></tas-icon>
              Expéditeur e-mail
            </p>
          </div>
          <div class="p-4 grid grid-cols-3 gap-3">
            <tas-form-field>
              <tas-label>E-mail d'envoi</tas-label>
              <input tasInput type="email" placeholder="noreply@monentreprise.com"
                [ngModel]="fromEmail()" (ngModelChange)="fromEmail.set($event)" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Nom affiché</tas-label>
              <input tasInput type="text" placeholder="Mon Entreprise"
                [ngModel]="fromName()" (ngModelChange)="fromName.set($event)" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Reply-to</tas-label>
              <input tasInput type="email" placeholder="support@monentreprise.com"
                [ngModel]="replyToEmail()" (ngModelChange)="replyToEmail.set($event)" />
            </tas-form-field>
          </div>
        </tas-card>

        <!-- Quota -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:bar-chart" class="text-slate-400" style="font-size:14px"></tas-icon>
              Quota mensuel d'envoi
            </p>
          </div>
          <div class="p-4">
            <div class="flex items-end gap-4 mb-3">
              <tas-form-field>
                <tas-label>Limite mensuelle</tas-label>
                <input tasInput type="number" min="0" placeholder="10000"
                  [ngModel]="quotaLimit()" (ngModelChange)="quotaLimit.set($event)" />
              </tas-form-field>
              <button tas-outlined-button color="primary" type="button" class="text-xs mb-1"
                [disabled]="isSavingQuota()" (click)="saveQuota()">
                @if (isSavingQuota()) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
                Mettre à jour
              </button>
            </div>
            @if (quotaLimit()) {
              <div class="flex items-center gap-3">
                <div class="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div class="h-full rounded-full transition-all"
                    [class]="quotaPercent() >= 90 ? 'bg-red-500' : quotaPercent() >= 70 ? 'bg-amber-500' : 'bg-green-500'"
                    [style.width.%]="quotaPercent()"></div>
                </div>
                <span class="text-xs text-slate-500 tabular-nums shrink-0">
                  {{ currentUsage() | number:'1.0-0' }} / {{ quotaLimit() | number:'1.0-0' }}
                </span>
                <span class="text-xs font-semibold tabular-nums"
                  [class]="quotaPercent() >= 90 ? 'text-red-600' : quotaPercent() >= 70 ? 'text-amber-600' : 'text-green-600'">
                  {{ quotaPercent().toFixed(1) }}%
                </span>
              </div>
            }
          </div>
        </tas-card>

        <!-- SMS provider (coming soon — no backend) -->
        <tas-card>
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:message-square" class="text-teal-500" style="font-size:14px"></tas-icon>
              Fournisseur SMS
            </p>
            <tas-tag severity="warning">À venir</tas-tag>
          </div>
          <div class="p-4">
            <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2 mb-4">
              <tas-icon iconName="feather:info" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
              <p class="text-xs text-amber-700">
                La configuration SMS sera disponible dans une prochaine version. Les champs ci-dessous sont en aperçu.
              </p>
            </div>
            <div class="grid grid-cols-3 gap-3 opacity-50">
              <tas-form-field>
                <tas-label>Fournisseur SMS</tas-label>
                <tas-select [options]="smsProviderOptions" optionLabel="label" optionValue="value"
                  placeholder="Sélectionnez" [ngModel]="smsProvider()" (ngModelChange)="smsProvider.set($event)"
                  [disabled]="true"></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Sender ID</tas-label>
                <input tasInput type="text" placeholder="Ex : SANKORE" disabled
                  [ngModel]="smsSenderId()" (ngModelChange)="smsSenderId.set($event)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Clé API</tas-label>
                <input tasInput type="password" placeholder="••••••••" disabled
                  [ngModel]="smsApiKey()" (ngModelChange)="smsApiKey.set($event)" />
              </tas-form-field>
            </div>
          </div>
        </tas-card>

        @if (settings()?.updatedAt) {
          <p class="text-xs text-slate-400 text-right">Dernière mise à jour : {{ settings()!.updatedAt }}</p>
        }
      </div>
    }
  `,
})
export class NotificationParametrage implements OnInit {
  private readonly _api = inject(NotificationSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly emailProviderOptions = EMAIL_PROVIDER_OPTIONS;
  public readonly smsProviderOptions = SMS_PROVIDER_OPTIONS;

  public isLoading = signal(true);
  public isSaving = signal(false);
  public isSavingQuota = signal(false);
  public settings = signal<NotificationSettingsDto | null>(null);

  // Email provider
  public providerType = signal('');
  public useDefault = signal(true);
  public sendingDomain = signal('');
  public credentialPath = signal('');

  // Sender
  public fromEmail = signal('');
  public fromName = signal('');
  public replyToEmail = signal('');

  // Quota
  public quotaLimit = signal<number | null>(null);
  public currentUsage = signal(0);
  public readonly quotaPercent = computed(() => {
    const limit = this.quotaLimit();
    if (!limit || limit === 0) return 0;
    return (this.currentUsage() / limit) * 100;
  });

  // SMS (frontend-only — no backend yet)
  public smsProvider = signal('');
  public smsSenderId = signal('');
  public smsApiKey = signal('');

  ngOnInit(): void { this._load(); }

  public save(): void {
    this.isSaving.set(true);
    this._api.updateNotificationSettings({
      providerType: this.providerType() || null,
      fromEmail: this.fromEmail() || null,
      fromName: this.fromName() || null,
      replyToEmail: this.replyToEmail() || null,
      sendingDomain: this.sendingDomain() || null,
      credentialVaultPath: this.credentialPath() || null,
    }).pipe(catchError(() => { this._snackbar.error('Erreur', 'Sauvegarde échouée.'); this.isSaving.set(false); return EMPTY; }))
      .subscribe(() => { this._snackbar.success('Enregistré', 'Configuration mise à jour.'); this.isSaving.set(false); });
  }

  public saveQuota(): void {
    this.isSavingQuota.set(true);
    this._api.setMonthlyEmailQuota({ monthlyQuotaLimit: this.quotaLimit() }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Quota non mis à jour.'); this.isSavingQuota.set(false); return EMPTY; }),
    ).subscribe(() => { this._snackbar.success('Quota mis à jour', `Limite : ${this.quotaLimit()}.`); this.isSavingQuota.set(false); });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._api.getNotificationSettings().pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((s: NotificationSettingsDto) => {
        this.settings.set(s);
        this.providerType.set(s.providerType ?? '');
        this.useDefault.set(s.useDefaultPlatformProvider ?? true);
        this.sendingDomain.set(s.sendingDomain ?? '');
        this.credentialPath.set(s.credentialVaultPathRef ?? '');
        this.fromEmail.set(s.fromEmail ?? '');
        this.fromName.set(s.fromName ?? '');
        this.replyToEmail.set(s.replyToEmail ?? '');
        this.quotaLimit.set(s.monthlyQuotaLimit ?? null);
        this.currentUsage.set(s.currentMonthUsageCount ?? 0);
        this.isLoading.set(false);
      });
  }
}

export default NotificationParametrage;
