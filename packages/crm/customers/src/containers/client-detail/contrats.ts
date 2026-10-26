import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { ClientContractDto, ProductHoldingsApiService } from '@sankore/crm-api';
import { PermissionsService, holdingStatusLabel, holdingStatusSeverity } from '@sankore/crm/common';
// Les statuts d'une police appartiennent au module Intégration.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { policyStatusMeta } from '@sankore/crm/integration';
import { ClientDetailStore } from '../../models/client-detail.store';

type Nature = 'Insurance' | 'Account' | 'Loan' | 'Other';

const NATURE_LABELS: Record<Nature, string> = {
  Insurance: 'Assurances',
  Account: 'Comptes et épargne',
  Loan: 'Crédits',
  Other: 'Autres produits',
};

const NATURE_ORDER: Nature[] = ['Insurance', 'Account', 'Loan', 'Other'];

const AMOUNT_KIND_LABELS: Record<string, string> = {
  Premium: 'Prime',
  Balance: 'Solde',
  Outstanding: 'Encours',
  InsuredCapital: 'Capital assuré',
  Deposit: 'Dépôt initial',
};

const SOURCE_LABELS: Record<string, string> = {
  Insurer: "Chez l'assureur",
  CoreBanking: 'À la banque',
};

/** Cadence et borne du suivi « temps réel » des contrats en synchronisation. */
const SYNC_POLL_INTERVAL_MS = 15_000;
const SYNC_POLL_MAX_TICKS = 12;

const PAGE_SIZE = 50;

/**
 * Une ligne du tableau : un titre de groupe (nature du contrat) ou un contrat.
 *
 * Alias d'objet et non interface : `tas-table` contraint ses données à `TableEntity`, dont
 * la signature d'index n'est reçue implicitement que par un alias sous `strictTemplates`.
 */
export type ContractRow = {
  id: string;
  kind: 'group' | 'contract';
  groupLabel: string;
  count: number;
  contract: ClientContractDto | null;
  label: string;
  caption: string;
  statusLabel: string;
  statusSeverity: Severity;
  externalLabel: string | null;
  isExternal: boolean;
  reference: string;
  amountLabel: string;
  amountCaption: string;
  dateLabel: string;
  toReview: number;
};

/**
 * Onglet « Contrats » de la fiche client — tout ce que le client détient, en une liste
 * (décision du propriétaire, 2026-10-26).
 *
 * Il remplace « Produits détenus », « Assurances » et « Core banking », qui rangeaient les
 * mêmes contrats selon le système qui les connaît. Le serveur fait le rapprochement
 * (`GET clients/{id}/contracts`) : un contrat saisi ici porte la police ou le compte qui le
 * réalise, et ce que seul l'assureur ou la banque connaît arrive sur sa propre ligne, en
 * lecture seule.
 *
 * Une souscription ne s'ouvre plus d'ici : tout contrat naît d'un projet gagné. Le bouton
 * mène donc à l'onglet « Projets », formulaire ouvert. Chaque ligne ouvre la page du contrat.
 */
@Component({
  selector: 'client-contrats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contrats.html',
  imports: [
    FormsModule,
    TasCard,
    TasTable,
    TasTag,
    TasIcon,
    TasSelect,
    TasFormField,
    TasLabel,
    Button,
  ],
})
export class ClientContrats implements OnDestroy {
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _router = inject(Router);
  private readonly _permissions = inject(PermissionsService);
  protected readonly store = inject(ClientDetailStore);

  private readonly _canManageProjects = this._permissions.can('lead:opportunity:manage');

  public readonly canCreateProject = computed(() => this._canManageProjects() && !this.store.isReadOnly());

  public readonly natureOptions = NATURE_ORDER.map((nature) => ({
    label: NATURE_LABELS[nature],
    value: nature,
  }));

  /**
   * Lié au query param `?holding=<id>` : la conversion d'un lead, le bloc des projets et la
   * page projet renvoient ici en désignant le contrat — l'onglet passe la main à sa page.
   */
  public readonly holding = input<string | undefined>(undefined);

  public readonly nature = signal('');

  public readonly contracts = signal<ClientContractDto[]>([]);
  public readonly unavailableSources = signal<string[]>([]);
  public readonly coreBankingAsOf = signal<string | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollTicks = 0;

  public readonly clientId = computed(() => this.store.clientId() ?? '');

  public readonly filtered = computed(() => {
    const nature = this.nature();
    return nature ? this.contracts().filter((c) => (c.nature ?? 'Other') === nature) : this.contracts();
  });

  /**
   * En mode « serveur » sur une seule page, et non en pagination locale : en local, `tas-table`
   * compte toutes les lignes, titres de groupe compris (« 1 – 5 of 5 » pour quatre contrats).
   * La liste arrive entière du serveur et un client détient quelques contrats.
   */
  public readonly tableConfig = computed<TableConfig>(() => {
    const count = this.filtered().length;
    return {
      property: 'entity',
      pagination: {
        serverSide: true,
        pageIndex: 0,
        pageSize: Math.max(PAGE_SIZE, count),
        pageSizeOptions: [Math.max(PAGE_SIZE, count)],
        totalElements: count,
      },
    };
  });

  public readonly pendingSyncCount = computed(
    () => this.contracts().filter((c) => c.source === 'Crm' && c.status === 'PendingSync').length,
  );

  public readonly toReviewCount = computed(() =>
    this.contracts().reduce((total, c) => total + (c.designationsToReview ?? 0), 0),
  );

  public readonly unavailableLabel = computed(() =>
    this.unavailableSources()
      .map((s) => (s === 'Insurer' ? 'des assureurs' : 'de la banque'))
      .join(' et '),
  );

  public readonly rows = computed<ContractRow[]>(() => {
    const rows: ContractRow[] = [];
    for (const nature of NATURE_ORDER) {
      const items = this.filtered().filter((c) => ((c.nature as Nature) ?? 'Other') === nature);
      if (items.length === 0) continue;

      rows.push({ ...EMPTY_ROW, id: `group:${nature}`, kind: 'group', groupLabel: NATURE_LABELS[nature], count: items.length });
      for (const contract of items) rows.push(this._toRow(contract));
    }
    return rows;
  });

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      if (clientId) this._load(clientId, true);
    });

    // `replaceUrl` : « Précédent » depuis la page du contrat ramène à l'écran d'où l'on venait,
    // pas à cette adresse intermédiaire qui renverrait aussitôt vers la page.
    effect(() => {
      const wanted = this.holding();
      const clientId = this.clientId();
      if (wanted && clientId) {
        this._router.navigate(['/customers', clientId, 'contrats', `holding:${wanted}`], { replaceUrl: true });
      }
    });
  }

  public ngOnDestroy(): void {
    this._stopPolling();
  }

  public setNature(value: string): void {
    this.nature.set(value ?? '');
  }

  public reload(): void {
    const clientId = this.clientId();
    if (clientId) this._load(clientId, true);
  }

  public newProject(): void {
    const clientId = this.clientId();
    if (clientId) this._router.navigate(['/customers', clientId, 'projets'], { queryParams: { nouveau: 1 } });
  }

  public open(contract: ClientContractDto | null): void {
    const clientId = this.clientId();
    if (contract?.key && clientId) this._router.navigate(['/customers', clientId, 'contrats', contract.key]);
  }

  private _load(clientId: string, initial: boolean): void {
    if (initial) {
      this.isLoading.set(true);
      this.loadFailed.set(false);
    }
    this._holdingsApi
      .listClientContracts(clientId)
      .pipe(
        catchError(() => {
          if (initial) this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((result) => {
        this.contracts.set(result.items ?? []);
        this.unavailableSources.set(result.unavailableSources ?? []);
        this.coreBankingAsOf.set(result.coreBankingAsOf ?? null);
        this._syncPolling();
      });
  }

  /**
   * On n'interroge le serveur que tant qu'un contrat est en synchronisation, toutes les quinze
   * secondes, trois minutes au plus, et le minuteur meurt avec l'onglet.
   */
  private _syncPolling(): void {
    if (this.pendingSyncCount() === 0) {
      this._stopPolling();
      return;
    }
    if (this._pollTimer) return;
    this._pollTicks = 0;
    this._pollTimer = setInterval(() => {
      this._pollTicks += 1;
      const clientId = this.clientId();
      if (this._pollTicks > SYNC_POLL_MAX_TICKS || !clientId) {
        this._stopPolling();
        return;
      }
      this._load(clientId, false);
    }, SYNC_POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _toRow(contract: ClientContractDto): ContractRow {
    const isExternal = contract.source !== 'Crm';
    const status = isExternal ? this._externalStatus(contract) : {
      label: holdingStatusLabel(contract.status, contract.signedAt),
      severity: holdingStatusSeverity(contract.status, contract.signedAt),
    };
    const external = !isExternal && contract.externalStatus ? this._externalStatus({ ...contract, status: contract.externalStatus }) : null;

    return {
      ...EMPTY_ROW,
      id: contract.key ?? '',
      kind: 'contract',
      contract,
      label: contract.label?.trim() || contract.productCode || 'Contrat',
      caption: [isExternal ? SOURCE_LABELS[contract.source ?? ''] : null, contract.insurer].filter(Boolean).join(' · '),
      statusLabel: status.label,
      statusSeverity: status.severity,
      externalLabel: external ? (contract.nature === 'Insurance' ? `Police : ${external.label}` : `Banque : ${external.label}`) : null,
      isExternal,
      reference: contract.reference?.trim() || '—',
      amountLabel: contract.amount == null ? '—' : `${contract.amount.toLocaleString('fr-FR')} ${contract.currency ?? ''}`.trim(),
      amountCaption: contract.amountKind ? (AMOUNT_KIND_LABELS[contract.amountKind] ?? contract.amountKind) : '',
      dateLabel: this._formatDate(contract.startDate),
      toReview: contract.designationsToReview ?? 0,
    };
  }

  /** Le mot du back-office : statuts d'une police traduits, ceux de la banque tels quels. */
  private _externalStatus(contract: ClientContractDto): { label: string; severity: Severity } {
    if (contract.nature === 'Insurance') {
      const meta = policyStatusMeta(contract.status);
      return contract.premiumOutstanding ? { label: 'Prime en attente', severity: 'warning' } : meta;
    }
    return { label: contract.status?.trim() || '—', severity: 'neutral' };
  }

  private _formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }
}

const EMPTY_ROW: ContractRow = {
  id: '',
  kind: 'contract',
  groupLabel: '',
  count: 0,
  contract: null,
  label: '',
  caption: '',
  statusLabel: '',
  statusSeverity: 'neutral',
  externalLabel: null,
  isExternal: false,
  reference: '',
  amountLabel: '',
  amountCaption: '',
  dateLabel: '',
  toReview: 0,
};

export default ClientContrats;
