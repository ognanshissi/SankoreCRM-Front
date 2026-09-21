import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
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
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EmailTemplatesApiService } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';

export interface EmailTemplate {
  id?: string;
  templateKey?: string;
  locale?: string;
  subject?: string;
  htmlBody?: string;
  textBody?: string;
  isActive?: boolean;
  isGlobal?: boolean;
  isSystem?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const LOCALE_FILTER_OPTIONS = [
  { label: 'Toutes', value: '' },
  { label: 'Français', value: 'fr' },
  { label: 'Anglais', value: 'en' },
  { label: 'Arabe', value: 'ar' },
  { label: 'Portugais', value: 'pt' },
];

@Component({
  selector: 'email-templates-homepage',
  imports: [
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasSwitch,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
  ],
  template: `
    <ng-container>
      @if (isLoading()) {
        <div class="flex justify-center py-24">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else {
        <div class="pb-6">
          <div class="flex items-start justify-between mb-6">
            <div>
              <h1 class="text-lg font-semibold text-slate-800">
                Modeles d'e-mail
              </h1>
              <p class="text-sm text-slate-500 mt-0.5">
                Créez et personnalisez les modèles d'e-mail transactionnels et
                marketing.
              </p>
            </div>
            <button
              tas-raised-button
              color="primary"
              type="button"
              (click)="navigateToCreate()"
            >
              <tas-icon
                iconName="feather:plus"
                style="font-size:14px"
              ></tas-icon>
              Nouveau modele
            </button>
          </div>

          <!-- Filters -->
          <div class="grid grid-cols-3 items-end gap-3 mb-6">
            <tas-form-field>
              <tas-label>Recherche par cle</tas-label>
              <input
                tasInput
                type="text"
                placeholder="Ex : WELCOME_EMAIL"
                [ngModel]="filterKey()"
                (ngModelChange)="filterKey.set($event)"
              />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Locale</tas-label>
              <tas-select
                [options]="localeOptions"
                [ngModel]="filterLocale()"
                (ngModelChange)="filterLocale.set($event)"
              ></tas-select>
            </tas-form-field>
            <div>
              <button
                tas-outlined-button
                color="primary"
                type="button"
                (click)="loadTemplates()"
              >
                <tas-icon iconName="feather:search"></tas-icon>
                Filtrer
              </button>
            </div>
          </div>

          <!-- Tabs -->
          <div class="flex items-center gap-1 mb-4 p-1 rounded-lg bg-slate-100 w-fit">
            <button type="button" class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              [class.bg-white]="activeTab() === 'system'" [class.text-slate-800]="activeTab() === 'system'"
              [class.shadow-sm]="activeTab() === 'system'" [class.text-slate-500]="activeTab() !== 'system'"
              (click)="activeTab.set('system')">
              <tas-icon iconName="feather:lock" style="font-size:12px" class="mr-1"></tas-icon>
              Système
              <span class="ml-1 text-[10px] font-semibold tabular-nums">{{ systemTemplates().length }}</span>
            </button>
            <button type="button" class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              [class.bg-white]="activeTab() === 'custom'" [class.text-slate-800]="activeTab() === 'custom'"
              [class.shadow-sm]="activeTab() === 'custom'" [class.text-slate-500]="activeTab() !== 'custom'"
              (click)="activeTab.set('custom')">
              <tas-icon iconName="feather:edit-3" style="font-size:12px" class="mr-1"></tas-icon>
              Personnalisés
              <span class="ml-1 text-[10px] font-semibold tabular-nums">{{ customTemplates().length }}</span>
            </button>
          </div>

          <!-- System templates tab -->
          @if (activeTab() === 'system') {
            <tas-card class="block">
              <div class="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p class="text-sm font-semibold text-slate-700">Modèles système</p>
                  <p class="text-xs text-slate-400 mt-0.5">Modèles par défaut — en lecture seule. Copiez pour personnaliser.</p>
                </div>
                <span class="text-xs text-slate-400">{{ systemTemplates().length }} modèle(s)</span>
              </div>
              @if (systemTemplates().length === 0) {
                <div class="flex flex-col items-center justify-center py-12 text-center">
                  <tas-icon iconName="feather:lock" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
                  <p class="text-sm text-slate-400">Aucun modèle système disponible</p>
                </div>
              } @else {
                <div class="divide-y divide-slate-100">
                  @for (tpl of systemTemplates(); track tpl.id) {
                    <div class="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors">
                      <div class="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        <tas-icon iconName="feather:lock" class="text-slate-400" style="font-size:15px"></tas-icon>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <p class="text-sm font-medium text-slate-800 truncate">{{ tpl.subject || '(sans sujet)' }}</p>
                          <span class="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">{{ tpl.templateKey }}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <tas-tag severity="info">{{ tpl.locale }}</tas-tag>
                          <tas-tag severity="accent">Système</tas-tag>
                          @if (tpl.isGlobal) { <tas-tag severity="neutral">Global</tas-tag> }
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <button tas-outlined-button type="button" class="text-xs" (click)="navigateToEdit(tpl)">
                          <tas-icon iconName="feather:eye" style="font-size:12px"></tas-icon> Aperçu
                        </button>
                        <button tas-outlined-button color="primary" type="button" class="text-xs"
                          [disabled]="copyingId() === tpl.id" (click)="copyAndCustomize(tpl)">
                          @if (copyingId() === tpl.id) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
                          @else { <tas-icon iconName="feather:copy" style="font-size:12px"></tas-icon> }
                          Copier et personnaliser
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </tas-card>
          }

          <!-- Custom templates tab -->
          @if (activeTab() === 'custom') {
            <tas-card class="block">
              <div class="p-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p class="text-sm font-semibold text-slate-700">Modèles personnalisés</p>
                  <p class="text-xs text-slate-400 mt-0.5">Vos modèles modifiables — créés ou copiés depuis les modèles système.</p>
                </div>
                <span class="text-xs text-slate-400">{{ customTemplates().length }} modèle(s)</span>
              </div>
              @if (customTemplates().length === 0) {
                <div class="flex flex-col items-center justify-center py-12 text-center">
                  <tas-icon iconName="feather:mail" class="text-slate-300 mb-2" style="font-size:28px"></tas-icon>
                  <p class="text-sm text-slate-400">Aucun modèle personnalisé</p>
                  <p class="text-xs text-slate-400 mt-1">Copiez un modèle système ou créez-en un nouveau.</p>
                  <div class="flex items-center gap-2 mt-4">
                    <button tas-outlined-button type="button" (click)="activeTab.set('system')">
                      Voir les modèles système
                    </button>
                    <button tas-outlined-button color="primary" type="button" (click)="navigateToCreate()">
                      Créer un modèle
                    </button>
                  </div>
                </div>
              } @else {
                <div class="divide-y divide-slate-100">
                  @for (tpl of customTemplates(); track tpl.id) {
                    <div class="flex items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                      [class.opacity-50]="!tpl.isActive" (click)="navigateToEdit(tpl)">
                      <div class="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                        <tas-icon iconName="feather:mail" class="text-indigo-500" style="font-size:15px"></tas-icon>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <p class="text-sm font-medium text-slate-800 truncate">{{ tpl.subject || '(sans sujet)' }}</p>
                          <span class="text-[10px] text-slate-400 font-mono bg-slate-50 px-1.5 py-0.5 rounded">{{ tpl.templateKey }}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                          <tas-tag severity="info">{{ tpl.locale }}</tas-tag>
                          <tas-tag severity="primary">Personnalisé</tas-tag>
                          @if (tpl.isGlobal) { <tas-tag severity="neutral">Global</tas-tag> }
                          @if (!tpl.isActive) { <tas-tag severity="warning">Inactif</tas-tag> }
                        </div>
                      </div>
                      <div class="flex items-center gap-2" (click)="$event.stopPropagation()">
                        <tas-switch [checked]="tpl.isActive ?? false"
                          [ariaLabel]="(tpl.isActive ? 'Désactiver' : 'Activer') + ' ' + (tpl.templateKey ?? '')"
                          [isLoading]="togglingId() === tpl.id" (toggle)="toggleActive(tpl)"></tas-switch>
                        <button tas-outlined-button type="button" class="text-xs" (click)="navigateToEdit(tpl)">
                          <tas-icon iconName="feather:edit-2" style="font-size:12px"></tas-icon> Modifier
                        </button>
                      </div>
                      <tas-icon iconName="feather:chevron-right" class="text-slate-300" style="font-size:16px"></tas-icon>
                    </div>
                  }
                </div>
              }
            </tas-card>
          }
        </div>
      }
    </ng-container>
  `,
})
export class EmailTemplatesHomepage implements OnInit {
  private readonly _api = inject(EmailTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly localeOptions = LOCALE_FILTER_OPTIONS;

  public isLoading = signal(true);
  public templates = signal<EmailTemplate[]>([]);
  public filterKey = signal('');
  public filterLocale = signal('');
  public togglingId = signal<string | null>(null);
  public copyingId = signal<string | null>(null);
  public activeTab = signal<'system' | 'custom'>('system');

  public readonly systemTemplates = computed(() => this.templates().filter((t) => t.isSystem));
  public readonly customTemplates = computed(() => this.templates().filter((t) => !t.isSystem));

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Parametrage', link: ['/settings'] },
      { label: "Modeles d'e-mail" },
    ]);
    this.loadTemplates();
  }

  public loadTemplates(): void {
    this.isLoading.set(true);
    const key = this.filterKey() || undefined;
    const locale = this.filterLocale() || undefined;
    this._api
      .apiV1EmailTemplatesGet(key, locale)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de charger les modeles.');
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((data) => {
        this.templates.set(data ?? []);
        this.isLoading.set(false);
      });
  }

  public toggleActive(tpl: EmailTemplate): void {
    this.togglingId.set(tpl.id ?? null);
    this._api
      .apiV1EmailTemplatesIdActivatePatch(tpl.id!)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Operation echouee.');
          this.togglingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.templates.update((list) =>
          list.map((t) =>
            t.id === tpl.id ? { ...t, isActive: !t.isActive } : t,
          ),
        );
        this._snackbar.success(
          'Succes',
          `Modele ${tpl.isActive ? 'desactive' : 'active'}.`,
        );
        this.togglingId.set(null);
      });
  }

  public navigateToCreate(): void {
    this._router.navigate(['/settings/email-templates/create']);
  }

  public navigateToEdit(tpl: EmailTemplate): void {
    this._router.navigate(['/settings/email-templates', tpl.id, 'edit']);
  }

  public copyAndCustomize(tpl: EmailTemplate): void {
    this.copyingId.set(tpl.id ?? null);
    // Load full template content, then navigate to create with pre-filled data
    this._api.apiV1EmailTemplatesIdGet(tpl.id!).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger le modèle.');
        this.copyingId.set(null);
        return EMPTY;
      }),
    ).subscribe((full: any) => {
      this.copyingId.set(null);
      // Store copy data in sessionStorage for the create page to pick up
      sessionStorage.setItem('email_template_copy', JSON.stringify({
        templateKey: `${full.templateKey ?? tpl.templateKey}_CUSTOM`,
        locale: full.locale ?? tpl.locale,
        subject: `Copie — ${full.subject ?? tpl.subject}`,
        htmlBody: full.htmlBody ?? '',
        textBody: full.textBody ?? '',
        isGlobal: false,
      }));
      this._router.navigate(['/settings/email-templates/create']);
    });
  }
}

export default EmailTemplatesHomepage;
