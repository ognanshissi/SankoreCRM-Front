import { Component, computed, effect, inject, input, signal, OnDestroy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Anchor, Button } from '@talisoft/ui/button';
import {
  AcknowledgeNextActionRequestActionEnum,
  CloseLeadRequestReasonEnum,
  DuplicateMatchResult,
  FormFieldReferenceTargetEnum,
  LeadDto,
  LeadIntentLevelDto,
  LeadsApiService,
  NextActionDto,
  NextActionDtoActionTypeEnum,
} from '@sankore/crm-api';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  BreadcrumbService,
  EntityFormReferences,
  FatcaStatusBadge,
  PepExposureBadge,
  PermissionsService,
} from '@sankore/crm/common';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ReassignLeadDrawer } from './reassign-lead-drawer';
import { EditLeadInfoDrawer } from './edit-lead-info-drawer';
import { ConvertLeadWizard } from './convert-lead-wizard';
import { NurtureRecycleDrawer } from './nurture-recycle-drawer';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { catchError, EMPTY, forkJoin, map, of } from 'rxjs';
import { LeadEditContext } from './lead-edit-context';
import { LeadComplianceStore } from './lead-compliance-store';
import { interestedProductLabel } from '../../components/interested-product';
import {
  displayName,
  formatDay,
  initials,
  intentOption,
  isConsentGap,
  leadStatusMeta,
  originLabel,
} from './lead-view.models';

interface LeadMenuItem {
  label: string;
  icon: string;
  route: string;
}

interface LeadMenuGroup {
  title: string;
  items: LeadMenuItem[];
}

/**
 * Les onglets de la fiche, regroupés comme le parcours d'un agent : qui est le prospect, ce qui
 * a été fait avec lui, ce que son dossier demande encore.
 */
const MENU: ReadonlyArray<LeadMenuGroup> = [
  {
    title: 'Le prospect',
    items: [
      { label: 'Informations', icon: 'feather:user', route: 'informations' },
      { label: 'Identité', icon: 'feather:user-check', route: 'identite' },
      { label: 'Foyer', icon: 'feather:users', route: 'foyer' },
      { label: 'Doublons', icon: 'feather:copy', route: 'doublons' },
    ],
  },
  {
    title: 'Suivi',
    items: [
      { label: 'Activités', icon: 'feather:activity', route: 'activites' },
      { label: 'Rappels', icon: 'feather:bell', route: 'rappels' },
      { label: 'Tâches', icon: 'feather:check-square', route: 'taches' },
      { label: 'Chronologie', icon: 'feather:clock', route: 'timeline' },
    ],
  },
  {
    title: 'Dossier',
    items: [
      { label: 'Qualification', icon: 'feather:list', route: 'qualification' },
      { label: 'Score', icon: 'feather:bar-chart-2', route: 'score' },
      { label: 'Questionnaires', icon: 'feather:clipboard', route: 'questionnaires' },
      { label: 'Conformité', icon: 'feather:flag', route: 'conformite' },
      { label: 'Consentements', icon: 'feather:shield', route: 'consentement' },
      { label: 'Opportunités', icon: 'feather:briefcase', route: 'opportunites' },
    ],
  },
];

interface ScoreFactor {
  label: string;
  value: string;
  impact: string;
}

function parseFactors(factorsJson: string | null | undefined): ScoreFactor[] {
  if (!factorsJson) return [];
  try {
    const parsed = JSON.parse(factorsJson);
    if (Array.isArray(parsed)) return parsed;
    return Object.entries(parsed).map(([key, val]: [string, any]) => ({
      label: key,
      value: typeof val === 'object' ? (val.value ?? val.detail ?? JSON.stringify(val)) : String(val),
      impact: typeof val === 'object' ? (val.impact ?? '') : '',
    }));
  } catch {
    return [];
  }
}

function scoreClasses(score: number): string {
  if (score >= 70) return 'border-green-500 text-green-700';
  if (score >= 40) return 'border-amber-500 text-amber-700';
  return 'border-red-400 text-red-700';
}

@Component({
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TasIcon,
    TasCard,
    TasSpinner,
    Anchor,
    Button,
    TasTag,
    PepExposureBadge,
    FatcaStatusBadge,
    TimeagoPipe,
    Menu,
    MenuItem,
    TasMenuTrigger,
  ],
  templateUrl: './edit-lead-navigation.html',
  styles: [
    `
      .is-link-active {
        background-color: rgb(var(--tas-color-primary));
        color: white;
        font-weight: 600;
      }
      .is-link-active tas-icon {
        color: white;
      }
    `,
  ],
})
export class EditLeadNavigation implements OnDestroy {
  private readonly _permissions = inject(PermissionsService);
  public readonly canUpdate = this._permissions.can('lead:update');

  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _leadEditContext = inject(LeadEditContext);
  private readonly _references = inject(EntityFormReferences);
  protected readonly compliance = inject(LeadComplianceStore);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  public readonly id = input.required<string>();

  public readonly menu = MENU;
  public readonly formatDay = formatDay;

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);
  public notFound = signal(false);
  public showFactors = signal(false);
  public isReopening = signal(false);
  public isReturningToQueue = signal(false);
  public nextAction = signal<NextActionDto | null>(null);
  public intentLevelDetail = signal<LeadIntentLevelDto | null>(null);
  public latestFactorsJson = signal<string | null>(null);
  private readonly _duplicates = signal<DuplicateMatchResult[]>([]);
  private readonly _dismissed = signal<Set<string>>(new Set());

  /** Lu par le template : un lead converti n'offre plus d'action d'écriture. */
  public readonly isConverted = computed(() => this.lead()?.status === 'Converted');
  public readonly productLabel = computed(() => interestedProductLabel(this.lead()?.interestedProduct));
  public readonly name = computed(() => displayName(this.lead()));
  public readonly avatar = computed(() => initials(this.name()));
  public readonly statusMeta = computed(() => leadStatusMeta(this.lead()?.status));
  public readonly intent = computed(() => intentOption(this.lead()?.intentLevel));
  public readonly origin = computed(() => originLabel(this.lead()));
  public readonly scoreFactors = computed(() => parseFactors(this.latestFactorsJson()));

  /** « suivi par Fatou Diallo » — l'agent qui a le lead, ou son responsable à défaut. */
  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
    ),
    { initialValue: new Map<string, string>() },
  );
  public readonly followedBy = computed(() => {
    const lead = this.lead();
    const id = lead?.currentAssignedId ?? lead?.ownerId;
    return id ? this._users().get(id) ?? null : null;
  });

  /**
   * « Pas encore qualifié » tant qu'aucune réponse de qualification n'existe : le score calculé à
   * la capture ne pèse que la source et les données saisies, et l'afficher comme un verdict fait
   * lire 30/100 comme un mauvais prospect plutôt que comme un prospect pas encore interrogé.
   */
  public readonly isUnqualified = computed(() => {
    const lead = this.lead();
    return !!lead && (lead.qualificationCompleteness ?? 0) === 0
      && lead.status !== 'Qualified' && lead.status !== 'Converted';
  });

  public readonly scoreRing = computed(() => scoreClasses(this.lead()?.score ?? 0));

  // ——— Ce que les compteurs du menu et l'en-tête signalent ———

  public readonly missingConsents = computed(
    () => (this.compliance.completeness()?.gaps ?? []).filter((g) => isConsentGap(g.code)).length,
  );

  public readonly duplicateCount = computed(() => {
    const id = this.id();
    const dismissed = this._dismissed();
    return this._duplicates().filter((d) => d.leadId && d.leadId !== id && !dismissed.has(d.leadId)).length;
  });

  public readonly qualificationBadge = computed(() => {
    const done = this.lead()?.qualificationCompleteness ?? 0;
    if (this.isConverted()) return null;
    if (done <= 0) return 'À faire';
    if (done < 1) return 'En cours';
    return null;
  });

  public badgeFor(route: string): { text: string; tone: 'red' | 'amber' | 'slate' } | null {
    switch (route) {
      case 'doublons':
        return this.duplicateCount() > 0 ? { text: String(this.duplicateCount()), tone: 'red' } : null;
      case 'consentement':
        return this.missingConsents() > 0 ? { text: String(this.missingConsents()), tone: 'amber' } : null;
      case 'qualification': {
        const badge = this.qualificationBadge();
        return badge ? { text: badge, tone: 'slate' } : null;
      }
      default:
        return null;
    }
  }

  /**
   * BNF-F-08 : « Convertir » n'est actif que si l'API l'autorise. La complétude *indisponible*
   * n'est pas un refus : si l'appel a échoué, on laisse le serveur trancher (il répond 409 avec
   * le motif) plutôt que de rendre l'action inatteignable.
   */
  public readonly convertDisabled = computed(() => {
    if (this.compliance.isLoading()) return true;
    if (this.compliance.completeness() === null) return false;
    return !this.compliance.canConvert();
  });

  public readonly convertDisabledHint = computed(() => {
    if (!this.convertDisabled()) return null;
    if (this.compliance.isLoading()) return 'Contrôle du dossier en cours…';
    return 'Dossier incomplet : complétez les éléments manquants listés dans « Fiche complète ».';
  });

  /**
   * BNF-F-19 : un lead rattaché à un client existant ne crée pas de fiche. Le contrat n'a pas de
   * drapeau dédié — `customerReference`, saisie à la capture, est le seul indice disponible.
   */
  public readonly convertActionLabel = computed(() => {
    const lead = this.lead();
    const attached = !!lead?.customerReference?.trim() || !!lead?.convertedToCustomerId;
    return attached ? 'Créer la souscription' : 'Convertir en client';
  });

  public readonly canBeConverted = computed(() => {
    const status = this.lead()?.status;
    return status !== 'Converted' && status !== 'Lost' && status !== 'Disqualified' && status !== 'Archived';
  });

  /** Les statuts que le serveur accepte de rouvrir (Lead.Reopen). */
  public readonly canBeReopened = computed(() => {
    const status = this.lead()?.status;
    return status === 'Lost' || status === 'Disqualified' || status === 'Recycled';
  });

  // ——— Cycle de vie ———

  public readonly lifecycleSteps = [
    { status: 'New', label: 'Nouveau', bar: 'bg-primary', text: 'text-primary' },
    { status: 'Open', label: 'Contacté', bar: 'bg-amber-500', text: 'text-amber-700' },
    { status: 'Qualified', label: 'Qualifié', bar: 'bg-violet-500', text: 'text-violet-700' },
    { status: 'Converted', label: 'Converti', bar: 'bg-green-600', text: 'text-green-700' },
  ];

  private readonly _lifecycleOrder: Record<string, number> = {
    New: 0, Open: 1, Qualifying: 1, Qualified: 2, Converted: 3,
    Nurturing: 1, Recycled: 1, Lost: -1, Disqualified: -1, Archived: -1,
  };

  public isLifecycleReached(stepStatus: string): boolean {
    const currentOrder = this._lifecycleOrder[this.lead()?.status ?? ''] ?? -1;
    return (this._lifecycleOrder[stepStatus] ?? -1) <= currentOrder;
  }

  public isLifecycleCurrent(stepStatus: string): boolean {
    const current = this._lifecycleOrder[this.lead()?.status ?? ''] ?? -1;
    return current === this._lifecycleOrder[stepStatus];
  }

  constructor() {
    // Le lead est rechargé à une dizaine d'endroits (actions du menu, polling).
    // Un effet de recopie évite d'avoir à penser au contexte partagé à chaque
    // fois : il suffit qu'un jour un `lead.set()` de plus soit ajouté ici pour
    // que les onglets restent corrects.
    effect(() => this._leadEditContext.set(this.lead()));
    this._leadEditContext.registerReloader(() => this.reload());

    // Le foyer, la PPE, FATCA et les questionnaires sont chargés une fois pour
    // la fiche entière : l'en-tête en a besoin pour ses badges, et chaque onglet
    // les relirait sinon pour son compte.
    effect(() => this.compliance.load(this.id()));

    effect(() => {
      const id = this.id();
      this.isLoading.set(true);
      this.notFound.set(false);
      this._stopPolling();

      this._leadsApiService.getLead(id).pipe(
        catchError((err) => {
          this.isLoading.set(false);
          if (err.status === 404 || err.status === 403) {
            this.notFound.set(true);
          }
          return EMPTY;
        }),
      ).subscribe((lead) => {
        this._setLead(lead);
        this.isLoading.set(false);
        this._loadScoreFactors(id);
        this._loadNextAction(id);
        this._loadIntentLevel(id);
        this._loadDuplicates(lead);
        this._startPolling(id);
      });
    });
  }

  ngOnDestroy(): void {
    this._stopPolling();
  }

  /** Relit le lead pour toute la fiche — voir `LeadEditContext.reload`. */
  public reload(): void {
    this._leadsApiService.getLead(this.id()).pipe(catchError(() => EMPTY)).subscribe((lead) => {
      this._setLead(lead);
      this._loadNextAction(this.id());
    });
    this.compliance.reloadAfterWrite();
  }

  private _setLead(lead: LeadDto): void {
    this.lead.set(lead);
    this._breadcrumbService.set([
      { label: 'Leads', link: ['/leads'] },
      { label: displayName(lead) },
    ]);
  }

  public closeLead(): void {
    this._confirmDialog.confirm({
      title: 'Clôturer ce lead ?',
      message: 'Le lead sera marqué comme perdu. Cette action peut être annulée via « Réouvrir ».',
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Clôturer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._leadsApiService.closeLead(this.id(), {
          reason: CloseLeadRequestReasonEnum.Lost,
          detail: 'Clôturé manuellement par l\'agent',
        }).pipe(catchError(() => { this._snackbar.error('Erreur', 'Clôture échouée.'); return EMPTY; }))
          .subscribe(() => {
            this._snackbar.success('Lead clôturé', 'Le lead a été marqué comme perdu.');
            this.reload();
          });
      },
    });
  }

  public returnToQueue(): void {
    this._confirmDialog.confirm({
      title: 'Remettre en file d\'attente ?',
      message: 'Le lead sera retiré de votre portefeuille et redistribué automatiquement.',
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Confirmer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isReturningToQueue.set(true);
        this._leadsApiService.returnLeadToQueue(this.id()).pipe(
          catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); return EMPTY; }),
        ).subscribe(() => {
          this._snackbar.success('Lead en file', 'Le lead a été remis en file d\'attente.');
          this.isReturningToQueue.set(false);
          this.reload();
        });
      },
    });
  }

  /**
   * « Lancer » : l'action recommandée est acceptée, et quand elle consiste à qualifier le lead,
   * l'agent est mené à l'onglet où il le fait — accepter sans y aller ne faisait rien voir.
   */
  public acceptNextAction(): void {
    const action = this.nextAction();
    this.acknowledgeNextAction('Accept');
    if (action?.actionType === NextActionDtoActionTypeEnum.Qualify
        || action?.actionType === NextActionDtoActionTypeEnum.CompleteQualification) {
      this._router.navigate(['/leads', this.id(), 'qualification']);
    }
  }

  public acknowledgeNextAction(action: 'Accept' | 'Ignore'): void {
    this._leadsApiService.acknowledgeLeadNextAction(this.id(), {
      action: action === 'Accept' ? AcknowledgeNextActionRequestActionEnum.Accept : AcknowledgeNextActionRequestActionEnum.Ignore,
    }).pipe(
      catchError(() => EMPTY),
    ).subscribe(() => this.nextAction.set(null));
  }

  public reopenLead(): void {
    this.isReopening.set(true);
    this._leadsApiService.reopenLead(this.id()).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de réouvrir le lead.');
        this.isReopening.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Lead réouvert', 'Le lead est de nouveau actif.');
      this.isReopening.set(false);
      this.reload();
    });
  }

  public openNurtureRecycleDrawer(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(NurtureRecycleDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { lead: currentLead },
    });

    ref.closed.subscribe((result: unknown) => {
      if (result === 'nurtured' || result === 'recycled') this.reload();
    });
  }

  public openConvertWizard(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(ConvertLeadWizard, {
      panelClass: 'side-drawer-panel',
      data: { lead: currentLead },
    });

    ref.closed.subscribe((result: any) => {
      // L'assistant rend l'identifiant du client (fiche créée, ou fiche existante proposée sur un
      // doublon bloquant) : la redirection reste ici, pour ne pas dépendre du module Clients.
      if (result && typeof result === 'object' && result.clientId) {
        this._router.navigate(['/customers', result.clientId]);
        return;
      }
      if (result) this.reload();
    });
  }

  public openEditInfoDrawer(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(EditLeadInfoDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { lead: currentLead },
    });

    ref.closed.subscribe((updated) => {
      if (updated) this.reload();
    });
  }

  public openReassignDrawer(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(ReassignLeadDrawer, {
      data: { lead: currentLead },
    });

    ref.closed.subscribe((reassigned) => {
      if (reassigned) this.reload();
    });
  }

  public toggleFactorsPanel(): void {
    this.showFactors.update((v) => !v);
  }

  private _loadIntentLevel(leadId: string): void {
    this._leadsApiService.getLeadIntentLevel(leadId).pipe(
      catchError(() => EMPTY),
    ).subscribe((detail) => this.intentLevelDetail.set(detail ?? null));
  }

  private _loadNextAction(leadId: string): void {
    this._leadsApiService.getLeadNextAction(leadId).pipe(
      catchError(() => EMPTY),
    ).subscribe((action) => this.nextAction.set(action ?? null));
  }

  private _loadScoreFactors(leadId: string): void {
    this._leadsApiService.getLeadScoreHistory(leadId).pipe(
      catchError(() => EMPTY),
    ).subscribe((history) => {
      const latest = history?.[0];
      this.latestFactorsJson.set(latest?.factorsJson ?? null);
    });
  }

  /**
   * Le compteur du menu « Doublons » : la même recherche que l'onglet, moins le lead lui-même et
   * les correspondances déjà écartées. Une panne laisse le compteur vide, pas l'écran.
   */
  private _loadDuplicates(lead: LeadDto): void {
    forkJoin({
      duplicates: this._leadsApiService
        .findLeadDuplicates(
          lead.phoneNumber ?? undefined, lead.email ?? undefined, lead.nationalId ?? undefined,
          lead.customerReference ?? undefined, lead.fullName ?? undefined,
          undefined, undefined, undefined, undefined, lead.id,
        )
        .pipe(catchError(() => of([] as DuplicateMatchResult[]))),
      dismissals: this._leadsApiService.listDismissals(lead.id ?? this.id()).pipe(catchError(() => of([]))),
    }).subscribe(({ duplicates, dismissals }) => {
      this._duplicates.set(duplicates ?? []);
      // `candidateLeadId` est le lead écarté ; `leadId` est celui-ci.
      this._dismissed.set(new Set((dismissals ?? []).map((d) => d.candidateLeadId ?? '').filter(Boolean)));
    });
  }

  /** Poll every 30s to pick up real-time score recalculations */
  private _startPolling(leadId: string): void {
    this._pollTimer = setInterval(() => {
      this._leadsApiService.getLead(leadId).pipe(
        catchError(() => EMPTY),
      ).subscribe((lead) => {
        const current = this.lead();
        if (current && (current.score !== lead.score
            || current.intentLevel !== lead.intentLevel
            || current.updatedAt !== lead.updatedAt)) {
          this.lead.set(lead);
          this._loadScoreFactors(leadId);
        }
      });
    }, 30_000);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}

export default EditLeadNavigation;
