import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { BASE_PATH } from '@sankore/crm-admin-api';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadConfig } from './environments/dev-config';

// En production, l'URL de l'API est compilée (`environment.prod.ts`) et `loadConfig` ne lit rien.
// En développement, `apps/admin/dev/config.json` peut la surcharger. `BASE_PATH` est lu par les
// services générés dès leur première injection : il doit être connu avant le bootstrap, d'où
// la résolution d'abord, puis un provider qui l'emporte sur celui d'`appConfig`.
loadConfig()
  .then((config) =>
    bootstrapApplication(
      App,
      mergeApplicationConfig(appConfig, {
        providers: [{ provide: BASE_PATH, useValue: config.apiUrl }],
      }),
    ),
  )
  .catch((err) => console.error(err));
