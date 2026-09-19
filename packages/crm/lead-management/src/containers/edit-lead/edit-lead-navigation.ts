import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgClass } from '@angular/common';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Anchor } from '@talisoft/ui/button';
import { LeadsApiService, LeadDto } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Severity, TasTag } from '@talisoft/ui/tag';

interface LeadMenuItem {
  label: string;
  icon: string;
  route: string;
}

function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':       return { label: 'Nouveau',  severity: 'info' };
    case 'Contacted': return { label: 'Contacté', severity: 'warning' };
    case 'Qualified': return { label: 'Qualifié', severity: 'warning' };
    case 'Converted': return { label: 'Converti', severity: 'success' };
    case 'Lost':      return { label: 'Perdu',    severity: 'error' };
    case 'Expired':   return { label: 'Expiré',   severity: 'neutral' };
    default:          return { label: status ?? '—', severity: 'neutral' };
  }
}

@Component({
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    NgClass,
    TasIcon,
    TasCard,
    TasSpinner,
    Anchor,
    TasTag,
  ],
  template: `
    <!-- Header -->
    <div class="flex items-center gap-3 mb-4">
      <a [routerLink]="['/leads']" tas-button iconButton>
        <tas-icon iconName="feather:chevron-left"></tas-icon>
      </a>
      <div class="flex-1 min-w-0">
        @if (isLoading()) {
          <div class="h-5 w-48 bg-slate-200 rounded animate-pulse"></div>
        } @else {
          <h1 class="text-lg font-semibold text-slate-900 truncate">
            {{ displayName() }}
          </h1>
        }
      </div>
      @if (!isLoading() && lead()) {
        <tas-tag [severity]="statusMeta().severity">{{ statusMeta().label }}</tas-tag>
      }
    </div>

    <!-- Grid: sidebar + content -->
    <div class="grid grid-cols-4 gap-4">

      <!-- Sidebar -->
      <div class="col-span-1">
        <tas-card>
          <!-- Lead summary -->
          @if (isLoading()) {
            <div class="p-4 flex justify-center">
              <tas-spinner size="5" class="text-primary"></tas-spinner>
            </div>
          } @else if (lead()) {
            <div class="p-4 border-b border-gray-100">
              <p class="text-sm font-medium text-slate-800 truncate">{{ displayName() }}</p>
              @if (lead()!.email) {
                <p class="text-xs text-slate-500 mt-0.5 truncate">{{ lead()!.email }}</p>
              }
              @if (lead()!.phoneNumber) {
                <p class="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <tas-icon iconName="feather:phone" class="inline-block w-3 h-3"></tas-icon>
                  {{ lead()!.phoneNumber }}
                </p>
              }
              @if (lead()!.source) {
                <p class="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <tas-icon iconName="feather:globe" class="inline-block w-3 h-3"></tas-icon>
                  {{ lead()!.source }}
                </p>
              }
              @if (lead()!.score != null) {
                <div class="mt-2 flex items-center gap-1.5">
                  <span class="text-xs text-slate-400">Score</span>
                  <span class="text-sm font-semibold text-slate-700 tabular-nums">{{ lead()!.score }}</span>
                </div>
              }
            </div>
          }

          <!-- Menu items -->
          @for (item of menuItems; track item.route) {
            <a
              class="px-4 py-3 hover:bg-gray-200 flex items-center gap-2 text-sm"
              [routerLink]="item.route"
              [routerLinkActive]="'is-link-active'"
            >
              <tas-icon [iconName]="item.icon"></tas-icon>
              <span>{{ item.label }}</span>
            </a>
          }
        </tas-card>
      </div>

      <!-- Page content -->
      <div class="col-span-3 h-[calc(100vh_-_130px)] overflow-y-auto">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [
    `
      .is-link-active {
        background-color: rgba(var(--tas-color-primary), 0.2);
        color: var(--tas-color-primary);
      }
    `,
  ],
})
export class EditLeadNavigation {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);

  public readonly menuItems: LeadMenuItem[] = [
    { label: 'Informations', icon: 'feather:user', route: 'informations' },
    { label: 'Qualification', icon: 'feather:clipboard', route: 'qualification' },
    { label: 'Doublons', icon: 'feather:copy', route: 'doublons' },
    { label: 'Consentement', icon: 'feather:shield', route: 'consentement' },
    { label: 'Score', icon: 'feather:bar-chart-2', route: 'score' },
    { label: 'Activités', icon: 'feather:activity', route: 'activites' },
  ];

  constructor() {
    effect(() => {
      this._leadsApiService.getLead(this.id()).subscribe({
        next: (lead) => {
          this.lead.set(lead);
          this.isLoading.set(false);
          this._breadcrumbService.set([
            { label: 'Leads', link: ['/leads'] },
            { label: this._displayName(lead) },
          ]);
        },
        error: () => this.isLoading.set(false),
      });
    });
  }

  public displayName(): string {
    return this._displayName(this.lead());
  }

  public statusMeta(): { label: string; severity: Severity } {
    return leadStatusMeta(this.lead()?.status);
  }

  private _displayName(lead: LeadDto | null | undefined): string {
    if (!lead) return 'Lead';
    if (lead.fullName) return lead.fullName;
    const parts = [lead.firstName, lead.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : lead.phoneNumber ?? lead.email ?? 'Lead';
  }
}

export default EditLeadNavigation;
