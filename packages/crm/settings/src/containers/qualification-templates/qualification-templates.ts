import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { LeadsApiService, QualificationTemplateDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { CreateQualificationTemplateComponent } from './create-qualification-template/create-qualification-template';
import { statusSeverity, statusLabel, productLabel, productVersionNumbers } from './qualification-template.models';

@Component({
  selector: 'qualification-templates-list',
  imports: [TasTable, TasIcon, TasTag, Button],
  template: `
    <div class="flex flex-col gap-4 pb-6">
      <div class="flex items-start justify-between gap-3">
        <p class="text-sm text-slate-500">Configurez les formulaires de qualification par produit.</p>
        @if (canManage()) {
          <button tas-raised-button color="primary" type="button" (click)="navigateToCreate()">
            <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
            Nouveau formulaire
          </button>
        }
      </div>

      <tas-table [data]="templates()" identifierField="id" [config]="tableConfig" [hasCaption]="false" [isLoading]="isLoading()">
        <ng-template #header>
          <tr class="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <th class="py-2.5 pl-4">Formulaire</th>
            <th class="py-2.5">Statut</th>
            <th class="py-2.5">Produit</th>
            <th class="py-2.5">Contenu</th>
            <th class="py-2.5 pr-4 text-right"></th>
          </tr>
        </ng-template>
        <ng-template #body let-tpl>
          <tr class="cursor-pointer transition-colors hover:bg-slate-50" (click)="navigateToEdit(tpl)">
            <td class="py-3 pl-4">
              <p class="text-sm font-semibold text-slate-800">{{ tpl.name }}</p>
              <p class="text-xs text-slate-400">
                @if (versionOf(tpl); as n) { Version {{ n }} } @else { Jamais publiée }
              </p>
            </td>
            <td class="py-3">
              <tas-tag [severity]="statusSeverity(tpl.status)">{{ statusLabel(tpl.status) }}</tas-tag>
            </td>
            <td class="py-3 text-sm text-slate-600">
              {{ productLabel(tpl.productCategory) }}
              @if (tpl.productCode) {
                <p class="text-xs text-slate-400">{{ tpl.productCode }}</p>
              }
            </td>
            <td class="py-3 text-xs text-slate-500 tabular-nums">
              {{ (tpl.questions ?? []).length }} question(s) · {{ (tpl.sections ?? []).length }} section(s)
            </td>
            <td class="py-3 pr-4" (click)="$event.stopPropagation()">
              <div class="flex items-center justify-end gap-2">
              @if (canManage() && tpl.status === 'Draft') {
                <button tas-outlined-button type="button" class="text-xs" (click)="publish(tpl)">
                  <tas-icon iconName="feather:send" style="font-size:12px"></tas-icon> Publier
                </button>
              }
              @if (canManage() && tpl.status === 'Published') {
                <button tas-outlined-button type="button" class="text-xs" (click)="archive(tpl)">
                  <tas-icon iconName="feather:archive" style="font-size:12px"></tas-icon> Archiver
                </button>
              }
              @if (canManage()) {
                <button tas-button iconButton type="button" (click)="duplicate(tpl)" aria-label="Dupliquer" title="Dupliquer">
                  <tas-icon iconName="feather:copy" style="font-size:14px" class="text-slate-500"></tas-icon>
                </button>
              }
              <button tas-button iconButton type="button" (click)="navigateToEdit(tpl)"
                      [attr.aria-label]="isReadonly(tpl) ? 'Voir' : 'Modifier'" [title]="isReadonly(tpl) ? 'Voir' : 'Modifier'">
                <tas-icon [iconName]="isReadonly(tpl) ? 'feather:eye' : 'feather:edit-2'" style="font-size:14px" class="text-slate-500"></tas-icon>
              </button>
              </div>
            </td>
          </tr>
        </ng-template>
      </tas-table>
    </div>
  `,
})
export class QualificationTemplatesList implements OnInit {
  private readonly _permissions = inject(PermissionsService);
  public readonly canManage = this._permissions.can('lead:qualification-template:manage');

  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly statusSeverity = statusSeverity;
  public readonly statusLabel = statusLabel;
  public readonly productLabel = productLabel;

  public isLoading = signal(true);
  public templates = signal<QualificationTemplateDto[]>([]);
  private readonly _versions = computed(() => productVersionNumbers(this.templates()));

  public readonly tableConfig: TableConfig = {
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 25, pageSizeOptions: [25, 50], totalElements: 0 },
  };

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Formulaires de qualification' },
    ]);
    this._load();
  }

  /**
   * La création se limite aux informations générales, dans un drawer : les
   * sections et les questions se configurent ensuite dans l'écran d'édition,
   * où l'on dispose de l'id du brouillon.
   */
  public navigateToCreate(): void {
    const ref = this._sideDrawerService.open<
      string,
      unknown,
      CreateQualificationTemplateComponent
    >(CreateQualificationTemplateComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((templateId) => {
      if (!templateId) return;
      this._router.navigate([
        '/settings/qualification-templates',
        templateId,
        'edit',
      ]);
    });
  }

  public navigateToEdit(tpl: QualificationTemplateDto): void {
    this._router.navigate(['/settings/qualification-templates', tpl.id, 'edit']);
  }

  /** Son numéro dans l'ordre de publication de son produit ; null pour un brouillon jamais publié. */
  public versionOf(tpl: QualificationTemplateDto): number | null {
    return this._versions().get(tpl.id ?? '') ?? null;
  }

  /** Même règle que dans l'écran d'édition : Published et Archived sont figés. */
  public isReadonly(tpl: QualificationTemplateDto): boolean {
    return tpl.status === 'Published' || tpl.status === 'Archived';
  }

  public publish(tpl: QualificationTemplateDto): void {
    this._confirmDialog.confirm({
      title: 'Publier ce formulaire ?',
      message: `Le formulaire « ${tpl.name} » deviendra actif pour le produit associé.`,
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Publier', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._leadsApi.publishQualificationTemplate(tpl.id!).pipe(
          catchError(() => { this._snackbar.error('Erreur', 'Publication échouée.'); return EMPTY; }),
        ).subscribe(() => { this._snackbar.success('Publié', 'Le formulaire est maintenant actif.'); this._load(); });
      },
    });
  }

  public archive(tpl: QualificationTemplateDto): void {
    this._confirmDialog.confirm({
      title: 'Archiver ce formulaire ?',
      message: `Le formulaire « ${tpl.name} » sera désactivé.`,
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Archiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._leadsApi.archiveQualificationTemplate(tpl.id!).pipe(
          catchError(() => { this._snackbar.error('Erreur', 'Archivage échoué.'); return EMPTY; }),
        ).subscribe(() => { this._snackbar.success('Archivé', 'Le formulaire a été archivé.'); this._load(); });
      },
    });
  }

  /**
   * Copie le formulaire, quel que soit son statut, dans un nouveau brouillon : c'est ainsi qu'on
   * prépare la version suivante d'un formulaire publié, qui ne se modifie plus. Le brouillon s'ouvre
   * aussitôt dans l'écran d'édition.
   */
  public duplicate(tpl: QualificationTemplateDto): void {
    const name = `${tpl.name ?? 'Formulaire'} (copie)`;
    this._confirmDialog.confirm({
      title: 'Dupliquer ce formulaire ?',
      message: `Un brouillon « ${name} » reprendra ses sections, ses questions et ses règles. Le formulaire d'origine ne change pas.`,
      closable: true, showCancelButton: true,
      acceptButtonProps: { label: 'Dupliquer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._leadsApi.duplicateQualificationTemplate(tpl.id!, name).pipe(
          catchError((error: HttpErrorResponse) => {
            const code = (error.error as { code?: string } | null)?.code;
            this._snackbar.error(
              'Duplication impossible',
              error.status === 404
                ? "Ce formulaire n'existe plus : rechargez la liste."
                : code === 'PRODUCT_CATEGORY_MODULE_DISABLED'
                  ? "La famille de produits de ce formulaire relève d'un module que l'institution n'a pas activé."
                  : error.status === 403
                    ? "Vous n'avez pas le droit de gérer les formulaires de qualification."
                    : 'Le formulaire n’a pas pu être dupliqué.',
            );
            return EMPTY;
          }),
        ).subscribe((id) => {
          this._snackbar.success('Formulaire dupliqué', `« ${name} » est en brouillon.`);
          this._router.navigate(['/settings/qualification-templates', id, 'edit']);
        });
      },
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this._leadsApi.listQualificationTemplates().pipe(
      catchError(() => { this.isLoading.set(false); return EMPTY; }),
    ).subscribe((t) => { this.templates.set(t ?? []); this.isLoading.set(false); });
  }
}

export default QualificationTemplatesList;
