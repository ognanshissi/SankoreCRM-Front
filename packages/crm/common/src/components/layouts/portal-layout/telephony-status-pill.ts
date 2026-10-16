import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { TelephonyTopBarState } from './telephony-top-bar-state';

/**
 * Pastille d'état de la téléphonie dans la barre supérieure (TEL-F-11).
 *
 * Purement présentationnelle : elle rend ce que le module Téléphonie a posé dans
 * `TelephonyTopBarState` et ne sait rien d'autre. Voir ce service pour la raison — une
 * dépendance de `common` vers `telephony` fermerait un cycle d'imports.
 *
 * Une pastille et non un `tas-tag` : il n'y a aucun badge dans cette barre aujourd'hui, et
 * le précédent le plus proche est la pastille en page de `roles-homepage.html`. Un
 * `tas-tag` y apporterait ses marges et sa hauteur de ligne, calibrées pour une cellule de
 * tableau.
 */
@Component({
  selector: 'lib-telephony-status-pill',
  imports: [TasIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state.pill(); as pill) {
      <span
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap cursor-default"
        [class]="toneClass()"
        role="status"
        [title]="pill.hint"
        [attr.aria-label]="pill.label + '. ' + pill.hint"
      >
        <tas-icon [iconName]="pill.icon" style="font-size:12px"></tas-icon>
        <span class="hidden sm:inline">{{ pill.label }}</span>
      </span>
    }
  `,
})
export class TelephonyStatusPill {
  public readonly state = inject(TelephonyTopBarState);

  public readonly toneClass = computed(() => {
    switch (this.state.pill()?.tone) {
      case 'success':
        return 'bg-emerald-50 text-emerald-700';
      case 'warning':
        return 'bg-amber-50 text-amber-700';
      case 'error':
        return 'bg-red-50 text-red-700';
      default:
        return 'bg-slate-100 text-slate-500';
    }
  });
}
