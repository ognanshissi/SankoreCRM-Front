import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { LeadImportWizard } from '../../components/lead-import-wizard/lead-import-wizard';

/**
 * Drawer d'import de leads, ouvert depuis la liste (`lead-homepage.openImportDrawer()`).
 *
 * Ce n'est plus qu'une coquille : tout l'assistant vit dans `LeadImportWizard`, partagé avec la page
 * `/leads/import`. La version précédente découpait le CSV dans le navigateur, proposait un mappage de
 * colonnes que le serveur ignore, et postait un JSON déguisé en fichier sur un endpoint multipart
 * attendant un CSV.
 *
 * `close(true)` reste la convention attendue par l'hôte : il recharge la liste et les statistiques
 * uniquement si un import a créé des leads.
 */
@Component({
  selector: 'import-leads',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    LeadImportWizard,
  ],
  template: `
    <tas-side-drawer width="900px">
      <tas-drawer-title>
        <TasTitle class="text-lg">Importer des leads</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <lead-import-wizard (imported)="onImported()"></lead-import-wizard>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">
          {{ hasImported() ? 'Fermer' : 'Annuler' }}
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ImportLeadsComponent {
  private readonly _dialogRef = inject(DialogRef);

  /** Retenu pour que la fermeture dise à la liste qu'elle a de quoi recharger. */
  public hasImported = signal(false);

  public onImported(): void {
    this.hasImported.set(true);
  }

  public close(): void {
    this._dialogRef.close(this.hasImported() ? true : undefined);
  }
}
