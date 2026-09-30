import { Component, inject, OnInit } from '@angular/core';
import { BreadcrumbService } from '@sankore/crm/common';
import { LeadImportWizard } from '../../components/lead-import-wizard/lead-import-wizard';

/**
 * Import de leads en page pleine, atteint depuis l'onglet importation du Paramétrage
 * (`/leads/import`). Même assistant que le drawer de la liste des leads : `LeadImportWizard`.
 *
 * La page vit dans la lib `lead-management` et non dans `settings`, contrairement aux imports
 * utilisateurs et clients : l'assistant appartient au domaine lead, et l'héberger dans `settings`
 * imposerait un import cross-lib sans rien apporter. L'onglet importation ne porte qu'un lien.
 */
@Component({
  selector: 'import-leads-page',
  imports: [LeadImportWizard],
  template: `
    <div class="pb-6">
      <div class="mb-6">
        <h1 class="text-lg font-semibold text-slate-800">Importer des leads</h1>
        <p class="text-sm text-slate-500 mt-0.5">
          Importez des leads depuis un fichier, un classeur Google Sheets ou Google Contacts.
        </p>
      </div>

      <lead-import-wizard></lead-import-wizard>
    </div>
  `,
})
export class ImportLeadsPage implements OnInit {
  private readonly _breadcrumbService = inject(BreadcrumbService);

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Leads', link: ['/leads'] },
      { label: 'Importer des leads' },
    ]);
  }
}

export default ImportLeadsPage;
