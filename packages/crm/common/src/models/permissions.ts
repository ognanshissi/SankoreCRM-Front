/**
 * Catalogue des permissions du système, aligné sur ce que renvoie l'API.
 *
 * C'est la seule source de vérité côté front. Les gardes de route, la
 * directive `*hasPermission` et les `computed` des écrans s'y réfèrent, si
 * bien qu'une faute de frappe devient une erreur de compilation au lieu d'un
 * bouton silencieusement masqué — ou pire, silencieusement affiché.
 */
export const PERMISSIONS = {
  // ——— Administration ———
  AGENCY_READ: 'agency:read',
  AGENCY_CREATE: 'agency:create',
  AGENCY_UPDATE: 'agency:update',
  AGENCY_DELETE: 'agency:delete',
  AGENCY_MOVE: 'agency:move',
  AGENCY_ACTIVATE: 'agency:activate',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',
  USER_REACTIVATE: 'user:reactivate',
  USER_RESET_PASSWORD: 'user:reset-password',
  USER_ASSIGN_ROLE: 'user:assign-role',
  USER_REVOKE_ROLE: 'user:revoke-role',
  USER_ASSIGN_PERMISSION: 'user:assign-permission',
  USER_REVOKE_PERMISSION: 'user:revoke-permission',

  TERRITORY_READ: 'territory:read',
  TERRITORY_CREATE: 'territory:create',
  TERRITORY_UPDATE: 'territory:update',
  TERRITORY_DELETE: 'territory:delete',

  ROLE_READ: 'role:read',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  ROLE_MANAGE_PERMISSIONS: 'role:manage-permissions',

  PRODUCT_READ: 'product:read',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',

  AUDIT_READ: 'audit:read',

  COMPANY_READ: 'company:read',
  COMPANY_UPDATE: 'company:update',

  NOTIFICATION_SETTINGS_READ: 'notification:settings:read',
  NOTIFICATION_SETTINGS_MANAGE: 'notification:settings:manage',
  NOTIFICATION_SETTINGS_QUOTA: 'notification:settings:quota',

  // ——— Leads ———
  LEAD_READ: 'lead:read',
  LEAD_CREATE: 'lead:create',
  LEAD_UPDATE: 'lead:update',
  LEAD_ASSIGN: 'lead:assign',
  LEAD_QUALIFY: 'lead:qualify',
  LEAD_CONVERT: 'lead:convert',
  LEAD_CLOSE: 'lead:close',
  LEAD_RECYCLE: 'lead:recycle',
  LEAD_NURTURE: 'lead:nurture',
  LEAD_PIPELINE: 'lead:pipeline',
  LEAD_TAG: 'lead:tag',
  LEAD_MERGE: 'lead:merge',
  LEAD_EXPORT: 'lead:export',
  LEAD_IMPORT: 'lead:import',
  LEAD_ANALYTICS_VIEW: 'lead:analytics:view',
  LEAD_ACTIVITY_LOG: 'lead:activity:log',
  LEAD_CONSENT_RECORD: 'lead:consent:record',
  LEAD_CONSENT_WITHDRAW: 'lead:consent:withdraw',
  LEAD_DUPLICATE_DISMISS: 'lead:duplicate:dismiss',
  LEAD_REMINDER_MANAGE: 'lead:reminder:manage',

  LEAD_OPPORTUNITY_READ: 'lead:opportunity:read',
  LEAD_OPPORTUNITY_MANAGE: 'lead:opportunity:manage',

  LEAD_TASK_READ: 'lead:task:read',
  LEAD_TASK_MANAGE: 'lead:task:manage',
  LEAD_TASK_TYPE_READ: 'lead:task-type:read',
  LEAD_TASK_TYPE_MANAGE: 'lead:task-type:manage',
  LEAD_TASK_RULE_MANAGE: 'lead:task-rule:manage',

  LEAD_SOURCE_READ: 'lead:source:read',
  LEAD_SOURCE_MANAGE: 'lead:source:manage',
  LEAD_SOURCE_CREDENTIALS: 'lead:source:credentials',

  LEAD_DISPATCHING_RULE_READ: 'lead:dispatching-rule:read',
  LEAD_DISPATCHING_RULE_MANAGE: 'lead:dispatching-rule:manage',

  LEAD_PIPELINE_STAGE_READ: 'lead:pipeline-stage:read',
  LEAD_PIPELINE_STAGE_MANAGE: 'lead:pipeline-stage:manage',

  LEAD_SCORING_CONFIG_READ: 'lead:scoring-config:read',
  LEAD_SCORING_CONFIG_MANAGE: 'lead:scoring-config:manage',

  LEAD_SLA_CONFIG_READ: 'lead:sla-config:read',
  LEAD_SLA_CONFIG_MANAGE: 'lead:sla-config:manage',

  LEAD_NURTURING_SEQUENCE_READ: 'lead:nurturing-sequence:read',
  LEAD_NURTURING_SEQUENCE_MANAGE: 'lead:nurturing-sequence:manage',

  LEAD_QUALIFICATION_TEMPLATE_MANAGE: 'lead:qualification-template:manage',

  // ——— Prêts ———
  LOAN_CREATE: 'loan:create',

  // ——— Notifications ———
  NOTIFICATION_TEMPLATE_READ: 'notification:template:read',
  NOTIFICATION_TEMPLATE_MANAGE: 'notification:template:manage',
  NOTIFICATION_OUTBOX_READ: 'notification:outbox:read',
  NOTIFICATION_OUTBOX_RETRY: 'notification:outbox:retry',
  NOTIFICATION_DELIVERY_LOG_READ: 'notification:delivery-log:read',

  // ——— Workflows ———
  WORKFLOW_READ: 'workflow:read',
  WORKFLOW_CREATE: 'workflow:create',
  WORKFLOW_UPDATE: 'workflow:update',
  WORKFLOW_DELETE: 'workflow:delete',
  WORKFLOW_ACTIVATE: 'workflow:activate',
  WORKFLOW_MANAGE_STEPS: 'workflow:manage-steps',
  WORKFLOW_TRIGGER_MANAGE: 'workflow:trigger:manage',
  WORKFLOW_START: 'workflow:start',
  WORKFLOW_CANCEL: 'workflow:cancel',
  WORKFLOW_APPROVE: 'workflow:approve',
  WORKFLOW_STEP_ASSIGN: 'workflow:step:assign',
  WORKFLOW_TASK_COMPLETE: 'workflow:task:complete',
  WORKFLOW_INSTANCE_VIEW: 'workflow:instance:view',
  WORKFLOW_ANALYTICS_VIEW: 'workflow:analytics:view',
} as const;

/** Code de permission valide. Tout autre littéral est refusé à la compilation. */
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Liste plate, utile pour les écrans d'administration des rôles. */
export const ALL_PERMISSION_CODES: PermissionCode[] = Object.values(PERMISSIONS);
