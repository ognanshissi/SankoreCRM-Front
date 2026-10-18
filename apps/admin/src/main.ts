import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { BASE_PATH } from '@sankore/crm-admin-api';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadRuntimeConfig } from './environments/runtime-config';

// Comme le CRM : `BASE_PATH` est lu par les services générés dès leur première injection, il
// doit donc être connu avant le bootstrap. `appConfig` le fournit déjà depuis `environment.ts` ;
// on le refournit après, le dernier provider l'emportant en DI.
loadRuntimeConfig()
  .then((config) =>
    bootstrapApplication(
      App,
      mergeApplicationConfig(appConfig, {
        providers: [{ provide: BASE_PATH, useValue: config.apiUrl }],
      }),
    ),
  )
  .catch((err) => console.error(err));
