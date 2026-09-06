import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantProvider } from '../services';
import { inject } from '@angular/core';

export const tenantInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
): Observable<HttpEvent<unknown>> => {
  // tenant fqdn will be loaded by APP_INITIALIZER
  const tenantProvider = inject(TenantProvider);
  const tenantFqdn = tenantProvider.getTenantId();
  const reqClone = req.clone({
    setHeaders: { 'x-tenant-id': tenantFqdn },
  });
  return next(reqClone);
};
