import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { catchError, Observable, throwError } from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // status 0 = network error or aborted request (e.g. component destroyed mid-flight,
      // HMR reload cancellation). Do NOT redirect to login for these — the
      // access-token interceptor already handles 401 redirects.
      return throwError(() => error);
    }),
  );
}
