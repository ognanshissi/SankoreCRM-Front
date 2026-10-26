import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { catchError, EMPTY, finalize } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { PermissionsService } from '@sankore/crm/common';
import { ClientsApiService, PaymentInstrumentDto } from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  AddPaymentInstrumentDrawer,
  AddPaymentInstrumentDrawerData,
  paymentInstrumentKindLabel,
} from './add-payment-instrument-drawer';

/**
 * « Moyens de paiement » du client (Mobile Money, RIB), dans l'onglet Coordonnées : de quoi
 * encaisser une prime et verser un remboursement. Le serveur ne renvoie que le numéro masqué.
 */
@Component({
  selector: 'client-payment-instruments-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TasCard, TasIcon, TasTag, TasTable, Button],
  template: `
    @if (canRead()) {
      <tas-card class="block">
        <div class="p-4 flex flex-col gap-3">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-start gap-2">
              <tas-icon iconName="feather:credit-card" class="text-slate-400 mt-0.5" style="font-size:15px"></tas-icon>
              <div>
                <p class="text-sm font-medium text-slate-800">Moyens de paiement</p>
                <p class="text-xs text-slate-500">
                  Utilisés pour encaisser une prime et verser un remboursement. Le numéro est enregistré
                  chiffré : seuls ses derniers chiffres sont affichés.
                </p>
              </div>
            </div>
            @if (canWrite()) {
              <button tas-text-button type="button" size="small" color="primary" (click)="openAddDrawer()">
                <tas-icon iconName="feather:plus" style="font-size:13px"></tas-icon>
                <span>Ajouter</span>
              </button>
            }
          </div>

          <tas-table [data]="instruments()" [config]="tableConfig" [isLoading]="isLoading()" [hasCaption]="false">
            <ng-template #header>
              <tr>
                <th>Opérateur / banque</th>
                <th>Type</th>
                <th>Numéro</th>
                <th>Titulaire</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </ng-template>
            <ng-template #body let-item>
              <tr [class.text-slate-400]="!item.isActive">
                <td class="py-2 text-sm text-slate-800">{{ item.provider || '—' }}</td>
                <td class="py-2 text-sm text-slate-600">{{ kindLabel(item.kind) }}</td>
                <td class="py-2 text-sm tabular-nums text-slate-800">{{ item.maskedIdentifier || '—' }}</td>
                <td class="py-2 text-sm text-slate-600">{{ item.holderName || '—' }}</td>
                <td class="py-2">
                  @if (item.isActive) {
                    <tas-tag severity="success">Actif</tas-tag>
                  } @else {
                    <tas-tag severity="neutral">Retiré</tas-tag>
                  }
                  <p class="text-xs text-slate-400">Ajouté le {{ item.createdAt | date: 'dd/MM/yyyy' }}</p>
                </td>
                <td class="py-2 text-right whitespace-nowrap">
                  @if (canWrite() && item.isActive) {
                    <button tas-text-button type="button" size="small" color="warn"
                            [disabled]="busyId() === item.id" (click)="confirmDeactivate(item)">
                      Retirer
                    </button>
                  }
                </td>
              </tr>
            </ng-template>
          </tas-table>
        </div>
      </tas-card>
    }
  `,
})
export class ClientPaymentInstrumentsCard {
  protected readonly store = inject(ClientDetailStore);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  public readonly canRead = this._permissions.can('customers:read');
  private readonly _canUpdate = this._permissions.can('customers:update');
  public readonly canWrite = computed(() => this._canUpdate() && !this.store.isReadOnly());

  public readonly clientId = computed(() => this.store.clientId());
  public readonly instruments = signal<PaymentInstrumentDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly busyId = signal<string | null>(null);
  public readonly kindLabel = paymentInstrumentKindLabel;

  public readonly tableConfig: TableConfig = {
    property: 'client-payment-instruments',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10] },
  };

  private _loadedFor: string | null = null;

  constructor() {
    effect(() => {
      const id = this.clientId();
      if (!id || !this.canRead() || id === this._loadedFor) return;
      this._loadedFor = id;
      this._load(id);
    });
  }

  public openAddDrawer(): void {
    const clientId = this.clientId();
    if (!clientId || !this.canWrite()) return;

    const ref = this._sideDrawer.open<string, AddPaymentInstrumentDrawerData, AddPaymentInstrumentDrawer>(
      AddPaymentInstrumentDrawer,
      {
        width: '520px',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { clientId, holderName: this.store.client()?.displayName },
      },
    );
    ref.closed.subscribe((id) => {
      if (id) this._load(clientId);
    });
  }

  public confirmDeactivate(instrument: PaymentInstrumentDto): void {
    if (!instrument.id || !this.canWrite()) return;
    this._confirmDialog.confirm({
      title: 'Retirer ce moyen de paiement ?',
      message: `« ${instrument.provider ?? ''} ${instrument.maskedIdentifier ?? ''} » ne servira plus aux encaissements ni aux remboursements. Il reste visible comme retiré.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Retirer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._deactivate(instrument.id!),
    });
  }

  private _deactivate(instrumentId: string): void {
    const clientId = this.clientId();
    if (!clientId) return;
    this.busyId.set(instrumentId);
    this._clientsApi
      .deactivateClientPaymentInstrument(instrumentId)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de retirer ce moyen de paiement.');
          return EMPTY;
        }),
        finalize(() => this.busyId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Moyen de paiement retiré', '');
        this._load(clientId);
      });
  }

  private _load(clientId: string): void {
    this.isLoading.set(true);
    this._clientsApi
      .listClientPaymentInstruments(clientId)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de charger les moyens de paiement.');
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((rows) => this.instruments.set(rows ?? []));
  }
}
