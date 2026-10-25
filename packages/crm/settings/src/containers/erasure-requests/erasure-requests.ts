import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, map } from 'rxjs';
import {
  ErasureRequestDto,
  ErasureRequestsApiService,
  FormFieldReferenceTargetEnum,
} from '@sankore/crm-api';
import {
  BreadcrumbService,
  EntityFormReferences,
  erasureBlockerLabel,
  erasureStatusMeta,
  PermissionsService,
} from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { DecideErasureDrawer, DecideErasureDrawerData } from './decide-erasure-drawer';

type StatusFilter = 'Pending' | 'Restricted' | 'Completed' | 'Rejected' | '';

/**
 * « Demandes d'effacement » (purge de données, lot 3) : la file des demandes à décider, puis leur
 * historique. Les décideurs (`privacy:erasure:approve`) voient toutes les demandes ; les autres,
 * celles qu'ils ont enregistrées (le serveur filtre).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TasCard, TasTable, TasTag, TasIcon, TasFormField, TasLabel, TasSelect, Button],
  template: `
    <div class="flex flex-col gap-4 pb-6">
      <div>
        <h1 class="text-xl font-bold text-slate-900">Demandes d'effacement</h1>
        <p class="mt-1 text-sm text-slate-500">
          Une personne demande que ses données soient effacées : un collaborateur enregistre la demande, une autre personne
          la décide. Un client encore sous conservation légale est restreint, puis effacé automatiquement à l'échéance.
        </p>
      </div>

      <tas-card class="block">
        <div class="grid grid-cols-4 gap-3 p-4">
          <tas-form-field>
            <tas-label>Statut</tas-label>
            <tas-select [options]="statusOptions" [ngModel]="status()" (ngModelChange)="onStatusChange($event)"></tas-select>
          </tas-form-field>
        </div>
      </tas-card>

      <tas-card class="block">
        <tas-table [data]="requests()" [config]="tableConfig" [isLoading]="isLoading()" [hasCaption]="false">
          <ng-template #header>
            <tr>
              <th>Personne</th>
              <th>Motif</th>
              <th>Demandé par</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </ng-template>
          <ng-template #body let-item>
            <tr class="align-top">
              <td class="py-3">
                <p class="text-sm font-semibold text-slate-900">{{ item.subjectReference }}</p>
                <p class="text-xs text-slate-500">{{ item.subjectType === 'Client' || item.clientId ? 'Client' : 'Prospect' }}</p>
              </td>
              <td class="py-3 max-w-md">
                <p class="text-sm text-slate-800 line-clamp-2">{{ item.reason }}</p>
                <p class="text-xs text-slate-500 truncate">Preuve : {{ item.evidence }}</p>
              </td>
              <td class="py-3">
                <p class="text-sm text-slate-800">{{ userName(item.requestedBy) }}</p>
                <p class="text-xs text-slate-500">{{ formatDate(item.requestedAt) }}</p>
              </td>
              <td class="py-3">
                <tas-tag [severity]="statusMeta(item.status).severity">{{ statusMeta(item.status).label }}</tas-tag>
                @if (item.status === 'Restricted') {
                  <p class="mt-1 max-w-56 text-xs text-slate-500">
                    {{ blockerLabel(item.blocker) }}
                    @if (item.eligibleFrom) { Effacement prévu le {{ formatDate(item.eligibleFrom) }}. }
                  </p>
                } @else if (item.decidedBy) {
                  <p class="mt-1 text-xs text-slate-500">par {{ userName(item.decidedBy) }}, {{ formatDate(item.decidedAt) }}</p>
                }
              </td>
              <td class="py-3 text-right whitespace-nowrap">
                @if (canApprove() && item.status === 'Pending') {
                  <button tas-text-button type="button" class="text-sm" (click)="decide(item, 'reject')">Refuser</button>
                  <button tas-outlined-button color="primary" type="button" class="ml-2 rounded-full text-sm" (click)="decide(item, 'approve')">Approuver</button>
                }
              </td>
            </tr>
          </ng-template>
        </tas-table>
      </tas-card>
    </div>
  `,
})
export class ErasureRequestsPage implements OnInit {
  private readonly _api = inject(ErasureRequestsApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _references = inject(EntityFormReferences);
  private readonly _permissions = inject(PermissionsService);

  public readonly canApprove = this._permissions.can('privacy:erasure:approve');

  public readonly statusOptions = [
    { label: 'Toutes', value: '' },
    { label: 'À décider', value: 'Pending' },
    { label: 'Restreintes', value: 'Restricted' },
    { label: 'Effacées', value: 'Completed' },
    { label: 'Refusées', value: 'Rejected' },
  ];

  public readonly status = signal<StatusFilter>('');
  public readonly requests = signal<ErasureRequestDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly statusMeta = erasureStatusMeta;
  public readonly blockerLabel = erasureBlockerLabel;

  public readonly tableConfig: TableConfig = {
    property: 'erasure-requests',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50] },
  };

  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
    ),
    { initialValue: new Map<string, string>() },
  );

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Paramétrage', link: ['/settings'] }, { label: "Demandes d'effacement" }]);
    this._load();
  }

  public onStatusChange(value: StatusFilter): void {
    this.status.set(value);
    this._load();
  }

  public userName(id: string | null | undefined): string {
    return (id && this._users().get(id)) || (id === '00000000-0000-0000-0000-000000000000' ? 'Système' : '—');
  }

  public formatDate(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  }

  public decide(request: ErasureRequestDto, decision: 'approve' | 'reject'): void {
    const ref = this._sideDrawer.open<ErasureRequestDto | null, DecideErasureDrawerData, DecideErasureDrawer>(DecideErasureDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { request, decision, requestedByName: this.userName(request.requestedBy) },
    });
    ref.closed.subscribe((decided) => {
      if (decided) this._load();
    });
  }

  /** Une page de 100 : les demandes d'effacement se comptent par dizaines, pas par milliers. */
  private _load(): void {
    this.isLoading.set(true);
    const status = this.status() || undefined;
    this._api.listErasureRequests(status, 1, 100).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this._snackbar.error('Erreur', 'Impossible de charger les demandes d’effacement.');
        return EMPTY;
      }),
    ).subscribe((page) => {
      this.requests.set(page.items ?? []);
      this.isLoading.set(false);
    });
  }
}

export default ErasureRequestsPage;
