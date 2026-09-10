import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { catchError, EMPTY, Observable, throwError } from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
):  Observable<HttpEvent<unknown>>  => {

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      console.log('ErrorInterceptorStatus', error.status);
      if (error.status === 0) {
        const errorMessage = error.error.message ? error.error.message : error.message || "Une erreur est survenue";
        console.log('ErrorInterceptor', errorMessage);
        console.log('ErrorInterceptorStatus', error.status);
        return throwError(() => new Error(error.message));
      }
      return throwError(() => error);
    }),
  );
}
