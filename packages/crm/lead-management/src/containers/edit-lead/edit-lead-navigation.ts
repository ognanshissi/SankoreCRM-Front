import { Component, computed, DestroyRef, effect, inject, input, OnDestroy, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
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
  LogActivityRequestTypeEnum,
  LeadNextStepDtoActionTypeEnum,
  LeadNextStepDtoKindEnum,
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
import { LogActivityDrawer, LogActivityDrawerData } from './log-activity-drawer';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { catchError, EMPTY, filter, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { LeadEditContext } from './lead-edit-context';
import { LeadComplianceStore } from './lead-compliance-store';
import { interestedProductLabel } from '../../components/interested-product';
import { nextStepDue, nextStepDueClass, nextStepIcon } from '../../components/lead-next-step';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import {
  displayName,
  formatDay,
  initials,
  intentOption,
  isConsentGap,
  leadStatusMeta,
  missingAddressParts,
  originLabel,
} from './lead-view.models';

interface LeadMenuItem {
  label: string;
  icon: string;
  route: string;
}

interface LeadMenuGroup {
  title: string;
  icon: string;
  items: LeadMenuItem[];
}

type MenuBadge = { text: string; tone: 'red' | 'amber' | 'slate' };

/**
 * Les onglets de la fiche, regroupés comme le parcours d'un agent : qui est le prospect, ce qui
 * a été fait avec lui, ce que son dossier demande encore.
 */
const MENU: ReadonlyArray<LeadMenuGroup> = [
  {
    title: 'Le prospect',
    icon: 'feather:user',
    items: [
      { label: 'Informations', icon: 'feather:user', route: 'informations' },
      { label: 'Identité', icon: 'feather:user-check', route: 'identite' },
      { label: 'Foyer', icon: 'feather:users', route: 'foyer' },
      { label: 'Doublons', icon: 'feather:copy', route: 'doublons' },
    ],
  },
  {
    title: 'Suivi',
    icon: 'feather:activity',
    items: [
      // Une seule page, dont les quatre sous-pages (activités, rappels, tâches, chronologie) sont
      // des onglets — voir `suivi/suivi.ts`.
      { label: 'Suivi', icon: 'feather:activity', route: 'suivi' },
    ],
  },
  {
    title: 'Dossier',
    icon: 'feather:folder',
    items: [
      { label: 'Qualification', icon: 'feather:list', route: 'qualification' },
      { label: 'Score', icon: 'feather:bar-chart-2', route: 'score' },
      { label: 'Questionnaires', icon: 'feather:clipboard', route: 'questionnaires' },
      { label: 'Conformité', icon: 'feather:flag', route: 'conformite' },
      { label: 'Consentements', icon: 'feather:shield', route: 'consentement' },
      { label: 'Projets', icon: 'feather:briefcase', route: 'projets' },
    ],
  },
];

interface ScoreFactor {
  label: string;
  value: string;
  impact: string;
}

/** Les dimensions que `LeadScoreCalculator` sérialise, en français. */
const FACTOR_LABELS: Record<string, string> = {
  profileCompleteness: 'Profil renseigné',
  sourceQuality: 'Qualité de la source',
  interactions: 'Échanges',
  behaviour: 'Engagement',
  declarativeCoherence: 'Cohérence déclarative',
  location: 'Localisation',
  address: 'Adresse',
};

function parseFactors(factorsJson: string | null | undefined): ScoreFactor[] {
  if (!factorsJson) return [];
  try {
    const parsed = JSON.parse(factorsJson);
    if (Array.isArray(parsed)) return parsed;
    return Object.entries(parsed).filter(([key]) => key !== 'total').map(([key, val]: [string, any]) => ({
      label: FACTOR_LABELS[key] ?? key,
      value: typeof val === 'object' ? (val.value ?? val.detail ?? JSON.stringify(val)) : String(val),
      impact: typeof val === 'object' ? (val.impact ?? '') : '',
    }));
  } catch {
    return [];
  }
}

function scoreBarClass(score: number, threshold: number): string {
  if (score >= threshold) return 'bg-green-600';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

/** Valeur par défaut du planificateur : demain, 9 h, au format d'un `<input type="datetime-local">`. */
function defaultPlanDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@Component({
  imports: [
    FormRoot,
    FormField,
    RouterLink,
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
  // En bloc : la barre des rubriques est `sticky`, et un hôte en ligne (le défaut d'un composant)
  // ne lui donnerait aucune hauteur à l'intérieur de laquelle rester collée.
  host: { class: 'block' },
})
export class EditLeadNavigation implements OnDestroy {
  private readonly _permissions = inject(PermissionsService);
  public readonly canUpdate = this._permissions.can('lead:update');

  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _breadcrumbOwner = inject(DestroyRef);
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

  /**
   * La rubrique affichée, lue dans l'URL (`/leads/{id}/foyer` → `foyer`), et son groupe : c'est lui
   * qui est ouvert dans la barre, si bien qu'un lien direct vers une rubrique ouvre le bon groupe.
   */
  private readonly _url = toSignal(
    inject(Router).events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: inject(Router).url },
  );
  /** Le segment qui suit l'identifiant du lead : `suivi` pour `/leads/{id}/suivi/rappels`. */
  public readonly activeRoute = computed(() => {
    const segments = this._url().split(/[?#]/)[0].split('/').filter(Boolean);
    const at = segments.indexOf(this.id());
    return (at >= 0 ? segments[at + 1] : segments[segments.length - 1]) ?? '';
  });
  public readonly activeGroup = computed(
    () => MENU.find((g) => g.items.some((i) => i.route === this.activeRoute())) ?? MENU[0],
  );

  /** La rubrique affichée, quand elle appartient à ce groupe — le bouton du groupe la nomme. */
  public activeItem(group: LeadMenuGroup): LeadMenuItem | null {
    return group.items.find((i) => i.route === this.activeRoute()) ?? null;
  }

  /**
   * Le résumé d'un groupe : la somme de ses compteurs, dans le ton le plus grave. Un badge
   * sans nombre (« À faire ») devient un point — on sait qu'il y a quelque chose, sans le détail.
   */
  public groupBadge(group: LeadMenuGroup): MenuBadge | null {
    const badges = group.items.map((i) => this.badgeFor(i.route)).filter((b): b is MenuBadge => !!b);
    if (badges.length === 0) return null;
    const tone = badges.some((b) => b.tone === 'red') ? 'red' : badges.some((b) => b.tone === 'amber') ? 'amber' : 'slate';
    const counts = badges.map((b) => Number(b.text)).filter((n) => Number.isFinite(n));
    const total = counts.reduce((sum, n) => sum + n, 0);
    return { text: total > 0 ? String(total) : '•', tone };
  }
  public readonly formatDay = formatDay;

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);
  public notFound = signal(false);
  public showFactors = signal(false);
  public isReopening = signal(false);
  public isReturningToQueue = signal(false);
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

  // ——— Prochaine étape : calculée par le serveur (`LeadDto.nextStep`), relue avec le lead ———

  public readonly nextStep = computed(() => (this.isConverted() ? null : this.lead()?.nextStep ?? null));
  public readonly nextStepDue = computed(() => nextStepDue(this.nextStep()));
  public readonly nextStepIcon = computed(() => nextStepIcon(this.nextStep()));
  public readonly nextStepDueClass = computed(() => nextStepDueClass(this.nextStepDue().tone));
  public readonly nextStepAssignee = computed(() => {
    const id = this.nextStep()?.assigneeId;
    return id ? this._users().get(id) ?? null : null;
  });
  public readonly nextStepIsQualification = computed(() => {
    const type = this.nextStep()?.actionType;
    return type === LeadNextStepDtoActionTypeEnum.Qualify || type === LeadNextStepDtoActionTypeEnum.CompleteQualification;
  });
  public readonly nextStepKind = LeadNextStepDtoKindEnum;

  /** « Planifier » une suggestion : le serveur en fait un rappel, qui devient l'étape datée. */
  public readonly showPlanner = signal(false);
  public readonly planModel = signal({ dueAt: defaultPlanDate() });
  public readonly planForm = form(this.planModel, (schema) => {
    required(schema.dueAt, { message: 'Choisissez une date' });
    validate(schema.dueAt, (ctx) =>
      ctx.value() && new Date(ctx.value()).getTime() <= Date.now()
        ? { kind: 'past', message: 'Choisissez une date à venir.' }
        : undefined,
    );
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

  /** Le seuil de qualification du serveur ; 60, la valeur historique, s'il ne l'a pas envoyé. */
  public readonly threshold = computed(() => this.lead()?.qualificationThreshold ?? 60);
  public readonly scoreValue = computed(() => Math.max(0, Math.min(100, this.lead()?.score ?? 0)));
  public readonly pointsToThreshold = computed(() => Math.max(0, this.threshold() - this.scoreValue()));
  public readonly scoreBar = computed(() => scoreBarClass(this.scoreValue(), this.threshold()));

  // ——— Ce que les compteurs du menu et l'en-tête signalent ———

  public readonly missingConsents = computed(
    () => (this.compliance.completeness()?.gaps ?? []).filter((g) => isConsentGap(g.code)).length,
  );

  public readonly duplicateCount = computed(() => {
    const id = this.id();
    const dismissed = this._dismissed();
    return this._duplicates().filter((d) => d.leadId && d.leadId !== id && !dismissed.has(d.leadId)).length;
  });

  /** Les éléments de l'adresse encore vides : ce que l'onglet Identité propose de compléter. */
  public readonly missingAddress = computed(() => {
    const lead = this.lead();
    return lead ? missingAddressParts(lead.address).length : 0;
  });

  /** Aucun échange noté : « 0 » sur Activités, tant que le lead est en cours. */
  public readonly hasNoActivity = computed(() => {
    const lead = this.lead();
    return !!lead && !lead.lastActivityAt && this.canBeConverted();
  });

  public readonly qualificationBadge = computed(() => {
    const done = this.lead()?.qualificationCompleteness ?? 0;
    if (this.isConverted()) return null;
    if (done <= 0) return 'À faire';
    if (done < 1) return 'En cours';
    return null;
  });

  public badgeFor(route: string): MenuBadge | null {
    switch (route) {
      case 'identite':
        return this.missingAddress() > 0 && !this.isConverted()
          ? { text: String(this.missingAddress()), tone: 'amber' }
          : null;
      case 'suivi':
        return this.hasNoActivity() ? { text: '0', tone: 'amber' } : null;
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

  /**
   * Un lead « Nouveau » n'a encore parlé à personne : l'action de l'en-tête est le premier
   * contact, pas la conversion — on ne convertit pas un prospect qu'on n'a jamais eu au bout du fil.
   */
  public readonly awaitsFirstContact = computed(() => this.lead()?.status === 'New');

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
      // Un enrichissement de l'adresse ou un appel noté recalcule le score côté serveur.
      this._loadScoreFactors(this.id());
    });
    this.compliance.reloadAfterWrite();
  }

  private _setLead(lead: LeadDto): void {
    this.lead.set(lead);
    this._breadcrumbService.setForTabs([
      { label: 'Leads', link: ['/leads'] },
      { label: displayName(lead) },
    ], this._breadcrumbOwner);
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

  public openPlanner(): void {
    this.planModel.set({ dueAt: defaultPlanDate() });
    this.showPlanner.set(true);
  }

  public planNextStep(): void {
    submit(this.planForm, async (field) => {
      const dueAt = new Date(field().value().dueAt).toISOString();
      const ok = await firstValueFrom(this._leadsApiService.acknowledgeLeadNextAction(this.id(), {
        action: AcknowledgeNextActionRequestActionEnum.Reschedule,
        rescheduledAt: dueAt,
      }).pipe(
        map(() => true),
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de planifier cette étape.');
          return of(false);
        }),
      ));
      if (!ok) return;
      this.showPlanner.set(false);
      this._snackbar.success('Étape planifiée', 'Un rappel a été créé à cette date.');
      this.reload();
    });
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

  /** « Premier contact » : le panneau d'activité ouvert sur un appel, dont l'issue fait avancer le statut. */
  public openFirstContact(): void {
    const lead = this.lead();
    if (!lead) return;
    const data: LogActivityDrawerData = {
      leadId: this.id(),
      leadName: displayName(lead),
      initialType: LogActivityRequestTypeEnum.Call,
    };
    const ref = this._sideDrawerService.open(LogActivityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });
    ref.closed.subscribe((result) => {
      if (result) this.reload();
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
