import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Button, Anchor } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTag } from '@talisoft/ui/tag';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { WorkflowTemplateDto, WorkflowTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { CreateWorkflowTemplateComponent } from '../create-workflow-template/create-workflow-template';
import { entityTypeLabel } from '../workflow-shared';

type StatusFilter = 'all' | 'active' | 'draft';

@Component({
  templateUrl: './workflows-homepage.html',
  imports: [RouterLink, Button, Anchor, TasIcon, TasCard, TasTag, TasTable, TimeagoPipe],
})
export class WorkflowsHomePage {
  private readonly _workflowTemplatesApiService = inject(WorkflowTemplatesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly entityTypeLabel = entityTypeLabel;

  public isLoading = signal(false);
  public templates = signal<WorkflowTemplateDto[]>([]);
  public searchQuery = signal('');
  public statusFilter = signal<StatusFilter>('all');

  public readonly statusFilters: { label: string; value: StatusFilter }[] = [
    { label: 'Tous', value: 'all' },
    { label: 'Actifs', value: 'active' },
    { label: 'Brouillons', value: 'draft' },
  ];

  public filteredTemplates = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const filter = this.statusFilter();

    return this.templates().filter((t) => {
      if (filter === 'active' && !t.isActive) return false;
      if (filter === 'draft' && t.isActive) return false;
      if (!query) return true;
      return (
        (t.name ?? '').toLowerCase().includes(query) ||
        entityTypeLabel(t.entityType).toLowerCase().includes(query)
      );
    });
  });

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [5, 10, 30, 50],
    },
  });

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Workflows' },
    ]);
    this.loadTemplates();
  }

  public loadTemplates(): void {
    this.isLoading.set(true);
    this._workflowTemplatesApiService.listWorkflowTemplates().subscribe({
      next: (result) => {
        this.templates.set(result ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  public setStatusFilter(filter: StatusFilter): void {
    this.statusFilter.set(filter);
  }

  public onSearchChange(query: string): void {
    this.searchQuery.set(query);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateWorkflowTemplateComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (result) {
        this._router.navigate(['/settings/workflows', result]);
      }
    });
  }

  public navigateToEdit(template: WorkflowTemplateDto): void {
    this._router.navigate(['/settings/workflows', template.id]);
  }

  public stepCount(template: WorkflowTemplateDto): number {
    return template.steps?.length ?? 0;
  }
}

export default WorkflowsHomePage;
