import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TeamAgentRowDto, TeamScorecardDto } from '@sankore/crm-api';
import { TasSelect } from '@talisoft/ui/select';
import { TableConfig, TasTable } from '@talisoft/ui/table';

export type TeamPeriod = 'day' | 'week' | 'month';

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

function dayLabel(date: string | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const label = WEEKDAY.format(new Date(y, m - 1, d)).replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** L'agence et ses sous-agences, d'après les agences que le responsable peut voir. */
function descendants(root: string, agencies: { id?: string; parentAgencyId?: string | null }[]): Set<string> {
  const result = new Set([root]);
  const frontier = [root];
  while (frontier.length) {
    const parent = frontier.shift()!;
    for (const a of agencies) {
      if (a.id && a.parentAgencyId === parent && !result.has(a.id)) {
        result.add(a.id);
        frontier.push(a.id);
      }
    }
  }
  return result;
}

/** `tas-select` n'affiche pas une option de valeur vide : « Toutes » et « Tous » ont la leur. */
const EVERYONE = 'all';

/**
 * La colonne de droite de « Ma journée » des responsables (2026-11-03) : la journée de l'équipe, à
 * la place de « Mes performances ». Agence et agent se choisissent ici ; le périmètre (son agence pour
 * un chef d'agence, toutes pour un administrateur) est celui que le serveur renvoie dans les options.
 * Les chiffres viennent de `GET leads/me/team-scorecard`, qui en porte les règles.
 */
@Component({
  selector: 'my-day-team',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TasSelect, DecimalPipe],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <section class="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm" aria-labelledby="my-day-team">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="my-day-team" class="text-lg font-bold text-slate-900">{{ agentId() ? 'Performance de l’agent' : 'Performance de l’équipe' }}</h2>
        <div role="group" aria-label="Période" class="flex gap-1 rounded-xl bg-slate-100 p-1">
          @for (p of periods; track p.value) {
            <button type="button" class="min-h-8 whitespace-nowrap rounded-lg px-2.5 text-xs font-semibold transition-colors"
              [class]="period() === p.value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'"
              [attr.aria-pressed]="period() === p.value" (click)="periodChange.emit(p.value)">{{ p.label }}</button>
          }
        </div>
      </header>

      <div class="mt-4 grid grid-cols-1 gap-2">
        <tas-select [options]="agencyOptions()" [clearable]="false" aria-label="Agence"
          [ngModel]="agencyId() || everyone" (ngModelChange)="agencyChange.emit(picked($event))"></tas-select>
        <tas-select [options]="agentOptions()" [clearable]="false" aria-label="Agent"
          [ngModel]="agentId() || everyone" (ngModelChange)="agentChange.emit(picked($event))"></tas-select>
      </div>

      @if (card(); as c) {
        <p class="mt-5 flex items-baseline gap-3">
          <span class="text-5xl font-bold text-slate-900 tabular-nums">{{ c.captured ?? 0 }}</span>
          <span class="text-sm text-slate-600">lead{{ (c.captured ?? 0) > 1 ? 's' : '' }} capturé{{ (c.captured ?? 0) > 1 ? 's' : '' }} {{ periodLabel() }}{{ agentId() ? ' par l’agent' : '' }}</span>
        </p>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <div class="rounded-2xl p-3" [class]="(c.tasks?.overdue ?? 0) > 0 ? 'bg-red-50' : 'bg-slate-50'">
            <p class="text-xs text-slate-700">Tâches non démarrées</p>
            <p class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{{ c.tasks?.notStarted ?? 0 }}</p>
            <p class="mt-1 text-xs" [class]="(c.tasks?.overdue ?? 0) > 0 ? 'font-semibold text-red-700' : 'text-slate-500'">
              {{ (c.tasks?.overdue ?? 0) > 0 ? 'dont ' + c.tasks!.overdue + ' en retard' : 'aucune en retard' }}
            </p>
          </div>
          <div class="rounded-2xl p-3" [class]="(c.lateFirstContacts ?? 0) > 0 ? 'bg-amber-50' : 'bg-slate-50'">
            <p class="text-xs text-slate-700">Premiers contacts en retard</p>
            <p class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{{ c.lateFirstContacts ?? 0 }}</p>
            <p class="mt-1 text-xs text-slate-500">délai dépassé, à l’instant</p>
          </div>
        </div>

        <div class="mt-4 border-t border-slate-100 pt-4">
          <p class="flex items-baseline gap-2 text-sm text-slate-700">
            <span class="text-xl font-bold text-slate-900 tabular-nums">{{ c.assigned?.total ?? 0 }}</span>
            lead{{ (c.assigned?.total ?? 0) > 1 ? 's' : '' }} attribué{{ (c.assigned?.total ?? 0) > 1 ? 's' : '' }} {{ periodLabel() }}
          </p>
          <div class="mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img" [attr.aria-label]="statusSummary()">
            @for (s of statuses(); track s.label) {
              @if (s.count > 0) {
                <span class="h-full" [class]="s.bar" [style.flex-grow]="s.count"></span>
              }
            }
          </div>
          <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            @for (s of statuses(); track s.label) {
              <div class="flex items-center gap-2">
                <span class="size-2.5 rounded-sm" [class]="s.bar"></span>
                <dt class="flex-1 text-slate-700">{{ s.label }}</dt>
                <dd class="font-semibold text-slate-900 tabular-nums">{{ s.count }}</dd>
              </div>
            }
          </dl>
        </div>

        <div class="mt-4 border-t border-slate-100 pt-4">
          <p class="text-xs text-slate-600">{{ period() === 'month' ? 'Leads attribués par semaine' : 'Leads attribués par jour' }}</p>
          <div class="mt-3 grid items-end gap-2" [style.grid-template-columns]="'repeat(' + bars().length + ', minmax(0, 1fr))'"
            role="img" [attr.aria-label]="barsSummary()">
            @for (b of bars(); track b.key) {
              <div class="flex flex-col items-center gap-1">
                <span class="text-xs font-semibold text-slate-900 tabular-nums">{{ b.value }}</span>
                <span class="w-full rounded-md" [class]="b.highlight ? 'bg-primary' : 'bg-primary/25'" [style.height.px]="barHeight(b.value)"></span>
                <span class="text-xs text-slate-500">{{ b.label }}</span>
              </div>
            }
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-xs text-slate-700">Premier contact sous 24 h</p>
            <p class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {{ c.firstContactWithin24h?.rate != null ? (c.firstContactWithin24h!.rate! | number: '1.0-0') + ' %' : '—' }}
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <span class="block h-full rounded-full bg-primary" [style.width.%]="c.firstContactWithin24h?.rate ?? 0"></span>
            </div>
            <p class="mt-1.5 text-xs text-slate-500">
              @if (c.firstContactWithin24h?.objective != null) { Objectif : {{ c.firstContactWithin24h!.objective }} % }
              @else { {{ c.firstContactWithin24h?.eligible ? c.firstContactWithin24h!.onTime + ' sur ' + c.firstContactWithin24h!.eligible : 'Rien à mesurer encore' }} }
            </p>
          </div>
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-xs text-slate-700">Convertis en clients</p>
            <p class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {{ c.conversions?.count ?? 0 }}@if (c.conversions?.objective != null) {<span class="text-slate-400"> / {{ c.conversions!.objective }}</span>}
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <span class="block h-full rounded-full bg-amber-500" [style.width.%]="conversionProgress()"></span>
            </div>
            <p class="mt-1.5 text-xs text-slate-500">{{ periodLabel() }}</p>
          </div>
        </div>
      } @else {
        <p class="mt-6 text-sm text-slate-500">{{ loading() ? 'Chargement…' : 'Les chiffres ne sont pas disponibles pour l’instant.' }}</p>
      }
    </section>
  `,
})
export class MyDayTeam {
  public readonly card = input<TeamScorecardDto | null>(null);
  public readonly period = input<TeamPeriod>('day');
  /** '' = toutes les agences du périmètre, tous les agents. */
  public readonly agencyId = input('');
  public readonly agentId = input('');
  public readonly loading = input(false);

  public readonly periodChange = output<TeamPeriod>();
  public readonly agencyChange = output<string>();
  public readonly agentChange = output<string>();

  public readonly everyone = EVERYONE;

  public picked(value: string | null): string {
    return !value || value === EVERYONE ? '' : value;
  }

  public readonly periods: { value: TeamPeriod; label: string }[] = [
    { value: 'day', label: 'Jour' },
    { value: 'week', label: 'Semaine' },
    { value: 'month', label: 'Mois' },
  ];

  public readonly agencyOptions = computed(() => {
    const c = this.card();
    const agencies = (c?.agencies ?? []).filter((a) => !!a.id);
    // Un chef d'agence qui n'en voit qu'une n'a rien à choisir : son agence est l'équipe.
    const all = c?.allAgencies ? 'Toutes les agences' : agencies.length > 1 ? 'Toutes mes agences' : agencies[0]?.name ?? 'Mon agence';
    return [{ label: all, value: EVERYONE }, ...agencies.map((a) => ({ label: a.name ?? '', value: a.id! }))];
  });

  public readonly agentOptions = computed(() => {
    const c = this.card();
    const agency = this.agencyId();
    const inAgency = agency ? descendants(agency, c?.agencies ?? []) : null;
    const agents = (c?.agents ?? []).filter((a) => !!a.id && (!inAgency || (!!a.agencyId && inAgency.has(a.agencyId))));
    return [{ label: 'Tous les agents', value: EVERYONE }, ...agents.map((a) => ({ label: a.fullName ?? '', value: a.id! }))];
  });

  public readonly periodLabel = computed(() => {
    switch (this.period()) {
      case 'day': return 'aujourd’hui';
      case 'week': return 'cette semaine';
      default: {
        const from = this.card()?.from;
        return `en ${MONTH.format(from ? new Date(from) : new Date())}`;
      }
    }
  });

  public readonly statuses = computed(() => {
    const a = this.card()?.assigned;
    return [
      { label: 'À contacter', count: a?.toContact ?? 0, bar: 'bg-amber-400' },
      { label: 'En cours', count: a?.inProgress ?? 0, bar: 'bg-blue-600' },
      { label: 'Convertis', count: a?.converted ?? 0, bar: 'bg-primary' },
      { label: 'Perdus', count: a?.lost ?? 0, bar: 'bg-stone-300' },
    ];
  });
  public readonly statusSummary = computed(() => this.statuses().map((s) => `${s.label} : ${s.count}`).join(', '));

  /** Jour et semaine : les jours de la semaine en cours ; mois : les quatre dernières semaines. */
  public readonly bars = computed(() => {
    const c = this.card();
    if (this.period() !== 'month') {
      return (c?.dailyReceived ?? []).map((d) => ({
        key: d.date ?? '', label: dayLabel(d.date), value: d.received ?? 0, highlight: !!d.isToday,
      }));
    }
    const weeks = c?.weeklyReceived ?? [];
    return weeks.map((w, i) => ({ key: w.label ?? String(i), label: w.label ?? '', value: w.received ?? 0, highlight: i === weeks.length - 1 }));
  });
  public readonly barsSummary = computed(() => this.bars().map((b) => `${b.label} : ${b.value}`).join(', '));
  private readonly _maxBar = computed(() => Math.max(1, ...this.bars().map((b) => b.value)));

  public readonly conversionProgress = computed(() => {
    const c = this.card()?.conversions;
    if (!c?.objective) return (c?.count ?? 0) > 0 ? 100 : 0;
    return Math.min(100, (100 * (c.count ?? 0)) / c.objective);
  });

  public barHeight(received: number | undefined): number {
    return 4 + Math.round(((received ?? 0) / this._maxBar()) * 52);
  }
}

/**
 * Une ligne par agent de l'équipe, sous la journée du responsable : qui a des tâches qui dorment,
 * des premiers contacts en retard, des leads à contacter. Cliquer une ligne choisit l'agent.
 */
@Component({
  selector: 'my-day-team-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasTable, DecimalPipe],
  template: `
    <section class="rounded-3xl border border-slate-100 bg-white shadow-sm" aria-labelledby="my-day-team-table">
      <header class="flex flex-wrap items-baseline justify-between gap-3 px-5 pb-2 pt-5">
        <h2 id="my-day-team-table" class="text-lg font-bold text-slate-900">Équipe</h2>
        <span class="text-xs text-slate-500">Tâches, à contacter et retards : à l’instant · le reste : {{ periodLabel() }}</span>
      </header>
      <div class="px-5 pb-4">
        <tas-table [data]="rows()" identifierField="agentId" [config]="table" [hasCaption]="false">
          <ng-template #header>
            <!-- tas-table interdit le retour à la ligne des en-têtes : dans la colonne de « Ma journée », huit
                 en-têtes sur une ligne faisaient défiler le tableau. « ! » passe devant sa feuille de style. -->
            <tr class="text-left text-xs font-medium text-slate-500 [&>th]:whitespace-normal! [&>th]:break-normal! [&>th]:align-bottom">
              <th class="py-2.5">Agent</th>
              <th class="py-2.5">Capturés</th>
              <th class="py-2.5">Attribués</th>
              <th class="py-2.5">À contacter</th>
              <th class="py-2.5">Tâches non démarrées</th>
              <th class="py-2.5">1er contact en retard</th>
              <th class="py-2.5">1er contact &lt; 24 h</th>
              <th class="py-2.5">Convertis</th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr class="cursor-pointer" [class]="row.agentId === selected() ? 'bg-primary/5' : 'hover:bg-slate-50'" (click)="pick.emit(row.agentId)">
              <td class="py-2.5">
                <p class="text-sm font-semibold text-slate-900">{{ row.fullName }}</p>
                @if (row.agencyName) { <p class="text-xs text-slate-500">{{ row.agencyName }}</p> }
              </td>
              <td class="py-2.5 text-sm tabular-nums">{{ row.captured }}</td>
              <td class="py-2.5 text-sm tabular-nums">{{ row.assigned }}</td>
              <td class="py-2.5 text-sm tabular-nums" [class.font-semibold]="row.toContact > 0">{{ row.toContact }}</td>
              <td class="py-2.5 text-sm tabular-nums">
                {{ row.tasksNotStarted }}
                @if (row.tasksOverdue > 0) { <span class="ms-1 rounded-full bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700">{{ row.tasksOverdue }} en retard</span> }
              </td>
              <td class="py-2.5 text-sm tabular-nums" [class]="row.lateFirstContacts > 0 ? 'font-semibold text-amber-700' : ''">{{ row.lateFirstContacts }}</td>
              <td class="py-2.5 text-sm tabular-nums">{{ row.firstContactRate != null ? (row.firstContactRate | number: '1.0-0') + ' %' : '—' }}</td>
              <td class="py-2.5 text-sm tabular-nums">{{ row.conversions }}</td>
            </tr>
          </ng-template>
        </tas-table>
        @if (!rows().length) {
          <p class="py-6 text-center text-sm text-slate-500">{{ loading() ? 'Chargement…' : 'Aucun agent dans ce périmètre.' }}</p>
        }
      </div>
    </section>
  `,
})
export class MyDayTeamTable {
  public readonly card = input<TeamScorecardDto | null>(null);
  public readonly selected = input('');
  public readonly loading = input(false);
  public readonly periodLabel = input('');

  public readonly pick = output<string>();

  /** Les retards d'abord : c'est ce qu'un responsable vient chercher. */
  public readonly rows = computed<TeamAgentRowDto[]>(() =>
    [...(this.card()?.rows ?? [])].sort((a, b) =>
      (b.tasksOverdue ?? 0) + (b.lateFirstContacts ?? 0) - ((a.tasksOverdue ?? 0) + (a.lateFirstContacts ?? 0))
      || (b.toContact ?? 0) - (a.toContact ?? 0)
      || (a.fullName ?? '').localeCompare(b.fullName ?? '', 'fr')),
  );

  public readonly table: TableConfig = {
    property: 'agentId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25, 50] },
  };
}
