import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AdminAuthService } from '../services/admin-auth.service';

/**
 * Laisse passer une session VÉRIFIÉE par `GET /auth/me`, pas un simple jeton présent en
 * `localStorage` : un compte désactivé garde un jeton signé jusqu'à son expiration, et seul le
 * serveur sait qu'il ne vaut plus rien.
 *
 * Côté serveur (SSR) il n'y a pas de session à lire : le garde laisse passer et le navigateur
 * le rejoue à l'hydratation. Rediriger ici enverrait chaque rendu serveur vers la page de
 * connexion, et l'opérateur connecté verrait cette page clignoter avant la sienne.
 */
export const adminAuthorized: CanActivateFn = (_route, state) => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const router = inject(Router);
  return inject(AdminAuthService)
    .ensureSession()
    .pipe(
      map((ok) =>
        ok ? true : router.createUrlTree(['/auth/login'], { queryParams: { redirectPath: state.url } }),
      ),
    );
};

/** Pour la page de connexion : un opérateur déjà connecté n'a rien à y faire. */
export const adminGuest: CanActivateFn = () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return true;

  const router = inject(Router);
  return inject(AdminAuthService)
    .ensureSession()
    .pipe(map((ok) => (ok ? router.createUrlTree(['/']) : true)));
};
