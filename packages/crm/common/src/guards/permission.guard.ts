import { inject, Injector } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';
import { filter, map, Observable, take } from 'rxjs';
import { AuthenticationService, PermissionsService } from '../services';
import { PermissionCode } from '../models/permissions';
import { AccessDeniedService } from '../components/access-denied/access-denied.service';

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
 * Évalue `decide` une fois le profil de l'utilisateur chargé.
 *
 * La garde parente `authorized` lance `getCurrentUserInfo()` sans l'attendre : à l'ouverture
 * directe d'une URL (rechargement, favori, lien d'un e-mail de notification), les gardes de
 * permission passaient AVANT la réponse, lisaient un profil vide et refusaient l'accès à un
 * utilisateur qui avait la permission. Pendant le chargement, on attend donc sa fin ; un échec
 * du chargement laisse un profil vide, et le refus redevient la bonne réponse.
 */
function afterUserLoaded<T>(decide: () => T): T | Observable<T> {
  const auth = inject(AuthenticationService);
  if (!auth.loadingUserInfo()) return decide();

  const injector = inject(Injector);
  return toObservable(auth.loadingUserInfo, { injector }).pipe(
    filter((loading) => !loading),
    take(1),
    map(() => decide()),
  );
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
