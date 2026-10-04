import { EnvironmentConfig } from '@sankore/crm/common';

export const environment: EnvironmentConfig = {
  production: false,
  // 5080, pinned by ASPNETCORE_HTTP_PORTS in the AppHost. Pas 5000 : sur macOS, le
  // récepteur AirPlay occupe ce port par défaut, Kestrel n'arrive pas à s'y lier et Aspire
  // en attribue un au hasard — le front parlait alors à AirPlay, sans erreur visible.
  apiUrl: 'http://localhost:5080', // https://lotchen-crm-api-9dc791e0816f.herokuapp.com
  apiKey: '',
  tenantId: '',
  ingestUrl: '', // vide → retombe sur apiUrl
};
