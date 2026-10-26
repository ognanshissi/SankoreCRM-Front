import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PermissionsService, TENANT_MODULES, TenantModulesService } from '@sankore/crm/common';
import { InsurancePolicyDto } from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, EMPTY } from 'rxjs';
import { IntegrationFacadeService, integrationErrorMessage } from '../data-access/integration-facade.service';
import {
  formatAmount,
  formatContractDate,
  INSURANCE_PERIODICITY_LABELS,
  InsurancePeriodicity,
  policyStatusMeta,
} from '../data-access/integration-referential';
import { DeclareClaimDrawer, DeclareClaimDrawerData } from './declare-claim-drawer';
import { InsurancePolicyDrawer, InsurancePolicyDrawerData } from './insurance-policy-drawer';

/** Un contrat suspendu demande attention : c'est ce qui doit sauter aux yeux dans ce bloc. */
export function isPolicyAtRisk(row: InsurancePolicyDto): boolean {
  return row.status === 'Suspended';
}

type PolicyRow = InsurancePolicyDto & { id: string };

/**
 * Bloc « Assurances » de la fiche client — ASS-16.
 *
 * Les polices viennent de `GET integration/insurance/policies?crmCustomerId=` : enregistrées à
 * l'émission par l'assureur, puis tenues à jour par sa synchronisation. Le serveur filtre sur le
 * périmètre d'agence de l'agent. L'attestation est demandée à l'assureur au moment du clic.
 *
 * Le bloc reçoit l'identifiant du client en entrée et n'injecte pas le store des clients, qui vit
 * dans une autre bibliothèque.
 */
@Component({
  selector: 'insurance-policies-block',
  templateUrl: './insurance-policies-block.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, Anchor, Button, TasCard, TasIcon, TasTable, TasTag, TimeagoPipe, RouterLink],
})
export class InsurancePoliciesBlock implements OnInit {
  /** Module désactivé : consultation seule, les actions se masquent (le serveur les refuserait). */
  private readonly _moduleReadOnly = inject(TenantModulesService).readOnly(TENANT_MODULES.INSURANCE);
  private readonly _permissions = inject(PermissionsService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly customerId = input.required<string>();

  private readonly _canSubscribePermission = this._permissions.can('Ins.Policy.Subscribe');
  public readonly canSubscribe = computed(() => this._canSubscribePermission() && !this._moduleReadOnly());
  private readonly _canDeclareClaimPermission = this._permissions.can('Ins.Claim.Declare');
  public readonly canDeclareClaim = computed(() => this._canDeclareClaimPermission() && !this._moduleReadOnly());

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly rows = signal<PolicyRow[]>([]);
  public readonly downloadingId = signal<string | null>(null);

  /** La plus ancienne synchronisation : la fraîcheur du bloc est celle de sa ligne la moins fraîche. */
  public readonly asOf = computed(() =>
    this.rows()
      .map((row) => row.lastSyncedAt ?? '')
      .filter(Boolean)
      .sort()[0] ?? null,
  );

  public readonly atRiskCount = computed(() => this.rows().filter(isPolicyAtRisk).length);

  /** Collection reçue en entier : pagination locale. */
  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25, 50] },
  });

  public ngOnInit(): void {
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._facade
      .listPolicies(this.customerId())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadError.set(integrationErrorMessage(err, "Les contrats d'assurance n'ont pas pu être lus."));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((policies) => {
        this.rows.set(policies.map((policy) => ({ ...policy, id: policy.id ?? '' })));
        this.isLoading.set(false);
      });
  }

  // Émise n'est pas en vigueur : le contrat ne prend effet qu'au paiement de la prime, et le statut
  // de l'assureur l'ignore jusqu'à sa prochaine synchronisation. Il s'affichait « En vigueur ».
  public statusLabel(row: PolicyRow): string {
    return row.premiumOutstanding ? 'Émise — prime à payer' : policyStatusMeta(row.status).label;
  }

  public statusSeverity(row: PolicyRow): Severity {
    return row.premiumOutstanding ? 'info' : policyStatusMeta(row.status).severity;
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

  public downloadCertificate(row: PolicyRow): void {
    this.downloadingId.set(row.id);
    this._facade
      .getPolicyCertificate(row.id)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Attestation indisponible',
            err.status === 502
              ? "L'assureur n'a pas pu produire l'attestation. Réessayez plus tard ou demandez-la par votre canal habituel."
              : integrationErrorMessage(err, "L'attestation n'a pas pu être téléchargée."),
          );
          this.downloadingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `attestation-${row.policyNumber || row.id}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        this.downloadingId.set(null);
      });
  }

  /** Opérations et documents du contrat ; les deux actions de la ligne restent sur la ligne. */
  public openDetails(row: PolicyRow): void {
    this._sideDrawer.open(InsurancePolicyDrawer, {
      data: { policy: row, customerId: this.customerId() } satisfies InsurancePolicyDrawerData,
    });
  }

  public declareClaim(row: PolicyRow): void {
    this._sideDrawer.open(DeclareClaimDrawer, {
      data: {
        policyId: row.id,
        productName: row.productName ?? '',
      } satisfies DeclareClaimDrawerData,
    });
  }
}
