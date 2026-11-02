import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin, map, of, switchMap } from 'rxjs';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasFormField } from '@talisoft/ui/form-field';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  ActivityDto,
  AgenciesApiService,
  CrmTaskDto,
  CustomerMatchDto,
  FormFieldReferenceTargetEnum,
  HoldingDto,
  LeadsApiService,
  LogActivityRequestTypeEnum,
  OpportunitiesApiService,
  OpportunityDto,
  ProductHoldingsApiService,
  ReminderDto,
  SetIntentLevelRequestIntentLevelEnum,
  TagDto,
  TasksApiService,
} from '@sankore/crm-api';
import {
  AuthenticationService,
  completenessGapTitle,
  completenessGapSection,
  CustomFieldsCard,
  EntityFormReferences,
  PERMISSIONS,
  PermissionsService,
  WireValue,
  ProductNamesStore,
} from '@sankore/crm/common';
import { WhatsAppContactButton } from './whatsapp/whatsapp-contact-button';
import { LeadEditContext } from './lead-edit-context';
import { LeadComplianceStore } from './lead-compliance-store';
import { interestedProductLabel } from '../../components/interested-product';
import { ConvertedLeadNotice } from './converted-lead-notice';
import { EditLeadInfoDrawer, genderLabel } from './edit-lead-info-drawer';
import { LogActivityDrawer, LogActivityDrawerData } from './log-activity-drawer';
import { CustomerMatchBanner, CustomerMatchView, customerMatchViewFromDto } from './customer-match-banner';
import { AttachCustomerDrawer, AttachCustomerDrawerData, AttachCustomerResult } from './attach-customer-drawer';
import { ReassignLeadDrawer } from './reassign-lead-drawer';
import { CreateOpportunityDrawer, CreateOpportunityDrawerData } from './opportunities/create-opportunity-drawer';
import { isClosed, stepLabel } from './opportunities/opportunity.model';
import {
  ageOf,
  formatAmount,
  formatDay,
  INTENT_OPTIONS,
  intentOption,
  journeyOffTrack,
  LEAD_STATUS_STEPS,
  originLabel,
  prospectTypeLabel,
  statusStepIndex,
  statusStepLabel,
} from './lead-view.models';

/** Une correspondance client, avec ses produits et demandes, avant mise en forme. */
interface LeadCustomerMatchRaw {
  dto: CustomerMatchDto;
  holdings: HoldingDto[] | null;
  opportunities: OpportunityDto[] | null;
}

/** Où se corrige un élément manquant de la jauge de complétude — l'onglet de la fiche. */
const GAP_SECTION_LABEL: Record<string, string> = {
  identite: 'Identité',
  foyer: 'Foyer',
  questionnaires: 'Questionnaires',
  conformite: 'Conformité',
  consentement: 'Consentements',
  client: 'Fiche client',
};

/** Une ligne de « Prochaines activités » : une tâche ou un rappel du lead. */
interface UpcomingItem {
  key: string;
  at: number;
  label: string;
  icon: string;
  when: string;
  tone: string;
  link: string[];
}

const UPCOMING_LIMIT = 5;
const NOTES_LIMIT = 3;
const WHEN_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « Lun. 3 nov. · 10:00 », l'heure omise quand elle tombe à minuit (une date sans heure). */
function upcomingWhen(at: Date): string {
  const day = WHEN_FMT.format(at);
  const label = day.charAt(0).toUpperCase() + day.slice(1);
  return at.getHours() === 0 && at.getMinutes() === 0 ? label : `${label} · ${TIME_FMT.format(at)}`;
}

/** Rouge en retard, ambre dans les 48 h, gris au-delà. */
function upcomingTone(at: number, now: number): string {
  if (at < now) return 'text-red-700';
  return at - now < 48 * 3_600_000 ? 'text-amber-800' : 'text-slate-600';
}

/** Les types de tâche qui se traitent au téléphone : l'icône d'appel, comme sur la maquette. */
const CALL_TASK_TYPES = new Set(['FirstContact', 'Qualification', 'SlaFollowUp']);

/** Les pointes de la frise du statut, en `clip-path` : la première étape n'a pas d'encoche. */
const CHEVRON = 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)';
const CHEVRON_FIRST = 'polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)';

/** Le numéro d'une pièce lisible à moitié : assez pour le reconnaître, pas pour le recopier. */
function maskDocument(value: string): string {
  const v = value.replace(/\s+/g, '');
  if (v.length <= 6) return v.replace(/.(?=.{2})/g, '•');
  return `${v.slice(0, 4)} •••• ${v.slice(-4)}`;
}

/**
 * L'onglet « Vue d'ensemble » de la fiche lead (maquette du 2026-11-02) : son intérêt et où il en
 * est, ses étiquettes, l'essentiel de la fiche (le reste derrière « Tout afficher »), les notes, ses
 * projets ouverts et ce qui est prévu avec lui ; puis le besoin détaillé et ce qui manque au dossier.
 *
 * <p>Le lead est celui de la coque (`LeadEditContext`) et non une copie rechargée ici : l'en-tête
 * et cet onglet ne peuvent plus diverger, et chaque écriture redemande un rechargement à la coque
 * pour toute la fiche.</p>
 */
@Component({
  selector: 'lead-informations',
  templateUrl: './informations.html',
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    RouterLink,
    TasSpinner,
    TasIcon,
    TasInput,
    TasFormField,
    TasTag,
    Button,
    TimeagoPipe,
    Menu,
    MenuItem,
    TasMenuTrigger,
    ConvertedLeadNotice,
    CustomerMatchBanner,
    CustomFieldsCard,
    WhatsAppContactButton,
  ],
})
export class LeadInformationsPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _leadEditContext = inject(LeadEditContext);
  private readonly _productNames = inject(ProductNamesStore).ensureLoaded();
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _references = inject(EntityFormReferences);
  protected readonly compliance = inject(LeadComplianceStore);

  public readonly id = input.required<string>();

  // L'état « converti » est replié dans les gardes de droits déjà lues par le template : chaque
  // action d'écriture passe par l'une d'elles, il n'y a donc pas d'endroit où la règle s'oublie.
  private readonly _canTag = this._permissions.can('lead:tag');
  private readonly _canUpdate = this._permissions.can('lead:update');
  public readonly canTag = computed(() => this._canTag() && !this._leadEditContext.isReadOnly());
  public readonly canUpdate = computed(() => this._canUpdate() && !this._leadEditContext.isReadOnly());
  public readonly canReadCustomers = this._permissions.can(PERMISSIONS.CUSTOMERS_READ);
  private readonly _canAssign = this._permissions.can('lead:assign');
  private readonly _canLogActivity = this._permissions.can('lead:activity:log');
  private readonly _canManageProjects = this._permissions.can('lead:opportunity:manage');
  private readonly _canReadTasks = this._permissions.can('lead:task:read');
  private readonly _canReadReminders = this._permissions.can('lead:reminder:manage');
  public readonly canAssign = computed(() => this._canAssign() && !this._leadEditContext.isReadOnly());
  public readonly canLogActivity = computed(() => this._canLogActivity() && !this._leadEditContext.isReadOnly());
  public readonly canCreateProject = computed(() => this._canManageProjects() && !this._leadEditContext.isReadOnly());

  /**
   * Rattacher et détacher sont des écritures sur le lead : le contrat n'expose pas de droit dédié
   * pour `PUT /leads/{id}/customer`, et `lead:update` est le plus proche.
   */
  public readonly canLinkCustomer = this.canUpdate;
  public readonly linkDisabledReason = computed(() => {
    if (this.canLinkCustomer()) return null;
    if (this._leadEditContext.isConverted()) return 'Lead converti : le rattachement client n\'est plus modifiable.';
    return 'Vous n\'avez pas le droit de modifier ce lead.';
  });

  public readonly lead = this._leadEditContext.lead;
  public readonly isConverted = this._leadEditContext.isConverted;
  public readonly isLoading = computed(() => !this._leadEditContext.isKnown());

  public readonly productLabel = computed(() => interestedProductLabel(this.lead()?.interestedProduct, this._productNames.names()));
  public readonly firstName = computed(() => this.lead()?.firstName || this.lead()?.fullName?.split(' ')[0] || 'le prospect');
  public readonly age = computed(() => ageOf(this.lead()?.dateOfBirth));
  public readonly isCompany = computed(() => this.lead()?.prospectType === 'Corporate');

  public readonly prospectTypeLabel = prospectTypeLabel;
  public readonly genderLabel = genderLabel;
  public readonly formatDay = formatDay;
  public readonly amount = computed(() => {
    const a = this.lead()?.desiredAmount;
    return a?.amount ? formatAmount(a.amount, a.currency) : null;
  });

  public readonly formatAmount = formatAmount;
  public readonly origin = computed(() => originLabel(this.lead()));
  public readonly showAll = signal(false);

  /** « Yopougon, Abidjan » : le quartier et la ville, ce que l'agent cherche pour une visite. */
  public readonly location = computed(() => {
    const a = this.lead()?.address;
    return [a?.neighbourhood, a?.city].filter((v) => !!v?.trim()).join(', ') || null;
  });
  public readonly agencyName = computed(() => {
    const id = this.lead()?.agencyId;
    return id ? this._agencyNames()[id] ?? null : null;
  });

  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
      catchError(() => of(new Map<string, string>())),
    ),
    { initialValue: new Map<string, string>() },
  );
  /** L'agent qui a le lead, ou son responsable à défaut. */
  public readonly followedBy = computed(() => {
    const lead = this.lead();
    const id = lead?.currentAssignedId ?? lead?.ownerId;
    return id ? this._users().get(id) ?? null : null;
  });
  public userName(id: string | null | undefined): string {
    return (id && this._users().get(id)) || 'Un collègue';
  }

  // ——— Intérêt ressenti et statut ———

  public readonly intentOptions = INTENT_OPTIONS;
  public readonly intent = computed(() => intentOption(this.lead()?.intentLevel));
  public readonly canSetIntent = this.canUpdate;
  public readonly statusSteps = LEAD_STATUS_STEPS;
  public readonly statusStep = computed(() => statusStepIndex(this.lead()));
  public readonly journeyOffTrack = computed(() => journeyOffTrack(this.lead()));
  public readonly chevron = CHEVRON;
  public readonly chevronFirst = CHEVRON_FIRST;

  public stepLabel(index: number): string {
    return statusStepLabel(this.lead(), index);
  }

  public setIntentLevel(level: SetIntentLevelRequestIntentLevelEnum): void {
    if (!this.canSetIntent() || this.lead()?.intentLevel === level) return;
    this._leadsApiService.setLeadIntentLevel(this.id(), { intentLevel: level }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de modifier l\'intérêt ressenti.'); return EMPTY; }),
    ).subscribe(() => this._reload());
  }

  // ——— Notes : les activités « Note » du lead, les plus récentes d'abord ———

  private readonly _notes = signal<ActivityDto[]>([]);
  public readonly notes = computed(() => this._notes().slice(0, NOTES_LIMIT));
  public readonly hasMoreNotes = computed(() => this._notes().length > NOTES_LIMIT);
  public readonly noteModel = signal({ text: '' });
  public readonly noteForm = form(this.noteModel, (schema) => {
    required(schema.text, { message: 'Écrivez la note' });
  });

  public addNote(): void {
    submit(this.noteForm, async (field) => {
      const text = field().value().text.trim();
      if (!text) return;
      const ok = await firstValueFrom(
        this._leadsApiService.logLeadActivity(this.id(), {
          type: LogActivityRequestTypeEnum.Note,
          subject: 'Note',
          notes: text,
        }).pipe(
          map(() => true),
          catchError(() => {
            this._snackbar.error('Erreur', 'La note n\'a pas pu être enregistrée.');
            return of(false);
          }),
        ),
      );
      if (!ok) return;
      this.noteModel.set({ text: '' });
      this.noteForm.text().reset();
      this._reload();
    });
  }

  // ——— Projets ouverts ———

  private readonly _projects = signal<OpportunityDto[]>([]);
  public readonly projectsFailed = signal(false);
  public readonly openProjects = computed(() => this._projects().filter((o) => !isClosed(o)));
  public readonly projectStep = stepLabel;

  public openProject(project: OpportunityDto): void {
    if (project.id) void this._router.navigate(['/leads/projets', project.id]);
  }

  public openCreateProject(): void {
    const lead = this.lead();
    if (!lead) return;
    const ref = this._sideDrawerService.open<string | false, CreateOpportunityDrawerData, CreateOpportunityDrawer>(
      CreateOpportunityDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { lead } },
    );
    ref.closed.subscribe((projectId) => {
      if (projectId) this._reload();
    });
  }

  // ——— Prochaines activités : tâches ouvertes et rappels en attente ———

  private readonly _tasks = signal<CrmTaskDto[]>([]);
  private readonly _reminders = signal<ReminderDto[]>([]);
  private readonly _upcomingAll = computed<UpcomingItem[]>(() => {
    const now = Date.now();
    const items: UpcomingItem[] = [];
    for (const t of this._tasks()) {
      if (t.status !== 'Pending' && t.status !== 'InProgress') continue;
      const due = t.slaDeadline ?? t.dueAt;
      if (!t.id || !due) continue;
      const at = new Date(due);
      items.push({
        key: `task:${t.id}`,
        at: at.getTime(),
        label: t.title || t.typeLabel || 'Tâche',
        icon: CALL_TASK_TYPES.has(t.type ?? '') ? 'feather:phone' : 'feather:file-text',
        when: upcomingWhen(at),
        tone: upcomingTone(at.getTime(), now),
        link: ['/tasks', t.id],
      });
    }
    for (const r of this._reminders()) {
      if (!r.id || !r.dueAt) continue;
      const at = new Date(r.dueAt);
      items.push({
        key: `reminder:${r.id}`,
        at: at.getTime(),
        label: r.title || 'Rappel',
        icon: 'feather:bell',
        when: upcomingWhen(at),
        tone: upcomingTone(at.getTime(), now),
        link: ['/leads', this.id(), 'suivi', 'rappels'],
      });
    }
    return items.sort((a, b) => a.at - b.at);
  });
  public readonly upcoming = computed(() => this._upcomingAll().slice(0, UPCOMING_LIMIT));
  public readonly upcomingMore = computed(() => Math.max(0, this._upcomingAll().length - UPCOMING_LIMIT));

  // ——— Pièce d'identité : masquée par défaut ———

  public readonly showDocument = signal(false);
  public readonly documentDisplay = computed(() => {
    const value = this.lead()?.nationalId;
    if (!value) return null;
    return this.showDocument() ? value : maskDocument(value);
  });

  // ——— L'alerte du haut : un contact sans trace ———

  /**
   * « Contacté » sans aucune activité : le statut dit que quelqu'un a parlé au prospect, et rien ne
   * dit ce qui s'est dit. « Nouveau » sans activité appelle, lui, un premier contact.
   */
  public readonly contactAlert = computed<'contacted-without-trace' | 'never-contacted' | null>(() => {
    const lead = this.lead();
    if (!lead || lead.lastActivityAt || !this.canUpdate()) return null;
    if (lead.status === 'Open') return 'contacted-without-trace';
    if (lead.status === 'New') return 'never-contacted';
    return null;
  });
  public readonly isRecordingFirstContact = signal(false);

  // ——— Fiche complète ———

  public readonly completeness = this.compliance.completeness;
  public readonly completenessPercent = computed(() => Math.round(this.completeness()?.percentage ?? 0));
  public readonly gaps = computed(() =>
    (this.completeness()?.gaps ?? []).map((g) => {
      const section = completenessGapSection(g.code);
      return {
        label: completenessGapTitle(g),
        where: GAP_SECTION_LABEL[section] ?? 'Identité',
        route: section === 'client' ? null : section,
        blocking: g.blocking ?? false,
      };
    }),
  );

  // ——— Qualification ———

  private readonly _questionCount = signal<number | null>(null);
  public readonly qualification = computed(() => {
    const total = this._questionCount();
    const done = this.lead()?.qualificationCompleteness ?? 0;
    return {
      percent: Math.round(done * 100),
      total,
      answered: total === null ? null : Math.round(done * total),
      started: done > 0,
    };
  });
  public showQualOverride = signal(false);
  public qualOverrideValue = signal(50);
  public isSavingQual = signal(false);

  // ——— Tags ———

  public tags = signal<TagDto[]>([]);
  public newTag = signal('');
  public showTagInput = signal(false);
  public isAddingTag = signal(false);

  // ——— Client existant (BNF-F-18 / BNF-F-19) ———

  private readonly _matchRaw = signal<LeadCustomerMatchRaw[]>([]);
  private readonly _agencyNames = signal<Record<string, string>>({});
  public isLoadingMatches = signal(false);
  public matchesFailed = signal(false);

  /** Le statut FATCA du bandeau vient du socle, jamais d'un calcul local. */
  public readonly fatcaEnabled = this.compliance.fatcaEnabled;
  public readonly fatcaStatus = this.compliance.principalFatcaStatus;

  public readonly customerMatches = computed<CustomerMatchView[]>(() => {
    const names = this._agencyNames();
    const requested = this.lead()?.interestedProduct ?? null;
    return this._matchRaw().map((raw) =>
      customerMatchViewFromDto(raw.dto, {
        agencyLabel: names[raw.dto.agencyId ?? ''] ?? null,
        products: raw.holdings,
        opportunities: raw.opportunities,
        requestedProductCode: requested,
      }),
    );
  });

  constructor() {
    effect(() => {
      const leadId = this.id();
      this._leadsApiService.listLeadTags(leadId).pipe(catchError(() => EMPTY))
        .subscribe((t) => this.tags.set(t ?? []));
      this._loadCustomerMatches(leadId);
    });

    // Notes, projets et agenda : relus quand le lead change (une note, un projet, une tâche y touchent).
    effect(() => {
      const leadId = this.id();
      this.lead()?.updatedAt;
      this.lead()?.lastActivityAt;
      untracked(() => this._loadSideData(leadId));
    });

    // Le nombre de questions vient du formulaire de qualification du produit demandé.
    effect(() => {
      const product = this.lead()?.interestedProduct;
      if (!product) {
        this._questionCount.set(null);
        return;
      }
      this._leadsApiService.resolveQualificationTemplate(product).pipe(
        catchError(() => of(null)),
      ).subscribe((template) => this._questionCount.set(template?.questions?.length ?? null));
    });

    this._loadAgencyNames();
  }

  /** Chaque bloc retombe sur une liste vide : un droit manquant ne vide pas la vue d'ensemble. */
  private _loadSideData(leadId: string): void {
    this._leadsApiService.listLeadActivities(leadId, 0, 50).pipe(catchError(() => of([]))).subscribe((items) => {
      const at = (a: ActivityDto) => new Date(a.performedAt ?? a.scheduledAt ?? 0).getTime();
      this._notes.set((items ?? []).filter((a) => a.type === 'Note' && !!a.notes?.trim()).sort((x, y) => at(y) - at(x)));
    });
    this._opportunitiesApi.listOpportunities(leadId).pipe(
      catchError(() => { this.projectsFailed.set(true); return of(null); }),
    ).subscribe((items) => {
      if (items) { this.projectsFailed.set(false); this._projects.set(items); }
    });
    if (this._canReadTasks()) {
      this._tasksApi.listCrmTasks(leadId).pipe(catchError(() => of([]))).subscribe((t) => this._tasks.set(t ?? []));
    }
    if (this._canReadReminders()) {
      this._leadsApiService.listLeadReminders(leadId, 'Pending').pipe(catchError(() => of([]))).subscribe((r) => this._reminders.set(r ?? []));
    }
  }

  // ——— Écritures : chacune recharge toute la fiche ———

  private _reload(): void {
    this._leadEditContext.reload();
  }

  /**
   * Envoie seulement les champs personnalisés : tout autre champ du PATCH laissé absent reste tel
   * quel au serveur. `expectedUpdatedAt` refuse l'enregistrement si quelqu'un a modifié le lead
   * depuis qu'il a été chargé.
   */
  public readonly saveCustomFields = (customFields: Record<string, WireValue>) =>
    this._leadsApiService.updateLead(this.id(), {
      customFields,
      expectedUpdatedAt: this.lead()?.updatedAt ?? null,
    });

  public onCustomFieldsSaved(): void {
    this._reload();
  }

  public recordFirstContact(): void {
    this.isRecordingFirstContact.set(true);
    this._leadsApiService.recordFirstContact(this.id(), { contactedAt: new Date().toISOString() }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Enregistrement échoué.');
        this.isRecordingFirstContact.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.isRecordingFirstContact.set(false);
      this._snackbar.success('Premier contact', 'Le premier contact a été enregistré.');
      this._reload();
    });
  }

  /** « Noter l'appel » : le panneau d'activité, ouvert sur un appel. */
  public logActivity(type: LogActivityRequestTypeEnum = LogActivityRequestTypeEnum.Call): void {
    const data: LogActivityDrawerData = { leadId: this.id(), leadName: this.lead()?.fullName ?? 'Lead', initialType: type };
    const ref = this._sideDrawerService.open(LogActivityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });
    ref.closed.subscribe((result) => {
      if (result) this._reload();
    });
  }

  public readonly Activity = LogActivityRequestTypeEnum;

  public copyEmail(): void {
    const email = this.lead()?.email;
    if (!email) return;
    navigator.clipboard?.writeText(email).then(
      () => this._snackbar.success('Copié', 'L\'adresse e-mail est dans le presse-papiers.'),
      () => this._snackbar.error('Erreur', 'Copie impossible.'),
    );
  }

  public openTab(route: string | null): void {
    if (!route) return;
    // Les consentements sont une section de l'onglet Conformité (refonte du 2026-10-24) ; le foyer
    // a retrouvé sa rubrique (2026-11-02).
    const merged: Record<string, [string, string]> = { consentement: ['conformite', 'consentements'] };
    const target = merged[route];
    if (target) this._router.navigate(['/leads', this.id(), target[0]], { fragment: target[1] });
    else this._router.navigate(['/leads', this.id(), route]);
  }

  public openReassignDrawer(): void {
    const lead = this.lead();
    if (!lead) return;
    this._sideDrawerService.open(ReassignLeadDrawer, { data: { lead } }).closed.subscribe((reassigned) => {
      if (reassigned) this._reload();
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

    // On recharge plutôt que de recopier le formulaire : le serveur recalcule fullName,
    // desiredAmount et updatedAt, et le prochain enregistrement en a besoin.
    ref.closed.subscribe((updated) => {
      if (updated) this._reload();
    });
  }

  public saveQualificationCompleteness(): void {
    this.isSavingQual.set(true);
    this._leadsApiService.setLeadQualificationCompleteness(this.id(), {
      completeness: this.qualOverrideValue() / 100,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Mise à jour échouée.');
        this.isSavingQual.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Qualification mise à jour', `Progression définie à ${this.qualOverrideValue()} %.`);
      this.showQualOverride.set(false);
      this.isSavingQual.set(false);
      this._reload();
    });
  }

  // ——— Tags ———

  public addTag(): void {
    const tag = this.newTag().trim();
    if (!tag) return;
    this.isAddingTag.set(true);
    this._leadsApiService.addLeadTag(this.id(), {
      tag,
      addedBy: this._auth.connectedUser()?.id,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible d\'ajouter le tag.');
        this.isAddingTag.set(false);
        return EMPTY;
      }),
    ).subscribe((added) => {
      this.tags.update((list) => [...list, added]);
      this.newTag.set('');
      this.showTagInput.set(false);
      this.isAddingTag.set(false);
    });
  }

  public removeTag(tag: TagDto): void {
    this._leadsApiService.removeLeadTag(this.id(), tag.id!).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de retirer le tag.'); return EMPTY; }),
    ).subscribe(() => this.tags.update((list) => list.filter((t) => t.id !== tag.id)));
  }

  // ——— Client existant ———

  public openCustomer(customerId: string): void {
    this._router.navigate(['/customers', customerId, 'identite']);
  }

  /** Un KYC à reprendre se corrige sur la fiche client, pas sur le lead (BNF-F-19). */
  public openCustomerKyc(customerId: string): void {
    this._router.navigate(['/customers', customerId, 'kyc']);
  }

  public openAttachDrawer(match: CustomerMatchView): void {
    this._openLinkDrawer('attach', match);
  }

  public openDetachDrawer(match: CustomerMatchView): void {
    this._openLinkDrawer('detach', match);
  }

  private _openLinkDrawer(mode: 'attach' | 'detach', match: CustomerMatchView): void {
    const data: AttachCustomerDrawerData = {
      leadId: this.id(),
      mode,
      customer: match,
      expectedUpdatedAt: this.lead()?.updatedAt ?? null,
    };

    const ref = this._sideDrawerService.open(AttachCustomerDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((raw) => {
      const result = raw as AttachCustomerResult | false | undefined;
      if (!result) return;
      // Un 204 ne dit pas ce que le serveur a retenu : on relit les correspondances et la fiche.
      this._loadCustomerMatches(this.id());
      this._reload();
    });
  }

  private _loadCustomerMatches(leadId: string): void {
    this.isLoadingMatches.set(true);
    this.matchesFailed.set(false);

    this._leadsApiService
      .getLeadCustomerMatches(leadId)
      .pipe(
        switchMap((matches) => this._withProductsAndRequests(matches ?? [])),
        catchError(() => {
          // La correspondance est un confort : son échec ne doit pas vider l'onglet.
          this.matchesFailed.set(true);
          return of([] as LeadCustomerMatchRaw[]);
        }),
      )
      .subscribe((raws) => {
        this._matchRaw.set(raws);
        this.isLoadingMatches.set(false);
      });
  }

  /**
   * Produits détenus et demandes en cours de chaque correspondance : l'un est affiché, l'autre
   * porte l'alerte « demande ouverte ou produit actif sur la même ligne ». Chaque appel retombe
   * sur `null` pour qu'un refus de droit n'emporte pas le bandeau.
   */
  private _withProductsAndRequests(matches: CustomerMatchDto[]) {
    if (matches.length === 0) return of([] as LeadCustomerMatchRaw[]);
    return forkJoin(
      matches.map((dto) =>
        forkJoin({
          holdings: this._holdingsApi
            .listClientHoldings(dto.customerId!, undefined, undefined, 1, 50)
            .pipe(map((page) => page.items ?? []), catchError(() => of(null))),
          opportunities: this._opportunitiesApi
            .listOpportunities(undefined, dto.customerId!)
            .pipe(catchError(() => of(null))),
        }).pipe(map(({ holdings, opportunities }) => ({ dto, holdings, opportunities }))),
      ),
    );
  }

  private _loadAgencyNames(): void {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(
        map((res) => {
          const index: Record<string, string> = {};
          for (const a of res.items ?? []) if (a.id) index[a.id] = a.name ?? '';
          return index;
        }),
        catchError(() => EMPTY),
      )
      .subscribe((index) => this._agencyNames.set(index));
  }
}

export default LeadInformationsPage;
