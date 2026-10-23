import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ConnectionListDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionCode, PermissionsService, TENANT_MODULES, TenantModule, ModuleReadOnlyNotice } from '@sankore/crm/common';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { catchError, EMPTY } from 'rxjs';
import { ReconciliationGapsList } from '../../components/reconciliation-gaps-list';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  ConnectionFamily,
  formatAmount,
} from '../../data-access/integration-referential';
import {
  InsuranceStatement,
  PendingIntegrationEndpoints,
  StatementLine,
} from '../../data-access/pending-endpoints';

/**
 * ASS-18 — Bordereaux et réconciliation assurance.
 *
 * L'écran est en deux moitiés qui n'ont pas le même état d'avancement.
 *
 * 1. Le BORDEREAU (sélection assureur + mois, lignes par produit, totaux, export)
 *    n'a AUCUN endpoint dans le swagger : ASS-18 dépend du lot back ASS-10, non
 *    livré. L'appel passe donc par `PendingIntegrationEndpoints.getInsuranceStatement()`,
 *    qui répond `null` — ni données factices, ni chemin inventé dans le swagger.
 *    L'écran le dit en clair à l'utilisateur plutôt que d'afficher « Aucune
 *    donnée », qui se lirait comme « ce mois-là, rien n'a été encaissé ».
 *    À l'arrivée de l'endpoint : mettre à jour `swaggers/sankore-crm-api-swagger.json`,
 *    lancer `npm run openapi-generator`, puis remplacer l'appel ci-dessous par la
 *    méthode correspondante de `IntegrationFacadeService`. Le tableau, les totaux
 *    et l'export CSV sont écrits pour de vrai et n'auront pas à bouger.
 *
 * 2. Les ÉCARTS DE RÉCONCILIATION fonctionnent : ils réutilisent
 *    `listReconciliationGaps` filtré sur la connexion de l'assureur, à travers le
 *    même composant que l'écran INT-35.
 */
@Component({
  templateUrl: './insurance-statements.html',
  imports: [ModuleReadOnlyNotice, 
    FormsModule,
    TasAlert,
    Button,
    TasCard,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    TasSpinner,
    TasTable,
    ReconciliationGapsList,
  ],
})
export class InsuranceStatementsPage implements OnInit {
  /** Module désactivé : l'écran reste consultable, sans action (bandeau en tête). */
  public readonly readOnlyModules: TenantModule[] = [TENANT_MODULES.INSURANCE];
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /** Frontière vers les endpoints non livrés : voir le commentaire de tête. */
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly canView = this._permissions.can('Ins.Statement.View');

  /** L'assurance referme ses écarts avec son propre droit. */
  public readonly resolvePermission: PermissionCode = 'Ins.Reconciliation.Resolve';

  /** La liste d'écarts est restreinte à l'assurance : voir son `input()` famille. */
  public readonly insuranceFamily: ConnectionFamily = 'Insurance';

  public readonly isStatementPending = PendingIntegrationEndpoints.isPending;

  public isLoadingInsurers = signal(true);
  public isLoadingStatement = signal(false);
  public insurers = signal<ConnectionListDto[]>([]);
  public selectedInsurerId = signal<string | null>(null);
  public statement = signal<InsuranceStatement | null>(null);

  /** Un bordereau se justifie sur un mois clos : on propose le mois précédent. */
  public period = signal<string>(previousMonth());

  public tableConfig = signal<TableConfig>({
    property: 'productId',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
    },
  });

  public readonly insurerOptions = computed(() =>
    this.insurers().map((insurer) => ({
      label: insurer.name ?? 'Assureur sans nom',
      value: insurer.id ?? '',
    })),
  );

  public readonly selectedInsurerName = computed(
    () =>
      this.insurers().find((insurer) => insurer.id === this.selectedInsurerId())?.name ?? '',
  );

  public readonly lines = computed<StatementLine[]>(() => this.statement()?.lines ?? []);

  public readonly periodLabel = computed(() => monthLabel(this.period()));

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: 'Bordereaux assurance' },
    ]);

    const params = this._route.snapshot.queryParams;
    if (params['connectionId']) this.selectedInsurerId.set(params['connectionId']);
    if (params['period']) this.period.set(params['period']);

    this._facade
      .listAllConnections('Insurance')
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isLoadingInsurers.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, 'Impossible de lire la liste des assureurs.'),
          );
          return EMPTY;
        }),
      )
      .subscribe((insurers) => {
        this.insurers.set(insurers);
        this.isLoadingInsurers.set(false);
        this._loadStatement();
      });
  }

  public onInsurerChange(value: string | null): void {
    this.selectedInsurerId.set(value || null);
    this._pushToUrl();
    this._loadStatement();
  }

  public onPeriodChange(value: string | null): void {
    this.period.set(value || previousMonth());
    this._pushToUrl();
    this._loadStatement();
  }

  public amount(value: number | null | undefined): string {
    return formatAmount(value, this.statement()?.currency);
  }

  // ——— Exports ———

  public exportCsv(): void {
    const statement = this.statement();
    if (!statement) return;

    const header = [
      'Produit',
      'Adhésions',
      'Primes encaissées',
      'Contre-passations',
      'Montant contre-passé',
      'Résiliations',
      'Commissions',
    ];

    const rows = statement.lines.map((line) => [
      line.productName,
      String(line.subscriptionCount),
      String(line.premiumCollected),
      String(line.reversalCount),
      String(line.reversedAmount),
      String(line.cancellationCount),
      String(line.commissionAmount),
    ]);

    const totals = [
      'Total',
      String(statement.totalSubscriptionCount),
      String(statement.totalPremiumCollected),
      '',
      String(statement.totalReversedAmount),
      String(statement.totalCancellationCount),
      String(statement.totalCommissionAmount),
    ];

    const csv = [header, ...rows, totals]
      .map((row) => row.map((field) => escapeCsv(field)).join(';'))
      .join('\r\n');

    // BOM UTF-8 : sans lui, Excel casse les accents des libellés de produits.
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bordereau-assurance-${statement.period}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // ——— Interne ———

  private _loadStatement(): void {
    if (!this.selectedInsurerId() || !this.period()) {
      this.statement.set(null);
      return;
    }

    this.isLoadingStatement.set(true);
    this._pending.getInsuranceStatement().subscribe((statement) => {
      this.statement.set(statement);
      this.isLoadingStatement.set(false);
    });
  }

  private _pushToUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        connectionId: this.selectedInsurerId(),
        period: this.period() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

/** Mois précédent au format `yyyy-MM`, celui qu'attend `input[type=month]`. */
function previousMonth(): string {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = `${previous.getMonth() + 1}`.padStart(2, '0');
  return `${previous.getFullYear()}-${month}`;
}

function monthLabel(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
}

function escapeCsv(value: string): string {
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export default InsuranceStatementsPage;
