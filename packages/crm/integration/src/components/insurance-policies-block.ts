import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PermissionsService } from '@sankore/crm/common';
import { TasAlert } from '@talisoft/ui/alert';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  formatAmount,
  formatContractDate,
  INSURANCE_PERIODICITY_LABELS,
  InsurancePeriodicity,
  policyStatusMeta,
} from '../data-access/integration-referential';
import { PendingIntegrationEndpoints, PolicyRow } from '../data-access/pending-endpoints';
import { DeclareClaimDrawer, DeclareClaimDrawerData } from './declare-claim-drawer';

/**
 * Un contrat demande attention quand il est suspendu, résilié pour impayé, ou quand sa
 * dernière échéance n'a pas été payée. C'est ce qui doit sauter aux yeux dans ce bloc.
 */
export function isPolicyAtRisk(row: PolicyRow): boolean {
  return row.status === 'Suspended' || row.status === 'Lapsed' || row.lastInstalmentPaid === false;
}

/**
 * Bloc « Assurances » de la fiche client — ASS-16.
 *
 * **Aucun endpoint ne liste les contrats d'un client** : les lots back ASS-07/ASS-08 ne
 * sont pas livrés, et le swagger ne déclare côté assurance que le catalogue des produits
 * et le devis. Le bloc appelle donc `PendingIntegrationEndpoints.listCustomerPolicies()`,
 * qui répond l'état vide, et affiche un vide **expliqué** — pas un « Aucun contrat » qui
 * laisserait croire que ce client n'en a pas. Le précédent de ce choix est
 * `customers/.../groupes.ts`.
 *
 * Tout le reste est écrit pour de vrai et fonctionnera tel quel le jour où l'endpoint
 * arrive : la mise en évidence des contrats suspendus ou en impayé, la date de fraîcheur,
 * les colonnes, les permissions.
 *
 * Le bloc reçoit l'identifiant du client en entrée et n'injecte pas le store des clients,
 * qui vit dans une autre bibliothèque.
 */
@Component({
  selector: 'insurance-policies-block',
  templateUrl: './insurance-policies-block.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, Anchor, Button, TasCard, TasIcon, TasTable, TasTag, TimeagoPipe, RouterLink],
})
export class InsurancePoliciesBlock implements OnInit {
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawer = inject(SideDrawerService);

  /** `PendingIntegrationEndpoints` n'est pas un service Angular : il s'instancie. */
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly customerId = input.required<string>();

  public readonly canSubscribe = this._permissions.can('Ins.Policy.Subscribe');
  public readonly canDeclareClaim = this._permissions.can('Ins.Claim.Declare');

  public readonly isLoading = signal(true);
  public readonly rows = signal<PolicyRow[]>([]);
  public readonly asOf = signal<string | null>(null);

  public readonly isPending = PendingIntegrationEndpoints.isPending;

  public readonly atRiskCount = computed(() => this.rows().filter(isPolicyAtRisk).length);

  /** Collection reçue en entier : pagination locale, donc pas de `(pageEventChange)`. */
  public readonly tableConfig = signal<TableConfig>({
    property: 'policyId',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
    },
  });

  public ngOnInit(): void {
    this._pending.listCustomerPolicies().subscribe((result) => {
      this.rows.set(result.rows);
      this.asOf.set(result.asOf);
      this.isLoading.set(false);
    });
  }

  public statusLabel(row: PolicyRow): string {
    return policyStatusMeta(row.status).label;
  }

  public statusSeverity(row: PolicyRow): Severity {
    return policyStatusMeta(row.status).severity;
  }

  public isAtRisk(row: PolicyRow): boolean {
    return isPolicyAtRisk(row);
  }

  public premiumLabel(row: PolicyRow): string {
    const periodicity = row.periodicity as InsurancePeriodicity;
    const periodicityLabel = INSURANCE_PERIODICITY_LABELS[periodicity] ?? row.periodicity;
    return `${formatAmount(row.premiumAmount, row.currency)} · ${periodicityLabel}`;
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  /** « payée » / « impayée » / « — » : le texte porte l'information, pas la couleur seule. */
  public lastInstalmentLabel(row: PolicyRow): string {
    if (!row.lastInstalmentDate) return '—';
    const date = formatContractDate(row.lastInstalmentDate);
    if (row.lastInstalmentPaid === null) return date;
    return row.lastInstalmentPaid ? `${date} · payée` : `${date} · impayée`;
  }

  public declareClaim(row: PolicyRow): void {
    this._sideDrawer.open(DeclareClaimDrawer, {
      data: {
        policyId: row.policyId,
        productName: row.productName,
      } satisfies DeclareClaimDrawerData,
    });
  }
}
