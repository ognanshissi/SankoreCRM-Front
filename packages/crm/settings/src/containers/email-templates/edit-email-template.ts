import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EmailTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { EmailEditorPreview } from './email-editor-preview';
import { EmailTemplate } from './email-templates';
import { generateTextFromHtml, EmailTemplateOptions } from './email-html-generator';

@Component({
  selector: 'edit-email-template',
  imports: [
    FormsModule, RouterLink, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasSwitch, TasFormField, TasLabel, TasInput, EmailEditorPreview,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else if (template()) {
      <div class="pb-6 flex flex-col gap-4" style="height: calc(100vh - 80px);">
        <!-- Header -->
        <div class="flex items-center justify-between shrink-0">
          <div class="flex items-center gap-3">
            <a [routerLink]="['/settings/email-templates']" tas-button iconButton>
              <tas-icon iconName="feather:chevron-left"></tas-icon>
            </a>
            <div class="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
              <tas-icon iconName="feather:mail" class="text-indigo-500" style="font-size:15px"></tas-icon>
            </div>
            <div class="min-w-0">
              <h1 class="text-lg font-semibold text-slate-800 truncate">{{ editSubject() || '(sans sujet)' }}</h1>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-xs font-mono text-slate-400">{{ template()!.templateKey }}</span>
                <tas-tag severity="info">{{ template()!.locale }}</tas-tag>
                @if (template()!.isGlobal) { <tas-tag severity="neutral">Global</tas-tag> }
                @if (!template()!.isActive) { <tas-tag severity="warning">Inactif</tas-tag> }
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <!-- Template options toggle -->
            <button
              class="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors"
              [class]="showOptions()
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-slate-200 text-slate-500 hover:bg-slate-50'"
              (click)="showOptions.set(!showOptions())"
            >
              <tas-icon iconName="feather:settings" style="font-size:12px"></tas-icon>
              Options
            </button>
            <div class="flex items-center gap-2 mr-1">
              <tas-switch
                [checked]="template()!.isActive ?? false"
                ariaLabel="Activer ou desactiver"
                [isLoading]="isToggling()"
                (toggle)="toggleActive()"
              ></tas-switch>
              <span class="text-xs text-slate-500">{{ template()!.isActive ? 'Actif' : 'Inactif' }}</span>
            </div>
            <button
              tas-raised-button
              color="primary"
              type="button"
              [disabled]="isSaving()"
              [isLoading]="isSaving()"
              (click)="save()"
            >
              <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
              Enregistrer
            </button>
          </div>
        </div>

        <!-- Subject + Options bar -->
        <tas-card class="shrink-0 block">
          <div class="p-3 flex items-end gap-3">
            <tas-form-field class="flex-1">
              <tas-label>Sujet</tas-label>
              <input tasInput type="text" [ngModel]="editSubject()" (ngModelChange)="editSubject.set($event)" />
            </tas-form-field>
            <div class="flex items-center gap-4 pb-1 text-xs text-slate-400">
              <span>Cle : <span class="font-mono text-slate-600">{{ template()!.templateKey }}</span></span>
              <span>Locale : <span class="font-medium text-slate-600">{{ template()!.locale }}</span></span>
            </div>
          </div>

          @if (showOptions()) {
            <div class="px-3 pb-3 pt-1 border-t border-slate-100">
              <p class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2 mt-2">Personnalisation du template</p>
              <div class="grid grid-cols-4 gap-3">
                <tas-form-field>
                  <tas-label>Nom de l'entreprise</tas-label>
                  <input tasInput type="text" [ngModel]="optCompanyName()" (ngModelChange)="optCompanyName.set($event)" />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Couleur principale</tas-label>
                  <div class="flex items-center gap-2">
                    <input
                      type="color"
                      class="w-8 h-8 rounded border border-slate-200 cursor-pointer p-0"
                      [ngModel]="optPrimaryColor()"
                      (ngModelChange)="optPrimaryColor.set($event)"
                    />
                    <input tasInput type="text" [ngModel]="optPrimaryColor()" (ngModelChange)="optPrimaryColor.set($event)" class="font-mono text-xs" />
                  </div>
                </tas-form-field>
                <tas-form-field>
                  <tas-label>URL du logo</tas-label>
                  <input tasInput type="text" placeholder="https://..." [ngModel]="optLogoUrl()" (ngModelChange)="optLogoUrl.set($event)" />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Preheader</tas-label>
                  <input tasInput type="text" placeholder="Texte d'apercu" [ngModel]="optPreheader()" (ngModelChange)="optPreheader.set($event)" />
                </tas-form-field>
              </div>
              <tas-form-field class="mt-2">
                <tas-label>Texte du pied de page</tas-label>
                <input tasInput type="text" [ngModel]="optFooterText()" (ngModelChange)="optFooterText.set($event)" />
              </tas-form-field>
            </div>
          }
        </tas-card>

        <!-- Editor + Preview -->
        <div class="flex-1 min-h-0 rounded-lg border border-slate-200 overflow-hidden">
          <email-editor-preview
            [subject]="editSubject()"
            [htmlBody]="editHtmlBody()"
            [textBody]="editTextBody()"
            [templateOptions]="templateOptions()"
            (htmlBodyChange)="editHtmlBody.set($event)"
            (textBodyChange)="editTextBody.set($event)"
            (emailHtmlGenerated)="generatedHtml.set($event)"
          ></email-editor-preview>
        </div>
      </div>
    }
  `,
})
export class EditEmailTemplatePage {
  private readonly _api = inject(EmailTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isSaving = signal(false);
  public isToggling = signal(false);
  public showOptions = signal(false);
  public template = signal<EmailTemplate | null>(null);
  public generatedHtml = signal('');

  public editSubject = signal('');
  public editHtmlBody = signal('');
  public editTextBody = signal('');

  // Template options
  public optCompanyName = signal('Sankore CRM');
  public optPrimaryColor = signal('#6366f1');
  public optLogoUrl = signal('');
  public optPreheader = signal('');
  public optFooterText = signal('Cet e-mail a ete envoye automatiquement. Merci de ne pas repondre directement.');

  public templateOptions = computed<Partial<EmailTemplateOptions>>(() => ({
    companyName: this.optCompanyName(),
    primaryColor: this.optPrimaryColor(),
    logoUrl: this.optLogoUrl(),
    preheader: this.optPreheader(),
    footerText: this.optFooterText(),
  }));

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._api.apiV1EmailTemplatesIdGet(this.id()).subscribe({
        next: (tpl: EmailTemplate) => {
          this.template.set(tpl);
          this.editSubject.set(tpl.subject ?? '');
          this.editHtmlBody.set(tpl.htmlBody ?? '');
          this.editTextBody.set(tpl.textBody ?? '');
          this.isLoading.set(false);
          this._breadcrumbService.set([
            { label: 'Parametrage', link: ['/settings'] },
            { label: "Modeles d'e-mail", link: ['/settings/email-templates'] },
            { label: tpl.subject ?? tpl.templateKey ?? 'Modele' },
          ]);
        },
        error: () => {
          this._snackbar.error('Erreur', 'Impossible de charger le modele.');
          this.isLoading.set(false);
        },
      });
    });

  }

  public save(): void {
    this.isSaving.set(true);

    // Auto-generate text if empty
    const textBody = this.editTextBody() || generateTextFromHtml(this.editHtmlBody());

    this._api.apiV1EmailTemplatesIdPut(this.id(), {
      subject: this.editSubject(),
      htmlBody: this.generatedHtml() || undefined,
      textBody: textBody || undefined,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de mettre a jour le modele.');
        this.isSaving.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Modele mis a jour', 'Les modifications ont ete enregistrees.');
      this.template.update((t) =>
        t ? { ...t, subject: this.editSubject(), htmlBody: this.generatedHtml(), textBody: textBody } : t,
      );
      this.isSaving.set(false);
    });
  }

  public toggleActive(): void {
    this.isToggling.set(true);
    this._api.apiV1EmailTemplatesIdActivatePatch(this.id()).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Operation echouee.');
        this.isToggling.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.template.update((t) => t ? { ...t, isActive: !t.isActive } : t);
      this._snackbar.success('Succes', `Modele ${this.template()?.isActive ? 'active' : 'desactive'}.`);
      this.isToggling.set(false);
    });
  }
}

export default EditEmailTemplatePage;
