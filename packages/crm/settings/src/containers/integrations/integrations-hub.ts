import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Anchor, Button } from '@talisoft/ui/button';
import { BreadcrumbService } from '@sankore/crm/common';

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'communication' | 'capture' | 'banking' | 'data';
  status: 'connected' | 'configured' | 'available' | 'coming_soon';
  link: string | null;
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'email',
    name: 'E-mail (SMTP / SendGrid)',
    description: 'Fournisseur d\'envoi d\'e-mails transactionnels et marketing.',
    icon: 'feather:mail',
    category: 'communication',
    status: 'available',
    link: '/settings/notifications/parametrage',
  },
  {
    id: 'email-templates',
    name: 'Modèles d\'e-mail',
    description: 'Créer et personnaliser les modèles d\'e-mail.',
    icon: 'feather:layout',
    category: 'communication',
    status: 'available',
    link: '/settings/email-templates',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'Envoyer des messages et notifications via WhatsApp Business API.',
    icon: 'feather:message-circle',
    category: 'communication',
    status: 'coming_soon',
    link: null,
  },
  {
    id: 'telephony',
    name: 'Téléphonie (Twilio / RingOver)',
    description: 'Intégrer votre système de téléphonie pour les appels sortants et entrants.',
    icon: 'feather:phone-call',
    category: 'communication',
    status: 'coming_soon',
    link: null,
  },
  {
    id: 'sms',
    name: 'SMS',
    description: 'Envoyer des SMS de notification et de suivi aux leads et clients.',
    icon: 'feather:smartphone',
    category: 'communication',
    status: 'coming_soon',
    link: null,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Capturer des leads depuis vos publications et formulaires LinkedIn.',
    icon: 'feather:linkedin',
    category: 'capture',
    status: 'coming_soon',
    link: null,
  },
  {
    id: 'website',
    name: 'Formulaires web',
    description: 'Créer des formulaires de capture et les intégrer sur votre site internet.',
    icon: 'feather:globe',
    category: 'capture',
    status: 'available',
    link: '/settings/lead-sources',
  },
  {
    id: 'webhooks',
    name: 'Webhooks',
    description: 'Recevoir ou envoyer des données en temps réel vers des services externes.',
    icon: 'feather:zap',
    category: 'data',
    status: 'available',
    link: '/settings/webhooks',
  },
  {
    id: 'cbs',
    name: 'Core Banking (CBS)',
    description: 'Synchroniser les produits et clients avec votre système bancaire central.',
    icon: 'feather:database',
    category: 'banking',
    status: 'available',
    link: '/settings/products',
  },
  {
    id: 'import',
    name: 'Import de données',
    description: 'Importer des utilisateurs, contacts et clients depuis des fichiers CSV/Excel.',
    icon: 'feather:upload',
    category: 'data',
    status: 'available',
    link: '/settings/import-users',
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  communication: 'Communication',
  capture: 'Capture de leads',
  banking: 'Services bancaires',
  data: 'Données & Webhooks',
};

const CATEGORY_ORDER: string[] = ['communication', 'capture', 'banking', 'data'];

@Component({
  selector: 'integrations-hub',
  standalone: true,
  imports: [TasCard, TasIcon, TasTag, Button, RouterLink, Anchor],
  template: `
    <div class="pb-6">
      <!-- Header -->
      <div class="mb-6">
        <h1 class="text-lg font-semibold text-slate-800">Intégrations</h1>
        <p class="text-sm text-slate-500 mt-1">
          Connectez des services externes pour étendre les fonctionnalités de
          votre CRM.
        </p>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-3 gap-4 mb-6">
        <tas-card>
          <div class="p-4 flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center"
            >
              <tas-icon
                iconName="feather:check-circle"
                class="text-green-500"
                style="font-size:18px"
              ></tas-icon>
            </div>
            <div>
              <p class="text-xl font-semibold text-slate-800">
                {{ connectedCount() }}
              </p>
              <p class="text-xs text-slate-400">Disponibles</p>
            </div>
          </div>
        </tas-card>
        <tas-card>
          <div class="p-4 flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center"
            >
              <tas-icon
                iconName="feather:clock"
                class="text-amber-500"
                style="font-size:18px"
              ></tas-icon>
            </div>
            <div>
              <p class="text-xl font-semibold text-slate-800">
                {{ comingSoonCount() }}
              </p>
              <p class="text-xs text-slate-400">A venir</p>
            </div>
          </div>
        </tas-card>
        <tas-card>
          <div class="p-4 flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center"
            >
              <tas-icon
                iconName="feather:box"
                class="text-blue-500"
                style="font-size:18px"
              ></tas-icon>
            </div>
            <div>
              <p class="text-xl font-semibold text-slate-800">
                {{ totalCount() }}
              </p>
              <p class="text-xs text-slate-400">Total</p>
            </div>
          </div>
        </tas-card>
      </div>

      <!-- Categories -->
      @for (category of categories; track category) {
        <div class="mb-6">
          <h2 class="text-sm font-semibold text-slate-700 mb-3">
            {{ categoryLabel(category) }}
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            @for (item of integrationsByCategory(category); track item.id) {
              <tas-card>
                <div class="p-4 flex flex-col h-full">
                  <div class="flex items-start justify-between mb-3">
                    <div
                      class="w-10 h-10 rounded-lg flex items-center justify-center"
                      [class]="iconBgClass(item.status)"
                    >
                      <tas-icon
                        [iconName]="item.icon"
                        [class]="iconColorClass(item.status)"
                        style="font-size:18px"
                      ></tas-icon>
                    </div>
                    <tas-tag [severity]="statusSeverity(item.status)">
                      {{ statusLabel(item.status) }}
                    </tas-tag>
                  </div>
                  <p class="text-sm font-semibold text-slate-800 mb-1">
                    {{ item.name }}
                  </p>
                  <p class="text-xs text-slate-400 mb-4 flex-1">
                    {{ item.description }}
                  </p>
                  <div class="flex justify-end">
                    @if (item.link) {
                      <a
                        [routerLink]="item.link"
                        tas-outlined-button
                        color="primary"
                        class="text-xs"
                      >
                        <tas-icon
                          iconName="feather:settings"
                          style="font-size:12px"
                        ></tas-icon>
                        Configurer
                      </a>
                    } @else {
                      <button tas-outlined-button disabled class="text-xs">
                        <tas-icon
                          iconName="feather:clock"
                          style="font-size:12px"
                        ></tas-icon>
                        Bientôt disponible
                      </button>
                    }
                  </div>
                </div>
              </tas-card>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class IntegrationsHub implements OnInit {
  private readonly _breadcrumb = inject(BreadcrumbService);

  private readonly integrations = signal<Integration[]>(INTEGRATIONS);

  public readonly categories = CATEGORY_ORDER;

  public readonly connectedCount = signal(
    INTEGRATIONS.filter(
      (i) =>
        i.status === 'available' ||
        i.status === 'connected' ||
        i.status === 'configured',
    ).length,
  );
  public readonly comingSoonCount = signal(
    INTEGRATIONS.filter((i) => i.status === 'coming_soon').length,
  );
  public readonly totalCount = signal(INTEGRATIONS.length);

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations' },
    ]);
  }

  public integrationsByCategory(category: string): Integration[] {
    return this.integrations().filter((i) => i.category === category);
  }

  public categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category;
  }

  public statusSeverity(status: Integration['status']): Severity {
    switch (status) {
      case 'connected':
        return 'success';
      case 'configured':
        return 'info';
      case 'available':
        return 'neutral';
      case 'coming_soon':
        return 'warning';
    }
  }

  public statusLabel(status: Integration['status']): string {
    switch (status) {
      case 'connected':
        return 'Connecté';
      case 'configured':
        return 'Configuré';
      case 'available':
        return 'Disponible';
      case 'coming_soon':
        return 'A venir';
    }
  }

  public iconBgClass(status: Integration['status']): string {
    switch (status) {
      case 'connected':
        return 'bg-green-50';
      case 'configured':
        return 'bg-blue-50';
      case 'available':
        return 'bg-slate-100';
      case 'coming_soon':
        return 'bg-amber-50';
    }
  }

  public iconColorClass(status: Integration['status']): string {
    switch (status) {
      case 'connected':
        return 'text-green-500';
      case 'configured':
        return 'text-blue-500';
      case 'available':
        return 'text-slate-500';
      case 'coming_soon':
        return 'text-amber-400';
    }
  }
}

export default IntegrationsHub;
