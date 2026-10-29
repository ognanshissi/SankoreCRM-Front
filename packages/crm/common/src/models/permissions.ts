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
  // Déclaré par `PUT` et `DELETE /api/v1/agencies/{id}/manager` dans leur description.
  // Distinct d'`agency:update` : désigner le responsable d'une agence peut accorder un
  // rôle à l'utilisateur visé (`AssignAgencyManagerResult.grantedRole`).
  AGENCY_ASSIGN_MANAGER: 'agency:assign-manager',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_IMPERSONATE: 'user:impersonate',
  USER_DEACTIVATE: 'user:deactivate',
  USER_REACTIVATE: 'user:reactivate',
  USER_RESET_PASSWORD: 'user:reset-password',
  USER_ASSIGN_ROLE: 'user:assign-role',
  // Déclaré par `POST /api/v1/users/bulk/agency`. Distinct d'`user:update` : déplacer un
  // utilisateur d'agence change son périmètre de données, pas seulement sa fiche.
  USER_ASSIGN_AGENCY: 'user:assign-agency',
  // Déclaré par `PUT` et `DELETE /api/v1/users/{userId}/manager`. Distinct d'`user:update` :
  // la ligne hiérarchique conditionne ce que le responsable voit et valide, pas la fiche.
  USER_ASSIGN_MANAGER: 'user:assign-manager',
  USER_REVOKE_ROLE: 'user:revoke-role',
  USER_ASSIGN_PERMISSION: 'user:assign-permission',
  USER_REVOKE_PERMISSION: 'user:revoke-permission',
  // Déclaré par `POST users/{id}/credentials` et `…/credentials/withdrawal` : la carte
  // professionnelle d'intermédiaire d'assurance (CIMA art. 503, 510).
  USER_CREDENTIAL_MANAGE: 'user:credential:manage',

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
  FORM_MANAGE: 'form:manage',

  AUDIT_READ: 'audit:read',

  COMPANY_READ: 'company:read',
  COMPANY_UPDATE: 'company:update',

  // Modules payants du tenant (« Banking - Microfinance », « Assurance ») : la demande
  // d'activation est autorisée par la plateforme, la désactivation est immédiate. Seul le
  // rôle Administrateur les détient par défaut.
  TENANT_MODULES_READ: 'tenant:modules:read',
  TENANT_MODULES_REQUEST: 'tenant:modules:request',
  TENANT_MODULES_DEACTIVATE: 'tenant:modules:deactivate',

  // Tickets adressés à l'équipe Sankoré. Chacun voit les siens ; « read:all » (Administrateur)
  // ouvre ceux de toute l'institution.
  SUPPORT_READ: 'support:read',
  SUPPORT_CREATE: 'support:create',
  SUPPORT_READ_ALL: 'support:read:all',

  NOTIFICATION_SETTINGS_READ: 'notification:settings:read',
  NOTIFICATION_SETTINGS_MANAGE: 'notification:settings:manage',
  NOTIFICATION_SETTINGS_QUOTA: 'notification:settings:quota',

  // ——— Leads ———
  LEAD_READ: 'lead:read',
  // Sans les trois « read:all », l'utilisateur ne voit que ses leads, clients et dossiers KYC —
  // le serveur filtre, l'écran n'a rien à faire. Agent et Agent commercial ne les ont pas.
  LEAD_READ_ALL: 'lead:read:all',
  LEAD_CREATE: 'lead:create',
  LEAD_UPDATE: 'lead:update',
  LEAD_ASSIGN: 'lead:assign',
  LEAD_QUALIFY: 'lead:qualify',
  LEAD_CONVERT: 'lead:convert',
  LEAD_CLOSE: 'lead:close',
  // Les paramètres de l'institution pour les leads (dont WhatsApp) : PUT /lead-settings/{key}.
  LEAD_SETTINGS_MANAGE: 'lead:settings:manage',
  LEAD_RECYCLE: 'lead:recycle',
  LEAD_NURTURE: 'lead:nurture',
  LEAD_PIPELINE: 'lead:pipeline',
  LEAD_TAG: 'lead:tag',
  LEAD_MERGE: 'lead:merge',
  LEAD_EXPORT: 'lead:export',
  LEAD_IMPORT: 'lead:import',
  LEAD_ANALYTICS_VIEW: 'lead:analytics:view',
  // Rapport institutionnel (toutes équipes, sans restriction d'équipe) : administrateurs par défaut.
  LEAD_REPORT_VIEW: 'lead:report:view',
  LEAD_ACTIVITY_LOG: 'lead:activity:log',
  LEAD_CONSENT_RECORD: 'lead:consent:record',
  /** Conjoint, enfants, statut PPE et ressources du foyer d'un lead. */
  LEAD_HOUSEHOLD_MANAGE: 'lead:household:manage',
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

  // Ces deux codes étaient utilisés en littéral dans `edit-lead-source.ts`
  // sans figurer au catalogue : à confirmer côté API, car si le serveur ne les
  // accorde jamais, les deux actions correspondantes restent inaccessibles.
  LEAD_INGESTION_PAYLOAD_READ: 'lead:ingestion:payload:read',
  LEAD_INGESTION_REPLAY: 'lead:ingestion:replay',

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

  // ——— Clients ———
  // Ces neuf codes sont ceux que le swagger déclare endpoint par endpoint : ils ne
  // sont pas déduits. Attention, la répartition n'est pas celle qu'on devine —
  // `customers:update` ne couvre que les champs non sensibles, les coordonnées, les
  // relations et l'affectation d'un conseiller. Les cas contre-intuitifs :
  //
  //   suspendre / réactiver / transférer d'agence  -> customers:update_sensitive
  //   déclarer les bénéficiaires effectifs         -> customers:update_sensitive
  //   modifier les règles de segmentation          -> customers:update_sensitive
  //   archiver / anonymiser                        -> customers:archive
  //   toute écriture sur un groupe                 -> customers:groups_manage
  //
  // Le module s'appelle « customers » côté permissions alors que le reste du contrat
  // parle de « clients » (`/api/v1/clients`, `ClientDetailDto`) : c'est bien ainsi
  // dans le swagger, ne pas « harmoniser ».
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_READ_ALL: 'customers:read:all',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_UPDATE_SENSITIVE: 'customers:update_sensitive',
  CUSTOMERS_REVEAL_SENSITIVE: 'customers:reveal_sensitive',
  CUSTOMERS_MERGE: 'customers:merge',
  CUSTOMERS_ARCHIVE: 'customers:archive',

  // Effacement à la demande (purge de données, lot 2) : enregistrer et lire les demandes ;
  // décider celles d'un AUTRE (jamais les siennes — le serveur le refuse).
  PRIVACY_ERASURE_REQUEST: 'privacy:erasure:request',
  PRIVACY_ERASURE_APPROVE: 'privacy:erasure:approve',
  COMPLIANCE_SUSPICION_RAISE: 'compliance:suspicion:raise',
  COMPLIANCE_SUSPICION_MANAGE: 'compliance:suspicion:manage',
  CUSTOMERS_EXPORT: 'customers:export',
  CUSTOMERS_GROUPS_MANAGE: 'customers:groups_manage',

  // Déclaré par `GET /api/v1/clients/{clientId}/household` : « PEP detail (function,
  // country, family link) requires customers:pep_read; the exposure flag is always
  // visible ». C'est le seul droit de lecture *partielle* du catalogue — sans lui, la
  // fiche affiche le badge d'exposition mais pas la fonction exercée (BNF-F-04).
  CUSTOMERS_PEP_READ: 'customers:pep_read',

  // Registre des réclamations du client (2026-10-26), tous produits ; celui de l'assurance
  // (CIMA) reste à part.
  CUSTOMERS_COMPLAINTS_READ: 'customers:complaints:read',
  CUSTOMERS_COMPLAINTS_MANAGE: 'customers:complaints:manage',

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

  // KYC
  KYC_READ: 'kyc:read',
  KYC_READ_ALL: 'kyc:read:all',
  KYC_MANAGE: 'kyc:manage',
  KYC_VERIFY: 'kyc:verify',
  KYC_APPROVE: 'kyc:approve',
  KYC_DUPLICATE_CLEAR: 'kyc:duplicate:clear',
  KYC_DOCUMENT_REVEAL: 'kyc:document:reveal',
  KYC_DOCUMENT_VALIDATE: 'kyc:document:validate',
  KYC_SETTINGS_MANAGE: 'kyc:settings:manage',
  KYC_REMOTE_INVITE: 'kyc:remote-invite',
  /**
   * Relire l'échantillon des dossiers validés sans intervention humaine, et consigner le constat
   * (KRM-B-11). Distinct de `kyc:approve` : un approbateur décide d'entrer en relation, celui-ci
   * répond au régulateur du fait que l'établissement ait laissé une machine décider — donner le
   * second à tous les porteurs du premier ferait auditer le dispositif par les personnes dont il
   * a remplacé la signature.
   */
  KYC_AUTO_APPROVAL_CONTROL: 'kyc:auto-approval:control',

  // ——— Intégrations (core banking, assurance) ———
  //
  // Ces codes sont en PascalCase pointé, contrairement à tout le reste du catalogue.
  // Ce n'est pas une incohérence à « harmoniser » : c'est la forme exacte que les
  // endpoints `/api/v1/integration/**` déclarent dans leur description (par ex.
  // « Requires permission: Integration.Connection.Manage. »). Les renommer en
  // `integration:connection:manage` produirait des gardes qui ne matchent jamais ce
  // que le serveur accorde.
  INTEGRATION_CONNECTION_VIEW: 'Integration.Connection.View',
  INTEGRATION_CONNECTION_MANAGE: 'Integration.Connection.Manage',
  INTEGRATION_MAPPING_MANAGE: 'Integration.Mapping.Manage',
  INTEGRATION_COMMAND_VIEW: 'Integration.Command.View',
  INTEGRATION_COMMAND_REPLAY: 'Integration.Command.Replay',
  INTEGRATION_RECONCILIATION_VIEW: 'Integration.Reconciliation.View',
  INTEGRATION_RECONCILIATION_RESOLVE: 'Integration.Reconciliation.Resolve',
  INTEGRATION_WEBHOOK_VIEW: 'Integration.Webhook.View',
  INTEGRATION_WEBHOOK_MANAGE: 'Integration.Webhook.Manage',

  CORE_BANKING_BALANCE_VIEW_LIVE: 'CoreBanking.Balance.ViewLive',

  INS_PRODUCT_MANAGE: 'Ins.Product.Manage',

  // Lire le catalogue et demander un tarif. Séparé de PRODUCT_MANAGE côté back parce
  // que lire le catalogue fait partie de la DISTRIBUTION et non de l'administration :
  // un agent qui ne détient que Ins.Policy.Subscribe doit pouvoir voir quels produits
  // existent et ce qu'ils coûtent.
  INS_PRODUCT_VIEW: 'Ins.Product.View',

  // ASS-04 à ASS-10 sont désormais LIVRÉS côté back, et ces codes sont vérifiés
  // contre Permissions.All : le commentaire précédent disait « à confirmer à l'arrivée
  // de ces endpoints », c'est fait. Un seul code a disparu dans l'opération, voir plus bas.
  INS_POLICY_VIEW: 'Ins.Policy.View',
  INS_POLICY_SUBSCRIBE: 'Ins.Policy.Subscribe',
  INS_CLAIM_VIEW: 'Ins.Claim.View',
  INS_CLAIM_DECLARE: 'Ins.Claim.Declare',
  INS_STATEMENT_VIEW: 'Ins.Statement.View',

  // Clôturer un bordereau du mois. Volontairement PAS la permission de lecture côté
  // back : figer les chiffres sort le mois définitivement de portée de la génération
  // nocturne, donc quiconque peut REGARDER un bordereau ne doit pas pouvoir en clôturer
  // un — la même ligne que Policy.View / Policy.Subscribe.
  INS_STATEMENT_FINALISE: 'Ins.Statement.Finalise',

  // Le mécanisme de traitement des réclamations du règlement 01/CIMA/2024. Sa propre
  // paire lecture/écriture : les gens qui le tiennent dans une IMF ne sont pas ceux qui
  // vendent, et un lecteur du registre ne doit pas répondre au nom de l'institution.
  INS_COMPLAINT_VIEW: 'Ins.Complaint.View',
  INS_COMPLAINT_HANDLE: 'Ins.Complaint.Handle',

  INS_RECONCILIATION_RESOLVE: 'Ins.Reconciliation.Resolve',

  // ——— Téléphonie ———
  //
  // Même forme PascalCase pointée que les intégrations, et pour la même raison : c'est
  // la chaîne exacte que les endpoints `/api/v1/integration/telephony/**` déclarent
  // dans leur description (par ex. « Requires permission: Telephony.Call.View. »).
  // Les réécrire en `telephony:call:view` donnerait des gardes qui ne matchent jamais.
  TELEPHONY_CALL_MAKE: 'Telephony.Call.Make',
  TELEPHONY_CALL_VIEW: 'Telephony.Call.View',
  TELEPHONY_CALL_LINK: 'Telephony.Call.Link',
  TELEPHONY_RECORDING_LISTEN: 'Telephony.Recording.Listen',
  TELEPHONY_RECORDING_EXPORT: 'Telephony.Recording.Export',
  TELEPHONY_STATS_VIEW: 'Telephony.Stats.View',
  TELEPHONY_SETTINGS_MANAGE: 'Telephony.Settings.Manage',

  // WhatsApp (lot 1) — même graphie que la téléphonie, comme la spécification les tabule.
  // Send : envoyer un template et lire le fil d'un lead de son périmètre ; Send.Force : renvoyer
  // avant 24 h sans réponse ; Supervise : lire les conversations de ses agences ; Config : numéro
  // et templates.
  WHATSAPP_SEND: 'WhatsApp.Send',
  WHATSAPP_SEND_FORCE: 'WhatsApp.Send.Force',
  // Répondre en message libre (texte, image, PDF) dans une conversation qu'on a prise en main.
  WHATSAPP_REPLY: 'WhatsApp.Reply',
  WHATSAPP_SUPERVISE: 'WhatsApp.Supervise',
  WHATSAPP_CONFIG: 'WhatsApp.Config',
  // Ce que dit le chatbot et quand il passe la main, par produit, et son activation pour
  // l'institution. Distinct de WhatsApp.Config : les mots du bot sont une affaire commerciale
  // et de conformité, le numéro une affaire technique.
  WHATSAPP_BOT_CONFIG: 'WhatsApp.Bot.Config',
  // Connecter SES propres comptes Microsoft et Google (agendas, contacts).
  CONNECTED_ACCOUNTS_USE: 'ConnectedAccounts.Use',

  // Volontairement en minuscules à deux-points, contrairement à ses voisines de ce
  // bloc : c'est la chaîne exacte que les endpoints de la politique d'enregistrement
  // accordent (`RecordingPolicySlices` et `RecordingAccessEndpoints` disent
  // « Requires permission: admin:compliance:manage. »), parce que le droit vient du
  // catalogue Administration et non de la famille Téléphonie. L'uniformiser en
  // `Admin.Compliance.Manage` produirait une garde que le serveur ne satisfait jamais.
  ADMIN_COMPLIANCE_MANAGE: 'admin:compliance:manage',
} as const;

/** Code de permission valide. Tout autre littéral est refusé à la compilation. */
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Liste plate, utile pour les écrans d'administration des rôles. */
export const ALL_PERMISSION_CODES: PermissionCode[] = Object.values(PERMISSIONS);
