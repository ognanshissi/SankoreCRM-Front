import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ConnectionListDto,
  IntegrationApiService,
  StatementDetailDto,
  StatementDto,
  StatementLineDto,
} from '@sankore/crm-api';
import {
  BreadcrumbService,
  ModuleReadOnlyNotice,
  PermissionCode,
  PermissionsService,
  TENANT_MODULES,
  TenantModule,
  TenantModulesService,
} from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY } from 'rxjs';
import { ReconciliationGapsList } from '../../components/reconciliation-gaps-list';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  ConnectionFamily,
  formatAmount,
  formatContractDate,
} from '../../data-access/integration-referential';
import {
  InsurerCommissionDrawer,
  InsurerCommissionDrawerData,
} from './insurer-commission-drawer';
import {
  commissionGapLabel,
  premiumsDue,
  remittanceState,
  statementErrorMessage,
  statementLineTypeLabel,
  statementStatusMeta,
} from './statement-referential';
import {
  StatementRemittanceDrawer,
  StatementRemittanceDrawerData,
} from './statement-remittance-drawer';

/**
 * ASS-18 — Bordereaux et réconciliation assurance.
 *
 * 1. Les BORDEREAUX du mois, générés chaque nuit par le serveur : liste filtrée par assureur
 *    et par mois, puis le détail du bordereau choisi (lignes figées, totaux, export CSV du
 *    serveur). Le cycle de vie se pilote d'ici : clôture, transmission à l'assureur,
 *    reversement des primes encaissées en son nom (30 jours) et rapprochement de la
 *    commission que l'assureur déclare.
 *
 * 2. Les ÉCARTS DE RÉCONCILIATION réutilisent `listReconciliationGaps` filtré sur la
 *    connexion de l'assureur, à travers le même composant que l'écran INT-35.
 */
@Component({
  templateUrl: './insurance-statements.html',
  imports: [
    ModuleReadOnlyNotice,
    DatePipe,
    FormsModule,
    Button,
    TasCard,
    TasFormField,
    TasLabel,
    TasSelect,
    TasSpinner,
    TasTable,
    TasTag,
    ReconciliationGapsList,
  ],
})
export class InsuranceStatementsPage implements OnInit {
  /** Module désactivé : l'écran reste consultable, sans action (bandeau en tête). */
  public readonly readOnlyModules: TenantModule[] = [TENANT_MODULES.INSURANCE];
  private readonly _moduleReadOnly = inject(TenantModulesService).readOnly(TENANT_MODULES.INSURANCE);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _api = inject(IntegrationApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canView = this._permissions.can('Ins.Statement.View');
  private readonly _canFinalisePermission = this._permissions.can('Ins.Statement.Finalise');
  public readonly canFinalise = computed(
    () => this._canFinalisePermission() && !this._moduleReadOnly(),
  );

  /** L'assurance referme ses écarts avec son propre droit. */
  public readonly resolvePermission: PermissionCode = 'Ins.Reconciliation.Resolve';

  /** La liste d'écarts est restreinte à l'assurance : voir son `input()` famille. */
  public readonly insuranceFamily: ConnectionFamily = 'Insurance';

  public isLoadingInsurers = signal(true);
  public isLoadingStatements = signal(false);
  public isLoadingDetail = signal(false);
  public isExporting = signal(false);
  public isActing = signal(false);

  public insurers = signal<ConnectionListDto[]>([]);
  public selectedInsurerId = signal<string | null>(null);
  /** Vide : tous les mois. */
  public period = signal<string>('');
  public statements = signal<StatementDto[]>([]);
  public selectedStatementId = signal<string | null>(null);
  public detail = signal<StatementDetailDto | null>(null);

  public readonly statementsTableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 12, pageSizeOptions: [12, 24, 48] },
  });

  public readonly linesTableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [10, 20, 50] },
  });

  public readonly insurerOptions = computed(() => [
    { label: 'Tous les assureurs', value: '' },
    ...this.insurers().map((insurer) => ({
      label: insurer.name ?? 'Assureur sans nom',
      value: insurer.id ?? '',
    })),
  ]);

  /** Les 24 derniers mois, le mois en cours compris (son bordereau est encore en brouillon). */
  public readonly periodOptions = computed(() => {
    const options = [{ label: 'Tous les mois', value: '' }];
    const now = new Date();
    for (let offset = 0; offset < 24; offset++) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const value = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}`;
      options.push({ label: capitalise(monthLabel(value)), value });
    }
    const current = this.period();
    if (current && !options.some((option) => option.value === current)) {
      options.push({ label: capitalise(monthLabel(current)), value: current });
    }
    return options;
  });

  public readonly hasInsurers = computed(() => this.insurers().length > 0);

  public readonly statement = computed(() => this.detail()?.statement ?? null);
  public readonly lines = computed<StatementLineDto[]>(() => this.detail()?.lines ?? []);

  public readonly selectedInsurerName = computed(() =>
    this.insurerName(this.statement()?.connectionId),
  );

  public readonly remittance = computed(() => remittanceState(this.statement()));
  public readonly commissionGap = computed(() => {
    const statement = this.statement();
    return commissionGapLabel(statement?.commissionGap, statement?.currency);
  });
  public readonly due = computed(() => premiumsDue(this.statement()));

  public readonly isDraft = computed(() => this.statement()?.status === 'Draft');
  /** Le serveur n'accepte la transmission que d'un bordereau clôturé (ou dont l'envoi a échoué). */
  public readonly canBeTransmitted = computed(() => {
    const status = this.statement()?.status;
    return status === 'Finalised' || status === 'TransmitFailed';
  });

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: 'Bordereaux assurance' },
    ]);

    const params = this._route.snapshot.queryParams;
    if (params['connectionId']) this.selectedInsurerId.set(params['connectionId']);
    if (params['period']) this.period.set(params['period']);
    if (params['statementId']) this.selectedStatementId.set(params['statementId']);

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
      });

    this._loadStatements();
    const statementId = this.selectedStatementId();
    if (statementId) this._loadDetail(statementId);
  }

  public onInsurerChange(value: string | null): void {
    this.selectedInsurerId.set(value || null);
    this._clearSelection();
    this._pushToUrl();
    this._loadStatements();
  }

  public onPeriodChange(value: string | null): void {
    this.period.set(value || '');
    this._clearSelection();
    this._pushToUrl();
    this._loadStatements();
  }

  public selectStatement(statement: StatementDto): void {
    if (!statement.id) return;
    this.selectedStatementId.set(statement.id);
    this._pushToUrl();
    this._loadDetail(statement.id);
  }

  public closeDetail(): void {
    this._clearSelection();
    this._pushToUrl();
  }

  // ——— Libellés ———

  public insurerName(connectionId: string | null | undefined): string {
    return this.insurers().find((insurer) => insurer.id === connectionId)?.name ?? '';
  }

  public periodLabel(period: string | null | undefined): string {
    return period ? capitalise(monthLabel(period)) : '—';
  }

  public amount(value: number | null | undefined, currency?: string | null): string {
    return formatAmount(value, currency ?? this.statement()?.currency);
  }

  public date(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public statusMeta(status: string | null | undefined) {
    return statementStatusMeta(status);
  }

  public remittanceOf(statement: StatementDto) {
    return remittanceState(statement);
  }

  public gapOf(statement: StatementDto) {
    return commissionGapLabel(statement.commissionGap, statement.currency);
  }

  public lineTypeLabel(lineType: string | null | undefined): string {
    return statementLineTypeLabel(lineType);
  }

  public rate(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 2 }).format(value);
  }

  // ——— Actions ———

  public exportCsv(): void {
    const statement = this.statement();
    if (!statement?.id) return;

    this.isExporting.set(true);
    this._api
      .exportInsurerStatementCsv(statement.id)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isExporting.set(false);
          this._snackbar.error(
            'Export impossible',
            statementErrorMessage(error, "Le bordereau n'a pas pu être exporté."),
          );
          return EMPTY;
        }),
      )
      .subscribe((content) => {
        this.isExporting.set(false);
        // L'Accept `text/csv` fait lire la réponse en texte, et le navigateur retire au
        // passage le BOM que le serveur pose pour Excel : on le remet, sinon les accents
        // des libellés de produits sortent cassés.
        const text = typeof content === 'string' ? content : String(content ?? '');
        const withBom = text.startsWith('﻿') ? text : `﻿${text}`;
        const blob = new Blob([withBom], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `bordereau-${slug(this.selectedInsurerName()) || 'assureur'}-${statement.period ?? ''}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      });
  }

  public finalise(): void {
    const statement = this.statement();
    if (!statement?.id) return;

    this._confirm.confirm({
      title: 'Clôturer ce bordereau ?',
      message:
        `Les chiffres de ${this.periodLabel(statement.period)} deviennent ceux que l'institution ` +
        `présente à l'assureur : la génération de nuit ne pourra plus les recalculer.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Clôturer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._runFinalise(statement.id!),
    });
  }

  public recordTransmission(): void {
    const statement = this.statement();
    if (!statement?.id) return;

    this._confirm.confirm({
      title: "Bordereau transmis à l'assureur ?",
      message: `Confirmez que le bordereau de ${this.periodLabel(statement.period)} a bien été envoyé à ${this.selectedInsurerName() || "l'assureur"}.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Confirmer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._runTransmission(statement.id!),
    });
  }

  public openRemittance(): void {
    const statement = this.statement();
    if (!statement) return;

    const ref = this._sideDrawer.open(StatementRemittanceDrawer, {
      data: {
        statement,
        insurerName: this.selectedInsurerName(),
        periodLabel: this.periodLabel(statement.period),
      } satisfies StatementRemittanceDrawerData,
    });
    ref.closed.subscribe((done) => {
      if (done) this._reloadAll();
    });
  }

  public openInsurerCommission(): void {
    const statement = this.statement();
    if (!statement) return;

    const ref = this._sideDrawer.open(InsurerCommissionDrawer, {
      data: {
        statement,
        insurerName: this.selectedInsurerName(),
        periodLabel: this.periodLabel(statement.period),
      } satisfies InsurerCommissionDrawerData,
    });
    ref.closed.subscribe((done) => {
      if (done) this._reloadAll();
    });
  }

  // ——— Interne ———

  private _runFinalise(statementId: string): void {
    this.isActing.set(true);
    this._api
      .finaliseInsurerStatement(statementId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isActing.set(false);
          this._snackbar.error(
            'Clôture impossible',
            statementErrorMessage(error, "Le bordereau n'a pas pu être clôturé."),
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isActing.set(false);
        this._snackbar.success('Bordereau clôturé', 'Ses chiffres ne seront plus recalculés.');
        this._reloadAll();
      });
  }

  private _runTransmission(statementId: string): void {
    this.isActing.set(true);
    this._api
      .recordInsurerStatementTransmission(statementId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isActing.set(false);
          this._snackbar.error(
            'Transmission non enregistrée',
            statementErrorMessage(error, "La transmission n'a pas pu être enregistrée."),
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isActing.set(false);
        this._snackbar.success('Transmission enregistrée', "Le bordereau est marqué comme transmis à l'assureur.");
        this._reloadAll();
      });
  }

  private _reloadAll(): void {
    this._loadStatements();
    const statementId = this.selectedStatementId();
    if (statementId) this._loadDetail(statementId);
  }

  private _loadStatements(): void {
    this.isLoadingStatements.set(true);
    this._api
      .listInsurerStatements(this.selectedInsurerId() ?? undefined, this.period() || undefined)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isLoadingStatements.set(false);
          this.statements.set([]);
          this._snackbar.error(
            'Erreur',
            statementErrorMessage(error, 'Impossible de lire les bordereaux.'),
          );
          return EMPTY;
        }),
      )
      .subscribe((statements) => {
        this.statements.set(statements ?? []);
        this.isLoadingStatements.set(false);
      });
  }

  private _loadDetail(statementId: string): void {
    this.isLoadingDetail.set(true);
    this._api
      .getInsurerStatement(statementId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isLoadingDetail.set(false);
          this.detail.set(null);
          this.selectedStatementId.set(null);
          this._pushToUrl();
          this._snackbar.error(
            'Erreur',
            statementErrorMessage(error, "Le bordereau n'a pas pu être chargé."),
          );
          return EMPTY;
        }),
      )
      .subscribe((detail) => {
        // Une réponse tardive d'un bordereau qu'on a quitté entre-temps ne doit pas
        // remplacer celui affiché.
        if (this.selectedStatementId() !== statementId) return;
        this.detail.set(detail);
        this.isLoadingDetail.set(false);
      });
  }

  private _clearSelection(): void {
    this.selectedStatementId.set(null);
    this.detail.set(null);
    this.isLoadingDetail.set(false);
  }

  private _pushToUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        connectionId: this.selectedInsurerId(),
        period: this.period() || null,
        statementId: this.selectedStatementId(),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

function monthLabel(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default InsuranceStatementsPage;
