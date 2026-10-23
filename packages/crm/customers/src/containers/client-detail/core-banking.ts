import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
// Le bloc appartient au module Intégration : il se nourrit des commandes
// d'intégration et du solde temps réel, et sert aussi le dossier KYC. On l'importe
// plutôt que d'en écrire une seconde version ici.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CoreBankingBlockComponent } from '@sankore/crm/integration';
import { ClientDetailStore } from '../../models/client-detail.store';
import { TENANT_MODULES, TenantModule, ModuleReadOnlyNotice } from '@sankore/crm/common';

/**
 * Onglet « Core banking » de la fiche client — INT-23.
 *
 * Coquille mince : la coquille de fiche fournit le client via `ClientDetailStore`, et
 * cet onglet ne fait que passer son identifiant au bloc. Le bloc vit dans la lib
 * `integration` et n'injecte pas ce store, qui appartient à cette bibliothèque-ci.
 */
@Component({
  selector: 'client-core-banking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModuleReadOnlyNotice, CoreBankingBlockComponent],
  template: `
    <module-read-only-notice [modules]="readOnlyModules"></module-read-only-notice>
    <div class="flex flex-col gap-4">
      @if (clientId()) {
        <core-banking-block [customerId]="clientId()"></core-banking-block>
      }
    </div>
  `,
})
export class ClientCoreBankingPage {
  /** Module désactivé : l'écran reste consultable, sans action (bandeau en tête). */
  public readonly readOnlyModules: TenantModule[] = [TENANT_MODULES.BANKING_MICROFINANCE];
  protected readonly store = inject(ClientDetailStore);

  protected readonly clientId = computed(() => this.store.clientId() ?? '');
}

export default ClientCoreBankingPage;
