import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CrmTaskDto, CrmTaskDtoStatusEnum, LeadDto } from '@sankore/crm-api';
import { TasIcon } from '@talisoft/ui/icon';
import { ContactButtons } from './contact-buttons';
import { DayGroup, dayChip, isFirstContact, SPREAD_THRESHOLD } from './my-day-meta';
import { leadDisplayName, taskActionLabel } from './task-meta';

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

function typeVisual(type: string | undefined): { icon: string; tone: string } {
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

/**
 * Les tâches de « Ma journée », une carte par jour. En cartes et non en `tas-table` : c'est la
 * maquette du propriétaire, et une liste de travail regroupée par jour n'a pas de paginateur.
 *
 * Le composant ne fait rien lui-même : ouvrir, reporter, répartir et réassigner remontent à
 * l'écran, qui possède la liste et la recharge.
 */
@Component({
  selector: 'my-day-task-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, ContactButtons],
  templateUrl: './task-day-list.html',
})
export class TaskDayList {
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

  public readonly open = output<CrmTaskDto>();
  public readonly postpone = output<CrmTaskDto>();
  public readonly spread = output<DayGroup<CrmTaskDto>>();
  public readonly reassign = output<CrmTaskDto>();

  public readonly visual = typeVisual;
  public readonly actionLabel = taskActionLabel;
  public readonly spreadThreshold = SPREAD_THRESHOLD;

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

  public firstContacts(group: DayGroup<CrmTaskDto>): number {
    return group.items.filter((t) => this.isOpen(t) && isFirstContact(t)).length;
  }
}
