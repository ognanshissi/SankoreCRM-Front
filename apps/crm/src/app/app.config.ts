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
    importProvidersFrom(TasIconRegistry),
    {
      provide: TAS_FORM_FIELD_OPTIONS,
      useValue: tasFormFieldOptions,
    },
  ],
};
