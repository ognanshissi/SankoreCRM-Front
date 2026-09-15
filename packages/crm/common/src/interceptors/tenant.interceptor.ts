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
  if (!req.url.startsWith('http')) {
    return next(req);
  }
  const tenantProvider = inject(TenantProvider);
  const fqdn = tenantProvider.getFqdn();
  if (!fqdn) {
    return next(req);
  }
  const reqClone = req.clone({
    setHeaders: { 'x-tenant-Fqdn': fqdn },
  });
  return next(reqClone);
};
