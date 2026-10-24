import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PermissionsService } from '@sankore/crm/common';
import { LeadConformite } from './conformite';
import { LeadConsentementPage } from './consentement';
import { LeadEditContext } from './lead-edit-context';

/**
 * Onglet « Conformité » : FATCA et PPE, puis les consentements. Deux pages auparavant, dont l'une
 * cachée dans le menu « Dossier » — refonte de la fiche, 2026-10-24. Les consentements gardent
 * leur droit : sans lui, la section n'apparaît pas (la route le refusait déjà).
 */
@Component({
  selector: 'lead-conformite-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LeadConformite, LeadConsentementPage],
  template: `
    <div class="flex flex-col gap-8">
      <lead-conformite></lead-conformite>
      @if (canSeeConsents() && leadId(); as id) {
        <div id="consentements" class="scroll-mt-24">
          <lead-consentement [id]="id"></lead-consentement>
        </div>
      }
    </div>
  `,
})
export class LeadConformiteTab {
  public readonly canSeeConsents = inject(PermissionsService).can('lead:consent:record', 'lead:consent:withdraw');
  private readonly _context = inject(LeadEditContext);
  /** La page Consentements recevait l'id de la route ; ici, du contexte de la fiche. */
  public readonly leadId = computed(() => this._context.lead()?.id ?? null);

  constructor() {
    // Arrivée par « …/conformite#consentements » (lien « consentement manquant » de l'en-tête).
    const fragment = inject(ActivatedRoute).snapshot.fragment;
    afterNextRender(() => {
      if (fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    });
  }
}

export default LeadConformiteTab;
