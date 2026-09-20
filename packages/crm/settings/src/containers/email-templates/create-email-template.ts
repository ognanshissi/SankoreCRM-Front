import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EmailTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { EmailEditorPreview } from './email-editor-preview';
import { generateTextFromHtml, EmailTemplateOptions } from './email-html-generator';

const LOCALE_OPTIONS = [
  { label: 'Francais', value: 'fr' },
  { label: 'Anglais', value: 'en' },
  { label: 'Arabe', value: 'ar' },
  { label: 'Portugais', value: 'pt' },
];

@Component({
  selector: 'create-email-template',
  imports: [
    FormsModule, RouterLink, TasCard, TasIcon, Button, TasSwitch,
    TasFormField, TasLabel, TasInput, TasSelect, EmailEditorPreview,
  ],
  template: `
    <div class="pb-6 flex flex-col gap-4" style="height: calc(100vh - 80px);">
      <!-- Header -->
      <div class="flex items-center justify-between shrink-0">
        <div class="flex items-center gap-3">
          <a [routerLink]="['/settings/email-templates']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div>
            <h1 class="text-lg font-semibold text-slate-800">Nouveau modele d'e-mail</h1>
            <p class="text-xs text-slate-400 mt-0.5">Redigez le contenu et visualisez le rendu final en temps reel.</p>
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
          <a [routerLink]="['/settings/email-templates']" tas-outlined-button color="primary">
            Annuler
          </a>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="isSubmitting() || !templateKey() || !locale() || !subject()"
            [isLoading]="isSubmitting()"
            (click)="create()"
          >
            <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
            Creer le modele
          </button>
        </div>
      </div>

      <!-- Identification + Options bar -->
      <tas-card class="shrink-0 block">
        <div class="p-3 flex items-end gap-3">
          <tas-form-field>
            <tas-label>Cle du modele <span class="text-red-500">*</span></tas-label>
            <input tasInput type="text" placeholder="Ex : WELCOME_EMAIL" [ngModel]="templateKey()" (ngModelChange)="templateKey.set($event)" />
          </tas-form-field>
          <tas-form-field>
            <tas-label>Locale <span class="text-red-500">*</span></tas-label>
            <tas-select
              [options]="localeOptions"
              [ngModel]="locale()"
              (ngModelChange)="locale.set($event)"
            ></tas-select>
          </tas-form-field>
          <tas-form-field class="flex-1">
            <tas-label>Sujet <span class="text-red-500">*</span></tas-label>
            <input tasInput type="text" placeholder="Objet de l'e-mail" [ngModel]="subject()" (ngModelChange)="subject.set($event)" />
          </tas-form-field>
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
                <input tasInput type="text" placeholder="Texte d'apercu dans la boite de reception" [ngModel]="optPreheader()" (ngModelChange)="optPreheader.set($event)" />
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
          [subject]="subject()"
          [htmlBody]="htmlBody()"
          [textBody]="textBody()"
          [templateOptions]="templateOptions()"
          (htmlBodyChange)="htmlBody.set($event)"
          (textBodyChange)="textBody.set($event)"
          (emailHtmlGenerated)="generatedHtml.set($event)"
        ></email-editor-preview>
      </div>
    </div>
  `,
})
export class CreateEmailTemplatePage implements OnInit {
  private readonly _api = inject(EmailTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly localeOptions = LOCALE_OPTIONS;

  public templateKey = signal('');
  public locale = signal('fr');
  public subject = signal('');
  public htmlBody = signal('');
  public textBody = signal('');
  public isGlobal = signal(false);
  public isSubmitting = signal(false);
  public showOptions = signal(false);
  public generatedHtml = signal('');

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

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Parametrage', link: ['/settings'] },
      { label: "Modeles d'e-mail", link: ['/settings/email-templates'] },
      { label: 'Nouveau' },
    ]);
  }

  public create(): void {
    if (!this.templateKey() || !this.locale() || !this.subject()) return;
    this.isSubmitting.set(true);

    // Auto-generate text if empty
    const textBody = this.textBody() || generateTextFromHtml(this.htmlBody());

    this._api.apiV1EmailTemplatesPost({
      templateKey: this.templateKey(),
      locale: this.locale(),
      subject: this.subject(),
      htmlBody: this.generatedHtml() || undefined,
      textBody: textBody || undefined,
      isGlobal: this.isGlobal(),
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de creer le modele.');
        this.isSubmitting.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Modele cree', `Le modele « ${this.templateKey()} » a ete cree.`);
      this._router.navigate(['/settings/email-templates']);
    });
  }
}

export default CreateEmailTemplatePage;
