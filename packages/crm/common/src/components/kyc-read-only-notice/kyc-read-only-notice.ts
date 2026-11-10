import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { TenantKycService } from '../../services/tenant-kyc.service';

/**
 * Bandeau des écrans KYC quand l'institution a désactivé le KYC (docs/kyc-par-institution.md) :
 * les dossiers se consultent, on n'y agit plus. Ne rend rien tant que le KYC est en vigueur.
 */
@Component({
  selector: 'kyc-read-only-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TasIcon],
  template: `
    @if (kyc.readOnly()) {
      <div class="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" role="status">
        <tas-icon iconName="feather:lock" class="mt-0.5 text-amber-700" style="font-size:14px"></tas-icon>
        <p class="text-sm text-amber-900">
          Le KYC est désactivé pour votre institution : les dossiers sont en consultation seule.
          <a routerLink="/settings/conformite" class="font-medium underline">Conformité</a>
        </p>
      </div>
    }
  `,
})
export class KycReadOnlyNotice {
  public readonly kyc = inject(TenantKycService);
}
