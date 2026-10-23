import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { PermissionsService } from '../services';
import { PermissionCode } from '../models/permissions';
import { AccessDeniedService } from '../components/access-denied/access-denied.service';
import { afterUserLoaded } from './after-user-loaded';

/**
 * Refus commun aux deux gardes : on signale à `AccessDeniedService`, qui
 * alimente la bannière globale, puis on renvoie l'utilisateur à l'accueil.
 *
 * Le message passait auparavant par un snackbar d'erreur. Une bannière
 * d'information est plus juste — ce n'est pas une anomalie mais une règle
 * d'accès — et elle peut nommer la permission manquante, ce qui fait gagner du
 * temps à l'administrateur qui diagnostique un rôle.
 */
function refuse(
  accessDenied: AccessDeniedService,
  router: Router,
  state: RouterStateSnapshot,
  permissions: PermissionCode[],
): ReturnType<Router['createUrlTree']> {
  accessDenied.notify(state.url, permissions);
  return router.createUrlTree(['/tasks/my-day']);
}

/**
 * Garde de route par permission.
 *
 * Plusieurs codes signifient « au moins un » : c'est ce dont on a besoin pour
 * un écran accessible aussi bien en lecture qu'en gestion.
 *
 *   canActivate: [hasPermissionGuard('lead:source:read')]
 *   canActivate: [hasPermissionGuard('role:read', 'role:update')]
 */
export function hasPermissionGuard(...permissions: PermissionCode[]): CanActivateFn {
  return (_route, state) => {
    const service = inject(PermissionsService);
    const accessDenied = inject(AccessDeniedService);
    const router = inject(Router);

    return afterUserLoaded(() =>
      service.has(...permissions) ? true : refuse(accessDenied, router, state, permissions),
    );
  };
}

/** Variante exigeant TOUTES les permissions listées. */
export function hasAllPermissionsGuard(...permissions: PermissionCode[]): CanActivateFn {
  return (_route, state) => {
    const service = inject(PermissionsService);
    const accessDenied = inject(AccessDeniedService);
    const router = inject(Router);

    return afterUserLoaded(() => {
      const granted = service.granted();
      if (permissions.every((p) => granted.has(p))) {
        return true;
      }
      // Ne nommer que ce qui manque réellement : la bannière sert à diagnostiquer
      // un rôle, lister les permissions déjà accordées brouille le message.
      return refuse(accessDenied, router, state, permissions.filter((p) => !granted.has(p)));
    });
  };
}
