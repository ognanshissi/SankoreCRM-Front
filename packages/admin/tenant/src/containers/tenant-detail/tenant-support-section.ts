import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { catchError, EMPTY, finalize } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { PlatformSupportTicketListItem, SupportApiService } from '@sankore/crm-admin-api';
import {
  describeSupportError,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_PRIORITY_TONE,
  supportStatusStyle,
} from '../support/support-referential';

/** Les tickets de support d'un tenant, du plus récent au plus ancien. */
@Component({
  selector: 'tenant-support-section',
  imports: [DatePipe, RouterLink, Anchor, Button, TasTable],
  template: `
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-base font-bold text-slate-800">Support</h2>
          <p class="text-sm text-slate-500 tabular-nums">{{ total() }} ticket{{ total() > 1 ? 's' : '' }}</p>
        </div>
        <a tas-text-button color="primary" routerLink="/support">File du support</a>
      </div>

      @if (loadError()) {
        <div role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-50 px-5 py-4">
          <p class="text-sm text-red-800">{{ loadError() }}</p>
          <button tas-outlined-button color="primary" type="button" (click)="load()">Réessayer</button>
        </div>
      } @else {
        <tas-table [data]="rows()" identifierField="id" [config]="tableConfig()" [hasCaption]="false"
                   [isLoading]="isLoading()" (pageEventChange)="onPageChange($event)">
          <ng-template #header>
            <tr class="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <th class="py-2.5 pl-5">Ticket</th>
              <th class="py-2.5">Priorité</th>
              <th class="py-2.5">Statut</th>
              <th class="py-2.5 pr-5 text-right">Dernière activité</th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr class="cursor-pointer transition-colors hover:bg-slate-50" (click)="open(row.id)">
              <td class="py-3 pl-5">
                <p class="font-mono text-xs text-slate-500">{{ row.reference }}</p>
                <p class="text-sm font-semibold text-slate-800">{{ row.subject }}</p>
                <p class="text-xs text-slate-500">{{ row.requester }}</p>
              </td>
              <td class="py-3 text-sm" [class]="row.priorityTone">{{ row.priority }}</td>
              <td class="py-3">
                <span class="flex items-center gap-1.5 text-sm font-semibold" [class]="row.tone">
                  <span class="size-2 rounded-full" [class]="row.dot" aria-hidden="true"></span>
                  {{ row.label }}
                </span>
              </td>
              <td class="py-3 pr-5 text-right text-xs text-slate-500 tabular-nums">{{ row.lastActivityAt | date: 'd MMM y, HH:mm' }}</td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </section>
  `,
})
export class TenantSupportSection implements OnInit {
  private readonly _api = inject(SupportApiService);
  private readonly _router = inject(Router);

  public readonly tenantId = input.required<string>();

  public items = signal<PlatformSupportTicketListItem[]>([]);
  public total = signal(0);
  public isLoading = signal(false);
  public loadError = signal<string | null>(null);

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: true, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25], totalElements: 0 },
  });

  public readonly rows = computed(() =>
    this.items().map((item) => {
      const t = item.ticket ?? {};
      return {
        id: t.id ?? '',
        reference: t.reference ?? '',
        subject: t.subject ?? '',
        requester: t.requesterName ?? '',
        priority: t.priority ? SUPPORT_PRIORITY_LABELS[t.priority] : '',
        priorityTone: t.priority ? SUPPORT_PRIORITY_TONE[t.priority] : '',
        lastActivityAt: t.lastActivityAt ?? null,
        ...supportStatusStyle(t.status),
      };
    }),
  );

  public ngOnInit(): void {
    this.load();
  }

  public open(id: string): void {
    this._router.navigate(['/support', id]);
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize } }));
    this.load();
  }

  public load(): void {
    const { pageIndex, pageSize } = this.tableConfig().pagination;
    this.isLoading.set(true);
    this.loadError.set(null);
    this._api
      .listPlatformSupportTickets(undefined, false, this.tenantId(), undefined, false, undefined, undefined, pageIndex + 1, pageSize)
      .pipe(
        catchError((err) => {
          this.loadError.set(describeSupportError(err, 'Les tickets de ce tenant n’ont pas pu être chargés.'));
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((page) => {
        this.items.set(page.items ?? []);
        this.total.set(page.total ?? 0);
        this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: page.total ?? 0 } }));
      });
  }
}
