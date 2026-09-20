import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { Navigation } from '../../../components/navigation/navigation';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { WorkflowTemplateDto, WorkflowTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService, MenuItem } from '@sankore/crm/common';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { entityTypeLabel } from '../workflow-shared';
import { Anchor, Button } from '@talisoft/ui/button';

@Component({
  selector: 'edit-workflow-template-navigation',
  imports: [
    Navigation,
    RouterLink,
    TasIcon,
    TasSpinner,
    Anchor,
    Button,
  ],
  template: `
    <crm-navigation [menuItems]="menuItems()">
      <div tas-navigation-top>
        <!-- Row 1: back + title + status badge -->
        <div class="flex items-center gap-2 mb-1">
          <a [routerLink]="['/settings/workflows']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div class="flex-1 min-w-0">
            @if (isLoading()) {
              <div class="h-5 w-40 bg-slate-200 rounded animate-pulse"></div>
            } @else {
              <h1 class="text-base font-semibold text-slate-900 truncate">
                {{ template()?.name ?? 'Modèle de workflow' }}
              </h1>
            }
          </div>
          <!-- Row 2: actions -->
          @if (!isLoading() && template()) {
            <div class="flex items-center gap-1.5">
              <button
                tas-raised-button
                color="primary"
                type="button"
                size="small"
                [disabled]="isTogglingStatus()"
                [isLoading]="isTogglingStatus()"
                (click)="toggleStatus()"
              >
                <tas-icon
                  [iconName]="
                    template()!.isActive
                      ? 'feather:pause-circle'
                      : 'feather:play-circle'
                  "
                  iconSize="sm"
                ></tas-icon>
                {{ template()!.isActive ? 'Désactiver' : 'Activer' }}
              </button>
              @if (template()!.isActive) {
                <button
                  tas-outlined-button
                  color="primary"
                  type="button"
                  size="small"
                  [disabled]="isCreatingDraft()"
                  [isLoading]="isCreatingDraft()"
                  (click)="createDraft()"
                  title="Créer un brouillon modifiable"
                >
                  Créer un brouillon &nbsp;
                  <tas-icon iconName="feather:copy" iconSize="sm"></tas-icon>
                </button>
              }
            </div>
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
              @if (template()!.version) {
                · v{{ template()!.version }}
              }
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
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();
  public readonly entityTypeLabel = entityTypeLabel;

  public isLoading = signal(true);
  public isTogglingStatus = signal(false);
  public isCreatingDraft = signal(false);
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
    {
      label: 'Analytiques',
      icon: 'feather:bar-chart-2',
      route: 'analytiques',
      active: true,
    },
    {
      label: 'Comparer',
      icon: 'feather:git-merge',
      route: 'comparer',
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

  public toggleStatus(): void {
    const t = this.template();
    if (!t) return;
    this.isTogglingStatus.set(true);
    const request$ = t.isActive
      ? this._workflowTemplatesApiService.deactivateWorkflowTemplate(this.id())
      : this._workflowTemplatesApiService.activateWorkflowTemplate(this.id());
    request$
      .pipe(
        catchError((error) => {
          this._snackbar.error(
            'Erreur',
            error.error.detail ??
              `Impossible de ${t.isActive ? 'désactiver' : 'activer'} le modèle.`,
          );
          this.isTogglingStatus.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.template.update((tpl) =>
          tpl ? { ...tpl, isActive: !tpl.isActive } : tpl,
        );
        this._snackbar.success(
          'Succès',
          t.isActive ? 'Modèle désactivé.' : 'Modèle activé.',
        );
        this.isTogglingStatus.set(false);
      });
  }

  public createDraft(): void {
    this.isCreatingDraft.set(true);
    this._workflowTemplatesApiService
      .createWorkflowTemplateDraft(this.id())
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de créer le brouillon.');
          this.isCreatingDraft.set(false);
          return EMPTY;
        }),
      )
      .subscribe((draftId) => {
        this.isCreatingDraft.set(false);
        this._snackbar.success('Succès', 'Brouillon créé.');
        if (draftId) {
          this._router.navigate(['/settings/workflows', draftId]);
        }
      });
  }
}

export default EditWorkflowTemplateNavigation;
