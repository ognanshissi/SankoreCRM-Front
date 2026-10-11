import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { fatcaStatusLabel, fatcaStatusSeverity } from './compliance-labels';
import { ComplianceConfigService } from '../services/compliance-config.service';

/**
 * Badge « Exposition PPE ». Visible même sans la permission de lecture du détail :
 * le cahier des charges (BNF-F-04) veut que l'exposition reste signalée quand la
 * fonction exercée, elle, est masquée.
 *
 * Le badge se tait en revanche quand le tenant a désactivé la vigilance PPE : le
 * drapeau est lu ici plutôt que passé en entrée par chaque appelant, parce qu'il
 * s'agit d'un réglage d'établissement et non d'une propriété du dossier affiché —
 * le faire remonter par une entrée obligerait les sept écrans qui posent ce badge
 * à répéter la même lecture, et le premier qui l'oublierait afficherait une
 * exposition que l'établissement ne collecte plus.
 */
@Component({
  selector: 'pep-exposure-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasTag, TasIcon],
  template: `
    @if (exposed() && pepEnabled()) {
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
  private readonly _complianceConfig = inject(ComplianceConfigService);

  public readonly exposed = input<boolean | null | undefined>(false);
  public readonly pepEnabled = this._complianceConfig.pepEnabled;

  constructor() {
    this._complianceConfig.load();
  }
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
