import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { PermissionsService } from '@sankore/crm/common';
import {
  claimNeedsAction,
  claimStatusMeta,
  formatAmount,
  formatContractDate,
} from '../../data-access/integration-referential';
import { ClaimRow, PendingIntegrationEndpoints } from '../../data-access/pending-endpoints';
import {
  ClaimDetailDrawer,
  ClaimDetailDrawerData,
} from '../../components/claim-detail-drawer';

/**
 * Sinistres du client — ASS-17.
 *
 * Section posée sous le bloc « Assurances » de la fiche client : un sinistre se lit en
 * regard des contrats, et l'agent y arrive depuis un contrat.
 *
 * **Aucun endpoint de sinistre n'est déclaré dans le swagger** (lot back ASS-09 non
 * livré) : `PendingIntegrationEndpoints.listCustomerClaims()` répond l'état vide, et la
 * section affiche un vide **expliqué** — pas un « Aucun sinistre » qui laisserait croire
 * que ce client n'en a déclaré aucun. Colonnes, statuts, mise en évidence et
 * permissions sont écrits pour de vrai et resteront tels quels.
 *
 * À l'arrivée de l'endpoint : mettre à jour le swagger, lancer
 * `npm run openapi-generator`, nommer la méthode dans `IntegrationFacadeService`, puis
 * remplacer l'appel et retirer le bandeau.
 */
@Component({
  selector: 'customer-claims-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, Button, TasCard, TasIcon, TasTable, TasTag, TimeagoPipe],
  template: `
    @if (canViewClaims()) {
      <tas-card class="block">
        <div class="flex items-center gap-2 border-b border-slate-200 p-4">
          <tas-icon
            iconName="feather:alert-circle"
            class="text-primary"
            style="font-size:16px"
          ></tas-icon>
          <p class="text-sm font-medium text-slate-700">Sinistres</p>
          @if (rows().length > 0) {
            <span class="text-xs text-slate-500 tabular-nums">({{ rows().length }})</span>
          }
          @if (needsActionCount() > 0) {
            <tas-tag severity="warning">
              {{ needsActionCount() }} en attente d'une pièce
            </tas-tag>
          }
        </div>

        @if (isPending) {
          <div class="p-4">
            <tas-alert type="info">
              <p class="text-sm font-medium">Le suivi des sinistres attend une livraison serveur</p>
              <p class="text-xs mt-1">
                Les sinistres déjà déclarés chez vos assureurs ne remontent pas encore ici.
                Déclarez un sinistre depuis un contrat pour préparer le dossier, et suivez-le
                auprès de l'assureur en attendant.
              </p>
            </tas-alert>
          </div>
        } @else if (rows().length === 0) {
          <div class="p-6 text-center">
            <p class="text-sm font-medium text-slate-700">Aucun sinistre déclaré</p>
            <p class="mt-1 text-xs text-slate-500">
              Déclarez un sinistre depuis l'un des contrats du client.
            </p>
          </div>
        } @else {
          <tas-table [data]="rows()" identifierField="claimId" [config]="tableConfig()">
            <ng-template #header>
              <tr>
                <th>Contrat</th>
                <th>Statut</th>
                <th>Référence assureur</th>
                <th>Survenu le</th>
                <th>Indemnisation</th>
                <th>Mise à jour</th>
                <th class="text-right"></th>
              </tr>
            </ng-template>

            <ng-template #body let-claim>
              <tr
                class="cursor-pointer transition-colors hover:bg-slate-50"
                [class.bg-amber-50]="needsAction(claim)"
                (click)="openDetail(claim)"
              >
                <td class="py-3 text-sm text-slate-800">{{ claim.productName }}</td>
                <td>
                  <tas-tag [severity]="statusSeverity(claim)">{{ statusLabel(claim) }}</tas-tag>
                </td>
                <td class="font-mono text-xs text-slate-600">
                  {{ claim.insurerClaimRef || '—' }}
                </td>
                <td class="text-sm text-slate-600">{{ formatDate(claim.occurredOn) }}</td>
                <td class="text-sm text-slate-800 tabular-nums">
                  {{ settlementLabel(claim) }}
                </td>
                <td class="text-sm text-slate-600">{{ claim.updatedAt | dateTimeAgo }}</td>
                <td class="text-right" (click)="$event.stopPropagation()">
                  <button
                    tas-button
                    iconButton
                    type="button"
                    title="Voir le suivi"
                    (click)="openDetail(claim)"
                  >
                    <tas-icon iconName="feather:eye" style="font-size:14px"></tas-icon>
                  </button>
                </td>
              </tr>
            </ng-template>
          </tas-table>
        }
      </tas-card>
    }
  `,
})
export class CustomerClaimsList {
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawer = inject(SideDrawerService);

  /** `PendingIntegrationEndpoints` n'est pas un service Angular : il s'instancie. */
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly customerId = input.required<string>();

  public readonly canViewClaims = this._permissions.can('Ins.Claim.View', 'Ins.Claim.Declare');

  public readonly isPending = PendingIntegrationEndpoints.isPending;

  public readonly isLoading = signal(true);
  public readonly rows = signal<ClaimRow[]>([]);

  public readonly needsActionCount = computed(
    () => this.rows().filter((r) => claimNeedsAction(r.status)).length,
  );

  /** Collection reçue en entier : pagination locale, donc pas de `(pageEventChange)`. */
  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'claimId',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
      totalElements: this.rows().length,
    },
  }));

  constructor() {
    this._pending.listCustomerClaims().subscribe((rows) => {
      this.rows.set(rows);
      this.isLoading.set(false);
    });
  }

  public statusLabel(claim: ClaimRow): string {
    return claimStatusMeta(claim.status).label;
  }

  public statusSeverity(claim: ClaimRow): Severity {
    return claimStatusMeta(claim.status).severity;
  }

  public needsAction(claim: ClaimRow): boolean {
    return claimNeedsAction(claim.status);
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public settlementLabel(claim: ClaimRow): string {
    return formatAmount(claim.settlementAmount, claim.settlementCurrency);
  }

  public openDetail(claim: ClaimRow): void {
    this._sideDrawer.open(ClaimDetailDrawer, {
      data: {
        claimId: claim.claimId,
        productName: claim.productName,
      } satisfies ClaimDetailDrawerData,
    });
  }
}
