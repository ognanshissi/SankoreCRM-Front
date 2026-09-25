import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantProvider } from '../services';

/**
 * Redirects to /unknown-tenant if tenant context failed to load.
 */
export const tenantGuard: CanActivateFn = () => {
  const tenantProvider = inject(TenantProvider);
  const router = inject(Router);

  if (tenantProvider.isLoaded()) {
    return true;
  }

  return router.createUrlTree(['/unknown-tenant']);
};
