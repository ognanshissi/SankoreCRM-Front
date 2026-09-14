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
  ENVIRONMENT_CONFIG, errorInterceptor,
  tenantInterceptor,
} from '@sankore/crm/common';
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
    provideHttpClient(withFetch(), withInterceptors([accessTokenInterceptor, errorInterceptor, tenantInterceptor])),
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
