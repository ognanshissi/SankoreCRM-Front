import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { TenantProvider } from '../services';

/**
 * Renvoie vers /unknown-tenant quand le contexte du tenant n'a pas pu être
 * chargé — domaine inconnu du back, ou back injoignable au démarrage — et vers
 * /tenant-suspended quand il l'a été mais que le tenant est désactivé ou en
 * maintenance.
 *
 * Le second cas n'était pas traité : le contexte arrivait avec `isActive: false`
 * et la garde ne regardait que sa présence, si bien qu'une institution
 * désactivée depuis l'administration ouvrait l'application normalement et ne
 * découvrait le refus qu'au premier appel à l'API.
 *
 * À placer AVANT `authorized` : `tenantInterceptor` estampille chaque requête
 * du FQDN du tenant, si bien qu'une vérification de jeton faite sans contexte
 * ne veut rien dire.
 *
 * Le rendu serveur est laissé passer : `provideTenantInitializer` ne charge le
 * contexte que dans le navigateur, donc `isLoaded()` y est toujours faux.
 * Sans cette sortie, chaque page rendue côté serveur afficherait « tenant
 * inconnu » avant que l'hydratation ne la remplace.
 */
export const tenantGuard: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) {
    return true;
  }

  const tenant = inject(TenantProvider);
  const router = inject(Router);

  if (!tenant.isLoaded()) {
    return router.createUrlTree(['/unknown-tenant']);
  }

  const ctx = tenant.context();
  if (ctx?.isActive === false) {
    return router.createUrlTree(['/tenant-suspended']);
  }
  if (ctx?.isMaintenance) {
    return router.createUrlTree(['/tenant-suspended'], { queryParams: { raison: 'maintenance' } });
  }

  return true;
};
