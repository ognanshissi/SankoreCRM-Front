import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  {
    path: '',
    renderMode: RenderMode.Prerender,
  },
  {
    path: 'auth/**',
    renderMode: RenderMode.Client,
  },
  // Authenticated routes must be client-only — the server has no access to
  // localStorage, so tokens can't be read, API calls return 401, and the
  // interceptor's redirect to /auth/login gets replayed on the client.
  {
    path: 'tasks/**',
    renderMode: RenderMode.Client,
  },
  {
    path: 'settings/**',
    renderMode: RenderMode.Client,
  },
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
