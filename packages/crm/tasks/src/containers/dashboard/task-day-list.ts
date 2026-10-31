import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, linkedSignal, output, signal } from '@angular/core';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { CrmTaskDto, CrmTaskDtoStatusEnum, LeadDto } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
import { provideTasPaginatorIntl } from '@talisoft/ui/table';
import { ContactButtons } from './contact-buttons';
import { DayGroup, dayChip, isFirstContact, SPREAD_THRESHOLD, taskUrgency } from './my-day-meta';
import { fmtDur, leadDisplayName, taskActionLabel } from './task-meta';

/** Le canal d'arrivée du lead, en clair, pour la ligne de sous-titre. */
const SOURCE_LABELS: Record<string, string> = {
  Web: 'Site web',
  MobileAgent: 'Agent mobile',
  Agency: 'Agence',
  CallCenter: "Centre d'appels",
  Sms: 'SMS',
  Ussd: 'USSD',
  WhatsApp: 'WhatsApp',
  Referral: 'Recommandation',
  Partner: 'Partenaire',
  FileImport: 'Import',
  Import: 'Import',
  Campaign: 'Campagne',
  MarketingCampaign: 'Campagne',
};

function typeVisual(type: string | null | undefined): { icon: string; tone: string } {
  switch (type) {
    case 'FirstContact':   return { icon: 'feather:phone',       tone: 'bg-primary/10 text-primary' };
    case 'Qualification':  return { icon: 'feather:list',        tone: 'bg-indigo-50 text-indigo-600' };
    case 'SlaFollowUp':    return { icon: 'feather:refresh-cw',  tone: 'bg-red-50 text-red-600' };
    case 'ScoreReview':    return { icon: 'feather:bar-chart-2', tone: 'bg-amber-50 text-amber-700' };
    case 'OwnerHandover':  return { icon: 'feather:repeat',      tone: 'bg-violet-50 text-violet-700' };
    case 'ManualDispatch': return { icon: 'feather:shuffle',     tone: 'bg-orange-50 text-orange-700' };
    default:               return { icon: 'feather:check-square', tone: 'bg-slate-100 text-slate-600' };
  }
}

/** Au-delà, la liste se pagine (demande du propriétaire, 2026-10-29). */
export const TASK_PAGE_SIZE = 10;

/** Un jour tel qu'affiché sur la page courante : ses tâches de la page, et le jour entier. */
interface PageGroup {
  group: DayGroup<CrmTaskDto>;
  items: CrmTaskDto[];
  /** Le jour a commencé sur la page précédente. */
  continued: boolean;
}

/**
 * Les tâches de « Ma journée », une carte par jour. En cartes et non en `tas-table` : c'est la
 * maquette du propriétaire. Au-delà de dix tâches, la liste se pagine : la page découpe la suite
 * des tâches, puis les regroupe par jour — le compte d'un jour et « Répartir sur la semaine »
 * portent toujours sur le jour entier, même coupé entre deux pages.
 *
 * Le composant ne fait rien lui-même : ouvrir, reporter, répartir et réassigner remontent à
 * l'écran, qui possède la liste et la recharge.
 */
@Component({
  selector: 'my-day-task-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, ContactButtons, MatPaginator],
  providers: [provideTasPaginatorIntl()],
  templateUrl: './task-day-list.html',
})
export class TaskDayList {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  public readonly groups = input.required<DayGroup<CrmTaskDto>[]>();
  public readonly leads = input<Map<string, LeadDto>>(new Map());
  public readonly now = input(Date.now());
  public readonly duplicates = input<Set<string>>(new Set());
  /** Vue équipe : le nom de l'agent en tête du sous-titre, et la réassignation. */
  public readonly agentNames = input<Map<string, string> | null>(null);
  public readonly canSpread = input(false);
  public readonly busyIds = input<Set<string>>(new Set());
  public readonly emptyTitle = input('Rien à faire');
  public readonly emptyText = input('');
  /** Change quand l'écran change de liste (vue, portée, jour, agent) : on revient à la page 1. */
  public readonly pageKey = input('');

  public readonly open = output<CrmTaskDto>();
  public readonly postpone = output<CrmTaskDto>();
  public readonly spread = output<DayGroup<CrmTaskDto>>();
  public readonly reassign = output<CrmTaskDto>();

  public readonly visual = typeVisual;
  public readonly actionLabel = taskActionLabel;
  public readonly spreadThreshold = SPREAD_THRESHOLD;
  public readonly pageSizeOptions = [TASK_PAGE_SIZE, 25, 50];

  // Une tâche faite ou reportée recharge la liste sans changer de clé : on reste sur la page.
  public readonly pageIndex = linkedSignal({ source: this.pageKey, computation: () => 0 });
  public readonly pageSize = signal(TASK_PAGE_SIZE);
  public readonly total = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));
  public readonly paginated = computed(() => this.total() > TASK_PAGE_SIZE);
  /** La page demandée, ramenée à la dernière quand la liste a rétréci. */
  public readonly currentPage = computed(() =>
    Math.min(this.pageIndex(), Math.max(0, Math.ceil(this.total() / this.pageSize()) - 1)),
  );

  public readonly pageGroups = computed<PageGroup[]>(() => {
    if (!this.paginated()) return this.groups().map((group) => ({ group, items: group.items, continued: false }));
    const start = this.currentPage() * this.pageSize();
    const end = start + this.pageSize();
    const page: PageGroup[] = [];
    let offset = 0;
    for (const group of this.groups()) {
      const from = Math.max(start - offset, 0);
      const to = Math.min(end - offset, group.items.length);
      if (from < to) page.push({ group, items: group.items.slice(from, to), continued: from > 0 });
      offset += group.items.length;
      if (offset >= end) break;
    }
    return page;
  });

  public changePage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
    this._host.nativeElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  public isOpen(task: CrmTaskDto): boolean {
    return task.status === CrmTaskDtoStatusEnum.Pending || task.status === CrmTaskDtoStatusEnum.InProgress;
  }

  public leadName(task: CrmTaskDto): string {
    const lead = task.leadId ? this.leads().get(task.leadId) : null;
    return lead ? leadDisplayName(lead) : '';
  }

  public phone(task: CrmTaskDto): string | null {
    return (task.leadId && this.leads().get(task.leadId)?.phoneNumber) || null;
  }

  /** « Crédit scolaire · Centre d'appels », précédé de l'agent en vue équipe. */
  public subtitle(task: CrmTaskDto): string {
    const lead = task.leadId ? this.leads().get(task.leadId) : null;
    const product = lead?.interestedProduct?.trim();
    const source = lead?.leadSourceLabel?.trim() || SOURCE_LABELS[lead?.channel ?? ''] || SOURCE_LABELS[lead?.source ?? ''];
    const agents = this.agentNames();
    const agent = agents ? (task.assignedAgentId ? agents.get(task.assignedAgentId) ?? 'Agent inconnu' : 'Non affectée') : null;
    return [agent, product && product.toLowerCase() !== 'unknown' ? product : null, source]
      .filter(Boolean)
      .join(' · ');
  }

  public isLate(task: CrmTaskDto): boolean {
    const deadline = task.slaDeadline ?? task.dueAt;
    return this.isOpen(task) && !!deadline && new Date(deadline).getTime() < this.now();
  }

  public chip(task: CrmTaskDto): string {
    if (!this.isOpen(task)) return task.completedAt ? `Faite ${dayChip(task.completedAt, this.now()).toLowerCase()}` : 'Faite';
    if (this.isLate(task)) return 'En retard';
    return task.dueAt ? dayChip(task.dueAt, this.now()) : '—';
  }

  /**
   * Pourquoi la ligne est où elle est, quand l'heure ne le dit pas : un SLA qui va tomber, un lead
   * chaud à contacter, ou une priorité haute. Un premier contact se reconnaît déjà à son « Contacter ».
   */
  public reason(task: CrmTaskDto): { label: string; tone: string } | null {
    if (!this.isOpen(task) || this.isLate(task)) return null;
    if (taskUrgency(task, this.now()) === 'sla')
      return { label: `SLA dans ${fmtDur(new Date(task.slaDeadline!).getTime() - this.now())}`, tone: 'bg-amber-50 text-amber-800' };
    // Un premier contact est toujours créé en priorité haute : ce badge-là s'affichait sur chacun
    // et noyait « Lead chaud », la seule différence qui compte entre eux.
    if (isFirstContact(task))
      return task.leadId && this.leads().get(task.leadId)?.intentLevel === 'Hot'
        ? { label: 'Lead chaud', tone: 'bg-red-50 text-red-700' }
        : null;
    if (task.priority === 'Critical') return { label: 'Critique', tone: 'bg-red-50 text-red-700' };
    if (task.priority === 'High') return { label: 'Priorité haute', tone: 'bg-orange-50 text-orange-800' };
    return null;
  }

  public firstContacts(group: DayGroup<CrmTaskDto>): number {
    return group.items.filter((t) => this.isOpen(t) && isFirstContact(t)).length;
  }
}
