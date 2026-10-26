import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { ClientComplaintSummaryDto, ClientComplaintsApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  COMPLAINT_CATEGORY_OPTIONS,
  COMPLAINT_STATUS_FILTER_OPTIONS,
  complaintCategoryLabel,
  complaintChannelLabel,
  complaintStatus,
  formatComplaintDate,
  isOpenComplaint,
} from './client-complaints.labels';
import { ClientComplaintDetailDrawer, ClientComplaintDetailDrawerData } from './client-complaint-detail-drawer';
import { RecordClientComplaintDrawer, RecordClientComplaintDrawerData } from './record-client-complaint-drawer';

/** Alias d'objet et non interface : `tas-table` ne reçoit la signature d'index que d'un alias. */
export type ComplaintRow = {
  id: string;
  reference: string;
  subject: string;
  categoryLabel: string;
  channelLabel: string;
  filedBySystem: boolean;
  receivedLabel: string;
  dueLabel: string;
  isOpen: boolean;
  isOverdue: boolean;
  statusLabel: string;
  statusSeverity: Severity;
};

const PAGE_SIZE = 25;

/**
 * Onglet « Réclamations » de la fiche client (2026-10-26) : le registre de ce client, tous
 * produits — celles qu'un agent a saisies et celles que le bot WhatsApp a recueillies. Celles
 * d'assurance relevant du règlement CIMA restent dans leur propre registre.
 */
@Component({
  selector: 'client-reclamations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reclamations.html',
  imports: [FormsModule, TasCard, TasTable, TasTag, TasIcon, TasSelect, TasFormField, TasLabel, Button],
})
export class ClientComplaintsPage {
  private readonly _api = inject(ClientComplaintsApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  protected readonly store = inject(ClientDetailStore);

  private readonly _canManage = this._permissions.can('customers:complaints:manage');
  public readonly canRecord = computed(() => this._canManage() && !this.store.isReadOnly());

  public readonly statusOptions = COMPLAINT_STATUS_FILTER_OPTIONS;
  public readonly categoryOptions = COMPLAINT_CATEGORY_OPTIONS;

  // Filtres en paramètres d'URL, comme les autres listes : un lien (celui d'une notification
  // de retard, par exemple) rouvre la même vue.
  public readonly status = signal(this._route.snapshot.queryParamMap.get('statut') ?? '');
  public readonly category = signal(this._route.snapshot.queryParamMap.get('categorie') ?? '');

  public readonly complaints = signal<ClientComplaintSummaryDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);

  public readonly clientId = computed(() => this.store.clientId() ?? '');

  public readonly openCount = computed(() => this.complaints().filter((c) => isOpenComplaint(c.status)).length);
  public readonly overdueCount = computed(() => this.complaints().filter((c) => c.isOverdue).length);

  public readonly rows = computed<ComplaintRow[]>(() => {
    const status = this.status();
    const category = this.category();
    return this.complaints()
      .filter((c) => {
        if (category && c.category !== category) return false;
        if (status === 'open') return isOpenComplaint(c.status);
        if (status === 'overdue') return c.isOverdue === true;
        return !status || c.status === status;
      })
      .map((c) => this._toRow(c));
  });

  public readonly hasFilters = computed(() => !!this.status() || !!this.category());

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'entity',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: PAGE_SIZE,
      pageSizeOptions: [PAGE_SIZE, 50, 100],
      totalElements: this.rows().length,
    },
  }));

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      if (clientId) untracked(() => this.reload());
    });
  }

  public reload(): void {
    const clientId = this.clientId();
    if (!clientId) return;
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._api
      .listClientComplaints(clientId)
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((items) => this.complaints.set(items ?? []));
  }

  public setStatus(value: string | null): void {
    this.status.set(value ?? '');
    this._persist();
  }

  public setCategory(value: string | null): void {
    this.category.set(value ?? '');
    this._persist();
  }

  public resetFilters(): void {
    this.status.set('');
    this.category.set('');
    this._persist();
  }

  public record(): void {
    this._sideDrawer
      .open<boolean, RecordClientComplaintDrawerData, RecordClientComplaintDrawer>(RecordClientComplaintDrawer, {
        data: { clientId: this.clientId() },
      })
      .closed.subscribe((done) => {
        if (done) this.reload();
      });
  }

  public open(row: ComplaintRow): void {
    this._sideDrawer
      .open<boolean, ClientComplaintDetailDrawerData, ClientComplaintDetailDrawer>(ClientComplaintDetailDrawer, {
        data: { clientId: this.clientId(), complaintId: row.id, canManage: this.canRecord() },
      })
      // Toujours : un tiroir fermé d'un clic à côté ne dit pas si une étape a été enregistrée.
      .closed.subscribe(() => this.reload());
  }

  private _persist(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      replaceUrl: true,
      queryParams: { statut: this.status() || null, categorie: this.category() || null },
    });
  }

  private _toRow(c: ClientComplaintSummaryDto): ComplaintRow {
    const status = complaintStatus(c.status);
    const isOpen = isOpenComplaint(c.status);
    const due = c.acknowledgedAt ? c.resolutionDueAt : c.acknowledgementDueAt;
    return {
      id: c.id ?? '',
      reference: c.reference ?? '',
      subject: c.subject ?? '',
      categoryLabel: complaintCategoryLabel(c.category),
      channelLabel: complaintChannelLabel(c.channel),
      filedBySystem: c.filedBySystem === true,
      receivedLabel: formatComplaintDate(c.receivedAt),
      // L'échéance qui compte maintenant : l'accusé tant qu'il n'est pas fait, puis la réponse.
      dueLabel: isOpen
        ? `${c.acknowledgedAt ? 'Réponse' : 'Accusé'} avant le ${formatComplaintDate(due)}`
        : formatComplaintDate(c.resolvedAt ?? c.closedAt),
      isOpen,
      isOverdue: c.isOverdue === true,
      statusLabel: status.label,
      statusSeverity: status.severity,
    };
  }
}

export default ClientComplaintsPage;
