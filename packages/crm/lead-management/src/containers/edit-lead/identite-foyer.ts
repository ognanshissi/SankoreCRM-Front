import { afterNextRender, ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LeadFoyer } from './foyer';
import { LeadIdentite } from './identite';

/**
 * Onglet « Identité & foyer » : qui est la personne, puis les personnes de son foyer. Deux pages
 * auparavant, rangées dans un menu déroulant — refonte de la fiche, 2026-10-24.
 */
@Component({
  selector: 'lead-identite-foyer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LeadIdentite, LeadFoyer],
  template: `
    <div class="flex flex-col gap-8">
      <lead-identite></lead-identite>
      <div id="foyer" class="scroll-mt-24">
        <lead-foyer></lead-foyer>
      </div>
    </div>
  `,
})
export class LeadIdentiteFoyer {
  constructor() {
    // Arrivée par « …/identite#foyer » (ou l'ancienne adresse « foyer ») : la section est plus bas.
    const fragment = inject(ActivatedRoute).snapshot.fragment;
    afterNextRender(() => {
      if (fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    });
  }
}

export default LeadIdentiteFoyer;
