import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthenticationService } from '../services';

export const accessTokenInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {

  let authenticationService = inject(AuthenticationService)

  if (urlIncludeNotSecuredPaths(req.url)) return next(req);
  const token = authenticationService.loadAccessToken();
  const router = inject(Router);
  const reqClone = req.clone({
    setHeaders: { authorization: `Bearer ${token}` },
  });
  return next(reqClone).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        router.navigate(['/auth/login']).then();
      }
      return throwError(() => error);
    })
  );
};

function urlIncludeNotSecuredPaths(url: string): boolean {
  const publicPaths = [
    'login',
    'logout',
    'forgot-password',
    'reset-password',
    'webforms-generated',
    'assets/',
  ];
  return publicPaths.some((path) => url.includes(path));
}
