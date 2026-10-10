import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { fatcaStatusLabel, fatcaStatusSeverity } from './compliance-labels';

/**
 * Badge « Exposition PPE ». Visible même sans la permission de lecture du détail :
 * le cahier des charges (BNF-F-04) veut que l'exposition reste signalée quand la
 * fonction exercée, elle, est masquée.
 */
@Component({
  selector: 'pep-exposure-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasTag, TasIcon],
  template: `
    @if (exposed()) {
      <tas-tag severity="warning">
        <span class="inline-flex items-center gap-1">
          <tas-icon iconName="feather:alert-triangle" style="font-size:11px"></tas-icon>
          Exposition PPE
        </span>
      </tas-tag>
    }
  `,
})
export class PepExposureBadge {
  public readonly exposed = input<boolean | null | undefined>(false);
}

/** Badge de statut FATCA, référentiel §3 du cahier des charges. */
@Component({
  selector: 'fatca-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasTag],
  template: `
    @if (status()) {
      <tas-tag [severity]="severity()">{{ label() }}</tas-tag>
    }
  `,
})
export class FatcaStatusBadge {
  public readonly status = input<string | null | undefined>(null);

  public readonly label = computed(() => fatcaStatusLabel(this.status()));
  public readonly severity = computed<Severity>(() => fatcaStatusSeverity(this.status()));
}
