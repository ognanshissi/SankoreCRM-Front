import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { catchError, EMPTY, Observable, throwError } from 'rxjs';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SnackbarService } from '@talisoft/ui/snackbar';

export const errorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const router = inject(Router);
  const snackbar = inject(SnackbarService);
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 0) {
        snackbar.info(
          'Application indisponible !',
          'Veuillez reessayer plutard votre application est indisponible ou contactez votre administrateur.',
        );
        router.navigate(['/unknown-tenant']).then();
        // status 0 = network error or aborted request (e.g. component destroyed mid-flight,
        // HMR reload cancellation). Do NOT redirect to login for these — the
        // access-token interceptor already handles 401 redirects.
        return EMPTY;
      }

      // Le serveur refuse un tenant désactivé (403) ou en maintenance (503) avec un code
      // dédié. Une session déjà ouverte au moment de la désactivation passe par ici : sans
      // cette redirection, chaque écran affichait sa propre erreur générique.
      const code = (error.error as { code?: string } | null)?.code;
      if (code === 'TENANT_INACTIVE') {
        router.navigate(['/tenant-suspended']).then();
        return EMPTY;
      }
      if (code === 'TENANT_MAINTENANCE') {
        router.navigate(['/tenant-suspended'], { queryParams: { raison: 'maintenance' } }).then();
        return EMPTY;
      }

      // « Mode test » : l'équipe et l'institution sont celles de la production, le serveur en refuse
      // toute modification. Dit ici une fois pour tous les écrans concernés, qui afficheraient
      // sinon chacun leur erreur générique ; l'erreur continue vers l'écran, qui s'arrête.
      if (error.status === 409 && (error.error as { detail?: string } | null)?.detail === 'TEST_MODE_TEAM_READ_ONLY') {
        snackbar.info('Mode test', 'L’équipe et l’institution se modifient en production : quittez le mode test pour cette modification.');
      }

      return throwError(() => error);
    }),
  );
}
