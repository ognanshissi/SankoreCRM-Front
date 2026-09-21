import { Component, inject, signal } from '@angular/core';
import { TasTitle } from '@talisoft/ui/title';
import { TasText } from '@talisoft/ui/text';
import { NgClass, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { BreadcrumbService } from '@sankore/crm/common';

export interface MenuItem {
  title: string;
  icon?: string;
  id: string;
  link?: string;
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
  imports: [TasTitle, TasText, NgIf, NgClass, RouterLink],
})
export class OverviewComponent {
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
          description:
            'Définir les étapes de validation appliquées aux leads, contacts et opportunités',
        },
        {
          title: 'Stratégies d\'affectation',
          type: 'basic',
          id: 'groups_dispatching',
          link: '/settings/dispatch-rules',
          description: 'Configurer et simuler les stratégies d\'affectation automatique des leads',
        },
        {
          title: 'Utilisateurs',
          type: 'basic',
          id: 'teams_territories_users',
          link: '/settings/users',
          description: 'Gestion des utilisateurs et groupes par territoires',
        },
        {
          title: 'Roles',
          type: 'basic',
          id: 'teams_territories_roles',
          link: '/settings/roles',
          description: 'Gestion des utilisateurs et groupes par territoires',
        },
        {
          title: 'Agences',
          type: 'basic',
          id: 'teams_territories_agencies',
          link: '/settings/agencies',
          description: "Gestion des agences de l'organisation",
        },
        {
          title: 'Territoires',
          type: 'basic',
          id: 'teams_territories_territory',
          link: '/settings/territories',
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
          title: 'Capture de leads',
          type: 'basic',
          id: 'leads_contacts_capture',
          link: '/settings/lead-capture',
          description:
            'Configurer les intégrations pour capturer des leads (site web, LinkedIn, etc.)',
        },
        {
          title: 'Formulaires de qualification',
          type: 'basic',
          id: 'leads_contacts_qualification_templates',
          link: '/settings/qualification-templates',
          description: 'Configurer les formulaires de qualification par produit (sections, questions, règles conditionnelles)',
        },
        {
          title: 'Étapes du pipeline',
          type: 'basic',
          id: 'leads_contacts_pipeline_stages',
          link: '/settings/pipeline-stages',
          description: 'Définir, réordonner et activer/désactiver les étapes du pipeline commercial',
        },
        {
          title: 'Sources & Campagnes',
          type: 'basic',
          id: 'leads_contacts_sources',
          link: '/settings/lead-sources',
          description: 'Gérer les sources d\'acquisition et campagnes de leads',
        },
        {
          title: 'Règles de scoring',
          type: 'basic',
          id: 'leads_contacts_scoring',
          link: '/settings/scoring-configs',
          description: 'Ajuster les poids et seuils du calcul de Lead Score',
        },
        {
          title: 'SLA & Calendrier ouvré',
          type: 'basic',
          id: 'leads_contacts_sla',
          link: '/settings/sla-configs',
          description: 'Définir les délais SLA par agence et le calendrier ouvré',
        },
      ],
    },
    {
      title: 'Activités & Événements',
      type: 'group',
      id: 'activities_events',
      description: "Configurer les types d'événements et activités",
      children: [
        {
          title: "Types d'événements",
          type: 'basic',
          id: 'activities_event_types',
          link: '/settings/event-types',
          description:
            "Configurer les types d'événements (réunion, appel, démo...)",
        },
        {
          title: 'Types de tâches',
          type: 'basic',
          id: 'activities_task_types',
          link: '/settings/task-types',
          description: 'Définir les types de tâches, priorités par défaut et résultats obligatoires',
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
          description: 'Importer les utilisateurs depuis différentes sources',
        },
        {
          title: 'Importer les contacts',
          type: 'basic',
          id: 'data_import_contacts',
          link: '/settings/import-contacts',
          description: 'Importer les contacts depuis différentes sources',
        },
        {
          title: 'Importer les clients',
          type: 'basic',
          id: 'data_import_clients',
          link: '/settings/import-clients',
          description: 'Importer les clients depuis différentes sources',
        },
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
          title: 'Configuration notifications',
          type: 'basic',
          id: 'channels_notifications',
          link: '/settings/notifications',
          description: 'Fournisseur d\'envoi, expéditeur, quota mensuel et journal de livraison',
        },
        {
          title: 'Modèles d\'e-mail',
          type: 'basic',
          id: 'channels_email_templates',
          link: '/settings/email-templates',
          description: 'Créer et personnaliser les modèles d\'e-mail transactionnels et marketing',
        },
        {
          title: 'WhatsApp',
          type: 'basic',
          id: 'communication_channels_whatsapp',
          link: '/settings/whatsapp-configuration',
          description: 'Configurer votre compte whatsapp entreprise.',
        },
        {
          title: 'LinkedIn',
          type: 'basic',
          id: 'communication_channels_linkedin',
          link: '/settings/lead-capture',
          description: 'Récuperer les leads depuis vos posts LinkedIn.',
        },
        {
          title: 'Site internet',
          type: 'basic',
          id: 'communication_channels_website',
          link: '/settings/lead-capture',
          description: 'Créer des formulaires et les intégrer sur votre site.',
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
      description: "Supervision des activités et traçabilité des actions sur l'organisation",
      children: [
        {
          title: "Journal d'audit",
          type: 'basic',
          id: 'security_audit',
          link: '/settings/audit',
          description: "Consulter l'historique des actions effectuées par les utilisateurs",
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
          description: "Nom, logo, langue par défaut et couleurs de l'organisation",
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
          title: 'Webhooks',
          type: 'basic',
          id: 'account_settings_webhooks',
          link: '/settings/webhooks',
          description:
            'Utiliser des webhooks pour faire parvenir vos données dans differents services',
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

  private readonly _snackbarService = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public menus = signal<MenuItem[]>(this.menuData);

  public selectedMenu = signal<MenuItem>(this.menuData[0]);

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Paramétrage' }]);
  }

  public toggleSelectedMenuGroup(item: MenuItem) {
    this.selectedMenu.set(item);
  }
}

export default OverviewComponent;
