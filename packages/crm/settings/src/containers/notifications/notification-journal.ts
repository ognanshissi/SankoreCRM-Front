import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { DeliveryLogsApiService } from '@sankore/crm-api';
import { DeliveryLogDetailDrawer } from './delivery-log-detail-drawer';

@Component({
  selector: 'notification-journal',
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasInput, TimeagoPipe,
  ],
  template: `
    <div class="pb-6">
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p class="text-sm font-semibold text-slate-700">Journal de livraison</p>
            <p class="text-xs text-slate-400 mt-0.5">Suivi des e-mails envoyés par la plateforme.</p>
          </div>
          <button tas-outlined-button type="button" class="text-xs" (click)="loadLogs()">
            <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
            Actualiser
          </button>
        </div>

        <!-- Filters -->
        <div class="p-4 border-b border-slate-100">
          <div class="grid grid-cols-4 gap-3">
            <tas-form-field>
              <tas-label>Destinataire</tas-label>
              <input tasInput type="text" placeholder="email@..."
                [ngModel]="filterRecipient()" (ngModelChange)="filterRecipient.set($event)" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Type d'événement</tas-label>
              <input tasInput type="text" placeholder="Ex : LeadCaptured"
                [ngModel]="filterEventType()" (ngModelChange)="filterEventType.set($event)" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Depuis</tas-label>
              <input tasInput type="date"
                [ngModel]="filterFrom()" (ngModelChange)="filterFrom.set($event)" />
            </tas-form-field>
            <div class="flex items-end">
              <button tas-outlined-button color="primary" type="button" class="text-xs" (click)="loadLogs()">
                <tas-icon iconName="feather:search" style="font-size:12px"></tas-icon> Filtrer
              </button>
            </div>
          </div>
        </div>

        @if (isLoading()) {
          <div class="flex justify-center py-8"><tas-spinner size="6" class="text-primary"></tas-spinner></div>
        } @else if (logs().length === 0) {
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <tas-icon iconName="feather:inbox" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
            <p class="text-sm text-slate-400">Aucun log de livraison</p>
            <p class="text-xs text-slate-400 mt-1">Les e-mails envoyés apparaîtront ici.</p>
          </div>
        } @else {
          <div class="divide-y divide-slate-100">
            @for (log of logs(); track $index) {
              <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer"
                (click)="openDetail(log)">
                <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  [class]="statusBgClass(log.status)">
                  <tas-icon [iconName]="statusIcon(log.status)" style="font-size:11px"
                    [class]="statusIconClass(log.status)"></tas-icon>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium text-slate-800 truncate">{{ log.recipientEmail ?? '—' }}</p>
                  <p class="text-[10px] text-slate-400 mt-0.5">{{ log.subject ?? log.eventType ?? '—' }}</p>
                </div>
                <tas-tag severity="info" class="shrink-0">{{ log.eventType ?? '—' }}</tas-tag>
                <tas-tag [severity]="statusSeverity(log.status)" class="shrink-0">{{ log.status ?? '—' }}</tas-tag>
                <span class="text-[10px] text-slate-400 shrink-0 w-20 text-right">{{ log.sentAt | dateTimeAgo }}</span>
                <tas-icon iconName="feather:chevron-right" class="text-slate-300 shrink-0" style="font-size:14px"></tas-icon>
              </div>
            }
          </div>
          @if (hasMore()) {
            <div class="p-3 border-t border-slate-100 text-center">
              <button type="button" class="text-xs text-primary hover:underline"
                [disabled]="isLoadingMore()" (click)="loadMore()">
                @if (isLoadingMore()) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
                Charger plus
              </button>
            </div>
          }
        }
      </tas-card>
    </div>
  `,
})
export class NotificationJournal implements OnInit {
  private readonly _api = inject(DeliveryLogsApiService);
  private readonly _sideDrawer = inject(SideDrawerService);

  public isLoading = signal(false);
  public isLoadingMore = signal(false);
  public logs = signal<any[]>([]);
  public hasMore = signal(false);
  public filterRecipient = signal('');
  public filterEventType = signal('');
  public filterFrom = signal('');
  private _page = 1;

  ngOnInit(): void { this.loadLogs(); }

  public openDetail(log: any): void {
    this._sideDrawer.open(DeliveryLogDetailDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel',
      data: { log },
    });
  }

  public statusSeverity(status: string | undefined): Severity {
    switch (status) { case 'Delivered': return 'success'; case 'Bounced': case 'Failed': return 'error'; case 'Deferred': return 'warning'; case 'Sent': return 'info'; default: return 'neutral'; }
  }
  public statusIcon(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'feather:check-circle'; case 'Bounced': case 'Failed': return 'feather:x-circle'; case 'Deferred': return 'feather:clock'; case 'Sent': return 'feather:send'; default: return 'feather:minus'; }
  }
  public statusBgClass(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'bg-green-100'; case 'Bounced': case 'Failed': return 'bg-red-100'; case 'Deferred': return 'bg-amber-100'; case 'Sent': return 'bg-blue-100'; default: return 'bg-slate-100'; }
  }
  public statusIconClass(status: string | undefined): string {
    switch (status) { case 'Delivered': return 'text-green-600'; case 'Bounced': case 'Failed': return 'text-red-500'; case 'Deferred': return 'text-amber-600'; case 'Sent': return 'text-blue-600'; default: return 'text-slate-400'; }
  }

  public loadLogs(): void {
    this._page = 1;
    this.isLoading.set(true);
    this._api.apiV1DeliveryLogsGet(
      this.filterRecipient() || undefined, this.filterEventType() || undefined, undefined,
      this.filterFrom() ? new Date(this.filterFrom()).toISOString() : undefined,
      undefined, 1, 20,
    ).pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((data: any) => {
        const items = Array.isArray(data) ? data : (data?.items ?? []);
        this.logs.set(items); this.hasMore.set(items.length >= 20); this.isLoading.set(false);
      });
  }

  public loadMore(): void {
    this._page++;
    this.isLoadingMore.set(true);
    this._api.apiV1DeliveryLogsGet(
      this.filterRecipient() || undefined, this.filterEventType() || undefined,
      undefined, undefined, undefined, this._page, 20,
    ).pipe(catchError(() => { this.isLoadingMore.set(false); return EMPTY; }))
      .subscribe((data: any) => {
        const items = Array.isArray(data) ? data : (data?.items ?? []);
        this.logs.update((prev) => [...prev, ...items]);
        this.hasMore.set(items.length >= 20); this.isLoadingMore.set(false);
      });
  }
}

export default NotificationJournal;
