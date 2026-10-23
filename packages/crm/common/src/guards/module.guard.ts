import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantModulesService } from '../services/tenant-modules.service';
import { TenantModule } from '../models/tenant-modules';
import { AccessDeniedService } from '../components/access-denied/access-denied.service';
import { afterUserLoaded } from './after-user-loaded';

/**
 * Garde de route par module payant. Plusieurs modules signifient « au moins un ».
 * Distincte des permissions : un module dit si la fonction existe pour l'institution, une
 * permission dit qui peut s'en servir. Jamais sur la téléphonie, qui est du socle.
 *
 *   canActivate: [hasModuleGuard(TENANT_MODULES.INSURANCE)]
 */
export function hasModuleGuard(...anyOf: TenantModule[]): CanActivateFn {
  return (_route, state) => {
    const modules = inject(TenantModulesService);
    const accessDenied = inject(AccessDeniedService);
    const router = inject(Router);

    return afterUserLoaded(() => {
      if (modules.has(...anyOf)) return true;
      accessDenied.notifyModule(state.url, anyOf);
      return router.createUrlTree(['/tasks/my-day']);
    });
  };
}

/**
 * Variante des écrans de CONSULTATION : ouverts aussi quand le module a été désactivé, en lecture
 * seule. Un tenant qui n'a jamais eu le module reste refusé. Les écrans de création gardent
 * `hasModuleGuard`.
 */
export function canReadModuleGuard(...anyOf: TenantModule[]): CanActivateFn {
  return (_route, state) => {
    const modules = inject(TenantModulesService);
    const accessDenied = inject(AccessDeniedService);
    const router = inject(Router);

    return afterUserLoaded(() => {
      if (modules.canRead(...anyOf)) return true;
      accessDenied.notifyModule(state.url, anyOf);
      return router.createUrlTree(['/tasks/my-day']);
    });
  };
}
