import { Component, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { LeadsApiService, QualificationTemplateDto } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { statusSeverity, statusLabel, productLabel } from './qualification-template.models';

@Component({
  selector: 'qualification-templates-list',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else {
      <div class="pb-6">
        <div class="flex items-start justify-between mb-6">
          <div>
            <h1 class="text-lg font-semibold text-slate-800">Formulaires de qualification</h1>
            <p class="text-sm text-slate-500 mt-0.5">Configurez les formulaires de qualification par produit.</p>
          </div>
          <button tas-raised-button color="primary" type="button" (click)="navigateToCreate()">
            <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
            Nouveau formulaire
          </button>
        </div>

        @if (templates().length === 0) {
          <tas-card class="block">
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <tas-icon iconName="feather:clipboard" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
              <p class="text-sm text-slate-400">Aucun formulaire configuré</p>
              <p class="text-xs text-slate-400 mt-1">Créez votre premier formulaire pour démarrer la qualification des leads.</p>
            </div>
          </tas-card>
        } @else {
          <div class="flex flex-col gap-3">
            @for (tpl of templates(); track tpl.id) {
              <tas-card class="block">
                <div class="p-4 flex items-center gap-4">
                  <div class="flex-1 min-w-0 cursor-pointer" (click)="navigateToEdit(tpl)">
                    <div class="flex items-center gap-2">
                      <p class="text-sm font-semibold text-slate-800">{{ tpl.name }}</p>
                      <tas-tag [severity]="statusSeverity(tpl.status)">{{ statusLabel(tpl.status) }}</tas-tag>
                      <span class="text-[10px] text-slate-400">v{{ tpl.version }}</span>
                    </div>
                    <div class="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span>Produit : {{ productLabel(tpl.productType) }}</span>
                      <span>{{ (tpl.questions ?? []).length }} question(s)</span>
                      <span>{{ (tpl.sections ?? []).length }} section(s)</span>
                    </div>
                  </div>
                  @if (tpl.status === 'Draft') {
                    <button tas-outlined-button type="button" class="text-xs shrink-0" (click)="publish(tpl)">
                      <tas-icon iconName="feather:send" style="font-size:12px"></tas-icon> Publier
                    </button>
                  }
                  @if (tpl.status === 'Published') {
                    <button tas-outlined-button type="button" class="text-xs shrink-0" (click)="archive(tpl)">
                      <tas-icon iconName="feather:archive" style="font-size:12px"></tas-icon> Archiver
                    </button>
                  }
                  <button tas-outlined-button type="button" class="text-xs shrink-0" (click)="navigateToEdit(tpl)">
                    <tas-icon iconName="feather:edit-2" style="font-size:12px"></tas-icon>
                    {{ tpl.status === 'Published' ? 'Voir' : 'Modifier' }}
                  </button>
                </div>
              </tas-card>
            }
          </div>
        }
      </div>
    }
  `,
})
export class QualificationTemplatesList implements OnInit {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly statusSeverity = statusSeverity;
  public readonly statusLabel = statusLabel;
  public readonly productLabel = productLabel;

  public isLoading = signal(true);
  public templates = signal<QualificationTemplateDto[]>([]);

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Formulaires de qualification' },
    ]);
    this._load();
  }

  public navigateToCreate(): void {
    this._router.navigate(['/settings/qualification-templates/create']);
  }

  public navigateToEdit(tpl: QualificationTemplateDto): void {
    this._router.navigate(['/settings/qualification-templates', tpl.id, 'edit']);
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

  private _load(): void {
    this.isLoading.set(true);
    this._leadsApi.listQualificationTemplates().pipe(
      catchError(() => { this.isLoading.set(false); return EMPTY; }),
    ).subscribe((t) => { this.templates.set(t ?? []); this.isLoading.set(false); });
  }
}

export default QualificationTemplatesList;
