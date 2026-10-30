import { PermissionCode, TENANT_MODULES, TenantModule } from '@sankore/crm/common';

export interface SettingsEntry {
  id: string;
  title: string;
  icon: string;
  description: string;
  /** Absent : l'écran n'existe pas encore. L'entrée s'affiche « Bientôt », sans lien. */
  link?: string;
  permission?: PermissionCode | PermissionCode[];
  /**
   * Modules payants dont l'écran relève : au moins un doit être actif, ou désactivé (l'écran
   * s'ouvre alors en consultation seule). Absent : socle.
   */
  modules?: TenantModule[];
}

export interface SettingsGroup {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Fond de la pastille d'icône dans la navigation, comme dans la maquette. */
  tint: string;
  entries: SettingsEntry[];
}

/**
 * La liste unique des rubriques du paramétrage. Elle vivait en dur dans `OverviewComponent` ;
 * séparée de l'écran, elle est aussi ce que `SettingsStatusService` complète par identifiant.
 *
 * Les entrées sans `link` sont celles dont l'écran n'existe pas : elles pointaient vers des
 * routes absentes (`/settings/currency`, `/settings/tags`…) et menaient à un écran blanc.
 */
/** Surfaces partagées par le core banking et les assureurs : ouvertes avec l'un ou l'autre module. */
const BANKING_OR_INSURANCE: TenantModule[] = [TENANT_MODULES.BANKING_MICROFINANCE, TENANT_MODULES.INSURANCE];

export const SETTINGS_CATALOG: ReadonlyArray<SettingsGroup> = [
  {
    id: 'organisation',
    title: 'Organisation',
    description: 'Les agences, leurs territoires et les personnes qui y travaillent.',
    icon: 'feather:grid',
    tint: 'bg-[#e3ebeb]',
    entries: [
      { id: 'agencies', title: 'Agences', icon: 'feather:home', link: '/settings/agencies', permission: 'agency:read', description: 'Les points de service de l’institution et leurs responsables.' },
      { id: 'territories', title: 'Territoires', icon: 'feather:map', link: '/settings/territories', permission: 'territory:read', description: 'Les zones couvertes, utilisées pour router les leads.' },
      { id: 'users', title: 'Utilisateurs', icon: 'feather:users', link: '/settings/users', permission: 'user:read', description: 'Inviter, désactiver et rattacher les membres.' },
      { id: 'roles', title: 'Rôles et permissions', icon: 'feather:key', link: '/settings/roles', permission: 'role:read', description: 'Ce que chaque rôle peut voir, créer ou valider.' },
    ],
  },
  {
    id: 'leads',
    title: 'Leads et clients',
    description: 'Comment une demande arrive, à qui elle va et par quelles étapes elle passe.',
    icon: 'feather:compass',
    tint: 'bg-[#e8eefb]',
    entries: [
      { id: 'workflows', title: 'Workflows', icon: 'feather:git-branch', link: '/settings/workflows', permission: 'workflow:read', description: 'Les étapes de validation d’un lead ou d’un contact.' },
      { id: 'dispatch', title: 'Stratégies d’affectation', icon: 'feather:shuffle', link: '/leads/dispatching', permission: 'lead:dispatching-rule:read', description: 'Qui reçoit quel lead, avec délais et escalade.' },
      { id: 'sources', title: 'Sources et campagnes', icon: 'feather:target', link: '/settings/lead-sources', permission: 'lead:source:read', description: 'Les canaux d’acquisition et leurs campagnes.' },
      { id: 'pipeline', title: 'Étapes des projets', icon: 'feather:list', link: '/settings/project-steps', permission: 'lead:pipeline-stage:read', description: 'Les étapes que suit un projet, par famille de produits ou par produit.' },
      { id: 'qualification', title: 'Formulaires de qualification', icon: 'feather:check-square', link: '/settings/qualification-templates', permission: 'lead:qualification-template:manage', description: 'Les questions posées par produit, et leurs règles conditionnelles.' },
      { id: 'forms', title: 'Formulaires', icon: 'feather:layout', link: '/settings/forms', permission: 'form:manage', description: 'Les champs des leads, clients et produits, ceux de la création rapide, et vos champs personnalisés.' },
      { id: 'scoring', title: 'Règles de scoring', icon: 'feather:trending-up', link: '/settings/scoring-configs', permission: 'lead:scoring-config:read', description: 'Les poids et seuils du score d’un lead.' },
      { id: 'sla', title: 'SLA et calendrier ouvré', icon: 'feather:clock', link: '/settings/sla-configs', permission: 'lead:sla-config:read', description: 'Les délais de prise en charge par agence et les jours ouvrés.' },
      { id: 'task-types', title: 'Types de tâches', icon: 'feather:clipboard', link: '/settings/task-types', permission: 'lead:task-type:read', description: 'Les types de tâches, leurs priorités et résultats attendus.' },
      { id: 'segments', title: 'Segmentation des clients', icon: 'feather:sliders', link: '/settings/client-segments', permission: 'customers:segments_manage', description: 'Les règles qui classent automatiquement les clients par segment.' },
    ],
  },
  {
    id: 'products',
    title: 'Produits et services',
    description: 'Le catalogue proposé aux prospects et clients.',
    icon: 'feather:package',
    tint: 'bg-[#f6efe5]',
    entries: [
      { id: 'products', title: 'Produits', icon: 'feather:credit-card', link: '/settings/products', permission: 'product:read', description: 'Comptes, crédits et épargne.' },
      { id: 'insurance-products', title: 'Assurances', icon: 'feather:umbrella', link: '/settings/integrations/insurance-products', permission: 'Ins.Product.Manage', description: 'Les offres des assureurs partenaires que vos agents peuvent proposer.' , modules: [TENANT_MODULES.INSURANCE] },
    ],
  },
  {
    id: 'data',
    title: 'Données et import',
    description: 'Faire entrer des données en masse.',
    icon: 'feather:download',
    tint: 'bg-[#e3ebeb]',
    entries: [
      { id: 'import-users', title: 'Importer des utilisateurs', icon: 'feather:upload', link: '/settings/import-users', permission: 'user:create', description: 'Depuis un fichier Excel ou CSV.' },
      { id: 'import-clients', title: 'Importer des clients', icon: 'feather:upload', link: '/customers/import-clients', permission: 'customers:create', description: 'Depuis un fichier, ou Google Sheets.' },
      { id: 'import-leads', title: 'Importer des leads', icon: 'feather:upload', link: '/leads/import', permission: 'lead:import', description: 'Depuis un fichier, Google Sheets ou Google Contacts.' },
    ],
  },
  {
    id: 'channels',
    title: 'Canaux de communication',
    description: 'Les canaux par lesquels vous captez et contactez prospects et clients.',
    icon: 'feather:message-circle',
    tint: 'bg-[#e8eefb]',
    entries: [
      { id: 'telephony', title: 'Téléphonie', icon: 'feather:phone', link: '/settings/telephony', permission: 'Telephony.Call.View', description: 'Standard téléphonique et comptes des agents.' },
      { id: 'email-provider', title: 'E-mail', icon: 'feather:mail', link: '/settings/notifications', permission: ['notification:settings:read', 'notification:outbox:read'], description: 'Fournisseur d’envoi, expéditeur, quota et journal de livraison.' },
      { id: 'sms-provider', title: 'SMS', icon: 'feather:message-square', link: '/settings/notifications/sms', permission: 'notification:settings:read', description: 'Fournisseur SMS, expéditeur et allocation mensuelle.' },
      { id: 'email-templates', title: 'Modèles d’e-mail', icon: 'feather:file-text', link: '/settings/email-templates', permission: 'notification:template:read', description: 'Les modèles transactionnels et marketing.' },
      { id: 'whatsapp', title: 'WhatsApp Business', icon: 'feather:message-circle', link: '/settings/whatsapp', permission: 'WhatsApp.Config', description: 'Les numéros WhatsApp de l’institution, leur clé 360dialog et leur webhook.' },
      { id: 'whatsapp-templates', title: 'Templates WhatsApp', icon: 'feather:file-text', link: '/settings/whatsapp/templates', permission: 'WhatsApp.Config', description: 'Les modèles approuvés par Meta, leurs produits et leurs variables.' },
      { id: 'whatsapp-bot', title: 'Chatbot WhatsApp', icon: 'feather:cpu', link: '/settings/whatsapp/bot', permission: 'WhatsApp.Bot.Config', description: 'Ce que le bot répond par produit, ce qu’il recueille et quand il passe la main.' },
    ],
  },
  {
    id: 'integrations',
    title: 'Intégrations',
    description: 'Relier SANKORE au core banking et aux back-offices des assureurs.',
    icon: 'feather:link',
    tint: 'bg-[#f6efe5]',
    entries: [
      { id: 'integrations-hub', title: 'Vue d’ensemble', icon: 'feather:grid', link: '/settings/integrations', permission: 'lead:source:read', description: 'Les services externes connectables depuis SANKORE, et leur état.' },
      { id: 'webhooks', title: 'Webhooks', icon: 'feather:zap', link: '/settings/webhooks', permission: 'Integration.Webhook.View', description: 'Les événements leads, projets et clients envoyés à vos partenaires, et leurs livraisons.' },
      { id: 'connections', title: 'Connexions', icon: 'feather:link', link: '/settings/integrations/connections', permission: 'Integration.Connection.View', description: 'Core banking, assurance et téléphonie.' },
      { id: 'mappings', title: 'Correspondances de codes', icon: 'feather:repeat', link: '/settings/integrations/mappings', permission: 'Integration.Mapping.Manage', description: 'Les codes du CRM et ceux attendus par chaque système externe.' , modules: BANKING_OR_INSURANCE },
      { id: 'commands', title: 'Écritures et rejets', icon: 'feather:send', link: '/settings/integrations/commands', permission: 'Integration.Command.View', description: 'Les écritures envoyées aux systèmes externes, et les rejets à traiter.' , modules: BANKING_OR_INSURANCE },
      { id: 'batch-files', title: 'Fichiers échangés', icon: 'feather:file', link: '/settings/integrations/batch-files', permission: 'Integration.Command.View', description: 'Les fichiers sortants et entrants, et les accusés manquants.' , modules: BANKING_OR_INSURANCE },
      { id: 'reconciliation', title: 'Réconciliation', icon: 'feather:git-pull-request', link: '/settings/integrations/reconciliation', permission: 'Integration.Reconciliation.View', description: 'Les écarts entre le CRM et les systèmes externes.' , modules: BANKING_OR_INSURANCE },
      { id: 'insurance-connections', title: 'Connexions assurance', icon: 'feather:shield', link: '/settings/integrations/insurance-connections', permission: 'Integration.Connection.View', description: 'Les back-offices des assureurs partenaires.' , modules: [TENANT_MODULES.INSURANCE] },
      { id: 'insurance-statements', title: 'Bordereaux assurance', icon: 'feather:book-open', link: '/settings/integrations/insurance-statements', permission: 'Ins.Statement.View', description: 'Primes reversées et commissions, par assureur et par mois.' , modules: [TENANT_MODULES.INSURANCE] },
    ],
  },
  {
    id: 'security',
    title: 'Sécurité et conformité',
    description: 'Traçabilité des actions et règles de conformité BCEAO.',
    icon: 'feather:shield',
    tint: 'bg-[#e3ebeb]',
    entries: [
      { id: 'audit', title: 'Journal d’audit', icon: 'feather:activity', link: '/settings/audit', permission: 'audit:read', description: 'Qui a fait quoi, quand.' },
      { id: 'kyc', title: 'Règles KYC', icon: 'feather:user-check', link: '/settings/kyc', permission: 'kyc:settings:manage', description: 'Plafonds du KYC simplifié, seuils d’alerte, revue et comparaison faciale.' },
      { id: 'compliance', title: 'FATCA et conformité', icon: 'feather:flag', link: '/settings/conformite', permission: 'admin:compliance:manage', description: 'FATCA, régime de l’institution, GIIN et maintien du statut PPE.' },
      { id: 'insurance-distribution', title: 'Distribution d’assurance', icon: 'feather:umbrella', link: '/settings/distribution-assurance', description: 'Statut de distributeur, mention légale, SMIG et pièces (agrément, garantie, RC) qui autorisent les souscriptions.', modules: [TENANT_MODULES.INSURANCE] },
      { id: 'erasure', title: 'Demandes d’effacement', icon: 'feather:user-x', link: '/settings/effacements', permission: 'privacy:erasure:request', description: 'Personnes demandant l’effacement de leurs données : décision, restriction et effacement.' },
      { id: 'suspicion-alerts', title: 'Alertes LBC/FT', icon: 'feather:alert-octagon', link: '/settings/alertes-lbc', permission: 'compliance:suspicion:manage', description: 'Soupçons signalés par les agents : examen, déclaration à la CENTIF ou classement. Confidentiel.' },
    ],
  },
  {
    id: 'account',
    title: 'Compte et abonnement',
    description: 'L’institution, sa facturation et son abonnement.',
    icon: 'feather:settings',
    tint: 'bg-[#f6efe5]',
    entries: [
      { id: 'company', title: 'Institution', icon: 'feather:briefcase', link: '/settings/company', permission: 'company:read', description: 'Nom, logo, langue par défaut et couleurs.' },
      { id: 'currency', title: 'Monnaie', icon: 'feather:dollar-sign', description: 'Les devises utilisées.' },
      { id: 'tags', title: 'Tags', icon: 'feather:tag', description: 'L’ensemble des tags.' },
      { id: 'billing', title: 'Modules et abonnement', icon: 'feather:package', link: '/settings/modules', permission: 'tenant:modules:read', description: 'Les modules payants de l’institution : Banking - Microfinance et Assurance.' },
      { id: 'test-mode', title: 'Mode test', icon: 'feather:tool', link: '/settings/mode-test', permission: 'tenant:test-mode', description: 'Une copie d’essai de l’institution, pour régler et essayer sans toucher à la production.' },
    ],
  },
];

/**
 * Les rubriques que l'utilisateur peut ouvrir — permission ET module payant —, groupe vide retiré. Une entrée « Bientôt » reste
 * visible : elle n'ouvre rien et ne révèle rien.
 */
export function visibleCatalog(granted: ReadonlySet<string>, activeModules: ReadonlySet<string>): SettingsGroup[] {
  const allowed = (entry: SettingsEntry) => {
    if (entry.modules && !entry.modules.some((m) => activeModules.has(m))) return false;
    if (!entry.permission) return true;
    const codes = Array.isArray(entry.permission) ? entry.permission : [entry.permission];
    return codes.some((c) => granted.has(c));
  };
  return SETTINGS_CATALOG.map((g) => ({ ...g, entries: g.entries.filter(allowed) })).filter(
    (g) => g.entries.some((e) => !!e.link),
  );
}
