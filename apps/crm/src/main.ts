import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { BASE_PATH } from '@sankore/crm-api';
import { ENVIRONMENT_CONFIG } from '@sankore/crm/common';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadRuntimeConfig } from './environments/runtime-config';

// Le démarrage attend `/config.json` : `BASE_PATH` est consommé par les services générés
// dès leur première injection, il doit donc être connu avant le bootstrap. Les mêmes
// jetons sont déjà fournis par `appConfig` depuis `environment.ts` ; on les refournit
// après, le dernier provider l'emportant en DI.
loadRuntimeConfig()
  .then((config) =>
    bootstrapApplication(
      App,
      mergeApplicationConfig(appConfig, {
        providers: [
          { provide: BASE_PATH, useValue: config.apiUrl },
          { provide: ENVIRONMENT_CONFIG, useValue: config },
        ],
      }),
    ),
  )
  .catch((err) => console.error(err));
