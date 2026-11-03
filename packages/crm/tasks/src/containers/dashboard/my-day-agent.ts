import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { catchError, EMPTY, finalize } from 'rxjs';
import { AgendaAppointmentDto, CrmTaskDto, LeadDto, LeadsApiService, MyScorecardDto } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { provideTasPaginatorIntl } from '@talisoft/ui/table';
import { PermissionsService } from '@sankore/crm/common';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CallButton, TelephonyStatusService } from '@sankore/crm/telephony';
import { RequestClickToCallRequestSlotEnum } from '@sankore/crm-api';
import { AgendaEntry } from './agenda-meta';
import { ContactButtons } from './contact-buttons';
import { MyDayScorecard, ScorePeriod } from './my-day-scorecard';
import { dayChip, dayKey, whatsappUrl } from './my-day-meta';
import { leadDisplayName, taskActionLabel } from './task-meta';
import {
  AgentDayItem,
  agentDayItems,
  groupByMoment,
  heroTask,
  isLateTask,
  MomentGroup,
  todayProgress,
  upcomingCount,
} from './my-day-agent-meta';

/** Au-delà, la liste se pagine (demande du propriétaire, 2026-10-29, gardée sur la nouvelle maquette). */
export const AGENT_DAY_PAGE_SIZE = 10;

const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

const SOURCE_LABELS: Record<string, string> = {
  Web: 'Site web', MobileAgent: 'Agent mobile', Agency: 'Agence', CallCenter: "Centre d'appels", Sms: 'SMS',
  Ussd: 'USSD', WhatsApp: 'WhatsApp', Referral: 'Recommandation', Partner: 'Partenaire', FileImport: 'Import',
  Import: 'Import', Campaign: 'Campagne', MarketingCampaign: 'Campagne',
};

/**
 * « Ma journée » des agents (maquette du propriétaire, 2026-10-31) : le bandeau de la tâche à faire
 * en premier, l'avancement du jour, et la journée rangée par moment — tâches, rappels et
 * rendez-vous mêlés. Les responsables ont la même maquette, avec la journée de leur équipe à droite.
 *
 * Le composant n'ouvre rien lui-même, sauf les rappels qu'il marque faits : tâches et rendez-vous
 * remontent à l'écran, qui possède les drawers et recharge les listes.
 */
@Component({
  selector: 'my-day-agent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, Button, Menu, MenuItem, TasMenuTrigger, MatPaginator, ContactButtons, CallButton, MyDayScorecard],
  providers: [provideTasPaginatorIntl()],
  templateUrl: './my-day-agent.html',
})
export class MyDayAgent {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _router = inject(Router);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _telephony = inject(TelephonyStatusService);
  private readonly _permissions = inject(PermissionsService);

  public readonly firstName = input('');
  public readonly agencyName = input('');
  public readonly now = input(Date.now());
  /** Toutes les tâches chargées de l'agent, ouvertes ou non. */
  public readonly tasks = input<CrmTaskDto[]>([]);
  /** Les tâches ouvertes, déjà dans l'ordre d'urgence (`byUrgency`). */
  public readonly openTasks = input<CrmTaskDto[]>([]);
  public readonly entries = input<AgendaEntry[]>([]);
  public readonly leads = input<Map<string, LeadDto>>(new Map());
  public readonly approvalsCount = input(0);
  /**
   * La maquette des responsables (2026-11-03) : la colonne de droite et le tableau d'équipe sont
   * projetés par l'écran (`[team-panel]`, `[team-table]`), et les décisions qui l'attendent sont
   * dites par type plutôt qu'en un seul compte.
   */
  public readonly team = input(false);
  public readonly kycApprovals = input(0);
  public readonly workflowApprovals = input(0);
  public readonly isLoading = input(false);
  public readonly canManageTasks = input(false);
  public readonly canScheduleAppointment = input(false);
  public readonly scorecard = input<MyScorecardDto | null>(null);
  public readonly scorePeriod = input<ScorePeriod>('month');
  public readonly scorecardLoading = input(false);

  public readonly openTask = output<CrmTaskDto>();
  public readonly openAppointment = output<AgendaAppointmentDto>();
  public readonly newTask = output<void>();
  public readonly newAppointment = output<void>();
  public readonly agendaChanged = output<void>();
  public readonly showUpcoming = output<void>();
  public readonly showApprovals = output<void>();
  public readonly scorePeriodChange = output<ScorePeriod>();

  public readonly canMakeCalls = this._telephony.canMakeCalls;
  public readonly canManageReminders = this._permissions.can('lead:reminder:manage');
  public readonly primarySlot = [RequestClickToCallRequestSlotEnum.Primary] as const;

  public readonly showAll = signal(false);
  public readonly actingKey = signal<string | null>(null);

  public readonly todayLabel = computed(() => {
    const label = LONG_DAY.format(this.now());
    return label.charAt(0).toUpperCase() + label.slice(1);
  });

  // ——— Bandeau et avancement ———

  public readonly hero = computed(() => heroTask(this.openTasks(), this.now()));
  public readonly heroLate = computed(() => { const t = this.hero(); return !!t && isLateTask(t, this.now()); });
  public readonly progress = computed(() => todayProgress(this.tasks(), this.now()));
  /** Le trait de l'anneau : la circonférence d'un cercle de rayon 34, et la part faite. */
  public readonly ring = computed(() => {
    const c = 2 * Math.PI * 34;
    const { done, total } = this.progress();
    return { circumference: c, offset: total === 0 ? c : c * (1 - done / total) };
  });

  // ——— Liste du jour ———

  public readonly items = computed(() => agentDayItems(this.tasks(), this.entries(), this.now(), this.showAll()));
  public readonly upcoming = computed(() => upcomingCount(this.tasks(), this.now()));

  public readonly pageIndex = linkedSignal({ source: this.showAll, computation: () => 0 });
  public readonly pageSize = signal(AGENT_DAY_PAGE_SIZE);
  public readonly pageSizeOptions = [AGENT_DAY_PAGE_SIZE, 25, 50];
  public readonly paginated = computed(() => this.items().length > AGENT_DAY_PAGE_SIZE);
  public readonly currentPage = computed(() =>
    Math.min(this.pageIndex(), Math.max(0, Math.ceil(this.items().length / this.pageSize()) - 1)),
  );
  /** La page coupe la suite des éléments, puis les range par moment : un moment peut s'étendre sur deux pages. */
  public readonly groups = computed<MomentGroup[]>(() => {
    const all = this.items();
    if (!this.paginated()) return groupByMoment(all);
    const start = this.currentPage() * this.pageSize();
    return groupByMoment(all.slice(start, start + this.pageSize()));
  });
  /** Le compte d'un moment porte sur la journée entière, pas sur la page. */
  public readonly momentTotals = computed(() => {
    const totals = new Map<string, number>();
    groupByMoment(this.items()).forEach((g) => totals.set(g.key, g.items.length));
    return totals;
  });

  public changePage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
    this._host.nativeElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ——— Lecture d'un élément ———

  public lead(item: AgentDayItem | CrmTaskDto): LeadDto | null {
    return item.leadId ? this.leads().get(item.leadId) ?? null : null;
  }

  public verb(item: AgentDayItem): string {
    switch (item.kind) {
      case 'task': return this.taskVerb(item.task!);
      case 'reminder': return 'Rappeler';
      case 'appointment': return 'Rendez-vous avec';
      default: return `${item.entry!.type.label} avec`;
    }
  }

  public taskVerb(task: CrmTaskDto): string {
    return task.type === 'FirstContact' ? 'Premier contact' : taskActionLabel(task);
  }

  public name(item: AgentDayItem): string {
    if (item.kind !== 'task') return item.entry!.leadName;
    const lead = this.lead(item);
    return lead ? leadDisplayName(lead) : '';
  }

  public taskName(task: CrmTaskDto): string {
    const lead = task.leadId ? this.leads().get(task.leadId) : null;
    return lead ? leadDisplayName(lead) : '';
  }

  /** « Compte Épargne · demande les pièces à fournir » : le produit, puis ce qui est à faire. */
  public subtitle(item: AgentDayItem): string {
    const product = this._product(this.lead(item));
    if (item.kind === 'task') return this.taskSubtitle(item.task!);
    const detail = item.kind === 'reminder'
      ? [item.entry!.title !== 'Rappel' ? item.entry!.title : null, item.entry!.notes]
      : [item.entry!.title, item.entry!.notes];
    return [product, ...detail].filter(Boolean).join(' · ');
  }

  public taskSubtitle(task: CrmTaskDto): string {
    const lead = task.leadId ? this.leads().get(task.leadId) ?? null : null;
    const source = lead?.leadSourceLabel?.trim() || SOURCE_LABELS[lead?.channel ?? ''] || SOURCE_LABELS[lead?.source ?? ''];
    return [this._product(lead), task.description?.trim() || source].filter(Boolean).join(' · ');
  }

  private _product(lead: LeadDto | null): string | null {
    const product = lead?.interestedProduct?.trim();
    return product && product.toLowerCase() !== 'unknown' ? product : null;
  }

  public phone(item: AgentDayItem | CrmTaskDto): string | null {
    return this.lead(item)?.phoneNumber || null;
  }

  public whatsapp(task: CrmTaskDto): string | null {
    return whatsappUrl(this.phone(task));
  }

  /** Le jour au-dessus de l'heure pour un retard d'un autre jour : « Hier », « Lun. 26 ». */
  public dayLabel(item: AgentDayItem): string | null {
    return dayKey(item.at) === dayKey(this.now()) ? null : dayChip(item.at, this.now());
  }

  public time(item: AgentDayItem): string {
    return TIME.format(new Date(item.at));
  }

  public visual(item: AgentDayItem): { icon: string; tone: string } {
    switch (item.kind) {
      case 'reminder': return { icon: 'feather:bell', tone: 'bg-amber-100 text-amber-700' };
      case 'appointment': return { icon: 'feather:calendar', tone: 'bg-indigo-50 text-indigo-600' };
      case 'activity': return { icon: item.entry!.type.icon, tone: 'bg-indigo-50 text-indigo-600' };
      default: return { icon: item.task?.type === 'FirstContact' || item.task?.type === 'SlaFollowUp' ? 'feather:phone' : 'feather:check-square', tone: 'bg-slate-100 text-slate-600' };
    }
  }

  // ——— Actions ———

  /** La ligne : la tâche s'ouvre dans son panneau de travail, le rappel sur le lead, le rendez-vous dans son détail. */
  public openItem(item: AgentDayItem): void {
    if (item.task) this.openTask.emit(item.task);
    else if (item.entry?.appointment) this.openAppointment.emit(item.entry.appointment);
    else if (item.leadId) this._router.navigate(['/leads', item.leadId, 'suivi', item.kind === 'reminder' ? 'rappels' : 'activites']);
  }

  /**
   * Le rond de gauche. Une tâche se termine dans son panneau de travail, qui consigne le résultat
   * sur le lead ; un rappel se marque fait d'ici.
   */
  public check(item: AgentDayItem): void {
    if (item.done) return;
    if (item.task) {
      this.openTask.emit(item.task);
      return;
    }
    if (item.kind !== 'reminder' || !item.leadId || !item.entry) return;
    const entry = item.entry;
    this.actingKey.set(item.key);
    this._leadsApi
      .completeLeadReminder(item.leadId, entry.id)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Le rappel n’a pas pu être marqué fait.');
          return EMPTY;
        }),
        finalize(() => this.actingKey.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Rappel fait', `${entry.leadName} : ${entry.title}`);
        this.agendaChanged.emit();
      });
  }

  public canCheck(item: AgentDayItem): boolean {
    return !item.done && (item.kind === 'task' || (item.kind === 'reminder' && this.canManageReminders()));
  }
}
