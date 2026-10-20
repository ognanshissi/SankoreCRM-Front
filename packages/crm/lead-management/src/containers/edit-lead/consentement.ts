import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, FormRoot, maxLength, minLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import {
  ActivityDto,
  ConsentDto,
  FormFieldReferenceTargetEnum,
  LeadsApiService,
  LogActivityRequestTypeEnum,
  RecordConsentRequestChannelEnum,
  RecordConsentRequestTypeEnum,
} from '@sankore/crm-api';
import { AuthenticationService, EntityFormReferences, PermissionsService } from '@sankore/crm/common';
import { interestedProductLabel } from '../../components/interested-product';
import { ConvertedLeadNotice } from './converted-lead-notice';
import { LeadComplianceStore } from './lead-compliance-store';
import { LeadEditContext } from './lead-edit-context';
import { displayName, formatDay } from './lead-view.models';
import { LogActivityDrawer, LogActivityDrawerData } from './log-activity-drawer';

interface ConsentPurpose {
  type: RecordConsentRequestTypeEnum;
  title: string;
  icon: string;
  /** Ce que le prospect accepte, en une phrase ; `product` est le produit demandé, s'il est connu. */
  describe: (product: string | null) => string;
}

/**
 * Les finalités présentées d'office, dans l'ordre où un agent les pose. Les autres types du contrat
 * (contact par canal, profilage, géolocalisation) n'apparaissent que si la ligne de produit les exige
 * ou s'ils ont déjà été recueillis ; le consentement santé se donne par personne, avec son
 * questionnaire, et n'apparaît ici que dans l'historique.
 */
const MAIN_PURPOSES: ReadonlyArray<ConsentPurpose> = [
  {
    type: RecordConsentRequestTypeEnum.DataProcessing,
    title: 'Traitement des données personnelles',
    icon: 'feather:database',
    describe: () => 'Collecter et conserver ses informations pour étudier sa demande.',
  },
  {
    type: RecordConsentRequestTypeEnum.CreditBureauCheck,
    title: 'Consultation du Bureau d’Information sur le Crédit',
    icon: 'feather:search',
    describe: (product) => `Vérifier son historique de crédit avant d’étudier ${product ? `le ${product.toLowerCase()}` : 'sa demande'}.`,
  },
  {
    type: RecordConsentRequestTypeEnum.ThirdPartySharing,
    title: 'Partage avec l’assureur partenaire',
    icon: 'feather:umbrella',
    describe: () => 'Transmettre son dossier à l’assureur pour l’assurance emprunteur.',
  },
  {
    type: RecordConsentRequestTypeEnum.Marketing,
    title: 'Prospection commerciale',
    icon: 'feather:message-circle',
    describe: () => 'Recevoir des offres par SMS, e-mail, WhatsApp ou téléphone.',
  },
];

const OTHER_PURPOSES: ReadonlyArray<ConsentPurpose> = [
  { type: RecordConsentRequestTypeEnum.EmailContact, title: 'Contact par e-mail', icon: 'feather:mail', describe: () => 'Être contacté par e-mail au sujet de sa demande.' },
  { type: RecordConsentRequestTypeEnum.SmsContact, title: 'Contact par SMS', icon: 'feather:smartphone', describe: () => 'Être contacté par SMS au sujet de sa demande.' },
  { type: RecordConsentRequestTypeEnum.PhoneContact, title: 'Contact par téléphone', icon: 'feather:phone', describe: () => 'Être appelé au sujet de sa demande.' },
  { type: RecordConsentRequestTypeEnum.ProfilingAndAnalytics, title: 'Profilage et analyses', icon: 'feather:bar-chart-2', describe: () => 'Analyser son profil pour lui proposer des offres adaptées.' },
  { type: RecordConsentRequestTypeEnum.LocationTracking, title: 'Géolocalisation des visites', icon: 'feather:map-pin', describe: () => 'Enregistrer la position GPS lors des visites terrain.' },
];

const TYPE_TITLES: Record<string, string> = {
  ...Object.fromEntries([...MAIN_PURPOSES, ...OTHER_PURPOSES].map((p) => [p.type, p.title])),
  HealthData: 'Données de santé',
};

interface ChannelOption {
  value: RecordConsentRequestChannelEnum;
  label: string;
  icon: string;
  /** Ce qu'on attend comme preuve quand aucun appel n'est rattaché. */
  proofHint: string;
}

const CHANNELS: ReadonlyArray<ChannelOption> = [
  { value: RecordConsentRequestChannelEnum.Phone, label: 'Appel téléphonique', icon: 'feather:phone', proofHint: 'Référence de l’appel' },
  { value: RecordConsentRequestChannelEnum.Paper, label: 'Formulaire signé', icon: 'feather:file-text', proofHint: 'Numéro ou référence du formulaire signé' },
  { value: RecordConsentRequestChannelEnum.Sms, label: 'SMS de confirmation', icon: 'feather:smartphone', proofHint: 'Numéro et heure du SMS de confirmation' },
  { value: RecordConsentRequestChannelEnum.WebForm, label: 'Formulaire web', icon: 'feather:globe', proofHint: 'Identifiant de la soumission du formulaire' },
  { value: RecordConsentRequestChannelEnum.InPerson, label: 'En agence', icon: 'feather:home', proofHint: 'Agence et référence du document remis' },
];

const CHANNEL_LABELS: Record<string, string> = {
  ...Object.fromEntries(CHANNELS.map((c) => [c.value, c.label])),
  Email: 'E-mail',
  Import: 'Import',
  Other: 'Autre',
};

type Decision = 'accept' | 'refuse';

/** La réponse du prospect, telle que l'agent la note. */
class CollectFormModel {
  public decision!: Decision;
  public channel!: string;
  public proofActivityId!: string;
  public proofReference!: string;

  public static instantiate(defaultCallId: string): CollectFormModel {
    const m = new CollectFormModel();
    m.decision = 'accept';
    m.channel = RecordConsentRequestChannelEnum.Phone;
    m.proofActivityId = defaultCallId;
    m.proofReference = '';
    return m;
  }
}

class WithdrawFormModel {
  public reason!: string;

  public static instantiate(): WithdrawFormModel {
    const m = new WithdrawFormModel();
    m.reason = '';
    return m;
  }
}

/** L'état d'une finalité : la dernière réponse du prospect, et ce qu'on peut en faire. */
export interface PurposeView {
  purpose: ConsentPurpose;
  required: boolean;
  latest: ConsentDto | null;
  state: 'none' | 'granted' | 'refused' | 'withdrawn';
}

interface HistoryEntry {
  key: string;
  at: string;
  kind: 'granted' | 'refused' | 'withdrawn';
  title: string;
  detail: string;
  by: string | null;
}

/** Onglet « Consentements » de la fiche lead : chaque finalité, sa réponse, sa preuve, et l'historique. */
@Component({
  selector: 'lead-consentement',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './consentement.html',
  imports: [
    FormRoot,
    FormField,
    TasCard,
    TasIcon,
    TasInput,
    TasFormField,
    TasLabel,
    TasError,
    TasSpinner,
    TasTable,
    Button,
    ConvertedLeadNotice,
  ],
})
export class LeadConsentementPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _context = inject(LeadEditContext);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _references = inject(EntityFormReferences);
  private readonly _auth = inject(AuthenticationService);
  protected readonly compliance = inject(LeadComplianceStore);

  public readonly id = input.required<string>();

  private readonly _canRecord = this._permissions.can('lead:consent:record');
  private readonly _canWithdraw = this._permissions.can('lead:consent:withdraw');
  public readonly canRecord = computed(() => this._canRecord() && !this._context.isReadOnly());
  public readonly canWithdraw = computed(() => this._canWithdraw() && !this._context.isReadOnly());

  public readonly channels = CHANNELS;
  public readonly formatDay = formatDay;
  public readonly historyTable: TableConfig = {
    property: 'lead-consent-history',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25] },
  };

  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly consents = signal<ConsentDto[]>([]);
  public readonly activities = signal<ActivityDto[]>([]);
  /** La finalité dont le formulaire de recueil, ou de retrait, est ouvert. */
  public readonly collecting = signal<string | null>(null);
  public readonly withdrawing = signal<string | null>(null);

  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
    ),
    { initialValue: new Map<string, string>() },
  );

  public readonly recorder = computed(() => {
    const user = this._auth.connectedUser();
    return user?.fullName || user?.email || 'vous';
  });

  public readonly name = computed(() => displayName(this._context.lead()));
  public readonly product = computed(() => interestedProductLabel(this._context.lead()?.interestedProduct));

  // ——— Les finalités ———

  private readonly _required = computed(() => new Set(this.compliance.completeness()?.requiredConsents ?? []));

  /** La dernière réponse par type, lead entier (les consentements santé sont par personne). */
  private readonly _latestByType = computed(() => {
    const latest = new Map<string, ConsentDto>();
    for (const c of this.consents()) {
      if (c.subjectId || !c.type) continue;
      const current = latest.get(c.type);
      if (!current || (c.grantedAt ?? '') > (current.grantedAt ?? '')) latest.set(c.type, c);
    }
    return latest;
  });

  public readonly purposes = computed<PurposeView[]>(() => {
    const required = this._required();
    const latest = this._latestByType();
    const shown = [
      ...MAIN_PURPOSES,
      ...OTHER_PURPOSES.filter((p) => required.has(p.type) || latest.has(p.type)),
    ];
    return shown
      .map((purpose) => {
        const record = latest.get(purpose.type) ?? null;
        const state: PurposeView['state'] = !record ? 'none'
          : record.status === 'Active' ? 'granted'
          : record.status === 'Refused' ? 'refused'
          : 'withdrawn';
        return { purpose, required: required.has(purpose.type), latest: record, state };
      })
      // Les obligatoires d'abord : ce sont eux qui bloquent la conversion.
      .sort((a, b) => Number(b.required) - Number(a.required));
  });

  public readonly requiredCount = computed(() => this.purposes().filter((p) => p.required).length);
  public readonly requiredGiven = computed(() => this.purposes().filter((p) => p.required && p.state === 'granted').length);
  public readonly ringOffset = computed(() => {
    const total = this.requiredCount();
    const ratio = total === 0 ? 1 : this.requiredGiven() / total;
    return 100 - ratio * 100;
  });

  public readonly headline = computed(() => {
    const given = this.requiredGiven();
    const total = this.requiredCount();
    if (total === 0) return 'Aucun consentement obligatoire pour ce produit';
    const s = given > 1 ? 's' : '';
    return `${given} consentement${s} obligatoire${s} recueilli${s} sur ${total}`;
  });

  public readonly subline = computed(() => {
    const total = this.requiredCount();
    const name = this.name();
    if (total === 0) return `Rien n’est exigé pour convertir ${name} ; les consentements facultatifs se recueillent quand il le souhaite.`;
    if (this.requiredGiven() === total) return `Tous les consentements obligatoires sont recueillis : ils ne bloquent plus la conversion de ${name}.`;
    const all = total === 2 ? 'les deux' : total === 1 ? 'celui-ci' : `les ${total}`;
    const product = this.product();
    return `Il faut ${all} pour convertir ${name} en client${product ? ` et étudier son ${product.toLowerCase()}` : ''}.`;
  });

  // ——— Recueil ———

  /** Les appels notés, du plus récent : ce sont eux qui prouvent un accord donné au téléphone. */
  public readonly calls = computed(() =>
    this.activities()
      .filter((a) => a.type === 'Call')
      .sort((a, b) => (b.performedAt ?? '').localeCompare(a.performedAt ?? ''))
      .slice(0, 5),
  );

  public collectModel = signal(CollectFormModel.instantiate(''));
  public collectForm = form(this.collectModel, (schema) => {
    required(schema.channel, { message: 'Choisissez comment il l’a donnée' });
    maxLength(schema.proofReference, 1000, { message: '1 000 caractères au maximum' });
    // Un accord se conserve avec sa preuve : l'appel rattaché, ou la référence du document.
    validate(schema.proofReference, (ctx) => {
      const decision = ctx.valueOf(schema.decision);
      const activity = ctx.valueOf(schema.proofActivityId);
      return decision === 'accept' && !activity && !ctx.value().trim()
        ? { kind: 'proof', message: 'Indiquez la preuve de l’accord' }
        : null;
    });
  });

  public withdrawModel = signal(WithdrawFormModel.instantiate());
  public withdrawForm = form(this.withdrawModel, (schema) => {
    required(schema.reason, { message: 'Le motif du retrait est obligatoire' });
    minLength(schema.reason, 3, { message: 'Précisez le motif' });
    maxLength(schema.reason, 500, { message: '500 caractères au maximum' });
  });

  public readonly selectedChannel = computed(() => CHANNELS.find((c) => c.value === this.collectModel().channel) ?? null);
  public readonly showCalls = computed(() => this.collectModel().channel === RecordConsentRequestChannelEnum.Phone && this.calls().length > 0);

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => this._load(id));
    });
  }

  public startCollect(view: PurposeView): void {
    this.withdrawing.set(null);
    this.collectForm().reset(CollectFormModel.instantiate(this.calls()[0]?.id ?? ''));
    this.collecting.set(view.purpose.type);
  }

  public setDecision(decision: Decision): void {
    this.collectForm.decision().value.set(decision);
  }

  public setChannel(channel: RecordConsentRequestChannelEnum): void {
    this.collectForm.channel().value.set(channel);
    // L'appel rattaché ne prouve qu'un accord donné par téléphone.
    this.collectForm.proofActivityId().value.set(
      channel === RecordConsentRequestChannelEnum.Phone ? this.calls()[0]?.id ?? '' : '',
    );
  }

  public setProofCall(activityId: string): void {
    this.collectForm.proofActivityId().value.set(activityId);
  }

  public cancelCollect(): void {
    this.collecting.set(null);
  }

  public saveCollect(view: PurposeView): void {
    submit(this.collectForm, async (field) => {
      const value = field().value();
      const granted = value.decision === 'accept';
      const done = await firstValueFrom(
        this._leadsApi.recordConsent(this.id(), {
          type: view.purpose.type,
          channel: value.channel as RecordConsentRequestChannelEnum,
          granted,
          proofActivityId: value.proofActivityId || null,
          proofReference: value.proofReference.trim() || null,
        }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!done) return;
      this._snackbar.success(granted ? 'Accord enregistré' : 'Refus enregistré', view.purpose.title);
      this.collecting.set(null);
      this._afterWrite();
    });
  }

  public startWithdraw(view: PurposeView): void {
    this.collecting.set(null);
    this.withdrawForm().reset(WithdrawFormModel.instantiate());
    this.withdrawing.set(view.purpose.type);
  }

  public saveWithdraw(view: PurposeView): void {
    const consentId = view.latest?.id;
    if (!consentId) return;
    submit(this.withdrawForm, async (field) => {
      const done = await firstValueFrom(
        this._leadsApi.withdrawConsent(this.id(), consentId, { reason: field().value().reason.trim() }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!done) return;
      this._snackbar.success('Consentement retiré', view.purpose.title);
      this.withdrawing.set(null);
      this._afterWrite();
    });
  }

  /** Pas d'appel à rattacher : on le note, puis il apparaît dans la liste et se sélectionne seul. */
  public logCall(): void {
    const data: LogActivityDrawerData = {
      leadId: this.id(),
      leadName: this.name(),
      initialType: LogActivityRequestTypeEnum.Call,
    };
    const ref = this._sideDrawer.open(LogActivityDrawer, {
      width: '100%', height: '100%', panelClass: 'side-drawer-panel', data,
    });
    ref.closed.subscribe((result) => {
      if (!result) return;
      this._leadsApi.listLeadActivities(this.id(), 1, 50).pipe(catchError(() => EMPTY)).subscribe((items) => {
        this.activities.set(items ?? []);
        if (this.collectModel().channel === RecordConsentRequestChannelEnum.Phone) {
          this.collectForm.proofActivityId().value.set(this.calls()[0]?.id ?? '');
        }
      });
    });
  }

  // ——— Affichage ———

  public callLabel(call: ActivityDto): string {
    const who = call.performedBy ? this._users().get(call.performedBy) : null;
    const at = call.performedAt ? this._when(call.performedAt) : '';
    return [`Appel${who ? ` de ${who}` : ''}`, at].filter(Boolean).join(' · ');
  }

  public callDetail(call: ActivityDto): string {
    const parts: string[] = [];
    if (call.durationMinutes) parts.push(`${call.durationMinutes} min`);
    parts.push(call.ctiCallReference ? 'enregistrement joint automatiquement' : 'sans enregistrement');
    if (call.subject?.trim()) parts.push(call.subject.trim());
    return parts.join(' · ');
  }

  public stateLabel(view: PurposeView): string {
    const day = formatDay(view.latest?.grantedAt, true);
    switch (view.state) {
      case 'granted': return `Accepté le ${day}`;
      case 'refused': return `Refusé le ${day}`;
      case 'withdrawn': return `Retiré le ${formatDay(view.latest?.withdrawnAt, true)}`;
      default: return 'Non recueilli';
    }
  }

  public describe(view: PurposeView): string {
    return view.purpose.describe(this.product());
  }

  public readonly history = computed<HistoryEntry[]>(() => {
    const entries: HistoryEntry[] = [];
    const activities = new Map(this.activities().map((a) => [a.id, a] as const));
    for (const c of this.consents()) {
      const title = (TYPE_TITLES[c.type ?? ''] ?? c.type ?? 'Consentement') + (c.subjectId ? ' (par personne)' : '');
      const proofCall = c.proofActivityId ? activities.get(c.proofActivityId) : undefined;
      const proof = proofCall ? this.callLabel(proofCall) : c.proofReference?.trim() || null;
      entries.push({
        key: `${c.id}-answer`,
        at: c.grantedAt ?? '',
        kind: c.status === 'Refused' ? 'refused' : 'granted',
        title: `${title} — ${c.status === 'Refused' ? 'refusé' : 'accepté'}`,
        detail: [CHANNEL_LABELS[c.channel ?? ''] ?? c.channel, proof ? `preuve : ${proof}` : 'sans preuve'].filter(Boolean).join(' · '),
        by: c.recordedBy ? this._users().get(c.recordedBy) ?? null : null,
      });
      if (c.withdrawnAt) {
        entries.push({
          key: `${c.id}-withdrawal`,
          at: c.withdrawnAt,
          kind: 'withdrawn',
          title: `${title} — retiré`,
          detail: c.withdrawalReason?.trim() ? `motif : ${c.withdrawalReason.trim()}` : 'sans motif',
          by: c.withdrawnBy ? this._users().get(c.withdrawnBy) ?? null : null,
        });
      }
    }
    return entries.sort((a, b) => b.at.localeCompare(a.at));
  });

  public historyDate(iso: string): string {
    return this._when(iso);
  }

  public retry(): void {
    this._load(this.id());
  }

  private _when(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return `aujourd’hui à ${time}`;
    if (d.toDateString() === yesterday.toDateString()) return `hier à ${time}`;
    return `${formatDay(iso, true)} à ${time}`;
  }

  /** La liste, la jauge et le compteur de l'en-tête : un consentement obligatoire change les trois. */
  private _afterWrite(): void {
    this._loadConsents(this.id());
    this._context.reload();
  }

  private _load(leadId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._loadConsents(leadId);
    this._leadsApi.listLeadActivities(leadId, 1, 50).pipe(catchError(() => EMPTY))
      .subscribe((items) => this.activities.set(items ?? []));
  }

  private _loadConsents(leadId: string): void {
    this._leadsApi.listConsents(leadId).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this.loadFailed.set(true);
        return EMPTY;
      }),
    ).subscribe((items) => {
      this.consents.set(items ?? []);
      this.isLoading.set(false);
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    switch (error.error?.detail ?? error.error?.error) {
      case 'CONSENT_ACTIVE_WITHDRAW_FIRST':
        return 'Le prospect avait accepté : enregistrez un retrait plutôt qu’un refus.';
      case 'CONSENT_REFUSED_NOT_WITHDRAWABLE':
        return 'Un refus ne se retire pas : recueillez à nouveau sa réponse.';
      case 'LEAD_ACTIVITY_NOT_FOUND':
        return 'L’appel choisi comme preuve n’appartient pas à ce lead.';
    }
    if (error.status === 403) return 'Vous n’avez pas le droit d’enregistrer ce consentement.';
    const validation = error.error?.errors as Record<string, string[]> | undefined;
    return (validation && Object.values(validation).flat()[0]) || error.error?.title || 'Enregistrement impossible.';
  }
}

export default LeadConsentementPage;
