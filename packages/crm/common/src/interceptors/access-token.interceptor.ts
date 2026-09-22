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
    'login',
    'logout',
    'forgot-password',
    'reset-password',
    'refresh-token',
    'webforms-generated',
    'assets/',
  ];
  return publicPaths.some((path) => url.includes(path));
}
