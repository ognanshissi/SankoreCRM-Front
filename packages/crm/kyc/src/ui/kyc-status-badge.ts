import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TasTag } from '@talisoft/ui/tag';
import { kycStatusMeta } from '../data-access/kyc-referential';

/** Statut d'un dossier KYC, traduit par le référentiel et jamais en dur dans un écran. */
@Component({
  selector: 'kyc-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasTag],
  template: `<tas-tag [severity]="meta().severity">{{ meta().label }}</tas-tag>`,
})
export class KycStatusBadge {
  public readonly status = input<string | null | undefined>(null);
  public readonly meta = computed(() => kycStatusMeta(this.status()));
}
