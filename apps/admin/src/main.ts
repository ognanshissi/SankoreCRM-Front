import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// L'URL de l'API d'administration est figée à la compilation (`environment.prod.ts`, fourni en
// `BASE_PATH` par `appConfig`) : l'admin ne lit pas de `/config.json`, choix du propriétaire.
// Changer de domaine d'API veut donc dire reconstruire l'image.
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
