import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * Jauge de plafond du KYC simplifié (KYC-F-09).
 *
 * Le plafond est une **entrée**, jamais une constante : les 250 000 et 500 000 du cahier sont des
 * paramètres du tenant et arrivent du serveur. Le seuil d'avertissement aussi (`alertPct`) — il
 * était écrit « 80 » ici, ce qui rendait muet tout tenant qui l'avait changé.
 *
 * Deux états, et la différence n'est pas cosmétique : soit la consommation est connue et la jauge se
 * remplit, soit elle ne l'est pas et la jauge **ne se dessine pas**. Une barre vide se lit comme
 * « rien consommé », qui est précisément ce qu'on ne sait pas : on affiche alors le plafond seul et
 * la raison. Ne « simplifie » pas ce cas en passant `used=0`.
 */
@Component({
  selector: 'kyc-cap-gauge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="flex items-baseline justify-between gap-2 mb-1.5">
      <span class="text-sm text-slate-600">{{ label() }}</span>

      @if (isMeasured()) {
        <span class="text-xs tabular-nums" [class]="textClasses()">
          {{ used() | number: '1.0-0' }} / {{ cap() | number: '1.0-0' }} {{ currency() }}
        </span>
      } @else {
        <span class="text-xs tabular-nums text-slate-500">
          Plafond {{ cap() | number: '1.0-0' }} {{ currency() }}
        </span>
      }
    </div>

    @if (isMeasured()) {
      <div
        class="h-2.5 rounded-full bg-slate-100 overflow-hidden"
        role="progressbar"
        [attr.aria-valuenow]="percent()"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="label() + ' : ' + percent() + ' pour cent du plafond atteint'"
      >
        <div
          class="h-full rounded-full transition-all"
          [class]="barClasses()"
          [style.width.%]="percent()"
        ></div>
      </div>

      @if (percent() >= 100) {
        <p class="text-xs text-red-700 mt-1">Plafond atteint : les opérations seront refusées.</p>
      } @else if (percent() >= alertPct()) {
        <p class="text-xs text-orange-700 mt-1">
          Plafond bientôt atteint. Proposez le passage au KYC complet.
        </p>
      }
    } @else {
      <!-- Pas de barre, même grise : une jauge à 0 % affirme « rien consommé ». -->
      <p class="text-xs text-slate-500">Consommation inconnue : la jauge ne peut pas être calculée.</p>
    }
  `,
})
export class KycCapGauge {
  public readonly label = input.required<string>();
  /** `null` = non mesuré. Jamais 0 pour dire « inconnu ». */
  public readonly used = input<number | null>(null);
  public readonly cap = input<number | null>(null);
  public readonly currency = input<string>('');
  /** Seuil d'avertissement du tenant, en pourcentage du plafond. */
  public readonly alertPct = input<number>(80);

  public readonly isMeasured = computed(() => this.used() !== null && (this.cap() ?? 0) > 0);

  public readonly percent = computed(() => {
    const cap = this.cap() ?? 0;
    const used = this.used();
    if (!cap || used === null) return 0;
    return Math.min(100, Math.round((used / cap) * 100));
  });

  public readonly barClasses = computed(() => {
    const p = this.percent();
    if (p >= 100) return 'bg-red-500';
    if (p >= this.alertPct()) return 'bg-orange-400';
    return 'bg-green-500';
  });

  public readonly textClasses = computed(() => {
    const p = this.percent();
    if (p >= 100) return 'text-red-700 font-medium';
    if (p >= this.alertPct()) return 'text-orange-700 font-medium';
    return 'text-slate-500';
  });
}
