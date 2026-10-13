import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { BehaviorSubject, catchError, filter, Observable, switchMap, take, throwError } from 'rxjs';
import { inject } from '@angular/core';
import { AuthenticationService } from '../services';

let isRefreshing = false;
const refreshSubject = new BehaviorSubject<string | null>(null);

export const accessTokenInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {

  const authService = inject(AuthenticationService);

  if (urlIncludeNotSecuredPaths(req.url)) return next(req);

  const token = authService.loadAccessToken();
  const authReq = addToken(req, token);

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !urlIncludeNotSecuredPaths(req.url)) {
        return handle401(req, next, authService);
      }
      return throwError(() => error);
    })
  );
};

function handle401(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authService: AuthenticationService,
): Observable<HttpEvent<unknown>> {
  if (!isRefreshing) {
    isRefreshing = true;
    refreshSubject.next(null);

    return authService.refreshAccessToken().pipe(
      switchMap((result) => {
        isRefreshing = false;
        if (result?.accessToken) {
          refreshSubject.next(result.accessToken);
          return next(addToken(req, result.accessToken));
        }

        // Refresh failed — redirect to login
        authService.logout();
        return throwError(() => new HttpErrorResponse({ status: 401 }));
      }),
      catchError((err) => {
        isRefreshing = false;
        authService.logout();
        return throwError(() => err);
      }),
    );
  }

  // Another request is already refreshing — wait for the new token
  return refreshSubject.pipe(
    filter((token) => token !== null),
    take(1),
    switchMap((token) => next(addToken(req, token))),
  );
}

function addToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  if (!token) return req;
  return req.clone({ setHeaders: { authorization: `Bearer ${token}` } });
}

function urlIncludeNotSecuredPaths(url: string): boolean {
  const publicPaths = [
    'auth/login',
    'auth/logout',
    'auth/forgot-password',
    'auth/reset-password',
    'auth/refresh-token',
    'webforms-generated',
    'assets/',
    // KRM-F-02 : le parcours KYC à distance du client.
    //
    // Exclu pour deux raisons, et la seconde est la vraie. D'abord le jeton du back-office n'y a
    // rien à faire : le serveur le refuse (clé et audience dédiées), et l'envoyer ferait porter un
    // jeton d'employé par un appareil qui n'est pas le sien. Ensuite le 401 : un client dont la
    // session de 20 minutes expire déclencherait ici la bascule `handle401`, donc un
    // `refreshAccessToken()` puis un `logout()` — c'est-à-dire la déconnexion de l'agent qui
    // travaille dans un autre onglet du même navigateur, à cause de la session d'un client.
    'public/kyc/',
  ];
  return publicPaths.some((path) => url.includes(path));
}
