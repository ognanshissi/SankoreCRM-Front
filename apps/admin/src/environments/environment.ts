import { EnvironmentConfig } from '@sankore/crm/common';

export const environment: EnvironmentConfig = {
  production: false,
  // 5080, pinned by ASPNETCORE_HTTP_PORTS in the AppHost. Pas 5000 : sur macOS, le
  // récepteur AirPlay occupe ce port par défaut, Kestrel n'arrive pas à s'y lier et Aspire
  // en attribue un au hasard — le front parlait alors à AirPlay, sans erreur visible.
  apiUrl: 'http://localhost:5200', // https://lotchen-crm-api-9dc791e0816f.herokuapp.com
  apiKey: 'sk-97079fdab9258a805db78c732091310154008b53b68a69039eb796fb44301357',
};
