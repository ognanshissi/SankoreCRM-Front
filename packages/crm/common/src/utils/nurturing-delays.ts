/**
 * Le serveur échange le délai d'une étape en TimeSpan (« 3.00:00:00 »), les écrans en jours entiers :
 * les deux écrans de nurturing (paramétrage, fiche lead) passent par ici.
 */
export function nurturingDelayDays(delay: string | null | undefined): number {
  const match = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)/.exec(delay ?? '');
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  const total = Number(days ?? 0) + (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) / 86400;
  return Math.ceil(total);
}

export function nurturingDelay(days: number): string {
  return days > 0 ? `${days}.00:00:00` : '00:00:00';
}

/** « 3 e-mails sur 21 jours », « 1 e-mail dès l'inscription ». */
export function nurturingSummary(steps: readonly { delayFromPrevious?: string | null }[] | null | undefined): string {
  const list = steps ?? [];
  const mails = list.length > 1 ? `${list.length} e-mails` : `${list.length} e-mail`;
  const total = list.reduce((sum, step) => sum + nurturingDelayDays(step.delayFromPrevious), 0);
  if (total === 0) return `${mails} dès l'inscription`;
  return `${mails} sur ${total} jour${total > 1 ? 's' : ''}`;
}
