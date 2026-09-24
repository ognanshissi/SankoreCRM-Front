import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthenticationService } from '../services';
import { SnackbarService } from '@talisoft/ui/snackbar';

/**
 * FE-03 — Garde de permission route.
 * Usage dans les routes :
 *   canActivate: [hasPermissionGuard('leads.sources.read')]
 */
export function hasPermissionGuard(permission: string): CanActivateFn {
  return () => {
    const auth = inject(AuthenticationService);
    const router = inject(Router);
    const snackbar = inject(SnackbarService);

    const codes = auth.connectedUser()?.permissions ?? [];
    if (codes.includes(permission)) {
      return true;
    }

    snackbar.error('Accès refusé', 'Vous n\'avez pas la permission d\'accéder à cette page.');
    return router.createUrlTree(['/tasks/my-day']);
  };
}
