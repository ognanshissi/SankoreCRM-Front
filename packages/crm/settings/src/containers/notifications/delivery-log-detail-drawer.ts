import { Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';

export interface DeliveryLogDetailData {
  log: any;
}

@Component({
  selector: 'delivery-log-detail-drawer',
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasIcon, TasTag, Button, TimeagoPipe, TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Détail de l'envoi</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Status banner -->
        <div class="mb-4 p-3 rounded-lg flex items-center gap-3"
          [class]="statusBannerClass(data.log.status)">
          <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            [class]="statusCircleClass(data.log.status)">
            <tas-icon [iconName]="statusIcon(data.log.status)" style="font-size:18px"></tas-icon>
          </div>
          <div>
            <p class="text-sm font-semibold" [class]="statusTextClass(data.log.status)">{{ statusLabel(data.log.status) }}</p>
            <p class="text-xs opacity-70" [class]="statusTextClass(data.log.status)">{{ data.log.sentAt | dateTimeAgo }}</p>
          </div>
        </div>

        <!-- Recipient -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div class="flex items-center gap-2">
            <tas-icon iconName="feather:mail" class="text-slate-400" style="font-size:14px"></tas-icon>
            <p class="text-sm font-medium text-slate-800">{{ data.log.recipientEmail ?? '—' }}</p>
          </div>
          @if (data.log.subject) {
            <p class="text-xs text-slate-500 mt-1.5">Sujet : <span class="font-medium text-slate-700">{{ data.log.subject }}</span></p>
          }
        </div>

        <!-- Detail grid -->
        <div class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-3">
            <div class="p-3 rounded-lg border border-slate-200">
              <p class="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Type d'événement</p>
              <tas-tag severity="info">{{ data.log.eventType ?? '—' }}</tas-tag>
            </div>
            <div class="p-3 rounded-lg border border-slate-200">
              <p class="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Statut</p>
              <tas-tag [severity]="statusSeverity(data.log.status)">{{ data.log.status ?? '—' }}</tas-tag>
            </div>
          </div>

          <!-- Template key -->
          @if (data.log.templateKey) {
            <div class="p-3 rounded-lg border border-slate-200 flex items-center gap-2">
              <tas-icon iconName="feather:file-text" class="text-slate-400" style="font-size:14px"></tas-icon>
              <div>
                <p class="text-[10px] text-slate-400 uppercase tracking-wider">Modèle utilisé</p>
                <p class="text-xs font-mono font-medium text-slate-700">{{ data.log.templateKey }}</p>
              </div>
            </div>
          }

          <!-- Email preview -->
          @if (data.log.htmlBody) {
            <div class="rounded-lg border border-slate-200 overflow-hidden">
              <div class="px-3 py-2 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <p class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Aperçu de l'e-mail</p>
                <button type="button" class="text-[10px] text-primary hover:underline"
                  (click)="showPreview.set(!showPreview())">
                  {{ showPreview() ? 'Masquer' : 'Afficher' }}
                </button>
              </div>
              @if (showPreview()) {
                <div class="bg-white">
                  <iframe
                    [srcdoc]="data.log.htmlBody"
                    sandbox=""
                    class="w-full border-0"
                    style="height: 400px;"
                    title="Aperçu de l'e-mail envoyé"
                  ></iframe>
                </div>
              }
            </div>
          } @else if (data.log.textBody) {
            <div class="rounded-lg border border-slate-200 overflow-hidden">
              <div class="px-3 py-2 border-b border-slate-200 bg-slate-50">
                <p class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Contenu texte</p>
              </div>
              <div class="p-3 bg-white">
                <pre class="text-xs text-slate-700 whitespace-pre-wrap font-mono">{{ data.log.textBody }}</pre>
              </div>
            </div>
          }

          @if (data.log.outboxMessageId || data.log.providerMessageId) {
            <div class="p-3 rounded-lg border border-slate-200">
              <p class="text-[10px] text-slate-400 uppercase tracking-wider mb-2">Identifiants</p>
              @if (data.log.outboxMessageId) {
                <div class="flex items-start gap-2 mb-1.5">
                  <span class="text-[10px] text-slate-400 shrink-0 w-20">Message ID</span>
                  <span class="text-[10px] text-slate-700 font-mono break-all">{{ data.log.outboxMessageId }}</span>
                </div>
              }
              @if (data.log.providerMessageId) {
                <div class="flex items-start gap-2">
                  <span class="text-[10px] text-slate-400 shrink-0 w-20">Provider ID</span>
                  <span class="text-[10px] text-slate-700 font-mono break-all">{{ data.log.providerMessageId }}</span>
                </div>
              }
            </div>
          }

          <!-- Tracking timeline -->
          @if (data.log.deliveredAt || data.log.openedAt || data.log.clickedAt || data.log.bouncedAt) {
            <div class="p-3 rounded-lg border border-slate-200">
              <p class="text-[10px] text-slate-400 uppercase tracking-wider mb-2">Suivi</p>
              <div class="flex flex-col gap-2">
                @if (data.log.deliveredAt) {
                  <div class="flex items-center gap-2">
                    <div class="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <tas-icon iconName="feather:check" class="text-green-600" style="font-size:9px"></tas-icon>
                    </div>
                    <span class="text-xs text-slate-700">Livré</span>
                    <span class="text-[10px] text-slate-400 ml-auto">{{ data.log.deliveredAt | dateTimeAgo }}</span>
                  </div>
                }
                @if (data.log.openedAt) {
                  <div class="flex items-center gap-2">
                    <div class="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <tas-icon iconName="feather:eye" class="text-blue-600" style="font-size:9px"></tas-icon>
                    </div>
                    <span class="text-xs text-slate-700">Ouvert</span>
                    <span class="text-[10px] text-slate-400 ml-auto">{{ data.log.openedAt | dateTimeAgo }}</span>
                  </div>
                }
                @if (data.log.clickedAt) {
                  <div class="flex items-center gap-2">
                    <div class="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                      <tas-icon iconName="feather:mouse-pointer" class="text-indigo-600" style="font-size:9px"></tas-icon>
                    </div>
                    <span class="text-xs text-slate-700">Cliqué</span>
                    <span class="text-[10px] text-slate-400 ml-auto">{{ data.log.clickedAt | dateTimeAgo }}</span>
                  </div>
                }
                @if (data.log.bouncedAt) {
                  <div class="flex items-center gap-2">
                    <div class="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                      <tas-icon iconName="feather:alert-circle" class="text-red-500" style="font-size:9px"></tas-icon>
                    </div>
                    <span class="text-xs text-slate-700">Rebond</span>
                    <span class="text-[10px] text-slate-400 ml-auto">{{ data.log.bouncedAt | dateTimeAgo }}</span>
                  </div>
                }
              </div>
            </div>
          }

          @if (data.log.attempts) {
            <div class="p-3 rounded-lg border border-slate-200">
              <p class="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Tentatives d'envoi</p>
              <p class="text-sm font-semibold text-slate-800 tabular-nums">{{ data.log.attempts }}</p>
            </div>
          }

          @if (data.log.errorMessage) {
            <div class="p-3 rounded-lg border border-red-200 bg-red-50">
              <p class="text-[10px] text-red-500 uppercase tracking-wider mb-1 font-semibold">Erreur</p>
              <p class="text-xs text-red-700 font-mono whitespace-pre-wrap">{{ data.log.errorMessage }}</p>
            </div>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">Fermer</button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class DeliveryLogDetailDrawer {
  public readonly data: DeliveryLogDetailData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef);
  public showPreview = signal(true);

  public statusSeverity(status: string | undefined): Severity {
    switch (status) { case 'Delivered': return 'success'; case 'Bounced': case 'Failed': return 'error'; case 'Deferred': return 'warning'; case 'Sent': return 'info'; default: return 'neutral'; }
  }
  public statusIcon(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'feather:check-circle'; case 'Bounced': case 'Failed': return 'feather:x-circle'; case 'Deferred': return 'feather:clock'; case 'Sent': return 'feather:send'; default: return 'feather:minus'; }
  }
  public statusLabel(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'Livré'; case 'Bounced': return 'Rebond'; case 'Failed': return 'Échec'; case 'Deferred': return 'Différé'; case 'Sent': return 'Envoyé'; default: return status ?? '—'; }
  }
  public statusBannerClass(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'bg-green-50 border border-green-200'; case 'Bounced': case 'Failed': return 'bg-red-50 border border-red-200'; case 'Deferred': return 'bg-amber-50 border border-amber-200'; default: return 'bg-blue-50 border border-blue-200'; }
  }
  public statusCircleClass(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'bg-green-100 text-green-600'; case 'Bounced': case 'Failed': return 'bg-red-100 text-red-500'; case 'Deferred': return 'bg-amber-100 text-amber-600'; default: return 'bg-blue-100 text-blue-600'; }
  }
  public statusTextClass(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'text-green-800'; case 'Bounced': case 'Failed': return 'text-red-800'; case 'Deferred': return 'text-amber-800'; default: return 'text-blue-800'; }
  }

  public close(): void { this._dialogRef.close(); }
}
