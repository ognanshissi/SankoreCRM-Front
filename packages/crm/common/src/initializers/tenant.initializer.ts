import { APP_INITIALIZER, EnvironmentProviders, makeEnvironmentProviders, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpContext } from '@angular/common/http';
import { catchError, firstValueFrom, of, tap } from 'rxjs';
import { BootstrapApiService } from '@sankore/crm-api';
import { TenantProvider } from '../services';
import { SKIP_LOADING } from '../interceptors';

export function provideTenantInitializer(): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: APP_INITIALIZER,
      useFactory: (bootstrapApi: BootstrapApiService, tenantProvider: TenantProvider, platformId: object) =>
        () => {
          if (!isPlatformBrowser(platformId)) return Promise.resolve(null);
          return firstValueFrom(
            bootstrapApi
              .getTenantContext(undefined, true, {
                context: new HttpContext().set(SKIP_LOADING, true),
              })
              .pipe(
                tap((ctx) => tenantProvider.setContext(ctx)),
                catchError(() => of(null)),
              ),
          );
        },
      deps: [BootstrapApiService, TenantProvider, PLATFORM_ID],
      multi: true,
    },
  ]);
}
