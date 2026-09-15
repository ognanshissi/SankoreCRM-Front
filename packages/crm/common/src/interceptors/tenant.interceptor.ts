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
  const tenantProvider = inject(TenantProvider);
  const reqClone = req.clone({
    setHeaders: { 'x-tenant-Fqdn': tenantProvider.getFqdn() },
  });
  return next(reqClone);
};
