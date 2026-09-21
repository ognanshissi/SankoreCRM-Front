import { Component, computed, effect, inject, input, signal, linkedSignal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EmailTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService, TenantProvider } from '@sankore/crm/common';
import { EmailEditorPreview } from './email-editor-preview';
import { EmailTemplate } from './email-templates';
import { generateTextFromHtml, EmailTemplateOptions } from './email-html-generator';

const LOCALE_OPTIONS = [
  { label: 'Français', value: 'fr' },
  { label: 'Anglais', value: 'en' },
  { label: 'Arabe', value: 'ar' },
  { label: 'Portugais', value: 'pt' },
];

@Component({
  selector: 'edit-email-template',
  imports: [
    FormsModule,
    RouterLink,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    Anchor,
    TasSwitch,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    EmailEditorPreview,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4" style="height: calc(100vh - 80px);">
        <!-- Header -->
        <div class="flex items-center justify-between shrink-0">
          <div class="flex items-center gap-3">
            <a
              [routerLink]="['/settings/email-templates']"
              tas-button
              iconButton
            >
              <tas-icon iconName="feather:chevron-left"></tas-icon>
            </a>
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              [class]="isCreateMode() ? 'bg-green-50' : 'bg-indigo-50'"
            >
              <tas-icon
                [iconName]="
                  isCreateMode() ? 'feather:plus-circle' : 'feather:mail'
                "
                [class]="isCreateMode() ? 'text-green-500' : 'text-indigo-500'"
                style="font-size:15px"
              ></tas-icon>
            </div>
            <div class="min-w-0">
              <h1 class="text-lg font-semibold text-slate-800 truncate">
                {{
                  isCreateMode()
                    ? "Nouveau modèle d'e-mail"
                    : editSubject() || '(sans sujet)'
                }}
              </h1>
              @if (!isCreateMode()) {
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-xs font-mono text-slate-400">{{
                    template()?.templateKey
                  }}</span>
                  <tas-tag severity="info">{{ template()?.locale }}</tas-tag>
                  @if (isSystemTemplate()) {
                    <tas-tag severity="accent">Système</tas-tag>
                  }
                  @if (template()?.isGlobal) {
                    <tas-tag severity="neutral">Global</tas-tag>
                  }
                  @if (!template()?.isActive) {
                    <tas-tag severity="warning">Inactif</tas-tag>
                  }
                </div>
              } @else {
                <p class="text-xs text-slate-400 mt-0.5">
                  Rédigez le contenu et visualisez le rendu en temps réel.
                </p>
              }
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button
              class="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors"
              [class]="
                showOptions()
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              "
              (click)="showOptions.set(!showOptions())"
            >
              <tas-icon
                iconName="feather:settings"
                style="font-size:12px"
              ></tas-icon>
              Options
            </button>
            @if (isSystemTemplate()) {
              <div
                class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200"
              >
                <tas-icon
                  iconName="feather:lock"
                  class="text-slate-400"
                  style="font-size:12px"
                ></tas-icon>
                <span class="text-xs text-slate-500">Lecture seule</span>
              </div>
            } @else {
              @if (!isCreateMode()) {
                <div class="flex items-center gap-2 mr-1">
                  <tas-switch
                    [checked]="template()?.isActive ?? false"
                    ariaLabel="Activer ou désactiver"
                    [isLoading]="isToggling()"
                    (toggle)="toggleActive()"
                  ></tas-switch>
                  <span class="text-xs text-slate-500">{{
                    template()?.isActive ? 'Actif' : 'Inactif'
                  }}</span>
                </div>
              }
              <a
                [routerLink]="['/settings/email-templates']"
                tas-outlined-button
                color="primary"
                >Annuler</a
              >
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="isSaving() || !canSave()"
                [isLoading]="isSaving()"
                (click)="save()"
              >
                <tas-icon
                  [iconName]="isCreateMode() ? 'feather:plus' : 'feather:save'"
                  iconSize="sm"
                ></tas-icon>
                {{ isCreateMode() ? 'Créer le modèle' : 'Enregistrer' }}
              </button>
            }
          </div>
        </div>

        <!-- Identification + Options bar -->
        <tas-card class="shrink-0 block">
          <div class="p-3 flex items-end gap-3">
            @if (isCreateMode()) {
              <tas-form-field>
                <tas-label
                  >Clé du modèle <span class="text-red-500">*</span></tas-label
                >
                <input
                  tasInput
                  type="text"
                  placeholder="Ex : WELCOME_EMAIL"
                  [ngModel]="templateKey()"
                  (ngModelChange)="templateKey.set($event)"
                />
              </tas-form-field>
              <tas-form-field>
                <tas-label
                  >Locale <span class="text-red-500">*</span></tas-label
                >
                <tas-select
                  [options]="localeOptions"
                  [ngModel]="locale()"
                  (ngModelChange)="locale.set($event)"
                ></tas-select>
              </tas-form-field>
            }
            <tas-form-field class="flex-1">
              <tas-label
                >Sujet
                @if (isCreateMode()) {
                  <span class="text-red-500">*</span>
                }
              </tas-label>
              <input
                tasInput
                type="text"
                placeholder="Objet de l'e-mail"
                [ngModel]="editSubject()"
                (ngModelChange)="editSubject.set($event)"
                [disabled]="isSystemTemplate()"
              />
            </tas-form-field>
            @if (!isCreateMode()) {
              <div class="flex items-center gap-4 pb-1 text-xs text-slate-400">
                <span
                  >Clé :
                  <span class="font-mono text-slate-600">{{
                    template()?.templateKey
                  }}</span></span
                >
                <span
                  >Locale :
                  <span class="font-medium text-slate-600">{{
                    template()?.locale
                  }}</span></span
                >
              </div>
            }
          </div>

          @if (showOptions()) {
            <div class="px-3 pb-3 pt-1 border-t border-slate-100">
              <p
                class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2 mt-2"
              >
                Personnalisation du template
              </p>
              <div class="grid grid-cols-4 gap-4">
                <tas-form-field>
                  <tas-label>Nom de l'entreprise</tas-label>
                  <input
                    tasInput
                    type="text"
                    [ngModel]="optCompanyName()"
                    (ngModelChange)="optCompanyName.set($event)"
                  />
                </tas-form-field>
                <div class="flex items-center gap-2">
                  <tas-form-field>
                    <tas-label
                      class="text-xs font-medium text-slate-500 mb-1 block"
                      >Couleur principale</tas-label
                    >
                    <input
                      type="text"
                      tasInput
                      [value]="optPrimaryColor()"
                      (input)="optPrimaryColor.set($any($event.target).value)"
                    />
                  </tas-form-field>
                  <div class="shrink-0 mt-5">
                    <label class="block text-xs text-slate-400 mb-1 sr-only"
                      >Sélecteur</label
                    >
                    <input
                      type="color"
                      class="w-8 h-8 rounded border border-slate-200 cursor-pointer p-0"
                      [value]="optPrimaryColor()"
                      (input)="optPrimaryColor.set($any($event.target).value)"
                    />
                  </div>
                </div>
                <tas-form-field>
                  <tas-label>URL du logo</tas-label>
                  <input
                    tasInput
                    type="text"
                    placeholder="https://..."
                    [ngModel]="optLogoUrl()"
                    (ngModelChange)="optLogoUrl.set($event)"
                  />
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Preheader</tas-label>
                  <input
                    tasInput
                    type="text"
                    placeholder="Texte d'aperçu"
                    [ngModel]="optPreheader()"
                    (ngModelChange)="optPreheader.set($event)"
                  />
                </tas-form-field>
              </div>
              <div class="mt-4">
                <tas-form-field>
                  <tas-label>Texte du pied de page</tas-label>
                  <input
                    tasInput
                    type="text"
                    [ngModel]="optFooterText()"
                    (ngModelChange)="optFooterText.set($event)"
                  />
                </tas-form-field>
              </div>
            </div>
          }
        </tas-card>

        <!-- Editor + Preview -->
        <div
          class="flex-1 min-h-0 rounded-lg border border-slate-200 overflow-hidden"
        >
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
  private readonly _tenantProvider = inject(TenantProvider);

  /** If id is provided → edit mode; otherwise → create mode */
  public readonly id = input<string>();

  public readonly localeOptions = LOCALE_OPTIONS;

  public isLoading = signal(false);
  public isSaving = signal(false);
  public isToggling = signal(false);
  public showOptions = signal(false);
  public template = signal<EmailTemplate | null>(null);
  public generatedHtml = signal('');

  public readonly isCreateMode = computed(() => !this.id());
  public readonly isSystemTemplate = computed(
    () => this.template()?.isSystem ?? false,
  );
  public readonly canSave = computed(() => {
    if (this.isCreateMode())
      return !!(this.templateKey() && this.locale() && this.editSubject());
    return true;
  });

  // Create-mode fields
  public templateKey = signal('');
  public locale = signal('fr');
  public isGlobal = signal(false);

  // Shared editor fields
  public editSubject = signal('');
  public editHtmlBody = signal('');
  public editTextBody = signal('');

  // Template options — populated from tenant context
  public optCompanyName = linkedSignal(
    () => this._tenantProvider.context()?.companyName ?? 'Sankore CRM',
  );
  public optPrimaryColor = signal(
    this._tenantProvider.context()?.primaryColor ?? '#6366f1',
  );
  public optLogoUrl = signal(this._tenantProvider.context()?.logoUrl ?? '');
  public optPreheader = signal('');
  public optFooterText = signal(
    'Cet e-mail a été envoyé automatiquement. Merci de ne pas répondre directement.',
  );

  public templateOptions = computed<Partial<EmailTemplateOptions>>(() => ({
    companyName: this.optCompanyName(),
    primaryColor: this.optPrimaryColor(),
    logoUrl: this.optLogoUrl(),
    preheader: this.optPreheader(),
    footerText: this.optFooterText(),
  }));

  constructor() {
    effect(() => {
      const templateId = this.id();
      if (templateId) {
        this._loadTemplate(templateId);
      } else {
        this._initCreateMode();
      }
    });
  }

  public save(): void {
    if (this.isCreateMode()) {
      this._create();
    } else {
      this._update();
    }
  }

  public toggleActive(): void {
    this.isToggling.set(true);
    this._api
      .apiV1EmailTemplatesIdActivatePatch(this.id()!)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Opération échouée.');
          this.isToggling.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.template.update((t) => (t ? { ...t, isActive: !t.isActive } : t));
        this._snackbar.success(
          'Succès',
          `Modèle ${this.template()?.isActive ? 'activé' : 'désactivé'}.`,
        );
        this.isToggling.set(false);
      });
  }

  // ——— Private ———

  private _loadTemplate(templateId: string): void {
    this.isLoading.set(true);
    this._api.apiV1EmailTemplatesIdGet(templateId).subscribe({
      next: (tpl: EmailTemplate) => {
        this.template.set(tpl);
        this.editSubject.set(tpl.subject ?? '');
        this.editHtmlBody.set(tpl.htmlBody ?? '');
        this.editTextBody.set(tpl.textBody ?? '');
        this.isLoading.set(false);
        this._breadcrumbService.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: "Modèles d'e-mail", link: ['/settings/email-templates'] },
          { label: tpl.subject ?? tpl.templateKey ?? 'Modèle' },
        ]);
      },
      error: () => {
        this._snackbar.error('Erreur', 'Impossible de charger le modèle.');
        this.isLoading.set(false);
      },
    });
  }

  private _initCreateMode(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: "Modèles d'e-mail", link: ['/settings/email-templates'] },
      { label: 'Nouveau' },
    ]);

    // Check for pre-filled data from a system template copy
    try {
      const raw = sessionStorage.getItem('email_template_copy');
      if (raw) {
        sessionStorage.removeItem('email_template_copy');
        const copy = JSON.parse(raw);
        if (copy.templateKey) this.templateKey.set(copy.templateKey);
        if (copy.locale) this.locale.set(copy.locale);
        if (copy.subject) this.editSubject.set(copy.subject);
        if (copy.htmlBody) this.editHtmlBody.set(copy.htmlBody);
        if (copy.textBody) this.editTextBody.set(copy.textBody);
      }
    } catch {
      /* ignore */
    }
  }

  private _create(): void {
    if (!this.templateKey() || !this.locale() || !this.editSubject()) return;
    this.isSaving.set(true);
    const textBody =
      this.editTextBody() || generateTextFromHtml(this.editHtmlBody());

    this._api
      .apiV1EmailTemplatesPost({
        templateKey: this.templateKey(),
        locale: this.locale(),
        subject: this.editSubject(),
        htmlBody: this.generatedHtml() || undefined,
        textBody: textBody || undefined,
        isGlobal: this.isGlobal(),
      })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de créer le modèle.');
          this.isSaving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Modèle créé',
          `Le modèle « ${this.templateKey()} » a été créé.`,
        );
        this._router.navigate(['/settings/email-templates']);
      });
  }

  private _update(): void {
    this.isSaving.set(true);
    const textBody =
      this.editTextBody() || generateTextFromHtml(this.editHtmlBody());

    this._api
      .apiV1EmailTemplatesIdPut(this.id()!, {
        subject: this.editSubject(),
        htmlBody: this.generatedHtml() || undefined,
        textBody: textBody || undefined,
      })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de mettre à jour.');
          this.isSaving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Modèle mis à jour',
          'Les modifications ont été enregistrées.',
        );
        this.template.update((t) =>
          t
            ? {
                ...t,
                subject: this.editSubject(),
                htmlBody: this.generatedHtml(),
                textBody,
              }
            : t,
        );
        this.isSaving.set(false);
      });
  }
}

export default EditEmailTemplatePage;
