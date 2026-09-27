import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { TenantProvider } from '../services';

/**
 * Renvoie vers /unknown-tenant quand le contexte du tenant n'a pas pu être
 * chargé — domaine inconnu du back, ou back injoignable au démarrage.
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

  if (inject(TenantProvider).isLoaded()) {
    return true;
  }

  return inject(Router).navigate(['/unknown-tenant']);
};
