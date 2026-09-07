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
      console.log('ErrorInterceptor', error);
      if (error.status === 0) {
        return EMPTY;
      }
      return throwError(() => error);
    }),
  );
}
