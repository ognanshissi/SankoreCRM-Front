import { Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasInput } from '@talisoft/ui/input';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  LeadsApiService,
  ConsentDto,
  RecordConsentRequestTypeEnum,
  RecordConsentRequestChannelEnum,
} from '@sankore/crm-api';

const TYPE_OPTIONS = [
  { label: 'Marketing',              value: RecordConsentRequestTypeEnum.Marketing },
  { label: 'Traitement des données', value: RecordConsentRequestTypeEnum.DataProcessing },
  { label: 'Contact e-mail',         value: RecordConsentRequestTypeEnum.EmailContact },
  { label: 'Contact SMS',            value: RecordConsentRequestTypeEnum.SmsContact },
  { label: 'Contact téléphonique',   value: RecordConsentRequestTypeEnum.PhoneContact },
  { label: 'Partage tiers',          value: RecordConsentRequestTypeEnum.ThirdPartySharing },
  { label: 'Profilage & analytique', value: RecordConsentRequestTypeEnum.ProfilingAndAnalytics },
  { label: 'Géolocalisation',        value: RecordConsentRequestTypeEnum.LocationTracking },
];

const CHANNEL_OPTIONS = [
  { label: 'Formulaire web', value: RecordConsentRequestChannelEnum.WebForm },
  { label: 'E-mail',         value: RecordConsentRequestChannelEnum.Email },
  { label: 'SMS',            value: RecordConsentRequestChannelEnum.Sms },
  { label: 'Téléphone',      value: RecordConsentRequestChannelEnum.Phone },
  { label: 'En personne',    value: RecordConsentRequestChannelEnum.InPerson },
  { label: 'Papier',         value: RecordConsentRequestChannelEnum.Paper },
  { label: 'Autre',          value: RecordConsentRequestChannelEnum.Other },
];

function statusInfo(c: ConsentDto): { label: string; severity: Severity } {
  if (c.withdrawnAt) return { label: 'Retiré', severity: 'error' };
  if (c.status === 'Granted') return { label: 'Accordé', severity: 'success' };
  return { label: c.status ?? '—', severity: 'neutral' };
}

@Component({
  selector: 'lead-consentement',
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasSelect, TasInput, TimeagoPipe,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">
        <!-- Record form -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="font-semibold text-slate-800">Enregistrer un consentement</p>
          </div>
          <div class="p-4">
            <div class="grid grid-cols-3 gap-3">
              <tas-form-field>
                <tas-label>Type <span class="text-red-500">*</span></tas-label>
                <tas-select [options]="typeOptions" optionLabel="label" optionValue="value"
                  placeholder="Sélectionnez" [ngModel]="newType()" (ngModelChange)="newType.set($event)"></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Canal <span class="text-red-500">*</span></tas-label>
                <tas-select [options]="channelOptions" optionLabel="label" optionValue="value"
                  placeholder="Sélectionnez" [ngModel]="newChannel()" (ngModelChange)="newChannel.set($event)"></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Référence preuve</tas-label>
                <input tasInput type="text" placeholder="Ex : form-web-2024"
                  [ngModel]="newProof()" (ngModelChange)="newProof.set($event)" />
              </tas-form-field>
            </div>
            <div class="mt-3 flex justify-end">
              <button tas-button color="primary" type="button" class="text-xs"
                [disabled]="isSaving() || !newType() || !newChannel()" (click)="record()">
                @if (isSaving()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
                Enregistrer
              </button>
            </div>
          </div>
        </tas-card>

        <!-- List -->
        <tas-card>
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="font-semibold text-slate-800">Consentements</p>
            @if (consents().length > 0) {
              <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium tabular-nums">{{ consents().length }}</span>
            }
          </div>
          @if (consents().length === 0) {
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <tas-icon iconName="feather:shield" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-400">Aucun consentement enregistré</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (c of consents(); track c.id) {
                <div class="p-4 flex items-start gap-3">
                  <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    [class]="c.withdrawnAt ? 'bg-red-100 text-red-500' : 'bg-green-100 text-green-600'">
                    <tas-icon [iconName]="c.withdrawnAt ? 'feather:shield-off' : 'feather:shield'" style="font-size:14px"></tas-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-0.5">
                      <p class="text-sm font-medium text-slate-800">{{ c.type }}</p>
                      <tas-tag [severity]="statusInfo(c).severity">{{ statusInfo(c).label }}</tas-tag>
                    </div>
                    <div class="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      @if (c.channel) { <span>{{ c.channel }}</span> }
                      @if (c.grantedAt) { <span>{{ c.grantedAt | dateTimeAgo }}</span> }
                      @if (c.proofReference) { <span>Réf : {{ c.proofReference }}</span> }
                    </div>
                    @if (c.withdrawnAt) {
                      <p class="text-xs text-red-500 mt-1">Retiré {{ c.withdrawnAt | dateTimeAgo }}@if (c.withdrawalReason) { — {{ c.withdrawalReason }}}</p>
                    }
                  </div>
                  @if (!c.withdrawnAt && c.status === 'Granted') {
                    <button type="button" class="text-slate-400 hover:text-red-500 transition-colors shrink-0" (click)="withdraw(c)">
                      <tas-icon iconName="feather:x-circle" style="font-size:16px"></tas-icon>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </tas-card>
      </div>
    }
  `,
})
export class LeadConsentementPage {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  public readonly id = input.required<string>();
  public readonly typeOptions = TYPE_OPTIONS;
  public readonly channelOptions = CHANNEL_OPTIONS;
  public readonly statusInfo = statusInfo;

  public isLoading = signal(true);
  public isSaving = signal(false);
  public consents = signal<ConsentDto[]>([]);
  public newType = signal('');
  public newChannel = signal('');
  public newProof = signal('');

  constructor() { effect(() => this._load()); }

  public record(): void {
    if (!this.newType() || !this.newChannel()) return;
    this.isSaving.set(true);
    this._leadsApi.recordConsent(this.id(), {
      type: this.newType() as any, channel: this.newChannel() as any,
      proofReference: this.newProof() || null,
    }).pipe(catchError(() => { this._snackbar.error('Erreur', 'Enregistrement échoué.'); return EMPTY; }))
      .subscribe(() => {
        this._snackbar.success('Enregistré', 'Consentement ajouté.');
        this.newType.set(''); this.newChannel.set(''); this.newProof.set('');
        this.isSaving.set(false); this._load();
      });
  }

  public withdraw(c: ConsentDto): void {
    this._confirmDialog.confirm({
      title: 'Retirer ce consentement ?',
      message: `Le consentement « ${c.type} » sera marqué comme retiré.`,
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._leadsApi.withdrawConsent(this.id(), c.id!, { reason: 'Retrait par agent' }).pipe(
          catchError(() => { this._snackbar.error('Erreur', 'Retrait échoué.'); return EMPTY; }),
        ).subscribe(() => { this._snackbar.success('Retiré', 'Consentement retiré.'); this._load(); });
      },
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._leadsApi.listConsents(this.id()).pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((c) => { this.consents.set(c ?? []); this.isLoading.set(false); });
  }
}

export default LeadConsentementPage;
