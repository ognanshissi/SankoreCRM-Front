import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { LeadDto, MyScorecardDto, ScorecardAssignedLeadDto } from '@sankore/crm-api';
import { ContactButtons } from './contact-buttons';

export type ScorePeriod = 'week' | 'month';

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });

/** « 2026-10-26 » → « Lun ». */
function dayLabel(date: string | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const label = WEEKDAY.format(new Date(y, m - 1, d)).replace('.', '');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const SOURCE_LABELS: Record<string, string> = {
  Web: 'Site web', MobileAgent: 'Agent mobile', Agency: 'Agence', CallCenter: "Centre d'appels", Sms: 'SMS',
  Ussd: 'USSD', WhatsApp: 'WhatsApp', Referral: 'Recommandation', Partner: 'Partenaire', FileImport: 'Import',
  Campaign: 'Campagne',
};

/**
 * La colonne de droite de « Ma journée » des agents : « Mes performances » et « Attribués
 * aujourd'hui » (maquette du propriétaire, 2026-10-31). Les chiffres viennent tous de
 * `GET leads/me/scorecard`, qui en porte les règles ; l'écran les lit sans recalculer.
 */
@Component({
  selector: 'my-day-scorecard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContactButtons, DecimalPipe],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <section class="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm" aria-labelledby="my-day-performance">
      <header class="flex items-center justify-between gap-3">
        <h2 id="my-day-performance" class="text-lg font-bold text-slate-900">Mes performances</h2>
        <div role="group" aria-label="Période" class="flex gap-1 rounded-xl bg-slate-100 p-1">
          @for (p of periods; track p.value) {
            <button type="button" class="min-h-8 rounded-lg px-3 text-xs font-semibold transition-colors"
              [class]="period() === p.value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'"
              [attr.aria-pressed]="period() === p.value" (click)="periodChange.emit(p.value)">{{ p.label }}</button>
          }
        </div>
      </header>

      @if (scorecard(); as card) {
        <p class="mt-4 flex items-baseline gap-3">
          <span class="text-5xl font-bold text-slate-900 tabular-nums">{{ card.assigned?.total ?? 0 }}</span>
          <span class="text-sm text-slate-600">lead{{ (card.assigned?.total ?? 0) > 1 ? 's' : '' }} attribué{{ (card.assigned?.total ?? 0) > 1 ? 's' : '' }} {{ periodLabel() }}</span>
        </p>

        <div class="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100" role="img"
          [attr.aria-label]="statusSummary()">
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

        <div class="mt-4 border-t border-slate-100 pt-4">
          <p class="text-xs text-slate-600">{{ period() === 'week' ? 'Leads reçus par jour' : 'Leads reçus par semaine' }}</p>
          <div class="mt-3 grid items-end gap-2" [style.grid-template-columns]="'repeat(' + bars().length + ', minmax(0, 1fr))'"
            role="img" [attr.aria-label]="barsSummary()">
            @for (b of bars(); track b.key) {
              <div class="flex flex-col items-center gap-1">
                <span class="text-xs font-semibold text-slate-900 tabular-nums">{{ b.value }}</span>
                <span class="w-full rounded-md" [class]="b.highlight ? 'bg-primary' : 'bg-primary/25'"
                  [style.height.px]="barHeight(b.value)"></span>
                <span class="text-xs text-slate-500">{{ b.label }}</span>
              </div>
            }
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3">
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-xs text-slate-700">Premier contact sous 24 h</p>
            <p class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {{ card.firstContactWithin24h?.rate != null ? (card.firstContactWithin24h!.rate! | number: '1.0-0') + ' %' : '—' }}
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <span class="block h-full rounded-full bg-primary" [style.width.%]="card.firstContactWithin24h?.rate ?? 0"></span>
            </div>
            <p class="mt-1.5 text-xs text-slate-500">
              @if (card.firstContactWithin24h?.objective != null) { Objectif : {{ card.firstContactWithin24h!.objective }} % }
              @else { Sans objectif fixé }
            </p>
          </div>
          <div class="rounded-2xl bg-slate-50 p-3">
            <p class="text-xs text-slate-700">Convertis en clients</p>
            <p class="mt-1 text-2xl font-bold text-slate-900 tabular-nums">
              {{ card.conversions?.count ?? 0 }}@if (card.conversions?.objective != null) {<span class="text-slate-400"> / {{ card.conversions!.objective }}</span>}
            </p>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <span class="block h-full rounded-full bg-amber-500" [style.width.%]="conversionProgress()"></span>
            </div>
            <p class="mt-1.5 text-xs text-slate-500">
              @if (card.conversions?.objective != null) { {{ period() === 'week' ? 'Objectif de la semaine' : 'Objectif du mois' }} }
              @else { Sans objectif fixé }
            </p>
          </div>
        </div>
      } @else {
        <p class="mt-6 text-sm text-slate-500">{{ loading() ? 'Chargement…' : 'Les chiffres ne sont pas disponibles pour l’instant.' }}</p>
      }
    </section>

    <section class="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm" aria-labelledby="my-day-assigned">
      <header class="flex items-baseline justify-between gap-3">
        <h2 id="my-day-assigned" class="text-lg font-bold text-slate-900">Attribués aujourd’hui</h2>
        <span class="text-xs text-slate-500">à contacter sous 24 h</span>
      </header>
      @if (assigned().length) {
        <ul class="mt-3 divide-y divide-slate-100">
          @for (lead of assigned(); track lead.leadId) {
            <li class="flex cursor-pointer items-center gap-3 py-2.5" (click)="openLead(lead)">
              <span class="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                {{ initials(lead.fullName) }}
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold text-slate-900">{{ lead.fullName }}</p>
                <p class="truncate text-xs text-slate-500">{{ detail(lead) }}</p>
              </div>
              @if (lead.contacted) {
                <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">Contacté</span>
              } @else if (lead.leadId) {
                <my-day-contact [leadId]="lead.leadId" [phone]="phone(lead)" [name]="lead.fullName ?? ''" variant="solid" [showWhatsapp]="false"></my-day-contact>
              }
            </li>
          }
        </ul>
        @if ((scorecard()?.assignedToday?.total ?? 0) > assigned().length) {
          <p class="mt-2 text-xs text-slate-500">
            et {{ (scorecard()?.assignedToday?.total ?? 0) - assigned().length }} autre(s), dans vos tâches de premier contact.
          </p>
        }
      } @else {
        <p class="mt-3 text-sm text-slate-500">{{ loading() && !scorecard() ? 'Chargement…' : 'Aucun lead ne vous a été attribué aujourd’hui.' }}</p>
      }
    </section>
  `,
})
export class MyDayScorecard {
  private readonly _router = inject(Router);

  public readonly scorecard = input<MyScorecardDto | null>(null);
  public readonly period = input<ScorePeriod>('month');
  public readonly loading = input(false);
  /** Les leads déjà chargés par l'écran : le numéro pour appeler n'est pas dans les chiffres. */
  public readonly leads = input<Map<string, LeadDto>>(new Map());

  public readonly periodChange = output<ScorePeriod>();

  public readonly periods: { value: ScorePeriod; label: string }[] = [
    { value: 'week', label: 'Semaine' },
    { value: 'month', label: 'Mois' },
  ];

  public readonly periodLabel = computed(() => {
    const from = this.scorecard()?.from;
    return this.period() === 'week' ? 'cette semaine' : `en ${MONTH.format(from ? new Date(from) : new Date())}`;
  });

  public readonly statuses = computed(() => {
    const a = this.scorecard()?.assigned;
    return [
      { label: 'À contacter', count: a?.toContact ?? 0, bar: 'bg-amber-400' },
      { label: 'En cours', count: a?.inProgress ?? 0, bar: 'bg-blue-600' },
      { label: 'Convertis', count: a?.converted ?? 0, bar: 'bg-primary' },
      { label: 'Perdus', count: a?.lost ?? 0, bar: 'bg-stone-300' },
    ];
  });
  public readonly statusSummary = computed(() => this.statuses().map((s) => `${s.label} : ${s.count}`).join(', '));

  /**
   * Le graphique change avec la période (maquette du propriétaire, 2026-11-01) : les jours de la
   * semaine en cours, aujourd'hui en foncé ; ou les quatre dernières semaines, la courante en foncé.
   */
  public readonly bars = computed(() => {
    const card = this.scorecard();
    if (this.period() === 'week') {
      return (card?.dailyReceived ?? []).map((d) => ({
        key: d.date ?? '', label: dayLabel(d.date), value: d.received ?? 0, highlight: !!d.isToday,
      }));
    }
    const weeks = card?.weeklyReceived ?? [];
    return weeks.map((w, i) => ({ key: w.label ?? String(i), label: w.label ?? '', value: w.received ?? 0, highlight: i === weeks.length - 1 }));
  });
  public readonly barsSummary = computed(() => this.bars().map((b) => `${b.label} : ${b.value}`).join(', '));
  private readonly _maxBar = computed(() => Math.max(1, ...this.bars().map((b) => b.value)));

  public readonly conversionProgress = computed(() => {
    const c = this.scorecard()?.conversions;
    if (!c?.objective) return 0;
    return Math.min(100, (100 * (c.count ?? 0)) / c.objective);
  });

  public readonly assigned = computed(() => this.scorecard()?.assignedToday?.items ?? []);

  /** Une semaine vide garde un trait : sa barre dit « zéro », pas « pas de donnée ». */
  public barHeight(received: number | undefined): number {
    return 4 + Math.round(((received ?? 0) / this._maxBar()) * 52);
  }

  public initials(name: string | null | undefined): string {
    return (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  }

  /** « Nantissement warrantage · WhatsApp · 08:12 ». */
  public detail(lead: ScorecardAssignedLeadDto): string {
    const source = lead.sourceLabel?.trim() || SOURCE_LABELS[lead.source ?? ''] || lead.source;
    const at = lead.assignedAt ? TIME.format(new Date(lead.assignedAt)) : null;
    return [lead.product, source, at].filter(Boolean).join(' · ');
  }

  public phone(lead: ScorecardAssignedLeadDto): string | null {
    return (lead.leadId && this.leads().get(lead.leadId)?.phoneNumber) || null;
  }

  public openLead(lead: ScorecardAssignedLeadDto): void {
    if (lead.leadId) this._router.navigate(['/leads', lead.leadId]);
  }
}
