import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
// Les sinistres appartiennent au module Intégration : ils parlent aux back-offices des
// assureurs. On importe sa liste plutôt que de la redéfinir ici.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CustomerClaimsList } from '@sankore/crm/integration';
import { ModuleReadOnlyNotice, TENANT_MODULES, TenantModule } from '@sankore/crm/common';
import { ClientDetailStore } from '../../models/client-detail.store';

/**
 * Onglet « Sinistres » de la fiche client : tous les sinistres du client, tous contrats
 * confondus (décision du propriétaire, 2026-10-26 — ils restent aussi lisibles depuis le
 * contrat qui les couvre).
 */
@Component({
  selector: 'client-sinistres',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModuleReadOnlyNotice, CustomerClaimsList],
  template: `
    <module-read-only-notice [modules]="readOnlyModules"></module-read-only-notice>
    @if (clientId(); as customerId) {
      <customer-claims-list [customerId]="customerId"></customer-claims-list>
    }
  `,
})
export class ClientSinistresPage {
  /** Module désactivé : l'écran reste consultable, sans action (bandeau en tête). */
  public readonly readOnlyModules: TenantModule[] = [TENANT_MODULES.INSURANCE];
  protected readonly store = inject(ClientDetailStore);

  protected readonly clientId = computed(() => this.store.clientId() ?? '');
}

export default ClientSinistresPage;
