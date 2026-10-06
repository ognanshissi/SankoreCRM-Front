import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnInit,
  signal,
  viewChildren,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { KycApprovalCircuitDto, KycFileDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  kycApprovalDecisionMeta,
  kycApprovalLevelLabel,
  kycVigilanceMeta,
} from '../data-access/kyc-referential';
import { KycHistoryEntry, KycHistoryKind } from '../data-access/kyc.types';
import { KycStatusBadge } from '../ui/kyc-status-badge';
import { KycStubNotice } from '../ui/kyc-stub-notice';
import { KycDocumentsPanel } from '../documents/kyc-documents-panel';
import { KycScorePanel } from '../verification/kyc-score-panel';
import {
  ManuallyValidateKycFileDrawer,
  ManuallyValidateKycFileDrawerData,
} from '../verification/manually-validate-kyc-file-drawer';

type KycDetailTab = 'identite' | 'piece' | 'score' | 'validation' | 'historique';

const TABS: { id: KycDetailTab; label: string }[] = [
  { id: 'identite', label: 'Identité' },
  { id: 'piece', label: 'Pièces' },
  { id: 'score', label: 'Score de confiance' },
  { id: 'validation', label: 'Validation' },
  { id: 'historique', label: 'Historique' },
];

/** Icône par type d'évènement : la frise doit se lire sans dépendre de la couleur. */
const HISTORY_ICONS: Record<KycHistoryKind, string> = {
  creation: 'feather:file-plus',
  verification: 'feather:shield',
  correction: 'feather:edit-3',
  decision: 'feather:check-square',
  review: 'feather:eye',
};

/**
 * Fiche détaillée d'un dossier KYC (KYC-F-08) : cinq onglets, chacun avec ses propres états de
 * chargement, de vide et d'erreur.
 *
 * « Historique » repose encore sur un bouchon de `KycFacadeService` (aucun endpoint d'agrégation) et
 * affiche un bandeau le disant plutôt qu'un cadre vide : sur un écran de conformité, une donnée
 * inventée présentée comme une donnée serveur est pire qu'une absence assumée.
 *
 * « Pièce et selfie » affiche la pièce pour de vrai — `GET /documents/{storageRef}`, à la demande et
 * journalisé — mais **pas le selfie** : le contrat ne rend nulle part sa référence de stockage, qui
 * n'existe que dans la réponse de son dépôt. L'onglet le dit à la place d'un bouton mort.
 *
 * Les listes passent par `tas-table`, y compris la frise d'historique : son `#body` rend une ligne de
 * frise dans un `<tr>` d'une seule cellule, sans `#header`.
 */
@Component({
  selector: 'kyc-file-detail',
  templateUrl: './kyc-file-detail.html',
  imports: [
    DatePipe,
    RouterLink,
    Button,
    TasCard,
    TasIcon,
    TasSpinner,
    TasTable,
    TasTag,
    KycDocumentsPanel,
    KycScorePanel,
    KycStatusBadge,
    KycStubNotice,
  ],
})
export class KycFileDetailPage implements OnInit {
  private readonly _facade = inject(KycFacadeService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);

  /** Identifiant du dossier, lié par `withComponentInputBinding()`. */
  public readonly id = input.required<string>();

  /**
   * Le détail technique brut du score est une donnée sensible : il relève de `kyc:document:reveal`,
   * le droit de révéler les pièces et les données en clair d'un dossier — celui que le swagger
   * exige pour relire une image déposée et pour `GET /kyc-files/{id}/identity-document`. Il était
   * porté par `customers:reveal_sensitive` faute de code KYC au catalogue, ce qui ouvrait le détail
   * brut à quiconque pouvait lire une fiche client en clair.
   */
  public readonly canSeeRawDetail = this._permissions.can('kyc:document:reveal');

  /**
   * Valider les pièces à la main relève de `kyc:document:validate`, pas de `kyc:approve` : ce n'est
   * pas une signature du circuit, c'est le jugement d'un validateur sur les preuves — et celui qui
   * le porte ne pourra justement signer aucun niveau du circuit ensuite.
   */
  public readonly canValidateDocuments = this._permissions.can('kyc:document:validate');

  public readonly tabs = TABS;
  public readonly activeTab = signal<KycDetailTab>('identite');

  private readonly _tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  // ——— Dossier ———
  public readonly isLoading = signal(true);
  public readonly hasFailed = signal(false);
  public readonly isNotFound = signal(false);
  public readonly file = signal<KycFileDto | null>(null);
  public readonly customerName = signal<string | null>(null);

  // ——— Circuit de validation ———
  public readonly isLoadingCircuit = signal(false);
  public readonly circuitFailed = signal(false);
  public readonly circuit = signal<KycApprovalCircuitDto | null>(null);
  private _circuitRequested = false;

  // ——— Historique ———
  public readonly isLoadingHistory = signal(false);
  public readonly historyFailed = signal(false);
  public readonly history = signal<KycHistoryEntry[]>([]);
  public readonly historyIsStub = signal(false);
  private _historyRequested = false;

  public readonly kycVigilanceMeta = kycVigilanceMeta;
  public readonly kycApprovalLevelLabel = kycApprovalLevelLabel;
  public readonly kycApprovalDecisionMeta = kycApprovalDecisionMeta;

  public readonly vigilance = computed(() => kycVigilanceMeta(this.file()?.vigilanceLevel));

  /**
   * Étapes du circuit, numérotées. `tas-table` identifie ses lignes par un champ : les étapes n'ont
   * pas d'identifiant au contrat, l'index en tient lieu.
   */
  public readonly circuitRows = computed(() =>
    (this.circuit()?.steps ?? []).map((step, index) => ({
      id: index,
      position: index + 1,
      levelLabel: kycApprovalLevelLabel(step.level),
      decision: kycApprovalDecisionMeta(step.decision),
      comment: step.comment ?? null,
      decidedAt: step.decidedAt ?? null,
      isNext: !!step.level && step.level === this.circuit()?.nextLevel,
    })),
  );

  public readonly historyRows = computed(() =>
    this.history().map((entry, index) => ({
      id: index,
      kind: entry.kind,
      icon: HISTORY_ICONS[entry.kind] ?? 'feather:circle',
      label: entry.label,
      // Une correction est identifiée par le **nom du champ**, pas par la valeur saisie : la valeur
      // peut être masquée, le champ corrigé reste une information utile et non sensible.
      fieldName: entry.kind === 'correction' ? entry.detail : null,
      detail: entry.kind === 'correction' ? null : entry.masked ? null : entry.detail,
      masked: entry.masked,
      authorName: entry.authorName,
      at: entry.at,
    })),
  );

  public readonly circuitTableConfig = computed<TableConfig>(() =>
    this._tableConfig(this.circuitRows().length),
  );
  public readonly historyTableConfig = computed<TableConfig>(() =>
    this._tableConfig(this.historyRows().length),
  );

  /** Jeton de rechargement : chaque rafraîchissement manuel le fait avancer. */
  private readonly _reloadToken = signal(0);

  constructor() {
    effect(() => {
      const kycFileId = this.id();
      this._reloadToken();

      this.isLoading.set(true);
      this.hasFailed.set(false);
      this.isNotFound.set(false);

      this._facade
        .getFile(kycFileId)
        .pipe(
          catchError((err: HttpErrorResponse) => {
            if (err.status === 404) {
              this.isNotFound.set(true);
            } else {
              this.hasFailed.set(true);
            }
            this.isLoading.set(false);
            return EMPTY;
          }),
        )
        .subscribe((file) => {
          this.file.set(file);
          this.isLoading.set(false);
          this._loadCustomerName(file.customerId);
        });
    });
  }

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Dossiers KYC', link: ['/kyc'] },
      { label: 'Fiche du dossier' },
    ]);
  }

  // ——— Onglets ———

  public selectTab(tab: KycDetailTab): void {
    this.activeTab.set(tab);
    this._ensureTabData(tab);
  }

  /**
   * Navigation au clavier de la bande d'onglets : flèches, Début et Fin. Le `tabindex` est tournant
   * (0 sur l'onglet actif, -1 sur les autres), donc une seule tabulation entre dans la bande.
   */
  public onTabKeydown(event: KeyboardEvent): void {
    const current = this.tabs.findIndex((tab) => tab.id === this.activeTab());
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (current + 1) % this.tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (current - 1 + this.tabs.length) % this.tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = this.tabs[next];
    if (!target) return;
    this.selectTab(target.id);
    this._tabButtons()[next]?.nativeElement.focus();
  }

  // ——— Actions ———

  public refresh(): void {
    this._circuitRequested = false;
    this._historyRequested = false;
    this._reloadToken.update((token) => token + 1);
    this._ensureTabData(this.activeTab());
  }

  public reloadCircuit(): void {
    this._circuitRequested = false;
    this._ensureTabData('validation');
  }

  public reloadHistory(): void {
    this._historyRequested = false;
    this._ensureTabData('historique');
  }

  public openCustomer(): void {
    const customerId = this.file()?.customerId;
    if (customerId) this._router.navigate(['/customers', customerId]);
  }

  /**
   * Vrai seulement dans les deux états où le serveur l'accepte : un dossier qui attend le service
   * biométrique, ou qui en est revenu sans conclusion. Ailleurs l'action est masquée plutôt que
   * proposée pour échouer en 409.
   */
  public readonly canValidateManually = computed(() => {
    const status = this.file()?.status;
    return (
      this.canValidateDocuments() &&
      (status === 'Verifying' || status === 'ComplementRequired')
    );
  });

  /** Ouvre la validation manuelle, puis relit le dossier : son statut et son circuit ont changé. */
  public validateManually(): void {
    const file = this.file();
    if (!file || !this.canValidateManually()) return;

    const ref = this._sideDrawerService.open(ManuallyValidateKycFileDrawer, {
      data: {
        kycFileId: this.id(),
        currentStatus: file.status ?? '',
      } satisfies ManuallyValidateKycFileDrawerData,
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((validated) => {
      if (validated) this.refresh();
    });
  }

  /** Les dates du contrat en `yyyy-MM-dd` : découper la chaîne évite le décalage de fuseau. */
  public formatDay(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  // ——— Chargements paresseux ———

  private _ensureTabData(tab: KycDetailTab): void {
    if (tab === 'validation' && !this._circuitRequested) {
      this._circuitRequested = true;
      this._loadCircuit();
    }
    if (tab === 'historique' && !this._historyRequested) {
      this._historyRequested = true;
      this._loadHistory();
    }
  }

  private _loadCircuit(): void {
    this.isLoadingCircuit.set(true);
    this.circuitFailed.set(false);
    this._facade
      .getApprovalCircuit(this.id())
      .pipe(
        catchError(() => {
          this.circuitFailed.set(true);
          this.isLoadingCircuit.set(false);
          return EMPTY;
        }),
      )
      .subscribe((circuit) => {
        this.circuit.set(circuit);
        this.isLoadingCircuit.set(false);
      });
  }

  private _loadHistory(): void {
    this.isLoadingHistory.set(true);
    this.historyFailed.set(false);
    this._facade
      .getHistory(this.id())
      .pipe(
        catchError(() => {
          this.historyFailed.set(true);
          this.isLoadingHistory.set(false);
          return EMPTY;
        }),
      )
      .subscribe((entries) => {
        this.history.set(entries);
        // L'historique est entièrement bouché aujourd'hui ; le drapeau survivra au rebranchement.
        this.historyIsStub.set(this._facade.hasStubbedData);
        this.isLoadingHistory.set(false);
      });
  }

  private _loadCustomerName(customerId: string | undefined): void {
    if (!customerId) {
      this.customerName.set(null);
      return;
    }
    this._facade
      .getCustomerName(customerId)
      .pipe(catchError(() => EMPTY))
      .subscribe((name) => {
        this.customerName.set(name);
        this._breadcrumbService.set([
          { label: 'Dossiers KYC', link: ['/kyc'] },
          { label: `Dossier de ${name}` },
        ]);
      });
  }

  private _tableConfig(totalElements: number): TableConfig {
    return {
      property: 'id',
      pagination: {
        // Les deux collections arrivent entières : la pagination est bien côté client.
        serverSide: false,
        pageIndex: 0,
        pageSize: 10,
        pageSizeOptions: [10, 25, 50],
        totalElements,
      },
    };
  }
}

export default KycFileDetailPage;
