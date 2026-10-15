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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { KycApprovalCircuitDto, KycFileDto, UsersApiService } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  kycApprovalDecisionMeta,
  kycApprovalLevelLabel,
  kycChannelMeta,
  kycConfidenceMeta,
  kycStatusMeta,
  kycTierLabel,
  kycVigilanceMeta,
  kycVigilanceShortLabel,
} from '../data-access/kyc-referential';
import { KycDocumentRow, KycHistoryEntry, KycHistoryKind } from '../data-access/kyc.types';
import { KYC_VALIDATED_STATUSES, KycStepState, kycProgressStates } from '../data-access/kyc-progress';
import { KycDocumentsPanel } from '../documents/kyc-documents-panel';
import { KycRemoteInvitationsPanel } from '../remote/kyc-remote-invitations-panel';
import { KycScorePanel } from '../verification/kyc-score-panel';
import { KycDecisionCard } from '../approval/kyc-decision-card';
import { KycRemoteDecisionBanner } from '../approval/kyc-remote-decision-banner';
import {
  ManuallyValidateKycFileDrawer,
  ManuallyValidateKycFileDrawerData,
} from '../verification/manually-validate-kyc-file-drawer';
// Le suivi de création dans le cœur bancaire appartient au module Intégration, pas au
// KYC : il se nourrit des commandes d'intégration et sert aussi la fiche client. On
// l'importe donc, plutôt que d'en écrire une seconde version ici.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  CbsBatchNoticeComponent,
  CbsProvisioningStatusComponent,
} from '@sankore/crm/integration';

type KycDetailTab = 'identite' | 'piece' | 'score' | 'validation' | 'historique';

const TABS: { id: KycDetailTab; label: string }[] = [
  { id: 'identite', label: 'Identité' },
  { id: 'piece', label: 'Pièces' },
  { id: 'score', label: 'Score de confiance' },
  { id: 'validation', label: 'Validation' },
  { id: 'historique', label: 'Historique' },
];

type ProgressStepState = KycStepState;

interface ProgressStep {
  label: string;
  detail: string;
  state: ProgressStepState;
}

/** Ce que l'écran dit de l'avancement, et l'onglet où agir. */
interface FileProgress {
  steps: ProgressStep[];
  message: string;
  tone: 'default' | 'warning' | 'error' | 'success';
  action: { label: string; tab: KycDetailTab } | null;
}

const VALIDATED_STATUSES = KYC_VALIDATED_STATUSES;

const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

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
    KycRemoteInvitationsPanel,
    KycScorePanel,
    KycDecisionCard,
    KycRemoteDecisionBanner,
    CbsBatchNoticeComponent,
    CbsProvisioningStatusComponent,
  ],
})
export class KycFileDetailPage implements OnInit {
  private readonly _facade = inject(KycFacadeService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

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

  /**
   * Signer un niveau du circuit. Le serveur n'exige que ce droit et le bon ordre : aucun rôle n'est
   * rattaché à un niveau, donc les actions s'affichent sur la ligne en attente pour tout porteur du
   * droit. Les quatre yeux (pas de signature par le soumissionnaire) sont tranchés côté serveur.
   */
  public readonly canApprove = this._permissions.can('kyc:approve');
  public readonly canUploadDocuments = this._permissions.can('kyc:manage');

  /**
   * Pièces du dossier, relues avec le circuit. `null` tant que la lecture n'a pas abouti : une
   * panne ne doit pas afficher « aucune pièce » sur un dossier qui en a.
   */
  public readonly documents = signal<KycDocumentRow[] | null>(null);

  /**
   * Au moins une pièce déposée par un agent : une ligne du registre, avec son auteur. Les images
   * antérieures au registre (`uploadedBy` nul) ne comptent pas — personne n'en répond.
   */
  public readonly hasAgentDocument = computed(() =>
    (this.documents() ?? []).some((d) => !!d.id && !!d.uploadedBy),
  );
  public readonly missingAgentDocument = computed(() => this.documents() !== null && !this.hasAgentDocument());

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
  /** Noms des auteurs, résolus une fois par identifiant : l'historique répète les mêmes. */
  private readonly _authorNames = signal<Record<string, string>>({});
  private readonly _resolvingAuthors = new Set<string>();
  private _historyRequested = false;

  public readonly kycVigilanceMeta = kycVigilanceMeta;
  public readonly kycApprovalLevelLabel = kycApprovalLevelLabel;
  public readonly kycApprovalDecisionMeta = kycApprovalDecisionMeta;

  public readonly vigilance = computed(() => kycVigilanceMeta(this.file()?.vigilanceLevel));



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
      authorName: this.authorLabel(entry.authorId),
      at: entry.at,
    })),
  );

  public readonly historyTableConfig = computed<TableConfig>(() =>
    this._tableConfig(this.historyRows().length),
  );

  // ——— Synthèse (onglet Identité) ———

  public readonly statusMeta = computed(() => kycStatusMeta(this.file()?.status));
  public readonly channel = computed(() => kycChannelMeta(this.file()?.channel));
  public readonly tierLabel = computed(() => kycTierLabel(this.file()?.tier));
  public readonly vigilanceShort = computed(() => kycVigilanceShortLabel(this.file()?.vigilanceLevel));
  public readonly documentCount = computed(() => this.documents()?.length ?? null);

  /**
   * « 2/2 » sur l'onglet Pièces : acceptées sur pièces courantes. Les images remplacées ne comptent
   * pas, elles ne se décident plus.
   */
  public readonly documentBadge = computed(() => {
    const current = (this.documents() ?? []).filter((d) => d.isCurrentForKind);
    if (current.length === 0) return null;
    const accepted = current.filter((d) => d.decision === 'Accepted').length;
    return { label: `${accepted}/${current.length}`, complete: accepted === current.length };
  });

  /** Aide « Comment fonctionne la revue des pièces ? », ouverte par défaut. */
  public readonly showDocumentsHelp = signal(true);
  public readonly hasScore = computed(() => {
    const score = this.file()?.confidenceScore;
    return score !== null && score !== undefined;
  });
  public readonly confidence = computed(() => kycConfidenceMeta(this.file()?.confidenceLevel));

  public readonly initials = computed(() => {
    const name = (this.customerName() ?? '').trim();
    if (!name) return 'KYC';
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? ''))
      .toUpperCase();
  });

  /** « il y a 8 jours » : le pipe `dateTimeAgo` rend une date relative (« mardi dernier »), pas une durée. */
  public readonly openedAgo = computed(() => {
    const createdAt = this.file()?.createdAt;
    if (!createdAt) return null;
    const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
    if (days <= 0) return 'aujourd\'hui';
    if (days === 1) return 'hier';
    if (days < 60) return `il y a ${days} jours`;
    const months = Math.floor(days / 30);
    return months < 24 ? `il y a ${months} mois` : `il y a ${Math.floor(months / 12)} ans`;
  });

  /**
   * Où en est le dossier, en cinq étapes. Déduit du statut, du score et des pièces : aucun champ du
   * contrat ne le dit à lui seul, et le statut seul confond « pas de pièce » et « pas de score ».
   */
  public readonly progress = computed<FileProgress>(() => {
    const file = this.file();
    const status = file?.status ?? '';
    const count = this.documentCount();
    const validated = VALIDATED_STATUSES.includes(status) || !!file?.validatedAt;
    const hasScore = this.hasScore();
    const states = kycProgressStates({
      status,
      confidenceScore: file?.confidenceScore,
      validatedAt: file?.validatedAt,
      documentCount: count,
    });
    const current = states.indexOf('current');
    const state = (i: number): ProgressStepState => states[i];

    const createdAt = file?.createdAt ? SHORT_DATE.format(new Date(file.createdAt)) : '—';
    const steps: ProgressStep[] = [
      { label: 'Ouvert', detail: createdAt, state: state(0) },
      {
        label: 'Pièces reçues',
        detail: count === null ? '—' : count === 0 ? 'Aucune pièce' : `${count} document${count > 1 ? 's' : ''}`,
        state: state(1),
      },
      {
        label: 'Score de confiance',
        detail: hasScore
          ? `${file?.confidenceScore} / 100`
          : status === 'Verifying' ? 'En cours' : 'À calculer',
        state: state(2),
      },
      {
        label: 'Validation',
        detail: validated
          ? 'Décidée'
          : this.vigilance().requiresCompliance ? 'Avec la conformité' : 'Circuit d\'approbation',
        state: state(3),
      },
      {
        label: 'Validé',
        detail: validated
          ? this.tierLabel() ?? 'Validé'
          : file?.nextReviewDate ? `Revue le ${this.formatDay(file.nextReviewDate)}` : 'Revue planifiée',
        state: state(4),
      },
    ];

    switch (status) {
      case 'Rejected':
        return { steps, tone: 'error', message: 'Le dossier a été rejeté par le circuit de validation.',
          action: { label: 'Voir l\'historique', tab: 'historique' } };
      case 'Suspended':
        return { steps, tone: 'error', message: 'Le dossier est suspendu : aucune décision ne peut être prise.',
          action: { label: 'Voir l\'historique', tab: 'historique' } };
      case 'Expired':
        return { steps, tone: 'warning', message: 'La validité du KYC est échue : une revue est nécessaire.',
          action: { label: 'Voir l\'historique', tab: 'historique' } };
      case 'ComplementRequired':
        return { steps, tone: 'warning', message: 'Un complément a été demandé : le client doit fournir de nouvelles pièces.',
          action: { label: 'Voir les pièces', tab: 'piece' } };
      case 'Verifying':
        return { steps, tone: 'default', message: 'Vérification biométrique en cours : le score arrive à son retour.',
          action: { label: 'Voir le score', tab: 'score' } };
    }

    switch (current) {
      case 1:
        return { steps, tone: 'default', message: 'Aucune pièce n\'a encore été reçue pour ce dossier.',
          action: { label: 'Voir les pièces', tab: 'piece' } };
      case 2:
        return { steps, tone: 'default', message: 'Il ne manque que le score de confiance avant la validation.',
          action: { label: 'Calculer le score de confiance', tab: 'score' } };
      case 3:
        return { steps, tone: 'default', message: 'Le dossier attend la décision du circuit de validation.',
          action: { label: 'Ouvrir la validation', tab: 'validation' } };
      default:
        return { steps, tone: 'success', message: `Le dossier est validé${this.tierLabel() ? ' : ' + this.tierLabel() : ''}.`,
          action: null };
    }
  });

  public stepBarClass(state: ProgressStepState): string {
    switch (state) {
      case 'done':    return 'bg-primary';
      case 'current': return 'bg-primary/40';
      default:        return 'bg-slate-200';
    }
  }

  // ——— Onglet Validation ———

  /**
   * Une carte par niveau du circuit, puis la création du client dans le système bancaire, qui suit
   * l'approbation du dernier niveau. Le contrat ne numérote pas les étapes : l'ordre du tableau fait
   * foi, c'est celui dans lequel le serveur exige les signatures.
   */
  public readonly circuitCards = computed(() => {
    const circuit = this.circuit();
    const steps = circuit?.steps ?? [];
    const status = this.file()?.status ?? circuit?.fileStatus ?? '';
    const closed = ['Rejected', 'ComplementRequired', 'Suspended'].includes(status);
    const validated = ['Simplified', 'Full', 'UnderReview'].includes(status);

    const cards = steps.map((step, index) => {
      const meta = kycApprovalDecisionMeta(step.decision);
      const decided = !!step.decision && step.decision !== 'Pending';
      const isNext = !!step.level && step.level === circuit?.nextLevel;
      const previous = index > 0 ? kycApprovalLevelLabel(steps[index - 1].level) : null;

      let title: string;
      let detail: string;
      if (decided) {
        title = meta.label;
        detail = step.decidedAt ? `Le ${SHORT_DATE.format(new Date(step.decidedAt))}` : 'Décision enregistrée';
      } else if (isNext) {
        title = this.canApprove() ? 'À vous de décider' : 'En attente de décision';
        detail = this.workflowTimedOut() ? 'Délai dépassé' : 'Décision attendue';
      } else if (closed) {
        title = 'Non sollicité';
        detail = 'Le circuit a été fermé avant';
      } else {
        title = 'En attente';
        detail = previous ? `Après le niveau ${previous}` : 'À l\'ouverture du circuit';
      }

      return {
        position: index + 1,
        label: kycApprovalLevelLabel(step.level),
        title,
        detail,
        state: (decided ? 'done' : isNext ? 'next' : 'todo') as 'done' | 'next' | 'todo',
        severity: decided ? meta.severity : null,
        comment: step.comment ?? null,
        timedOut: isNext && this.workflowTimedOut(),
      };
    });

    cards.push({
      position: steps.length + 1,
      label: 'Création du client',
      title: validated ? 'Demandée' : closed ? 'Sans objet' : 'En attente du circuit',
      detail: 'Système bancaire',
      state: validated ? 'done' : 'todo',
      severity: null,
      comment: null,
      timedOut: false,
    });
    return cards;
  });

  public readonly circuitProgressLabel = computed(() => {
    const steps = this.circuit()?.steps ?? [];
    const decided = steps.filter((s) => !!s.decision && s.decision !== 'Pending').length;
    return `${decided} décision${decided > 1 ? 's' : ''} sur ${steps.length}`;
  });

  /** « Avant de décider » : ce qu'un valideur vérifie d'un coup d'œil, avec le lien pour agir. */
  public readonly decisionChecklist = computed(() => {
    const file = this.file();
    const badge = this.documentBadge();
    const vigilance = this.vigilance();
    return {
      documents: {
        ok: !!badge?.complete,
        warn: !badge || !badge.complete,
        label: !badge
          ? 'Aucune pièce déposée'
          : badge.complete ? 'Pièces acceptées' : 'Pièces à examiner',
        value: badge?.label ?? null,
      },
      duplicate: { ok: !file?.duplicateSuspected, label: file?.duplicateSuspected ? 'Doublon suspecté' : 'Aucun doublon' },
      score: {
        ok: this.hasScore(),
        label: this.hasScore()
          ? `Score de confiance : ${file?.confidenceScore} / 100`
          : 'Score de confiance non calculé',
      },
      vigilance: {
        label: vigilance.label,
        hint: vigilance.requiresCompliance ? 'Le circuit comporte une étape conformité' : null,
      },
    };
  });

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
          this._loadDocuments();
        });
    });
  }

  public ngOnInit(): void {
    // `?tab=validation` : l'aperçu de la liste mène directement à l'onglet où agir.
    const tab = this._route.snapshot.queryParamMap.get('tab') as KycDetailTab | null;
    if (tab && TABS.some((t) => t.id === tab)) this.selectTab(tab);

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


  /** Le dépôt de pièces se fait dans le parcours d'enrôlement du client. */
  public goToUpload(): void {
    const customerId = this.file()?.customerId;
    if (customerId) this._router.navigate(['/kyc/enrolment', customerId]);
  }

  public reloadDocuments(): void {
    this._loadDocuments();
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

  /**
   * Statut de l'instance de workflow qui reflète ce tour de validation, quand il y en a une.
   *
   * <p>Le module KYC reste la référence : cette instance n'est qu'un reflet, pour la piste d'audit
   * commune, la corbeille « mes étapes » et les statistiques. Elle est donc affichée pour ce qu'elle
   * est, et surtout quand elle <b>contredit</b> le dossier.</p>
   */
  public readonly workflowStatus = computed(() => this.file()?.workflowStatus ?? null);

  /**
   * Vrai quand l'instance a dépassé son délai alors que le dossier, lui, attend toujours sa
   * décision.
   *
   * C'est la divergence assumée du choix d'un délai sur les étapes : le vérificateur de SLA de M12
   * clôt l'instance au-delà de l'échéance, le dossier KYC ne bouge pas — c'est M02 qui gouverne. Sans
   * cet affichage l'alerte n'existerait que dans un journal, et une alerte invisible ne vaut rien.
   */
  public readonly workflowTimedOut = computed(() => this.workflowStatus() === 'TimedOut');

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

  /**
   * Lues dès l'ouverture : le compteur de l'onglet et l'étape « Pièces reçues » en dépendent, et la
   * validation s'en sert pour griser « Approuver ».
   */
  private _loadDocuments(): void {
    this.documents.set(null);
    this._facade
      .listDocuments(this.id())
      .pipe(catchError(() => EMPTY))
      .subscribe((list) => this.documents.set(list.documents));
  }

  private _loadCircuit(): void {
    this.isLoadingCircuit.set(true);
    this.circuitFailed.set(false);
    this._loadDocuments();
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
        this.isLoadingHistory.set(false);
        this._resolveAuthors(entries);
      });
  }

  /** Évènement machine quand aucun auteur n'est donné : ouverture et notation n'ont pas d'auteur. */
  public authorLabel(authorId: string | null): string {
    if (!authorId) return 'Système';
    return this._authorNames()[authorId] ?? 'Utilisateur inconnu';
  }

  private _resolveAuthors(entries: KycHistoryEntry[]): void {
    const known = this._authorNames();
    const pending = new Set(
      entries
        .map((entry) => entry.authorId)
        .filter((id): id is string => !!id && !known[id] && !this._resolvingAuthors.has(id)),
    );

    for (const id of pending) {
      this._resolvingAuthors.add(id);
      this._usersApi
        .getUser(id)
        .pipe(catchError(() => of(null)))
        .subscribe((user) => {
          const name = user?.fullName || user?.email;
          if (name) this._authorNames.update((current) => ({ ...current, [id]: name }));
        });
    }
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
