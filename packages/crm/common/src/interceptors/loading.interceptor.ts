import {
  HttpEvent,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { finalize, Observable, tap } from 'rxjs';
import { inject } from '@angular/core';
import { Loading } from '@sankore/crm/common';

export const loadingInterceptor: HttpInterceptorFn = (req: HttpRequest<unknown>, next: HttpHandlerFn): Observable<HttpEvent<unknown>> => {
  const loading = inject(Loading);

  if (req.method === 'POST' ||
    req.method === 'DELETE' ||
    req.method === 'PUT' ||
    req.method === 'PATCH' ||
    req.method === 'GET') {
    loading.set(true);

    return next(req).pipe(
      tap(() => console.log("loading...")),
      finalize(() => loading.set(false))
    )
  }
  return next(req)
}
