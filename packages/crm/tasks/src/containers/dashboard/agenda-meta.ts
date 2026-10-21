import { AgendaActivityDtoTypeEnum, AgendaAppointmentDto, AgendaAppointmentDtoMeetingProviderEnum, AgendaAppointmentDtoModeEnum, MyAgendaDto } from '@sankore/crm-api';

/**
 * L'agenda de « Ma journée » : rappels, activités planifiées et rendez-vous, fondus en une seule
 * liste chronologique. Le serveur les rend séparément (`GET leads/me/agenda`) parce que ce sont
 * trois entités ; l'agent, lui, ne lit qu'une suite de rendez-vous.
 */
export interface AgendaEntry {
  /** Préfixé du genre : un rappel et une activité peuvent partager un identifiant. */
  key: string;
  kind: 'reminder' | 'activity' | 'appointment';
  id: string;
  /** Nul pour un rendez-vous avec un client, ou avec personne. */
  leadId: string | null;
  /** Le lead, le client, ou « Réunion interne » : ce que la ligne dit après le titre. */
  leadName: string;
  at: string;
  title: string;
  notes: string | null;
  durationMinutes: number | null;
  isOverdue: boolean;
  type: { label: string; icon: string; tone: string };
  /** Le rendez-vous complet, pour son détail : participants, lien, organisateur. */
  appointment?: AgendaAppointmentDto;
}

const REMINDER_TYPE = { label: 'Rappel', icon: 'feather:bell', tone: 'bg-violet-50 text-violet-700' };

export function activityTypeMeta(type: AgendaActivityDtoTypeEnum | undefined): AgendaEntry['type'] {
  switch (type) {
    // Le formulaire d'activité appelle « Rendez-vous » ce que l'API nomme Meeting.
    case AgendaActivityDtoTypeEnum.Meeting:  return { label: 'Rendez-vous', icon: 'feather:users',          tone: 'bg-amber-50 text-amber-700' };
    case AgendaActivityDtoTypeEnum.Visit:    return { label: 'Visite',      icon: 'feather:map-pin',        tone: 'bg-green-50 text-green-700' };
    case AgendaActivityDtoTypeEnum.Call:     return { label: 'Appel',       icon: 'feather:phone',          tone: 'bg-blue-50 text-blue-700' };
    case AgendaActivityDtoTypeEnum.Email:    return { label: 'E-mail',      icon: 'feather:mail',           tone: 'bg-indigo-50 text-indigo-700' };
    case AgendaActivityDtoTypeEnum.Sms:      return { label: 'SMS',         icon: 'feather:message-square', tone: 'bg-cyan-50 text-cyan-700' };
    case AgendaActivityDtoTypeEnum.WhatsApp: return { label: 'WhatsApp',    icon: 'feather:message-circle', tone: 'bg-emerald-50 text-emerald-700' };
    case AgendaActivityDtoTypeEnum.Task:     return { label: 'Tâche',       icon: 'feather:check-square',   tone: 'bg-orange-50 text-orange-700' };
    default:                                 return { label: 'Activité',    icon: 'feather:calendar',       tone: 'bg-slate-100 text-slate-600' };
  }
}

const PROVIDER_LABELS: Record<string, string> = {
  [AgendaAppointmentDtoMeetingProviderEnum.Zoom]: 'Zoom',
  [AgendaAppointmentDtoMeetingProviderEnum.Teams]: 'Teams',
  [AgendaAppointmentDtoMeetingProviderEnum.GoogleMeet]: 'Google Meet',
};

export function appointmentTypeMeta(a: AgendaAppointmentDto): AgendaEntry['type'] {
  if (a.mode === AgendaAppointmentDtoModeEnum.Online) {
    const provider = PROVIDER_LABELS[a.meetingProvider ?? ''];
    return { label: provider ? `Réunion ${provider}` : 'Réunion en ligne', icon: 'feather:video', tone: 'bg-sky-50 text-sky-700' };
  }
  return { label: 'Rendez-vous', icon: 'feather:users', tone: 'bg-amber-50 text-amber-700' };
}

export function appointmentSubject(a: AgendaAppointmentDto): string {
  if (a.leadId) return a.leadName?.trim() || 'Lead';
  if (a.clientId) return a.clientName?.trim() ? `Client ${a.clientName.trim()}` : 'Client';
  return 'Réunion interne';
}

export function agendaEntries(agenda: MyAgendaDto | null): AgendaEntry[] {
  if (!agenda) return [];
  const reminders: AgendaEntry[] = (agenda.reminders ?? []).map((r) => ({
    key: `r-${r.id}`,
    kind: 'reminder',
    id: r.id ?? '',
    leadId: r.leadId ?? '',
    leadName: r.leadName?.trim() || 'Lead',
    at: r.dueAt ?? '',
    title: r.title?.trim() || 'Rappel',
    notes: r.notes ?? null,
    durationMinutes: null,
    isOverdue: !!r.isOverdue,
    type: REMINDER_TYPE,
  }));
  const activities: AgendaEntry[] = (agenda.activities ?? []).map((a) => {
    const type = activityTypeMeta(a.type);
    return {
      key: `a-${a.id}`,
      kind: 'activity',
      id: a.id ?? '',
      leadId: a.leadId ?? '',
      leadName: a.leadName?.trim() || 'Lead',
      at: a.scheduledAt ?? '',
      title: a.subject?.trim() || type.label,
      notes: a.notes ?? null,
      durationMinutes: a.durationMinutes ?? null,
      isOverdue: false,
      type,
    };
  });
  const appointments: AgendaEntry[] = (agenda.appointments ?? []).map((a) => ({
    key: `m-${a.id}`,
    kind: 'appointment',
    id: a.id ?? '',
    leadId: a.leadId ?? null,
    leadName: appointmentSubject(a),
    at: a.startAt ?? '',
    title: a.title?.trim() || 'Rendez-vous',
    notes: a.description ?? null,
    durationMinutes: a.durationMinutes ?? null,
    isOverdue: false,
    type: appointmentTypeMeta(a),
    appointment: a,
  }));
  return [...reminders, ...activities, ...appointments].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
}

export interface AgendaWhen {
  /** « En retard de 2 j », « Aujourd'hui · 14:00 », « Demain · 09:00 », « lun. 27 oct. · 10:30 ». */
  label: string;
  tone: 'overdue' | 'today' | 'later';
  fullDate: string;
}

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** En français par `toLocale…` : l'application n'enregistre pas la locale française d'Angular. */
export function agendaWhen(iso: string, now: number, isOverdue = false): AgendaWhen {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fullDate = at.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });

  if (isOverdue) {
    const late = now - at.getTime();
    const by = late >= DAY ? `${Math.floor(late / DAY)} j` : late >= 3_600_000 ? `${Math.floor(late / 3_600_000)} h` : `${Math.max(1, Math.floor(late / 60_000))} min`;
    return { label: `En retard de ${by}`, tone: 'overdue', fullDate };
  }

  const days = Math.round((startOfDay(at) - startOfDay(new Date(now))) / DAY);
  if (days === 0) return { label: `Aujourd'hui · ${time}`, tone: 'today', fullDate };
  if (days === 1) return { label: `Demain · ${time}`, tone: 'later', fullDate };
  const day = at.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return { label: `${day} · ${time}`, tone: 'later', fullDate };
}

