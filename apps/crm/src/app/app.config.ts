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
  provideQuickCreateActions,
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
    // Le menu « Créer » de la barre du haut. Les tiroirs sont chargés au clic, dans les mêmes
    // morceaux que les routes de leurs libs ; les droits sont ceux des boutons des écrans.
    provideQuickCreateActions([
      {
        kind: 'lead',
        label: 'Nouveau lead',
        icon: 'feather:user-plus',
        anyOf: ['lead:create'],
        load: () => import('@sankore/crm/lead-management').then((m) => m.CreateLeadComponent),
      },
      {
        kind: 'task',
        label: 'Nouvelle tâche',
        icon: 'feather:check-square',
        anyOf: ['lead:task:manage'],
        load: () => import('@sankore/crm/tasks').then((m) => m.NewTaskDrawer),
      },
      {
        kind: 'appointment',
        label: 'Nouveau rendez-vous',
        icon: 'feather:calendar',
        anyOf: ['lead:activity:log'],
        load: () => import('@sankore/crm/tasks').then((m) => m.CreateAppointmentDrawer),
      },
    ]),
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
