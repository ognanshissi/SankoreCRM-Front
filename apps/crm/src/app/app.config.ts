import {
  ApplicationConfig,
  importProvidersFrom,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { TasIconRegistry } from '@talisoft/ui/icon';
import {
  AbstractFormFieldConfigOptions,
  TAS_FORM_FIELD_OPTIONS,
} from '@talisoft/ui/form-field';
import {
  accessTokenInterceptor,
  ENVIRONMENT_CONFIG,
  errorInterceptor,
  loadingInterceptor,
  provideTenantInitializer,
  tenantInterceptor,
} from '@sankore/crm/common';
import { kycRemoteSessionInterceptor } from '@sankore/crm/kyc';
import { BASE_PATH } from '@sankore/crm-api';
import { environment } from '../environments/environment';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';

const tasFormFieldOptions: AbstractFormFieldConfigOptions = {
  rounded: false,
  size: 'large',
  appearance: 'fill'
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    // `kycRemoteSessionInterceptor` APRÈS `accessTokenInterceptor` : celui-ci laisse
    // passer `public/kyc/` sans y toucher, celui-là y pose le jeton de session du client.
    // L'ordre inverse marcherait aussi, mais le lire dans cet ordre dit ce qui se passe.
    provideHttpClient(
      withFetch(),
      withInterceptors([
        loadingInterceptor,
        accessTokenInterceptor,
        kycRemoteSessionInterceptor,
        errorInterceptor,
        tenantInterceptor,
      ]),
    ),
    provideTenantInitializer(),
    importProvidersFrom(TasIconRegistry),
    {
      provide: BASE_PATH,
      useValue: environment.apiUrl
    },
    {
      provide: TAS_FORM_FIELD_OPTIONS,
      useValue: tasFormFieldOptions,
    },
    {
      provide: ENVIRONMENT_CONFIG,
      useValue: environment,
    },
  ],
};
