import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  GuardResult,
  MaybeAsync,
  Router,
  RouterStateSnapshot,
} from '@angular/router';
import { inject } from '@angular/core';
import { AuthenticationService } from '../services';
import { catchError, map, of } from 'rxjs';

export const authorized: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot
): MaybeAsync<GuardResult> => {
  const authenticationService = inject(AuthenticationService);
  const router = inject(Router);
  return authenticationService.verifyToken().pipe(
    catchError(() => {
      return of(false);
    }),
    map((res) => {
      if (!res) {
        const redirectPath = state.url ?? '/tasks/my-day';
        router.navigate(['/auth', 'login'], { queryParams: { redirectPath } });
        return false;
      }
      return true;
    })
  );
};

export const noAuthorized: CanActivateFn = (
  _route: ActivatedRouteSnapshot,
  _state: RouterStateSnapshot
): MaybeAsync<GuardResult> => {
  const authenticationService = inject(AuthenticationService);
  const router = inject(Router);
  return authenticationService.verifyToken().pipe(
    map((res) => {
      if (res) {
        const redirectPath = '/portal/dashboard';
        router.navigate([redirectPath]);
        return false;
      }
      return true;
    })
  );
};
