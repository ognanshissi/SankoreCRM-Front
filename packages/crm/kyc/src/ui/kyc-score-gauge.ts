import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { kycConfidenceMeta, kycScoreBarClasses } from '../data-access/kyc-referential';

/**
 * Score de confiance : le chiffre porte l'information, la barre ne fait que la situer.
 *
 * Le niveau (Validé / À revoir / Rejeté) est écrit en clair à côté du score : un agent ne doit pas
 * avoir à deviner ce que « 72 » autorise.
 */
@Component({
  selector: 'kyc-score-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-baseline gap-2">
      <span class="text-3xl font-semibold tabular-nums text-slate-900">{{ score() ?? '—' }}</span>
      <span class="text-sm text-slate-400">/ 100</span>
      <span class="text-sm font-medium ml-1" [class]="confidence().classes">
        {{ confidence().label }}
      </span>
    </div>
    <div
      class="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden"
      role="progressbar"
      [attr.aria-valuenow]="score() ?? 0"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-label]="'Score de confiance : ' + (score() ?? 0) + ' sur 100, ' + confidence().label"
    >
      <div class="h-full rounded-full transition-all" [class]="barClasses()" [style.width.%]="width()"></div>
    </div>
  `,
})
export class KycScoreGauge {
  public readonly score = input<number | null | undefined>(null);
  public readonly level = input<string | number | null | undefined>(null);

  public readonly confidence = computed(() => kycConfidenceMeta(this.level()));
  public readonly barClasses = computed(() => kycScoreBarClasses(this.score()));
  public readonly width = computed(() => Math.max(0, Math.min(100, this.score() ?? 0)));
}
