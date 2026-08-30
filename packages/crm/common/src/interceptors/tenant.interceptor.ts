import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';

export const tenantInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  // tenant fqdn will be loaded by APP_INITIALIZER
  const tenantFqdn = 'db';
  const reqClone = req.clone({
    setHeaders: { 'X-TENANT-FQDN': tenantFqdn },
  });
  return next(reqClone);
};
