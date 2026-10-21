import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { LeadNextStepDto, LeadNextStepDtoKindEnum } from '@sankore/crm-api';

export type NextStepTone = 'overdue' | 'today' | 'soon' | 'later' | 'unplanned';

export interface NextStepDue {
  /** « En retard de 2 j », « Aujourd'hui · 14:00 », « Demain · 09:00 », « lun. 27 oct. », « À planifier ». */
  label: string;
  /** La date complète, pour l'infobulle et le lecteur d'écran. */
  fullDate: string | null;
  tone: NextStepTone;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function time(d: Date): string {
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function lateBy(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)} j`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)} h`;
  return `${Math.max(1, Math.floor(ms / MINUTE))} min`;
}

/**
 * L'échéance d'une prochaine étape, en mots. Une étape sans date est une suggestion que personne
 * n'a encore planifiée : on l'écrit « À planifier » plutôt que d'inventer une date.
 */
export function nextStepDue(step: LeadNextStepDto | null | undefined, now = new Date()): NextStepDue {
  if (!step?.dueAt) return { label: 'À planifier', fullDate: null, tone: 'unplanned' };
  const due = new Date(step.dueAt);
  if (Number.isNaN(due.getTime())) return { label: 'À planifier', fullDate: null, tone: 'unplanned' };

  const fullDate = due.toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const diff = due.getTime() - now.getTime();
  if (step.isOverdue || diff < 0) {
    return { label: `En retard de ${lateBy(-diff)}`, fullDate, tone: 'overdue' };
  }

  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (days === 0) return { label: `Aujourd'hui · ${time(due)}`, fullDate, tone: 'today' };
  if (days === 1) return { label: `Demain · ${time(due)}`, fullDate, tone: 'soon' };
  const sameYear = due.getFullYear() === now.getFullYear();
  const label = due.toLocaleDateString('fr-FR', days < 7
    ? { weekday: 'short', day: 'numeric', month: 'short' }
    : { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return { label, fullDate, tone: days < 7 ? 'soon' : 'later' };
}

export function nextStepIcon(step: LeadNextStepDto | null | undefined): string {
  switch (step?.kind) {
    case LeadNextStepDtoKindEnum.Task:         return 'feather:check-square';
    case LeadNextStepDtoKindEnum.Reminder:     return 'feather:bell';
    case LeadNextStepDtoKindEnum.FirstContact: return 'feather:phone-call';
    default:                                   return 'feather:zap';
  }
}

/** Classes de la pastille d'échéance, communes à la liste, au pipeline et à la fiche. */
export function nextStepDueClass(tone: NextStepTone): string {
  switch (tone) {
    case 'overdue':   return 'bg-red-50 text-red-700';
    case 'today':     return 'bg-amber-100 text-amber-800';
    case 'soon':      return 'bg-blue-50 text-blue-700';
    case 'later':     return 'bg-slate-100 text-slate-700';
    case 'unplanned': return 'border border-dashed border-slate-300 text-slate-500';
  }
}

/**
 * La prochaine étape d'un lead en deux lignes — quoi, puis quand — pour une cellule de liste ou une
 * carte du pipeline. Rien sur un lead clos : le serveur n'en renvoie pas.
 */
@Component({
  selector: 'lead-next-step',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    @if (step(); as s) {
      <div class="min-w-0" [attr.title]="due().fullDate ? s.title + ' — ' + due().fullDate : s.title">
        <p class="flex items-center gap-1.5 text-sm text-slate-800 min-w-0">
          <tas-icon [iconName]="icon()" class="text-slate-400 shrink-0" style="font-size:12px"></tas-icon>
          <span class="truncate">{{ s.title }}</span>
        </p>
        <span class="inline-flex mt-1 px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap" [class]="dueClass()">
          {{ due().label }}
        </span>
      </div>
    } @else {
      <span class="text-sm text-slate-400">—</span>
    }
  `,
})
export class LeadNextStep {
  public readonly step = input<LeadNextStepDto | null | undefined>(null);

  public readonly due = computed(() => nextStepDue(this.step()));
  public readonly icon = computed(() => nextStepIcon(this.step()));
  public readonly dueClass = computed(() => nextStepDueClass(this.due().tone));
}
