import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
// Contrats et sinistres appartiennent au module Intégration : ils parlent aux
// back-offices des assureurs. On importe ses blocs plutôt que de les redéfinir ici.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CustomerClaimsList, InsurancePoliciesBlock } from '@sankore/crm/integration';
import { ClientDetailStore } from '../../models/client-detail.store';

/**
 * Onglet « Assurances » de la fiche client — ASS-16 et ASS-17.
 *
 * Coquille mince : la coquille de fiche fournit le client via `ClientDetailStore`, et
 * cet onglet ne fait que passer son identifiant aux deux blocs. Les sinistres viennent
 * sous les contrats, parce qu'un sinistre se lit en regard du contrat qui le couvre et
 * que l'agent y arrive depuis un contrat.
 */
@Component({
  selector: 'client-assurances',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [InsurancePoliciesBlock, CustomerClaimsList],
  template: `
    <div class="flex flex-col gap-4">
      @if (clientId(); as customerId) {
        <insurance-policies-block [customerId]="customerId"></insurance-policies-block>
        <customer-claims-list [customerId]="customerId"></customer-claims-list>
      }
    </div>
  `,
})
export class ClientAssurancesPage {
  protected readonly store = inject(ClientDetailStore);

  protected readonly clientId = computed(() => this.store.clientId() ?? '');
}

export default ClientAssurancesPage;
