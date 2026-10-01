import {
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { TasTitle } from '@talisoft/ui/title';
import { TasText } from '@talisoft/ui/text';
import { NgClass, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  BreadcrumbService,
  PermissionCode,
  PermissionsService,
} from '@sankore/crm/common';

export interface MenuItem {
  title: string;
  icon?: string;
  id: string;
  link?: string;
  permission?: PermissionCode | PermissionCode[];
  type: 'basic' | 'group';
  description?: string;
  isActive?: boolean;
  hidden?: (item: MenuItem) => boolean;
  children?: MenuItem[];
}

@Component({
  selector: 'settings-overview',
  templateUrl: './overview.component.html',
  standalone: true,
  styles: [
    `
      .menu-group__active {
        background-color: rgba(var(--tas-color-primary)) !important;
        color: var(--tas-color-white);
      }
    `,
  ],
  imports: [TasTitle, TasText, NgClass, RouterLink, NgIf],
})
export class OverviewComponent implements OnInit {
  private readonly menuData: MenuItem[] = [
    {
      title: 'Agences & utilisateurs',
      type: 'group',
      id: 'teams_territories',
      description: "Gestion des utilisateurs et agences de l'organisation",
      children: [
        {
          title: 'Workflows',
          type: 'basic',
          id: 'groups_workflows',
          link: '/settings/workflows',
          permission: 'workflow:read',
          description:
            'Définir les étapes de validation appliquées aux leads, contacts et opportunités',
        },
        {
          title: "Stratégies d'affectation",
          type: 'basic',
          id: 'groups_dispatching',
          link: '/settings/dispatch-rules',
          permission: 'lead:dispatching-rule:read',
          description:
            "Configurer et simuler les stratégies d'affectation automatique des leads",
        },
        {
          title: 'Utilisateurs',
          type: 'basic',
          id: 'teams_territories_users',
          link: '/settings/users',
          permission: 'user:read',
          description: 'Gestion des utilisateurs et groupes par territoires',
        },
        {
          title: 'Roles',
          type: 'basic',
          id: 'teams_territories_roles',
          link: '/settings/roles',
          permission: 'role:read',
          description: 'Gestion des utilisateurs et groupes par territoires',
        },
        {
          title: 'Agences',
          type: 'basic',
          id: 'teams_territories_agencies',
          link: '/settings/agencies',
          permission: 'agency:read',
          description: "Gestion des agences de l'organisation",
        },
        {
          title: 'Territoires',
          type: 'basic',
          id: 'teams_territories_territory',
          link: '/settings/territories',
          permission: 'territory:read',
          description: 'Gestion des utilisateurs et groupes par territoires',
        },
      ],
    },
    {
      title: 'Leads, Contacts & Compte',
      type: 'group',
      description: 'Gestion des personnes et vos différents clients',
      id: 'leads_contacts_compte',
      children: [
        {
          title: 'Sources & Campagnes',
          type: 'basic',
          id: 'leads_contacts_sources',
          link: '/settings/lead-sources',
          permission: 'lead:source:read',
          description: "Gérer les sources d'acquisition et campagnes de leads",
        },
        {
          title: 'Segmentation des clients',
          type: 'basic',
          id: 'leads_contacts_client_segments',
          link: '/settings/client-segments',
          permission: 'customers:update_sensitive',
          description:
            'Définir et ordonner les règles qui classent automatiquement les clients par segment',
        },
        {
          title: 'Formulaires de qualification',
          type: 'basic',
          id: 'leads_contacts_qualification_templates',
          link: '/settings/qualification-templates',
          permission: 'lead:qualification-template:manage',
          description:
            'Configurer les formulaires de qualification par produit (sections, questions, règles conditionnelles)',
        },
        {
          title: 'Étapes du pipeline',
          type: 'basic',
          id: 'leads_contacts_pipeline_stages',
          link: '/settings/pipeline-stages',
          permission: 'lead:pipeline-stage:read',
          description:
            'Définir, réordonner et activer/désactiver les étapes du pipeline commercial',
        },
        {
          title: 'Règles de scoring',
          type: 'basic',
          id: 'leads_contacts_scoring',
          link: '/settings/scoring-configs',
          permission: 'lead:scoring-config:read',
          description: 'Ajuster les poids et seuils du calcul de Lead Score',
        },
        {
          title: 'SLA & Calendrier ouvré',
          type: 'basic',
          id: 'leads_contacts_sla',
          link: '/settings/sla-configs',
          permission: 'lead:sla-config:read',
          description:
            'Définir les délais SLA par agence et le calendrier ouvré',
        },
        {
          title: 'Types de tâches',
          type: 'basic',
          id: 'activities_task_types',
          link: '/settings/task-types',
          permission: 'lead:task-type:read',
          description:
            'Définir les types de tâches, priorités par défaut et résultats obligatoires',
        },
      ],
    },
    {
      title: 'Produits & Services',
      type: 'group',
      id: 'products_services',
      description: 'Gestion des produits et services',
      children: [
        {
          title: 'Produits',
          type: 'basic',
          id: 'products_services_products',
          link: '/settings/products',
          permission: 'product:read',
          description: 'Gérer les produits et services des votre entreprise',
        },
      ],
    },
    {
      title: 'Données & Importation',
      type: 'group',
      isActive: false,
      id: 'data_import',
      description: 'Gestion des importations des leads, contacts, utilisateurs',
      children: [
        {
          title: 'Importer les utilisateurs',
          type: 'basic',
          id: 'data_import_users',
          link: '/settings/import-users',
          permission: 'user:create',
          description: 'Importer les utilisateurs depuis différentes sources',
        },
        {
          title: 'Importer les clients',
          type: 'basic',
          id: 'data_import_clients',
          link: '/customers/import-clients',
          permission: 'customers:create',
          description: 'Importer les clients depuis un fichier CSV/Excel ou Google Sheets',
        },
        {
          title: 'Importer les leads',
          type: 'basic',
          id: 'data_import_leads',
          // La page vit dans le module Leads, pas dans Paramétrage : l'assistant appartient au
          // domaine lead et sert aussi au drawer de la liste. `/settings/import-contacts` était un
          // lien mort.
          link: '/leads/import',
          permission: 'lead:import',
          description: 'Importer des leads depuis un fichier, Google Sheets ou Google Contacts',
        }
      ],
    },
    {
      title: 'Canaux de communication',
      type: 'group',
      id: 'channels',
      description:
        'Gérer vos differents canaux de communication avec vos prospect, clients.',
      children: [
        {
          title: 'Fournisseur Email',
          type: 'basic',
          id: 'channels_notifications',
          link: '/settings/notifications',
          permission: [
            'notification:settings:read',
            'notification:outbox:read',
          ],
          description:
            "Fournisseur d'envoi, expéditeur, quota mensuel et journal de livraison",
        },
        {
          title: "Modèles d'e-mail",
          type: 'basic',
          id: 'channels_email_templates',
          link: '/settings/email-templates',
          permission: 'notification:template:read',
          description:
            "Créer et personnaliser les modèles d'e-mail transactionnels et marketing",
        },
        {
          title: 'WhatsApp Business',
          type: 'basic',
          id: 'communication_channels_whatsapp',
          link: '/settings/whatsapp-configuration',
          description: 'Configurer votre compte whatsapp entreprise.',
        },
        {
          title: 'Fournisseur SMS',
          type: 'basic',
          id: 'communication_channels_sms_provider',
          link: '/settings/whatsapp-configuration',
          description: "Configurer votre compte entreprise afin d'envoyer les sms a vos prospects et clients.",
        },
        {
          title: 'Téléphonie',
          type: 'basic',
          id: 'communication_channels_telephony',
          link: '/settings/telephony',
          description:
            'Configurer votre système de téléphonie (Twilio, RingOver, Asterisk).',
        },
      ],
    },
    {
      title: 'Sécurité & Conformité',
      type: 'group',
      id: 'security_compliance',
      description:
        "Supervision des activités et traçabilité des actions sur l'organisation",
      children: [
        {
          title: 'Paramètres KYC',
          type: 'basic',
          id: 'security_kyc_settings',
          link: '/settings/kyc',
          permission: 'kyc:read',
          description:
            "Plafonds du KYC simplifié, seuils d'alerte, périodicité de revue et tentatives de comparaison faciale",
        },
        {
          title: "Journal d'audit",
          type: 'basic',
          id: 'security_audit',
          link: '/settings/audit',
          permission: 'audit:read',
          description:
            "Consulter l'historique des actions effectuées par les utilisateurs",
        },
      ],
    },
    {
      title: 'Réglages de compte',
      type: 'group',
      id: 'account_settings',
      description:
        'Paramétrage global du compte, facturation, et souscription ',
      children: [
        {
          title: "Informations de l'organisation",
          type: 'basic',
          id: 'account_settings_company',
          link: '/settings/company',
          permission: 'company:read',
          description:
            "Nom, logo, langue par défaut et couleurs de l'organisation",
        },
        {
          title: 'Monnaie',
          type: 'basic',
          id: 'account_settings_currency',
          link: '/settings/currency',
          description: 'Gérer les differentes devises et monnaie',
        },
        {
          title: 'Tags',
          type: 'basic',
          id: 'account_settings_tags',
          link: '/settings/tags',
          description: "Gérer l'ensemble des tags",
        },
        {
          title: 'Intégrations',
          type: 'basic',
          id: 'account_settings_integrations',
          link: '/settings/integrations',
          permission: 'lead:source:read',
          description:
            'Connecter des services externes (WhatsApp, téléphonie, CBS, webhooks)',
        },
        {
          title: 'Plan et Facturation',
          type: 'basic',
          id: 'account_settings_billing',
          link: '/settings/plan-facturation',
          description: 'Gerer vos plan et facturations',
        },
      ],
    },
  ];

  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);

  public menus = computed<MenuItem[]>(() => {
    const granted = this._permissions.granted();
    const allowed = (item: MenuItem): boolean => {
      if (!item.permission) return true;
      const codes = Array.isArray(item.permission)
        ? item.permission
        : [item.permission];
      return codes.some((c) => granted.has(c));
    };

    return this.menuData
      .map((group) => ({
        ...group,
        children: (group.children ?? []).filter(allowed),
      }))
      .filter((group) => allowed(group) && group.children.length > 0);
  });

  public selectedMenu = signal<MenuItem>(this.menuData[0]);

  constructor() {
    // Le groupe sélectionné doit rester un groupe visible.
    effect(() => {
      const visible = this.menus();
      if (visible.length === 0) return;
      if (!visible.some((g) => g.id === this.selectedMenu().id)) {
        this.selectedMenu.set(visible[0]);
      }
    });
  }

  public ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage' }]);
  }

  public toggleSelectedMenuGroup(item: MenuItem) {
    this.selectedMenu.set(item);
  }
}

export default OverviewComponent;
