import {
  HttpContext,
  HttpContextToken,
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { finalize, Observable } from 'rxjs';
import { inject } from '@angular/core';
import { Loading } from '@sankore/crm/common';

export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);

export const loadingInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> => {
  if (req.context.get(SKIP_LOADING)) {
    return next(req);
  }

  const loading = inject(Loading);

  if (req.method === 'POST' ||
    req.method === 'DELETE' ||
    req.method === 'PUT' ||
    req.method === 'PATCH' ||
    req.method === 'GET') {
    loading.set(true);

    return next(req).pipe(
      finalize(() => loading.set(false))
    );
  }
  return next(req);
}
