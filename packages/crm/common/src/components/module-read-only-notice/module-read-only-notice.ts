import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { TENANT_MODULE_LABELS, TenantModule } from '../../models/tenant-modules';
import { TenantModulesService } from '../../services/tenant-modules.service';

/**
 * Bandeau des écrans d'un module désactivé : on y consulte ce qui a été fait, on n'y agit plus.
 * Ne rend rien tant qu'un des modules est actif. À poser en tête de l'écran, au-dessus du contenu.
 */
@Component({
  selector: 'module-read-only-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TasIcon],
  template: `
    @if (isReadOnly()) {
      <div class="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" role="status">
        <tas-icon iconName="feather:lock" class="mt-0.5 text-amber-700" style="font-size:14px"></tas-icon>
        <p class="text-sm text-amber-900">
          Le module {{ names() }} est désactivé : cet écran est en consultation seule.
          <a routerLink="/settings/modules" class="font-medium underline">Modules et abonnement</a>
        </p>
      </div>
    }
  `,
})
export class ModuleReadOnlyNotice {
  private readonly _modules = inject(TenantModulesService);

  public readonly modules = input.required<TenantModule[]>();

  public readonly isReadOnly = computed(
    () => !this._modules.has(...this.modules()) && this._modules.canRead(...this.modules()),
  );

  public readonly names = computed(() =>
    this.modules()
      .filter((m) => this._modules.readable().has(m))
      .map((m) => `« ${TENANT_MODULE_LABELS[m]} »`)
      .join(' et '),
  );
}
