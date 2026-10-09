import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';

/**
 * État du dernier test de connexion.
 *
 * Le contrat distingue trois situations que rien ne permet de confondre :
 * `lastHealthStatus` est `null` tant qu'aucun test n'a tourné, `false` quand un test a
 * ÉCHOUÉ — « that is a different operational fact ». Un badge binaire ferait passer une
 * connexion jamais testée pour une connexion en panne, et inversement.
 */
@Component({
  selector: 'connection-health-badge',
  imports: [TasTag, TimeagoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-2">
      <tas-tag [severity]="meta().severity">{{ meta().label }}</tas-tag>
      @if (showDate() && checkedAt()) {
        <span class="text-xs text-slate-400">{{ checkedAt() | dateTimeAgo }}</span>
      }
    </span>
  `,
})
export class ConnectionHealthBadgeComponent {
  public readonly status = input<boolean | null | undefined>(null);
  public readonly checkedAt = input<string | null | undefined>(null);
  public readonly showDate = input(true);

  public readonly meta = computed<{ label: string; severity: Severity }>(() => {
    const status = this.status();
    if (status === true) return { label: 'Test passé', severity: 'success' };
    if (status === false) return { label: 'Test échoué', severity: 'error' };
    return { label: 'Jamais testée', severity: 'neutral' };
  });
}
