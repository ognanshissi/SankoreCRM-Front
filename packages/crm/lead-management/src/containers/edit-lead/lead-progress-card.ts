import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { LeadIntentLevelDto, LeadsApiService } from '@sankore/crm-api';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { LeadEditContext } from './lead-edit-context';
import { intentOption } from './lead-view.models';

interface ScoreFactor {
  label: string;
  value: string;
}

/** Les dimensions que `LeadScoreCalculator` sérialise, en français. */
const FACTOR_LABELS: Record<string, string> = {
  profileCompleteness: 'Profil renseigné',
  sourceQuality: 'Qualité de la source',
  interactions: 'Échanges',
  behaviour: 'Engagement',
  declarativeCoherence: 'Cohérence déclarative',
  location: 'Localisation',
  address: 'Adresse',
};

function parseFactors(factorsJson: string | null | undefined): ScoreFactor[] {
  if (!factorsJson) return [];
  try {
    const parsed = JSON.parse(factorsJson);
    if (Array.isArray(parsed)) return parsed;
    return Object.entries(parsed)
      .filter(([key]) => key !== 'total')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(([key, val]: [string, any]) => ({
        label: FACTOR_LABELS[key] ?? key,
        value: typeof val === 'object' ? (val.value ?? val.detail ?? JSON.stringify(val)) : String(val),
      }));
  } catch {
    return [];
  }
}

/**
 * Le score du lead dans la vue d'ensemble. Il était dans une colonne de gauche présente sur chaque
 * onglet (refonte de la fiche, 2026-10-24). La carte portait aussi une frise « Cycle de vie » sur le
 * statut : elle contredisait la frise du pipeline de « Suivi commercial », qui porte désormais
 * seule le parcours du lead.
 */
@Component({
  selector: 'lead-progress-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TimeagoPipe, RouterLink],
  template: `
    @if (lead(); as l) {
      <tas-card class="block">
        <div class="p-5">
          <div>
            <button type="button" class="w-full text-left" (click)="showFactors.set(!showFactors())"
                    [attr.aria-expanded]="showFactors()" aria-controls="score-factors-panel">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-semibold text-slate-800">
                  Score <span class="text-2xl font-bold tabular-nums text-slate-900">{{ score() }}</span><span class="text-slate-400">/100</span>
                </p>
                <span class="flex items-center gap-1.5 text-xs text-slate-500">
                  <span class="h-2 w-2 rounded-full" [class]="intent().dot"></span>
                  {{ intent().label }}
                  <tas-icon [iconName]="showFactors() ? 'feather:chevron-up' : 'feather:chevron-down'" class="text-slate-400" style="font-size:14px"></tas-icon>
                </span>
              </div>
              <!-- La barre et le repère du seuil : ce qui manque se voit avant de se lire. -->
              <div class="relative mt-3 h-2 rounded-full bg-slate-100" role="meter" aria-label="Score du lead"
                   aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="score()">
                <div class="h-2 rounded-full" [class]="bar()" [style.width.%]="score()"></div>
                <div class="absolute -top-1 h-4 w-0.5 rounded bg-slate-500" [style.left.%]="threshold()" aria-hidden="true"></div>
              </div>
              <div class="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                <span>
                  @if (isUnqualified()) {
                    Pas encore qualifié
                  } @else if (pointsToThreshold() > 0) {
                    Encore <span class="font-semibold tabular-nums text-slate-700">{{ pointsToThreshold() }}</span> points pour le seuil
                  } @else {
                    Seuil de qualification atteint
                  }
                </span>
                <span class="shrink-0 tabular-nums">seuil {{ threshold() }}</span>
              </div>
            </button>
            @if (showFactors()) {
              <div id="score-factors-panel" class="mt-3 overflow-hidden rounded-lg border border-slate-200" role="region" aria-label="Détail du score">
                @for (factor of factors(); track factor.label) {
                  <div class="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
                    <p class="truncate text-xs font-medium text-slate-700">{{ factor.label }}</p>
                    <span class="shrink-0 text-xs font-semibold tabular-nums text-slate-800">{{ factor.value }}</span>
                  </div>
                } @empty {
                  <p class="px-3 py-3 text-center text-xs text-slate-400">Aucun détail disponible</p>
                }
                @if (intentDetail()?.updatedAt) {
                  <p class="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
                    Intérêt mis à jour {{ intentDetail()!.updatedAt! | dateTimeAgo }}
                  </p>
                }
              </div>
            }
            <a [routerLink]="['../score']" class="mt-3 inline-block text-xs font-semibold text-primary hover:underline">Historique du score</a>
          </div>
        </div>
      </tas-card>
    }
  `,
})
export class LeadProgressCard {
  private readonly _context = inject(LeadEditContext);
  private readonly _api = inject(LeadsApiService);

  public readonly lead = this._context.lead;
  public readonly showFactors = signal(false);
  public readonly intentDetail = signal<LeadIntentLevelDto | null>(null);
  private readonly _factorsJson = signal<string | null>(null);

  public readonly factors = computed(() => parseFactors(this._factorsJson()));
  public readonly intent = computed(() => intentOption(this.lead()?.intentLevel));
  /** Le seuil de qualification du serveur ; 60, la valeur historique, s'il ne l'a pas envoyé. */
  public readonly threshold = computed(() => this.lead()?.qualificationThreshold ?? 60);
  public readonly score = computed(() => Math.max(0, Math.min(100, this.lead()?.score ?? 0)));
  public readonly pointsToThreshold = computed(() => Math.max(0, this.threshold() - this.score()));
  public readonly bar = computed(() =>
    this.score() >= this.threshold() ? 'bg-green-600' : this.score() >= 40 ? 'bg-amber-500' : 'bg-red-500',
  );

  /**
   * « Pas encore qualifié » tant qu'aucune réponse de qualification n'existe : le score calculé à
   * la capture ne pèse que la source et les données saisies, et l'afficher comme un verdict fait
   * lire 30/100 comme un mauvais prospect plutôt que comme un prospect pas encore interrogé.
   */
  public readonly isUnqualified = computed(() => {
    const lead = this.lead();
    return !!lead && (lead.qualificationCompleteness ?? 0) === 0 && lead.status !== 'Qualified' && lead.status !== 'Converted';
  });

  constructor() {
    // Relu quand le score bouge : la fiche relit le lead toutes les 30 s et après chaque écriture.
    effect(() => {
      const id = this.lead()?.id;
      this.lead()?.score;
      if (id) untracked(() => this._load(id));
    });
  }

  private _load(id: string): void {
    this._api.getLeadScoreHistory(id).pipe(catchError(() => EMPTY)).subscribe((history) => {
      this._factorsJson.set(history?.[0]?.factorsJson ?? null);
    });
    this._api.getLeadIntentLevel(id).pipe(catchError(() => EMPTY)).subscribe((detail) => this.intentDetail.set(detail ?? null));
  }
}
