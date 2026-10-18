import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  // La page de connexion ne dépend de personne : elle est prérendue et s'affiche sans attendre
  // le bundle.
  {
    path: 'auth/**',
    renderMode: RenderMode.Prerender,
  },
  // Tout le reste est derrière une session qui n'existe que dans le navigateur (localStorage) :
  // un prérendu au build figerait une page sans opérateur, et un rendu serveur à la requête n'en
  // saurait pas davantage. Le serveur Express reste en place et sert l'app.
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
