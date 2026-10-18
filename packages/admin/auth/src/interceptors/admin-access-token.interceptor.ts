import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { BASE_PATH } from '@sankore/crm-admin-api';
import { AdminAuthService } from '../services/admin-auth.service';
import { ADMIN_EXPLICIT_TOKEN } from './admin-explicit-token';

/** Les deux routes qui servent précisément à obtenir un jeton : elles n'en portent pas. */
const ANONYMOUS_PATHS = ['/api/v1/auth/login', '/api/v1/auth/refresh'];

/**
 * Pose le jeton de l'opérateur sur les appels à l'API Sankore.Admin, et seulement sur ceux-là :
 * un jeton envoyé à un autre hôte (une ressource externe, un CDN) est un jeton divulgué.
 *
 * Un jeton expiré est rafraîchi AVANT l'envoi plutôt qu'après un 401, ce qui évite un aller-retour
 * à chaque retour sur l'onglet. Le 401 reste traité, une fois : un compte désactivé ou une session
 * fermée ailleurs répondent 401 avec un jeton encore valide en apparence.
 */
export const adminAccessTokenInterceptor: HttpInterceptorFn = (req, next) => {
  const basePath = inject(BASE_PATH, { optional: true }) ?? '';
  const auth = inject(AdminAuthService);

  if (!isAdminApiCall(req, basePath) || ANONYMOUS_PATHS.some((p) => req.url.includes(p))) {
    return next(req);
  }

  const withToken = (token: string | null) =>
    token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  const explicit = req.context.get(ADMIN_EXPLICIT_TOKEN);
  if (explicit) return next(withToken(explicit));

  const refreshThenSend = () =>
    auth.refresh().pipe(
      switchMap((tokens) => next(withToken(tokens.accessToken ?? null))),
      catchError((error: unknown) => {
        auth.logout();
        return throwError(() => error);
      }),
    );

  if (auth.accessToken() && auth.isAccessTokenExpired() && auth.refreshTokenValue()) {
    return refreshThenSend();
  }

  return next(withToken(auth.accessToken())).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && auth.refreshTokenValue()) {
        return refreshThenSend();
      }
      if (error instanceof HttpErrorResponse && error.status === 401 && auth.accessToken()) {
        auth.logout();
      }
      return throwError(() => error);
    }),
  );
};

function isAdminApiCall(req: HttpRequest<unknown>, basePath: string): boolean {
  return basePath !== '' && req.url.startsWith(basePath);
}
