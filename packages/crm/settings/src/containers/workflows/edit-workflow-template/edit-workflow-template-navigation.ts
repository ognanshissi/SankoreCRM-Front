import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgClass } from '@angular/common';
import { Navigation } from '../../../components/navigation/navigation';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { WorkflowTemplateDto, WorkflowTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService, MenuItem } from '@sankore/crm/common';
import { entityTypeLabel } from '../workflow-shared';
import { Anchor } from '@talisoft/ui/button';

@Component({
  selector: 'edit-workflow-template-navigation',
  imports: [Navigation, RouterLink, NgClass, TasIcon, TasSpinner, Anchor],
  template: `
    <crm-navigation [menuItems]="menuItems()">
      <div tas-navigation-top>
        <div class="flex items-center gap-3 mb-2">
          <a [routerLink]="['/settings/workflows']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div class="flex-1 min-w-0">
            @if (isLoading()) {
              <div class="h-5 w-40 bg-slate-200 rounded animate-pulse"></div>
            } @else {
              <h1 class="text-lg font-semibold text-slate-900 truncate">
                {{ template()?.name ?? 'Modèle de workflow' }}
              </h1>
            }
          </div>
          @if (!isLoading() && template()) {
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0"
              [ngClass]="{
                'bg-green-100 text-green-700': template()!.isActive,
                'bg-yellow-100 text-yellow-700': !template()!.isActive,
              }"
            >
              {{ template()!.isActive ? 'Actif' : 'Brouillon' }}
            </span>
          }
        </div>
      </div>

      <div tas-navigation-info>
        @if (isLoading()) {
          <div class="p-4 flex justify-center">
            <tas-spinner size="5" class="text-primary"></tas-spinner>
          </div>
        } @else if (template()) {
          <div class="p-4 border-b border-gray-100">
            <p class="text-sm font-medium text-slate-800 truncate">
              {{ template()!.name ?? '—' }}
            </p>
            @if (template()!.description) {
              <p class="text-xs text-slate-500 mt-0.5 truncate">
                {{ template()!.description }}
              </p>
            }
            <p class="text-xs text-slate-400 mt-1">
              <tas-icon
                iconName="feather:layers"
                class="inline-block w-3 h-3 mr-1"
              ></tas-icon>
              {{ entityTypeLabel(template()!.entityType) }}
            </p>
          </div>
        }
      </div>
    </crm-navigation>
  `,
})
export class EditWorkflowTemplateNavigation {
  private readonly _workflowTemplatesApiService = inject(
    WorkflowTemplatesApiService,
  );
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();
  public readonly entityTypeLabel = entityTypeLabel;

  public isLoading = signal(true);
  public template = signal<WorkflowTemplateDto | null>(null);

  public menuItems = signal<MenuItem[]>([
    {
      label: 'Builder',
      icon: 'feather:git-branch',
      route: 'builder',
      active: true,
    },
    {
      label: 'Informations',
      icon: 'feather:info',
      route: 'informations',
      active: true,
    },
    { label: 'Étapes', icon: 'feather:list', route: 'etapes', active: true },
    {
      label: 'Déclencheurs',
      icon: 'feather:zap',
      route: 'declencheurs',
      active: true,
    },
    {
      label: 'Instances',
      icon: 'feather:activity',
      route: 'instances',
      active: true,
    },
  ]);

  constructor() {
    effect(() => {
      this._workflowTemplatesApiService
        .getWorkflowTemplate(this.id())
        .subscribe({
          next: (template) => {
            this.template.set(template);
            this.isLoading.set(false);
            this._breadcrumbService.set([
              { label: 'Paramétrage', link: ['/settings'] },
              { label: 'Workflows', link: ['/settings/workflows'] },
              { label: template.name ?? 'Modèle' },
            ]);
          },
          error: () => this.isLoading.set(false),
        });
    });
  }
}

export default EditWorkflowTemplateNavigation;
