import { Severity } from '@talisoft/ui/tag';
import {
  AgentPerformanceDto,
  TelephonyStatsDayDto,
  TelephonyStatsRowDto,
} from '@sankore/crm-api';
import {
  TEL_EMPTY_LABEL,
  telDurationLabel,
} from '../../data-access/telephony-referential';

/**
 * Aides de présentation du tableau de bord téléphonie (TEL-F-12).
 *
 * Tout ce qui calcule ou met en forme vit ici et non dans le composant : ce sont des
 * fonctions pures, et ce sont elles qui portent les cas qui se trompent en silence —
 * un dénominateur nul, une journée absente de la série, un point-virgule dans un nom
 * exporté. Le composant ne garde que l'état et les appels réseau.
 */

// ——— Période ———

/** Le serveur retient 31 jours quand on ne lui dit rien : l'écran affiche la même chose. */
export const TELEPHONY_STATS_DEFAULT_PERIOD_DAYS = 31;

/**
 * Plafond dur du serveur. Au-delà il répond 422 `TELEPHONY_STATS_PERIOD_TOO_LONG` : la
 * demande est refusée, pas tronquée. On le vérifie donc avant d'appeler, pour nommer le
 * problème au moment où l'utilisateur choisit les dates plutôt qu'après un aller-retour.
 */
export const TELEPHONY_STATS_MAX_PERIOD_DAYS = 400;

/** Jour UTC au format `date` du contrat (`from`, `to`, `statDate`). */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Normalise ce que le serveur renvoie dans `statDate`.
 *
 * Le contrat le déclare `format: date`, mais une sérialisation .NET d'un `DateOnly` passé
 * par un `DateTime` sort `2026-03-12T00:00:00Z`. Comparer la chaîne brute à un jour
 * `2026-03-12` ne rapprocherait alors AUCUNE ligne de la série, et le graphique serait
 * vide alors que les chiffres sont là.
 */
export function statDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

export interface TelephonyStatsPeriod {
  from: string;
  to: string;
}

/** Les 31 derniers jours, bornes incluses, en jours UTC — comme le serveur les compte. */
export function defaultStatsPeriod(now: Date = new Date()): TelephonyStatsPeriod {
  const to = isoDay(now);
  const fromDate = new Date(`${to}T00:00:00Z`);
  fromDate.setUTCDate(fromDate.getUTCDate() - (TELEPHONY_STATS_DEFAULT_PERIOD_DAYS - 1));
  return { from: isoDay(fromDate), to };
}

/** Nombre de jours de la période, bornes incluses. `null` si une borne est illisible ou inversée. */
export function periodDayCount(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  const start = statDay(from);
  const end = statDay(to);
  if (!start || !end) return null;

  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null;

  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

export function isPeriodTooLong(
  from: string | null | undefined,
  to: string | null | undefined,
): boolean {
  const days = periodDayCount(from, to);
  return days !== null && days > TELEPHONY_STATS_MAX_PERIOD_DAYS;
}

/**
 * Bornes `date-time` de la même période, pour les lectures du module Leads.
 *
 * `telephony/stats` prend des jours (`format: date`) et compte en UTC ;
 * `leads/agent-performance` prend des instants (`format: date-time`). On construit donc
 * les bornes EN UTC et non dans le fuseau du navigateur : un responsable à l'ouest de
 * Greenwich comparerait sinon deux fenêtres décalées d'un jour et ne le verrait pas.
 */
export function periodStartIso(day: string | null | undefined): string | undefined {
  const parsed = statDay(day);
  return parsed ? `${parsed}T00:00:00.000Z` : undefined;
}

export function periodEndIso(day: string | null | undefined): string | undefined {
  const parsed = statDay(day);
  return parsed ? `${parsed}T23:59:59.999Z` : undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Un paramètre d'URL se colle à la main autant qu'il se partage. `agencyId` et
 * `crmUserId` sont déclarés `format: uuid` : une valeur mal collée partirait en 400, et le
 * filtre paraîtrait actif sans l'être.
 */
export function uuidFilterValue(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

/** Jour valide venu de l'URL, ou `null` — jamais renvoyé tel quel au serveur. */
export function dayFilterValue(raw: string | null | undefined): string | null {
  return statDay(raw);
}

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

/**
 * Libellé d'un jour, lu en UTC et non dans le fuseau du navigateur.
 *
 * `new Date('2026-03-12').toLocaleDateString()` rend « 11 mars » à l'ouest de Greenwich :
 * le graphique décalerait d'un cran toute la série, et l'écran annoncerait des jours UTC
 * en en affichant d'autres.
 */
export function formatDayLabel(day: string | null | undefined): string {
  const parsed = statDay(day);
  if (!parsed) return TEL_EMPTY_LABEL;
  const [, month, dayOfMonth] = parsed.split('-');
  return `${Number(dayOfMonth)} ${MONTHS_FR[Number(month) - 1] ?? ''}`.trim();
}

export function formatDayLong(day: string | null | undefined): string {
  const parsed = statDay(day);
  if (!parsed) return TEL_EMPTY_LABEL;
  return `${formatDayLabel(parsed)} ${parsed.slice(0, 4)}`;
}

// ——— Agrégats ———

/**
 * Somme des compteurs d'un lot de buckets. Les champs du DTO sont tous optionnels — le
 * générateur les rend `number | undefined` — donc chaque lecture retombe sur zéro ici
 * plutôt que de produire un `NaN` qui contaminerait ensuite tous les taux de l'écran.
 */
export interface TelephonyTotals {
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  failed: number;
  contact: number;
  wrappedUp: number;
  talkSeconds: number;
  ringSeconds: number;
}

export const EMPTY_TELEPHONY_TOTALS: TelephonyTotals = {
  inbound: 0,
  outbound: 0,
  answered: 0,
  missed: 0,
  failed: 0,
  contact: 0,
  wrappedUp: 0,
  talkSeconds: 0,
  ringSeconds: 0,
};

function count(value: number | null | undefined): number {
  return Number.isFinite(value) ? (value as number) : 0;
}

export function sumTelephonyRows(
  rows: ReadonlyArray<TelephonyStatsRowDto> | null | undefined,
): TelephonyTotals {
  const totals: TelephonyTotals = { ...EMPTY_TELEPHONY_TOTALS };
  for (const row of rows ?? []) {
    totals.inbound += count(row.inboundCount);
    totals.outbound += count(row.outboundCount);
    totals.answered += count(row.answeredCount);
    totals.missed += count(row.missedCount);
    totals.failed += count(row.failedCount);
    totals.contact += count(row.contactCount);
    totals.wrappedUp += count(row.wrappedUpCount);
    totals.talkSeconds += count(row.talkSeconds);
    totals.ringSeconds += count(row.ringSeconds);
  }
  return totals;
}

/** Appels de la période. Les appels internes ne sont PAS comptés : le serveur les exclut en amont. */
export function callCount(totals: TelephonyTotals): number {
  return totals.inbound + totals.outbound;
}

/**
 * Taux, ou `null` quand il n'y a rien à diviser.
 *
 * C'est le cœur de l'honnêteté de l'écran : sur une période sans appel, `0 / 0` rendrait
 * `NaN` (affiché « NaN % ») et `answered / 0 || 0` rendrait « 0 % », c'est-à-dire
 * « personne n'a décroché » — un reproche au lieu d'une absence de mesure. `null` se rend
 * « — ».
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** Taux de décroché : décrochés ÷ appels (entrants + sortants), appels internes exclus. */
export function answerRate(totals: TelephonyTotals): number | null {
  return ratio(totals.answered, callCount(totals));
}

/** Durée moyenne de conversation, en secondes, rapportée aux appels DÉCROCHÉS. */
export function averageTalkSeconds(totals: TelephonyTotals): number | null {
  return ratio(totals.talkSeconds, totals.answered);
}

/** Durée moyenne d'attente avant décroché ou abandon, rapportée aux appels de la période. */
export function averageRingSeconds(totals: TelephonyTotals): number | null {
  return ratio(totals.ringSeconds, callCount(totals));
}

// ——— Mises en forme ———

/** Séparateur de milliers français : espace insécable, pour que « 1 240 » ne se coupe pas en fin de ligne. */
const THOUSANDS_SEPARATOR = '\u202f';

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return TEL_EMPTY_LABEL;
  }
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  let grouped = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) grouped += THOUSANDS_SEPARATOR;
    grouped += digits[i];
  }
  return `${sign}${grouped}`;
}

/**
 * Pourcentage à une décimale, virgule française. `null` (dénominateur nul) rend « — » :
 * un taux non mesurable ne s'affiche pas « 0 % ».
 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return TEL_EMPTY_LABEL;
  }
  return `${(value * 100).toFixed(1).replace('.', ',')} %`;
}

/**
 * Durée en clair. Un responsable lit « 3 min 12 s », pas « 192 ».
 *
 * `null` rend « — » (rien à moyenner), zéro rend « 0 s » (mesuré, et nul) : les deux ne
 * disent pas la même chose et ne doivent pas s'afficher pareil.
 */
export function formatDuration(seconds: number | null | undefined): string {
  // Déléguée au référentiel : cette mise en forme était la plus lisible des trois que les
  // écrans avaient écrites, elle est devenue la seule.
  return telDurationLabel(seconds);
}

// ——— Fraîcheur de la projection ———

/**
 * Âge des chiffres affichés, et à partir de quand il faut le dire.
 *
 * Les indicateurs sortent d'une projection recalculée depuis le journal — toutes les
 * heures sur deux jours, toutes les nuits sur sept — et non du journal. Un écran qui
 * laisse croire à des chiffres temps réel est le défaut, pas l'écran qui annonce un
 * retard. `computedAt` nul n'est pas une panne : c'est une période sans aucun appel,
 * donc sans bucket à dater.
 */
export const TELEPHONY_STATS_FRESH_WITHIN_MINUTES = 90;
export const TELEPHONY_STATS_STALE_AFTER_MINUTES = 26 * 60;

export interface TelephonyStatsFreshness {
  /** `true` quand il n'y a rien à dater : aucun bucket sur la période. */
  readonly isEmpty: boolean;
  readonly isStale: boolean;
  readonly label: string;
  readonly severity: Severity;
}

export function statsFreshness(
  computedAt: string | null | undefined,
  now: number = Date.now(),
): TelephonyStatsFreshness {
  if (!computedAt) {
    return {
      isEmpty: true,
      isStale: false,
      label: 'Aucun appel sur la période : il n’y a rien à calculer.',
      severity: 'neutral',
    };
  }

  const computed = Date.parse(computedAt);
  if (!Number.isFinite(computed)) {
    return {
      isEmpty: false,
      isStale: true,
      label: 'Date de calcul illisible : considérez ces chiffres comme datés.',
      severity: 'warning',
    };
  }

  const minutes = Math.max(0, Math.floor((now - computed) / 60_000));
  const age =
    minutes < 1
      ? "à l’instant"
      : minutes < 60
        ? `il y a ${minutes} min`
        : minutes < 48 * 60
          ? `il y a ${Math.floor(minutes / 60)} h`
          : `il y a ${Math.floor(minutes / 1440)} j`;

  if (minutes <= TELEPHONY_STATS_FRESH_WITHIN_MINUTES) {
    return {
      isEmpty: false,
      isStale: false,
      label: `Chiffres arrêtés ${age}`,
      severity: 'success',
    };
  }

  if (minutes <= TELEPHONY_STATS_STALE_AFTER_MINUTES) {
    return { isEmpty: false, isStale: false, label: `Chiffres arrêtés ${age}`, severity: 'info' };
  }

  return {
    isEmpty: false,
    isStale: true,
    label: `Chiffres arrêtés ${age}`,
    severity: 'warning',
  };
}

// ——— Série par jour ———

export interface TelephonyDayPoint {
  readonly day: string;
  readonly totals: TelephonyTotals;
}

/**
 * Série continue, un point par jour de la période.
 *
 * **Les journées sans appel sont ABSENTES de la réponse, pas à zéro.** Branché tel quel
 * sur un graphique, le dimanche n'existe pas : la courbe saute d'un samedi au lundi et
 * la semaine paraît tassée. Le remplissage est donc fait ici, et il est fait sur les
 * bornes DEMANDÉES — sinon une période vide en son début commencerait au premier jour
 * ayant eu un appel, et deux agences se compareraient sur deux axes différents.
 *
 * Les lignes hors bornes sont ignorées, et la boucle est plafonnée au maximum du serveur
 * pour qu'une borne saisie à la main dans l'URL ne construise pas un tableau sans fin.
 */
export function fillDailySeries(
  days: ReadonlyArray<TelephonyStatsDayDto> | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): TelephonyDayPoint[] {
  const rows = days ?? [];

  // À défaut de bornes lisibles, on retombe sur l'étendue des données : l'écran reste
  // lisible au lieu de n'afficher aucun jour.
  const observed = rows
    .map((row) => statDay(row.statDate))
    .filter((day): day is string => day !== null)
    .sort();

  const start = statDay(from) ?? observed[0] ?? null;
  const end = statDay(to) ?? observed[observed.length - 1] ?? null;
  if (!start || !end) return [];

  const length = periodDayCount(start, end);
  if (length === null) return [];

  const buckets = new Map<string, TelephonyStatsDayDto[]>();
  for (const row of rows) {
    const day = statDay(row.statDate);
    if (!day || day < start || day > end) continue;
    const existing = buckets.get(day);
    if (existing) existing.push(row);
    else buckets.set(day, [row]);
  }

  const points: TelephonyDayPoint[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < Math.min(length, TELEPHONY_STATS_MAX_PERIOD_DAYS); i++) {
    const day = isoDay(cursor);
    points.push({ day, totals: sumTelephonyRows(buckets.get(day)) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
}

// ——— Géométrie du graphique ———

/**
 * Colonnes du graphique par jour, en pourcentages prêts à poser sur une hauteur CSS.
 *
 * Le repo n'embarque aucune bibliothèque de graphiques et ce n'est pas un écran qui
 * justifie d'en ajouter une : deux séries empilées sur une rangée de `div` suffisent, et
 * restent lisibles à 360 px là où un canvas demanderait une taille mesurée.
 */
export interface TelephonyDayColumn {
  readonly day: string;
  readonly label: string;
  readonly total: number;
  readonly outboundPercent: number;
  readonly inboundPercent: number;
  readonly title: string;
}

export function dayChartColumns(
  points: ReadonlyArray<TelephonyDayPoint>,
): TelephonyDayColumn[] {
  const max = points.reduce((peak, point) => Math.max(peak, callCount(point.totals)), 0);

  return points.map((point) => {
    const total = callCount(point.totals);
    // Un maximum nul n'est pas une anomalie : c'est une période sans appel. Toutes les
    // colonnes valent alors zéro, au lieu de diviser par zéro.
    const scale = max > 0 ? 100 / max : 0;
    return {
      day: point.day,
      label: formatDayLabel(point.day),
      total,
      outboundPercent: point.totals.outbound * scale,
      inboundPercent: point.totals.inbound * scale,
      title: `${formatDayLong(point.day)} — ${formatCount(point.totals.outbound)} sortant(s), ${formatCount(point.totals.inbound)} entrant(s)`,
    };
  });
}

/**
 * Jours à étiqueter sous le graphique : au plus `maxTicks`, premier et dernier compris.
 * Étiqueter 400 jours rendrait l'axe illisible et déborderait à 360 px.
 */
export function dayChartTicks(
  points: ReadonlyArray<TelephonyDayPoint>,
  maxTicks = 5,
): string[] {
  if (points.length === 0) return [];
  if (points.length <= maxTicks) return points.map((point) => formatDayLabel(point.day));

  const step = (points.length - 1) / (maxTicks - 1);
  const ticks: string[] = [];
  for (let i = 0; i < maxTicks; i++) {
    ticks.push(formatDayLabel(points[Math.round(i * step)].day));
  }
  return ticks;
}

// ——— Classement par agent ———

/** Clé du bucket « personne » : `crmUserId` nul, et non une absence de nom. */
export const TELEPHONY_NOBODY_KEY = '__nobody__';

export const TELEPHONY_NOBODY_LABEL = 'Non attribué';

export const TELEPHONY_NOBODY_HINT =
  "Appels passés depuis un compte du fournisseur qu'aucun rattachement ne résout. Ils ne sont visibles que si vous voyez l'ensemble de l'établissement.";

export interface TelephonyAgentRow {
  /** Identifiant de ligne du tableau : jamais nul, pour que `tas-table` sache suivre la ligne. */
  readonly key: string;
  readonly crmUserId: string | null;
  /** Agences où l'agent a passé des appels sur la période (l'agence est estampillée sur l'appel). */
  readonly agencyIds: ReadonlyArray<string | null>;
  readonly totals: TelephonyTotals;
  readonly calls: number;
  readonly answerRate: number | null;
  readonly averageTalkSeconds: number | null;
}

/**
 * Classement par agent, trié sur le volume d'appels.
 *
 * `totals` donne un bucket par couple (agent, agence) : un agent muté en cours de période
 * y figure DEUX fois, parce que l'agence est copiée sur l'appel au moment où il est passé
 * et non jointe à l'agent du jour. On regroupe donc par agent, et la ligne dit sur
 * combien d'agences elle porte — additionner sans le dire ferait croire à un doublon.
 */
export function rankAgents(
  rows: ReadonlyArray<TelephonyStatsRowDto> | null | undefined,
): TelephonyAgentRow[] {
  const grouped = new Map<string, { crmUserId: string | null; agencies: Set<string | null>; rows: TelephonyStatsRowDto[] }>();

  for (const row of rows ?? []) {
    const crmUserId = row.crmUserId ?? null;
    const key = crmUserId ?? TELEPHONY_NOBODY_KEY;
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.agencies.add(row.agencyId ?? null);
      bucket.rows.push(row);
    } else {
      grouped.set(key, {
        crmUserId,
        agencies: new Set<string | null>([row.agencyId ?? null]),
        rows: [row],
      });
    }
  }

  return [...grouped.values()]
    .map((bucket) => {
      const totals = sumTelephonyRows(bucket.rows);
      return {
        key: bucket.crmUserId ?? TELEPHONY_NOBODY_KEY,
        crmUserId: bucket.crmUserId,
        agencyIds: [...bucket.agencies],
        totals,
        calls: callCount(totals),
        answerRate: answerRate(totals),
        averageTalkSeconds: averageTalkSeconds(totals),
      } satisfies TelephonyAgentRow;
    })
    .sort((a, b) => b.calls - a.calls || b.totals.talkSeconds - a.totals.talkSeconds);
}

// ——— Premier contact et SLA : chiffres du module Leads ———

/**
 * Les deux indicateurs de TEL-F-12 qui ne sont PAS dans `TelephonyStatsDto`.
 *
 * Le délai de premier contact et la part des leads contactés dans le SLA se mesurent dans
 * le module Leads : l'horloge part de l'attribution du lead et s'arrête sur un résultat
 * d'appel marqué « compte comme contact », information que les compteurs téléphoniques
 * n'exposent pas appel par appel. Ils viennent donc de
 * `GET leads/agent-performance` (`AgentPerformanceDto`), qui les calcule, et non d'une
 * approximation bâtie sur `contactCount`.
 *
 * Conséquence à dire à l'écran : un premier contact pris par courriel ou en agence y est
 * compté. Ce n'est pas un indicateur téléphonique.
 */
export interface LeadSlaSummary {
  readonly assigned: number;
  readonly contactedWithinSla: number;
  readonly contactedLate: number;
  readonly notContacted: number;
  /** Part des leads attribués contactés dans le délai. `null` si aucun lead attribué. */
  readonly slaShare: number | null;
  /** Moyenne pondérée par le nombre de leads contactés. `null` si personne n'a été contacté. */
  readonly averageFirstContactMinutes: number | null;
  /** Agents dont le délai moyen est inconnu : la moyenne ne les compte pas, l'écran le dit. */
  readonly agentsWithoutMeasure: number;
}

export const EMPTY_LEAD_SLA_SUMMARY: LeadSlaSummary = {
  assigned: 0,
  contactedWithinSla: 0,
  contactedLate: 0,
  notContacted: 0,
  slaShare: null,
  averageFirstContactMinutes: null,
  agentsWithoutMeasure: 0,
};

export function summariseLeadSla(
  rows: ReadonlyArray<AgentPerformanceDto> | null | undefined,
): LeadSlaSummary {
  let assigned = 0;
  let withinSla = 0;
  let late = 0;
  let notContacted = 0;
  let weightedMinutes = 0;
  let weight = 0;
  let agentsWithoutMeasure = 0;

  for (const row of rows ?? []) {
    assigned += count(row.totalAssigned);
    withinSla += count(row.contactedWithinSla);
    late += count(row.contactedLate);
    notContacted += count(row.notContacted);

    const contacted = count(row.contactedWithinSla) + count(row.contactedLate);
    const average = row.avgFirstContactMinutes;

    // La moyenne de l'établissement est pondérée par le nombre de leads contactés, pas
    // une moyenne de moyennes : un agent avec deux leads pèserait autrement autant qu'un
    // agent avec deux cents. Un agent sans mesure (aucun contact pris) est exclu des DEUX
    // côtés de la fraction au lieu d'y entrer comme un zéro, qui tirerait le délai moyen
    // vers le bas en récompensant l'inaction.
    if (average !== null && average !== undefined && Number.isFinite(average) && contacted > 0) {
      weightedMinutes += average * contacted;
      weight += contacted;
    } else if (contacted === 0) {
      agentsWithoutMeasure++;
    }
  }

  return {
    assigned,
    contactedWithinSla: withinSla,
    contactedLate: late,
    notContacted,
    slaShare: ratio(withinSla, assigned),
    averageFirstContactMinutes: ratio(weightedMinutes, weight),
    agentsWithoutMeasure,
  };
}

/** Le contrat donne le délai en MINUTES, l'écran l'affiche comme les autres durées. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes < 0) {
    return TEL_EMPTY_LABEL;
  }
  return formatDuration(minutes * 60);
}

// ——— Export CSV ———

/**
 * Échappement CSV « maison » : guillemets doublés, et guillemets autour du champ dès
 * qu'il contient le séparateur, un guillemet ou un saut de ligne. Un nom d'agence
 * « Ouaga 2000 ; Zone B » couperait sinon la ligne en deux colonnes.
 */
export function csvField(value: string | null | undefined): string {
  const text = value ?? '';
  if (/[";\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface TelephonyCsvNameResolver {
  agentName(crmUserId: string | null | undefined): string;
  agencyName(agencyId: string | null | undefined): string;
}

/**
 * Fichier d'export, construit CÔTÉ CLIENT.
 *
 * Le serveur n'expose pas d'export des indicateurs — seulement `telephony/calls/export.csv`
 * pour le journal. Ici c'est sans conséquence : la réponse contient DÉJÀ toutes les lignes
 * de la période, donc le fichier est complet et non une page. On exporte le grain le plus
 * fin (jour × agent × agence) : les totaux s'en rejouent par un tableau croisé, l'inverse
 * est impossible.
 *
 * Point-virgule et BOM UTF-8 (posé au téléchargement), comme `ExportTelephonyCallsSlice`
 * côté serveur : un Excel français ouvre un fichier à virgules en une seule colonne et
 * massacre les accents sans BOM.
 */
export const TELEPHONY_STATS_CSV_HEADER = [
  'Jour (UTC)',
  'Agent',
  'Agence',
  'Appels',
  'Entrants',
  'Sortants',
  'Décrochés',
  'Manqués',
  'Échecs',
  'Contacts utiles',
  'Qualifiés',
  'Temps de conversation (s)',
  'Temps de sonnerie (s)',
] as const;

export function buildTelephonyStatsCsv(
  days: ReadonlyArray<TelephonyStatsDayDto> | null | undefined,
  resolver: TelephonyCsvNameResolver,
): string {
  const rows = [...(days ?? [])].sort((a, b) =>
    (statDay(a.statDate) ?? '').localeCompare(statDay(b.statDate) ?? ''),
  );

  const lines = rows.map((row) => {
    const totals = sumTelephonyRows([row]);
    return [
      statDay(row.statDate) ?? '',
      resolver.agentName(row.crmUserId),
      resolver.agencyName(row.agencyId),
      String(callCount(totals)),
      String(totals.inbound),
      String(totals.outbound),
      String(totals.answered),
      String(totals.missed),
      String(totals.failed),
      String(totals.contact),
      String(totals.wrappedUp),
      String(totals.talkSeconds),
      String(totals.ringSeconds),
    ]
      .map((field) => csvField(field))
      .join(';');
  });

  return [TELEPHONY_STATS_CSV_HEADER.map((field) => csvField(field)).join(';'), ...lines].join(
    '\r\n',
  );
}

export function telephonyStatsCsvFileName(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const start = statDay(from) ?? 'debut';
  const end = statDay(to) ?? 'fin';
  return `indicateurs-telephonie-${start}_${end}.csv`;
}
