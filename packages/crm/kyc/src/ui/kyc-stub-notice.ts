import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';

/**
 * Bandeau disant qu'une partie de l'écran affiche des données simulées, faute d'endpoint dans
 * KYC-B-08.
 *
 * Il existe pour une raison précise : un écran de conformité qui présenterait un score inventé comme
 * un score serveur est pire qu'un écran vide. Il disparaîtra avec les bouchons de
 * `kyc-facade.service.ts`.
 */
@Component({
  selector: 'kyc-stub-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    <div class="flex gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200 mb-4">
      <tas-icon
        iconName="feather:alert-triangle"
        class="text-amber-600 shrink-0 mt-0.5"
        style="font-size:14px"
      ></tas-icon>
      <div class="text-sm text-slate-700">
        <p class="font-medium text-amber-800">Données de démonstration</p>
        <p class="text-xs text-amber-700 mt-0.5">
          {{ what() }} n'est pas encore exposé par l'API : ce que vous voyez est simulé et ne doit pas
          servir à décider.
        </p>
      </div>
    </div>
  `,
})
export class KycStubNotice {
  /** Ce qui manque, formulé pour un agent : « La liste des dossiers », « Le détail du score »… */
  public readonly what = input.required<string>();
}
