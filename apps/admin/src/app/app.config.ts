import {
  ApplicationConfig,
  importProvidersFrom,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  provideClientHydration,
  withEventReplay,
} from '@angular/platform-browser';
import { TasIconRegistry } from '@talisoft/ui/icon';
import {
  AbstractFormFieldConfigOptions,
  TAS_FORM_FIELD_OPTIONS,
} from '@talisoft/ui/form-field';
import { BASE_PATH } from '@sankore/crm-admin-api';
import { adminAccessTokenInterceptor } from '@sankore/admin/auth';
import { environment } from '../environments/environment';
import { appRoutes } from './app.routes';

const tasFormFieldOptions: AbstractFormFieldConfigOptions = {
  rounded: false,
  size: 'large',
  appearance: 'fill',
};

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay()),
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([adminAccessTokenInterceptor])),
    importProvidersFrom(TasIconRegistry),
    // Le client de Sankore.Admin, jamais celui du CRM : les deux exportent un `BASE_PATH`
    // homonyme, et c'est celui de `@sankore/crm-admin-api` que ses services injectent.
    { provide: BASE_PATH, useValue: environment.apiUrl },
    { provide: TAS_FORM_FIELD_OPTIONS, useValue: tasFormFieldOptions },
  ],
};
