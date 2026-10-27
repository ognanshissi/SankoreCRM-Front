import { PermissionCode, PERMISSIONS } from '../../../models/permissions';

/** Le compteur qu'une entrée affiche, et sa teinte. Voir `NavBadges`. */
export type NavBadgeKey = 'whatsapp' | 'mail' | 'leads' | 'kyc' | 'workflows';

export interface PortalNavItem {
  id: string;
  label: string;
  icon: string;
  link: string;
  /** Un de ces droits suffit ; absent, l'entrée est pour tous. */
  anyOf?: PermissionCode[];
  badge?: NavBadgeKey;
}

export interface PortalNavGroup {
  /** Le nom du groupe : non affiché dans la barre, il ouvre le fil d'Ariane (« Pilotage › … »). */
  label: string;
  items: PortalNavItem[];
}

/**
 * La navigation du portail, en trois groupes séparés d'un trait : le quotidien de l'agent, son
 * portefeuille, le pilotage. Une seule définition pour la barre latérale, le fil d'Ariane de la
 * barre du haut et la palette de recherche — une entrée ajoutée ici apparaît partout.
 */
export const PORTAL_NAVIGATION: PortalNavGroup[] = [
  {
    label: 'Mon activité',
    items: [
      { id: 'my-day', label: 'Ma journée', icon: 'feather:sun', link: '/tasks/my-day' },
      { id: 'calendar', label: 'Calendrier', icon: 'feather:calendar', link: '/tasks/calendar' },
      {
        id: 'mail',
        label: 'Messagerie',
        icon: 'feather:mail',
        link: '/tasks/mail',
        anyOf: [PERMISSIONS.CONNECTED_ACCOUNTS_USE],
        badge: 'mail',
      },
      {
        id: 'whatsapp',
        label: 'WhatsApp',
        icon: 'feather:message-circle',
        link: '/leads/whatsapp',
        anyOf: [PERMISSIONS.WHATSAPP_SEND, PERMISSIONS.WHATSAPP_REPLY, PERMISSIONS.WHATSAPP_SUPERVISE],
        badge: 'whatsapp',
      },
    ],
  },
  {
    label: 'Portefeuille',
    items: [
      { id: 'leads', label: 'Leads', icon: 'feather:target', link: '/leads', anyOf: [PERMISSIONS.LEAD_READ], badge: 'leads' },
      { id: 'projects', label: 'Projets', icon: 'feather:briefcase', link: '/leads/projets', anyOf: [PERMISSIONS.LEAD_OPPORTUNITY_READ] },
      { id: 'customers', label: 'Clients', icon: 'feather:users', link: '/customers', anyOf: [PERMISSIONS.CUSTOMERS_READ] },
      { id: 'kyc', label: 'Dossiers KYC', icon: 'feather:user-check', link: '/kyc', anyOf: [PERMISSIONS.KYC_READ], badge: 'kyc' },
    ],
  },
  {
    label: 'Pilotage',
    items: [
      { id: 'analytics', label: 'Tableau de bord', icon: 'feather:bar-chart-2', link: '/leads/analytics' },
      { id: 'reports', label: 'Rapports', icon: 'feather:pie-chart', link: '/leads/reports', anyOf: [PERMISSIONS.LEAD_REPORT_VIEW] },
      { id: 'dispatching', label: 'Dispatching', icon: 'feather:shuffle', link: '/leads/dispatching', anyOf: [PERMISSIONS.LEAD_DISPATCHING_RULE_READ] },
      {
        id: 'workflows',
        label: 'Suivi des workflows',
        icon: 'feather:activity',
        link: '/settings/workflows/analytiques',
        anyOf: [PERMISSIONS.WORKFLOW_ANALYTICS_VIEW],
        badge: 'workflows',
      },
    ],
  },
];

export const SETTINGS_NAV_ITEM: PortalNavItem = { id: 'settings', label: 'Paramétrage', icon: 'feather:settings', link: '/settings' };

/**
 * L'entrée qui correspond à une URL : le lien le plus LONG qui la préfixe. `/leads/whatsapp`
 * appartient à WhatsApp et non à Leads, `/leads/123` à Leads, `/settings/workflows/analytiques`
 * au suivi des workflows et le reste de `/settings` au paramétrage — ce qu'un `routerLinkActive`
 * par entrée ne sait pas trancher, chacun s'allumant pour tout ce qui commence par son lien.
 */
export function activeNavItem(url: string, items: PortalNavItem[]): PortalNavItem | null {
  const path = url.split(/[?#]/)[0];
  let best: PortalNavItem | null = null;
  for (const item of items) {
    const matches = path === item.link || path.startsWith(`${item.link}/`);
    if (matches && (!best || item.link.length > best.link.length)) best = item;
  }
  return best;
}

export function groupOf(item: PortalNavItem | null): PortalNavGroup | null {
  if (!item) return null;
  return PORTAL_NAVIGATION.find((g) => g.items.includes(item)) ?? null;
}
