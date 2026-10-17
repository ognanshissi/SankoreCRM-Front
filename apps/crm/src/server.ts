import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDistFolder = dirname(fileURLToPath(import.meta.url));
const browserDistFolder = resolve(serverDistFolder, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/**', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Configuration lue au démarrage par le bundle navigateur (`main.ts`).
 *
 * C'est le seul chemin par lequel une variable du conteneur atteint le client : les
 * routes de l'application sont en `RenderMode.Client`, le rendu a donc lieu dans le
 * navigateur, qui exécute un bundle statique sans accès à `process.env`. Sans cet
 * endpoint, l'URL de l'API resterait celle compilée dans l'image.
 *
 * Déclaré avant le handler Angular, sinon le `app.use('/**')` ci-dessous l'absorbe.
 *
 * La réponse est publique : n'y mettre que des URL, jamais une clé ou un secret. Une
 * variable absente est omise du JSON (`JSON.stringify` saute les `undefined`), ce qui
 * laisse `main.ts` retomber sur la valeur compilée.
 */
app.get('/config.json', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    apiUrl: process.env['NG_API_URL'],
    ingestUrl: process.env['NG_INGEST_URL'],
  });
});

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use('/**', (req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
