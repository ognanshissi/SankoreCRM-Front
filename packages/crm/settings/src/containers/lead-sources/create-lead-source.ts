import { Component, inject, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, debounceTime, EMPTY, of, Subject, switchMap } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  LeadSourcesApiService,
  ProductsApiService,
  AgenciesApiService,
  DispatchingRulesApiService,
  CreateLeadSourceRequestChannelTypeEnum,
  CreateLeadSourceRequestIntegrationModeEnum,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { LeadSourcesService } from './lead-sources.service';
import { writeSettings } from './lead-source-settings.types';
import { LeadSourceMetadataService } from './lead-source-metadata.service';
import {
  IntegrationMode,
  modeLabel,
  modeToNumeric,
  channelIcon,
  tabForMode,
} from './lead-source.types';

// ——— FE-05: Business case definitions ———

interface BusinessCase {
  id: string;
  title: string;
  description: string;
  icon: string;
  channel: string;
  mode: string | null;
  question?: string;
  choices?: { label: string; mode: string }[];
}

const BUSINESS_CASES: BusinessCase[] = [
  {
    id: 'website-form',
    title: 'Formulaire de mon site',
    description: 'Capturer les leads soumis via un formulaire sur votre site vitrine.',
    icon: 'feather:globe',
    channel: 'WebForm',
    mode: 'EmbeddedScript',
  },
  {
    id: 'server-webhook',
    title: 'Site avec backend',
    description: 'Votre site envoie les leads depuis son serveur vers le CRM.',
    icon: 'feather:server',
    channel: 'InboundWebhook',
    mode: 'ServerWebhook',
  },
  {
    id: 'lead-factory',
    title: 'Lead factory / Fournisseur',
    description: 'Connecter un fournisseur externe de leads.',
    icon: 'feather:package',
    channel: 'ExternalApiPull',
    mode: null,
    question: 'Le fournisseur envoie-t-il ses leads, ou dois-je aller les chercher ?',
    choices: [
      { label: 'Le fournisseur envoie (webhook)', mode: 'ServerWebhook' },
      { label: 'Je vais les chercher (pull)', mode: 'ScheduledPull' },
    ],
  },
  {
    id: 'walk-in',
    title: 'Visite en agence',
    description: 'Leads captés par les agents lors de visites en agence.',
    icon: 'feather:home',
    channel: 'WalkIn',
    mode: 'Internal',
  },
  {
    id: 'mobile-agent',
    title: 'Agent mobile',
    description: 'Leads captés par les agents terrain depuis l\'application mobile.',
    icon: 'feather:smartphone',
    channel: 'MobileAgent',
    mode: 'Internal',
  },
  {
    id: 'referral',
    title: 'Parrainage',
    description: 'Leads issus du programme de parrainage.',
    icon: 'feather:users',
    channel: 'Referral',
    mode: 'Internal',
  },
  {
    id: 'file-import',
    title: 'Import fichier',
    description: 'Importer des leads depuis un fichier CSV ou Excel.',
    icon: 'feather:upload',
    channel: 'FileImport',
    mode: 'Internal',
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp',
    description: 'Leads provenant de conversations WhatsApp Business.',
    icon: 'feather:message-circle',
    channel: 'WhatsAppInbound',
    mode: 'PlatformConnection',
  },
  {
    id: 'phone',
    title: 'Appel entrant',
    description: 'Leads créés suite à un appel téléphonique entrant.',
    icon: 'feather:phone-incoming',
    channel: 'InboundCall',
    mode: 'Internal',
  },
];

@Component({
  selector: 'create-lead-source',
  imports: [
    FormsModule, RouterLink, TasCard, TasIcon, TasTag, TasSpinner, Button,
    TasFormField, TasLabel, TasError, TasInput, TasSelect,
  ],
  template: `
    <div class="pb-6">
      <!-- Header -->
      <div class="flex items-center gap-3 mb-6">
        <a [routerLink]="['/settings/lead-sources']" tas-icon-button>
          <tas-icon iconName="feather:arrow-left" style="font-size:16px"></tas-icon>
        </a>
        <div>
          <h1 class="text-lg font-semibold text-slate-800">
            {{ step() === 'pick' ? 'Que voulez-vous connecter ?' : 'Nouvelle source de leads' }}
          </h1>
          <p class="text-xs text-slate-400 mt-0.5">
            {{ step() === 'pick'
              ? 'Choisissez un cas d\'usage pour configurer automatiquement le canal et le mode.'
              : 'Renseignez les informations de votre source.' }}
          </p>
        </div>
      </div>

      <!-- STEP 1: Business case picker (FE-05) -->
      @if (step() === 'pick') {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          @for (bc of businessCases; track bc.id) {
            <tas-card class="block cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all"
                      (click)="selectCase(bc)">
              <div class="p-4 flex flex-col h-full">
                <div class="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center mb-3">
                  <tas-icon [iconName]="bc.icon" class="text-slate-500" style="font-size:18px"></tas-icon>
                </div>
                <p class="text-sm font-semibold text-slate-800 mb-1">{{ bc.title }}</p>
                <p class="text-xs text-slate-400 flex-1">{{ bc.description }}</p>
              </div>
            </tas-card>
          }
        </div>

        <!-- Question sub-step for lead factory -->
        @if (pendingCase()) {
          <div class="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" (click)="pendingCase.set(null)">
            <div class="bg-white rounded-xl shadow-xl p-6 max-w-md w-full" (click)="$event.stopPropagation()">
              <p class="text-sm font-semibold text-slate-800 mb-2">{{ pendingCase()!.question }}</p>
              <div class="flex flex-col gap-2 mt-4">
                @for (choice of pendingCase()!.choices; track choice.mode) {
                  <button tas-outlined-button class="justify-start" type="button"
                          (click)="confirmCase(pendingCase()!, choice.mode)">
                    <tas-icon [iconName]="choice.mode === 'ServerWebhook' ? 'feather:zap' : 'feather:download-cloud'"
                              style="font-size:14px"></tas-icon>
                    {{ choice.label }}
                  </button>
                }
              </div>
              <div class="mt-4 flex justify-end">
                <button tas-outlined-button type="button" (click)="pendingCase.set(null)">Annuler</button>
              </div>
            </div>
          </div>
        }
      }

      <!-- STEP 2: Form (FE-06) -->
      @if (step() === 'form') {
        <div class="max-w-3xl flex flex-col gap-4">
          <!-- Selected case indicator -->
          <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <tas-icon [iconName]="getChannelIcon(channelType())" class="text-slate-500" style="font-size:16px"></tas-icon>
            <div class="flex-1">
              <p class="text-sm font-medium text-slate-700">{{ selectedCaseTitle() }}</p>
              <p class="text-xs text-slate-400">Canal : {{ channelType() }} · Mode : {{ integrationMode() ?? 'Non défini' }}</p>
            </div>
            <button tas-outlined-button type="button" class="text-xs" (click)="step.set('pick')">
              Changer
            </button>
          </div>

          <!-- Identification -->
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Identification</p>
            </div>
            <div class="p-4 flex flex-col gap-4">
              <div class="grid grid-cols-2 gap-4">
                <tas-form-field>
                  <tas-label>Libellé <span class="text-red-500">*</span></tas-label>
                  <input tasInput type="text" placeholder="Ex : Site vitrine contact"
                         [ngModel]="label()" (ngModelChange)="onLabelChange($event)" />
                  @if (serverError('label'); as msg) {
                    <tas-error>{{ msg }}</tas-error>
                  }
                </tas-form-field>
                <tas-form-field>
                  <tas-label>Code <span class="text-red-500">*</span></tas-label>
                  <input tasInput type="text" placeholder="AUTO-GENERE"
                         [ngModel]="code()" (ngModelChange)="onCodeChange($event)" />
                  @if (codeStatus() === 'checking') {
                    <p class="text-xs text-slate-400 mt-1 flex items-center gap-1">
                      <tas-spinner size="3"></tas-spinner> Vérification...
                    </p>
                  } @else if (codeStatus() === 'taken') {
                    <tas-error>Code déjà utilisé</tas-error>
                  } @else if (codeStatus() === 'available') {
                    <p class="text-xs text-green-500 mt-1">Code disponible</p>
                  }
                  @if (serverError('code'); as msg) {
                    <tas-error>{{ msg }}</tas-error>
                  }
                </tas-form-field>
              </div>
              <tas-form-field>
                <tas-label>Description</tas-label>
                <input tasInput type="text" placeholder="Description optionnelle"
                       [ngModel]="description()" (ngModelChange)="description.set($event)" />
              </tas-form-field>
            </div>
          </tas-card>

          <!-- Orientation commerciale (FE-06) -->
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Orientation commerciale</p>
              <p class="text-xs text-slate-400 mt-0.5">Optionnel — pré-paramètre le dispatching des leads reçus.</p>
            </div>
            <div class="p-4 grid grid-cols-2 gap-4">
              <tas-form-field>
                <tas-label>Produit par défaut</tas-label>
                <tas-select
                  [options]="productOptions()"
                  optionLabel="label" optionValue="value"
                  placeholder="Aucun"
                  [ngModel]="defaultProductCode()" (ngModelChange)="defaultProductCode.set($event)"
                ></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Agence par défaut</tas-label>
                <tas-select
                  [options]="agencyOptions()"
                  optionLabel="label" optionValue="value"
                  placeholder="Aucune"
                  [ngModel]="defaultAgencyId()" (ngModelChange)="defaultAgencyId.set($event)"
                ></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Règle de dispatching</tas-label>
                <tas-select
                  [options]="dispatchRuleOptions()"
                  optionLabel="label" optionValue="value"
                  placeholder="Aucune"
                  [ngModel]="defaultDispatchRuleId()" (ngModelChange)="defaultDispatchRuleId.set($event)"
                ></tas-select>
              </tas-form-field>
              <tas-form-field>
                <tas-label>Fenêtre de déduplication (jours)</tas-label>
                <input tasInput type="number" placeholder="30"
                       [ngModel]="dedupWindowDays()" (ngModelChange)="dedupWindowDays.set($event)" />
                <p class="text-[10px] text-slate-400 mt-1">Un lead identique reçu dans cette fenêtre sera détecté. 30 jours par défaut.</p>
              </tas-form-field>
            </div>
          </tas-card>

          <!-- Coût -->
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Coût d'acquisition</p>
            </div>
            <div class="p-4 grid grid-cols-2 gap-4">
              <tas-form-field>
                <tas-label>Coût par lead</tas-label>
                <input tasInput type="number" placeholder="0"
                       [ngModel]="costPerLead()" (ngModelChange)="costPerLead.set($event)" />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Devise</tas-label>
                <input tasInput type="text" placeholder="XOF"
                       [ngModel]="costCurrency()" (ngModelChange)="costCurrency.set($event)" />
              </tas-form-field>
            </div>
          </tas-card>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3">
            <a [routerLink]="['/settings/lead-sources']" tas-outlined-button color="primary">Annuler</a>
            <button tas-raised-button color="primary" type="button"
                    [disabled]="isSaving() || !code() || !label() || codeStatus() === 'taken'"
                    [isLoading]="isSaving()"
                    (click)="create()">
              <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
              Créer la source
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class CreateLeadSourcePage implements OnInit {
  private readonly _api = inject(LeadSourcesApiService);
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _dispatchApi = inject(DispatchingRulesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumb = inject(BreadcrumbService);
  public readonly metadataService = inject(LeadSourceMetadataService);

  public readonly businessCases = BUSINESS_CASES;
  public readonly getChannelIcon = channelIcon;

  // Step management
  public step = signal<'pick' | 'form'>('pick');
  public pendingCase = signal<BusinessCase | null>(null);
  public selectedCaseTitle = signal('');

  // Form fields
  public code = signal('');
  public label = signal('');
  public description = signal('');
  public channelType = signal<string | null>(null);
  public integrationMode = signal<string | null>(null);
  public dedupWindowDays = signal<number>(30);
  public costPerLead = signal<number | null>(null);
  public costCurrency = signal('XOF');

  // Orientation (FE-06)
  public defaultProductCode = signal<string | null>(null);
  public defaultAgencyId = signal<string | null>(null);
  public defaultDispatchRuleId = signal<string | null>(null);

  // Dropdown options
  public productOptions = signal<{ label: string; value: string }[]>([]);
  public agencyOptions = signal<{ label: string; value: string }[]>([]);
  public dispatchRuleOptions = signal<{ label: string; value: string }[]>([]);

  // Code uniqueness check
  public codeStatus = signal<'idle' | 'checking' | 'available' | 'taken'>('idle');
  private readonly _codeCheck$ = new Subject<string>();

  public isSaving = signal(false);

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Sources & Campagnes', link: ['/settings/lead-sources'] },
      { label: 'Nouvelle source' },
    ]);
    this.metadataService.load();
    this._loadDropdowns();
    this._setupCodeCheck();
  }

  /**
   * FE-02 — Erreur de validation renvoyee par le serveur pour ce champ.
   * Les ecrans « sources » sont bases sur des signals : la projection sur des
   * controles reactifs ne les atteindrait pas.
   */
  public serverError(path: string): string | null {
    return this._sourcesService.errorFor(path);
  }

  // ——— FE-05: Business case selection ———

  public selectCase(bc: BusinessCase): void {
    if (bc.question && bc.choices) {
      this.pendingCase.set(bc);
    } else {
      this.confirmCase(bc, bc.mode!);
    }
  }

  public confirmCase(bc: BusinessCase, mode: string): void {
    this.pendingCase.set(null);
    this.channelType.set(bc.channel);
    this.integrationMode.set(mode);
    this.selectedCaseTitle.set(bc.title);
    this.step.set('form');
  }

  // ——— FE-06: Label → Code auto-generation ———

  public onLabelChange(value: string): void {
    this.label.set(value);
    if (value) {
      const generated = value
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      this.code.set(generated);
      this._codeCheck$.next(generated);
    }
  }

  public onCodeChange(value: string): void {
    this.code.set(value);
    if (value) {
      this._codeCheck$.next(value);
    } else {
      this.codeStatus.set('idle');
    }
  }

  // ——— Create ———

  public create(): void {
    if (!this.code() || !this.label() || this.codeStatus() === 'taken') return;
    this.isSaving.set(true);

    const mode = this.integrationMode() as IntegrationMode | null;

    this._sourcesService.create({
      code: this.code(),
      label: this.label(),
      description: this.description() || null,
      channelType: this.channelType() as CreateLeadSourceRequestChannelTypeEnum,
      integrationMode: modeToNumeric(mode) as CreateLeadSourceRequestIntegrationModeEnum,
      dedupWindowDays: this.dedupWindowDays(),
      costPerLead: this.costPerLead(),
      costCurrency: this.costCurrency() || null,
      // FE-06 — orientation commerciale : ces champs étaient saisis puis perdus.
      defaultAgencyId: this.defaultAgencyId(),
      defaultDispatchingRuleId: this.defaultDispatchRuleId(),
      // `defaultProductCode` n'a pas encore de champ au contrat : il est rangé
      // dans le sac de settings en attendant (dépendance back #1).
      settings: writeSettings(null, mode, {
        defaultProductCode: this.defaultProductCode(),
      }),
    }).pipe(
      catchError(() => {
        // Error already handled by LeadSourcesService (400/403/409)
        this.isSaving.set(false);
        return EMPTY;
      }),
    ).subscribe((id) => {
      this._snackbar.success('Source créée', `« ${this.label()} » a été créée en brouillon.`);
      // FE-05 AC3 / FE-06 AC5 — on ouvre le détail directement sur l'onglet du
      // mode choisi, pour enchaîner sur l'assistant sans passer par la liste.
      if (id) {
        this._router.navigate(['/settings/lead-sources', id], {
          queryParams: { tab: tabForMode(mode) },
        });
      } else {
        this._router.navigate(['/settings/lead-sources']);
      }
    });
  }

  // ——— Private ———

  private _loadDropdowns(): void {
    this._productsApi.listProducts(true).pipe(
      catchError(() => of([])),
    ).subscribe((products) => {
      this.productOptions.set(
        products.map((p) => ({ label: p.name ?? p.code ?? '—', value: p.code ?? '' })),
      );
    });

    this._agenciesApi.listAgencies(false, 1, 100).pipe(
      catchError(() => of({ items: [] })),
    ).subscribe((result) => {
      this.agencyOptions.set(
        (result.items ?? []).map((a) => ({ label: a.name ?? '—', value: a.id ?? '' })),
      );
    });

    this._dispatchApi.listDispatchingRules(true).pipe(
      catchError(() => of([])),
    ).subscribe((rules) => {
      this.dispatchRuleOptions.set(
        rules.map((r) => ({ label: r.name ?? '—', value: r.id ?? '' })),
      );
    });
  }

  private _setupCodeCheck(): void {
    this._codeCheck$.pipe(
      debounceTime(400),
      switchMap((code) => {
        this.codeStatus.set('checking');
        return this._api.listLeadSources(undefined, undefined, undefined, code, 1, 1).pipe(
          catchError(() => of({ items: [] })),
        );
      }),
    ).subscribe((result) => {
      const match = (result.items ?? []).find(
        (s) => s.code?.toUpperCase() === this.code().toUpperCase(),
      );
      this.codeStatus.set(match ? 'taken' : 'available');
    });
  }
}

export default CreateLeadSourcePage;
