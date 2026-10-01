import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * Jauge de plafond du KYC simplifié (KYC-F-09). Orange à 80 %, rouge à 100 % — seuils du cahier.
 *
 * Le plafond est une **entrée**, jamais une constante : les 250 000 et 500 000 FCFA du cahier sont
 * des valeurs métier qui doivent venir du serveur. Les écrire ici les figerait dans le front.
 */
@Component({
  selector: 'kyc-cap-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="flex items-baseline justify-between gap-2 mb-1.5">
      <span class="text-sm text-slate-600">{{ label() }}</span>
      <span class="text-xs tabular-nums" [class]="textClasses()">
        {{ used() | number: '1.0-0' }} / {{ cap() | number: '1.0-0' }} {{ currency() }}
      </span>
    </div>
    <div
      class="h-2.5 rounded-full bg-slate-100 overflow-hidden"
      role="progressbar"
      [attr.aria-valuenow]="percent()"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-label]="label() + ' : ' + percent() + ' pour cent du plafond atteint'"
    >
      <div class="h-full rounded-full transition-all" [class]="barClasses()" [style.width.%]="percent()"></div>
    </div>
    @if (percent() >= 100) {
      <p class="text-xs text-red-700 mt-1">Plafond atteint : les opérations seront refusées.</p>
    } @else if (percent() >= 80) {
      <p class="text-xs text-orange-700 mt-1">
        Plafond bientôt atteint. Proposez le passage au KYC complet.
      </p>
    }
  `,
})
export class KycCapGauge {
  public readonly label = input.required<string>();
  public readonly used = input<number>(0);
  public readonly cap = input<number>(0);
  public readonly currency = input<string>('FCFA');

  public readonly percent = computed(() => {
    const cap = this.cap();
    if (!cap) return 0;
    return Math.min(100, Math.round((this.used() / cap) * 100));
  });

  public readonly barClasses = computed(() => {
    const p = this.percent();
    if (p >= 100) return 'bg-red-500';
    if (p >= 80) return 'bg-orange-400';
    return 'bg-green-500';
  });

  public readonly textClasses = computed(() => {
    const p = this.percent();
    if (p >= 100) return 'text-red-700 font-medium';
    if (p >= 80) return 'text-orange-700 font-medium';
    return 'text-slate-500';
  });
}
