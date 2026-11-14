import { Component, computed, inject, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SnippetResult } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';
import {
  angularHostedSnippet, angularSnippet, expectedFields, hostedScriptTag, reactHostedSnippet, reactSnippet,
} from './framework-snippets';
import { HighlightLanguage, highlightCode } from './code-highlight';
import { MappingRule } from './field-mapping.types';

/**
 * FE-11 — Obtenir et partager le script à installer
 */
@Component({
  selector: 'script-installer',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    FormsModule, TasCard, TasSpinner, TasIcon, Button,
    TasFormField, TasLabel, TasInput,
  ],
  template: `
    <div class="max-w-=full flex flex-col gap-4">
      @if (isLoading()) {
        <div class="flex justify-center py-12">
          <tas-spinner size="8" class="text-primary"></tas-spinner>
        </div>
      } @else if (loadError()) {
        <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
          <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
          <p class="text-xs text-amber-700">{{ loadError() }}</p>
        </div>
      } @else if (snippet()) {
        <!-- Regenerated warning -->
        @if (showRegeneratedWarning()) {
          <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
            <div class="text-xs text-amber-700">
              <p class="font-semibold">
                L'ancien script installé sur votre site a cessé de fonctionner.
              </p>
              <p class="mt-0.5">
                La clé publique a été régénérée : copiez le nouveau snippet ci-dessous et remplacez-le sur
                toutes les pages de votre site. Tant que l'ancien snippet reste en place, le site n'envoie
                plus aucun lead.
              </p>
            </div>
          </div>
        }

        <!-- Script block -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:code" class="text-slate-400" style="font-size:14px"></tas-icon>
              Script à installer
            </p>
            <div class="flex items-center gap-2">
              @if (canManageSecrets()) {
                <button tas-outlined-button type="button" class="text-xs"
                        [disabled]="isRegenerating()" (click)="regenerateKey()">
                  @if (isRegenerating()) {
                    <tas-spinner size="3"></tas-spinner>
                  } @else {
                    <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
                  }
                  Régénérer la clé
                </button>
              }
              <button tas-outlined-button type="button" class="text-xs" (click)="copyScript()">
                <tas-icon [iconName]="copiedId() === 'script' ? 'feather:check' : 'feather:copy'" style="font-size:12px"></tas-icon>
                {{ copiedId() === 'script' ? 'Copié !' : 'Copier' }}
              </button>
            </div>
          </div>
          <div class="p-4">
            <pre class="code-block text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono select-all"><code [innerHTML]="highlight(snippet()!.html, 'html')"></code></pre>
          </div>
        </tas-card>

        <!-- Installation guides -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:book-open" class="text-slate-400" style="font-size:14px"></tas-icon>
              Guide d'installation
            </p>
          </div>
          <div class="p-4">
            <!-- Tab buttons -->
            <div class="flex flex-wrap gap-1 mb-4">
              @for (tab of guideTabs; track tab.id) {
                <button class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                        [class]="activeGuide() === tab.id
                          ? 'bg-primary text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
                        (click)="activeGuide.set(tab.id)">
                  {{ tab.label }}
                </button>
              }
            </div>

            @switch (activeGuide()) {
              @case ('html') {
                <div class="text-xs text-slate-600 space-y-2">
                  <p><strong>1.</strong> Ouvrez le fichier HTML de votre page.</p>
                  <p><strong>2.</strong> Collez le script juste avant la balise <code class="bg-slate-100 px-1 rounded">&lt;/body&gt;</code>.</p>
                  <p><strong>3.</strong> Enregistrez et déployez votre site.</p>
                </div>
              }
              @case ('wordpress') {
                <div class="text-xs text-slate-600 space-y-2">
                  <p><strong>1.</strong> Allez dans <strong>Apparence → Éditeur de thème</strong> (ou utilisez un plugin comme <em>Insert Headers and Footers</em>).</p>
                  <p><strong>2.</strong> Collez le script dans la section <strong>Footer</strong>.</p>
                  <p><strong>3.</strong> Enregistrez les modifications.</p>
                </div>
              }
              @case ('angular') {
                @if (hosted()) {
                  <div class="text-xs text-slate-600 space-y-2">
                    <p>Le formulaire est composé dans le CRM (onglet « Champs du formulaire ») : le site ne fait que l'afficher.</p>
                    <p><strong>1.</strong> Collez ce script <strong>une seule fois</strong> dans <code class="bg-slate-100 px-1 rounded">src/index.html</code>, avant <code class="bg-slate-100 px-1 rounded">&lt;/body&gt;</code>.</p>
                  </div>
                  <ng-container [ngTemplateOutlet]="frameworkCode" [ngTemplateOutletContext]="{ $implicit: hostedScript(), id: 'angular-script', lang: 'html' }" />
                  <div class="text-xs text-slate-600 space-y-2 mt-4">
                    <p><strong>2.</strong> Ajoutez ce composant, puis affichez <code class="bg-slate-100 px-1 rounded">&lt;app-sankore-form /&gt;</code> où le formulaire doit apparaître. Le script le remplit dès qu'il s'affiche, y compris après un changement de page.</p>
                    <p><strong>3.</strong> Ajoutez l'adresse du site dans les origines autorisées de la source. Champs, consentement, captcha et message se règlent ensuite dans le CRM, sans redéployer le site (5 minutes au plus).</p>
                  </div>
                  <ng-container [ngTemplateOutlet]="frameworkCode" [ngTemplateOutletContext]="{ $implicit: angularHostedCode(), id: 'angular' }" />
                } @else {
                <div class="text-xs text-slate-600 space-y-2">
                  <p>Le script ci-dessus cherche le formulaire au chargement de la page : dans une application Angular, il ne le trouve pas. Utilisez ce service à la place, sans balise <code class="bg-slate-100 px-1 rounded">&lt;script&gt;</code>.</p>
                  <p><strong>1.</strong> Créez le fichier <code class="bg-slate-100 px-1 rounded">sankore-lead.service.ts</code> avec le code ci-dessous.</p>
                  <p><strong>2.</strong> Dans le composant du formulaire, injectez <code class="bg-slate-100 px-1 rounded">SankoreLeadService</code> et appelez <code class="bg-slate-100 px-1 rounded">submit()</code> à l'envoi. Compatible SSR.</p>
                  <p><strong>3.</strong> Ajoutez l'adresse du site dans les origines autorisées de la source.</p>
                  <ng-container [ngTemplateOutlet]="expectedFieldsNote" />
                </div>
                <ng-container [ngTemplateOutlet]="frameworkCode" [ngTemplateOutletContext]="{ $implicit: angularCode(), id: 'angular' }" />
                }
              }
              @case ('react') {
                @if (hosted()) {
                  <div class="text-xs text-slate-600 space-y-2">
                    <p>Le formulaire est composé dans le CRM (onglet « Champs du formulaire ») : le site ne fait que l'afficher.</p>
                    <p><strong>1.</strong> Collez ce script <strong>une seule fois</strong> dans <code class="bg-slate-100 px-1 rounded">index.html</code> (Vite) ou dans le <code class="bg-slate-100 px-1 rounded">&lt;head&gt;</code> de votre mise en page (Next.js).</p>
                  </div>
                  <ng-container [ngTemplateOutlet]="frameworkCode" [ngTemplateOutletContext]="{ $implicit: hostedScript(), id: 'react-script', lang: 'html' }" />
                  <div class="text-xs text-slate-600 space-y-2 mt-4">
                    <p><strong>2.</strong> Ajoutez ce composant, puis affichez <code class="bg-slate-100 px-1 rounded">&lt;SankoreForm /&gt;</code> où le formulaire doit apparaître. Le script le remplit dès qu'il s'affiche, y compris après un changement de page.</p>
                    <p><strong>3.</strong> Ajoutez l'adresse du site dans les origines autorisées de la source. Champs, consentement, captcha et message se règlent ensuite dans le CRM, sans redéployer le site (5 minutes au plus).</p>
                  </div>
                  <ng-container [ngTemplateOutlet]="frameworkCode" [ngTemplateOutletContext]="{ $implicit: reactHostedCode(), id: 'react' }" />
                } @else {
                <div class="text-xs text-slate-600 space-y-2">
                  <p>Le script ci-dessus cherche le formulaire au chargement de la page : dans une application React, il ne le trouve pas. Utilisez ce hook à la place, sans balise <code class="bg-slate-100 px-1 rounded">&lt;script&gt;</code>.</p>
                  <p><strong>1.</strong> Créez le fichier <code class="bg-slate-100 px-1 rounded">useSankoreLead.ts</code> avec le code ci-dessous (Next.js : ajoutez <code class="bg-slate-100 px-1 rounded">'use client'</code>).</p>
                  <p><strong>2.</strong> Dans le formulaire, appelez <code class="bg-slate-100 px-1 rounded">submit()</code> du hook à l'envoi ; <code class="bg-slate-100 px-1 rounded">status</code> et <code class="bg-slate-100 px-1 rounded">error</code> pilotent l'affichage.</p>
                  <p><strong>3.</strong> Ajoutez l'adresse du site dans les origines autorisées de la source.</p>
                  <ng-container [ngTemplateOutlet]="expectedFieldsNote" />
                </div>
                <ng-container [ngTemplateOutlet]="frameworkCode" [ngTemplateOutletContext]="{ $implicit: reactCode(), id: 'react' }" />
                }
              }
              @case ('wix') {
                <div class="text-xs text-slate-600 space-y-2">
                  <p><strong>1.</strong> Dans l'éditeur Wix, allez dans <strong>Paramètres → Onglets avancés → Code personnalisé</strong>.</p>
                  <p><strong>2.</strong> Cliquez <strong>+ Ajouter du code</strong> et collez le script.</p>
                  <p><strong>3.</strong> Placez-le dans le <strong>Corps — Fin</strong> et sur <strong>Toutes les pages</strong>.</p>
                  <p class="text-slate-400 mt-1">La même procédure s'applique pour Webflow (Project Settings → Custom Code → Footer).</p>
                </div>
              }
            }
          </div>
        </tas-card>

        <ng-template #expectedFieldsNote>
          <div class="mt-3 p-3 rounded-lg border text-xs"
               [class]="expected().fromRules ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-amber-50 border-amber-200 text-amber-700'">
            @if (expected().fromRules) {
              <p class="font-semibold text-slate-700 mb-1">Champs attendus par cette source</p>
              <p class="mb-2">Ils viennent de l'onglet « Correspondance des champs » et sont typés dans le code (<code class="bg-white px-1 rounded">SankoreLeadFields</code>) : une clé oubliée ou mal orthographiée ne compile pas. Si vous changez la correspondance, recopiez le code.</p>
              <ul class="space-y-0.5">
                @for (f of expected().fields; track f.key) {
                  <li><code class="bg-white px-1 rounded">{{ f.key }}</code> → {{ f.target }}@if (f.required) { <span class="text-functional-error">*</span> }@if (f.note) { <span class="text-slate-400"> ({{ f.note }})</span> }</li>
                }
              </ul>
            } @else {
              <p>Aucune règle dans « Correspondance des champs » : le site doit envoyer les noms du CRM (<code class="bg-white px-1 rounded">fullName</code>, <code class="bg-white px-1 rounded">phoneNumber</code>…), listés dans le code. Pour garder les noms de votre formulaire, déclarez-les d'abord dans cet onglet.</p>
            }
          </div>
        </ng-template>

        <ng-template #frameworkCode let-code let-id="id" let-lang="lang">
          <div class="mt-3 relative">
            <button tas-outlined-button type="button" class="text-xs absolute top-2 right-2 bg-white"
                    (click)="copyText(code, id)">
              <tas-icon [iconName]="copiedId() === id ? 'feather:check' : 'feather:copy'" style="font-size:12px"></tas-icon>
              {{ copiedId() === id ? 'Copié !' : 'Copier le code' }}
            </button>
            <pre class="code-block text-xs p-4 pt-12 rounded-lg overflow-x-auto max-h-[420px] font-mono"><code [innerHTML]="highlight(code, lang)"></code></pre>
          </div>
        </ng-template>

        <!-- Send to webmaster -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:send" class="text-slate-400" style="font-size:14px"></tas-icon>
              Envoyer au webmaster
            </p>
          </div>
          <div class="p-4">
            <div class="flex items-end gap-3">
              <tas-form-field class="flex-1">
                <tas-label>E-mail du destinataire</tas-label>
                <input tasInput type="email" placeholder="webmaster@exemple.ci"
                       [ngModel]="webmasterEmail()" (ngModelChange)="webmasterEmail.set($event)" />
              </tas-form-field>
              <button tas-raised-button color="primary" type="button"
                      [disabled]="isSending() || !webmasterEmail()"
                      [isLoading]="isSending()"
                      (click)="sendToWebmaster()">
                <tas-icon iconName="feather:send" style="font-size:12px"></tas-icon>
                Envoyer
              </button>
            </div>
            <p class="text-xs text-slate-400 mt-2">
              Le destinataire recevra le script, les consignes d'installation et vos coordonnées.
            </p>

            <!-- FE-11 AC2 — aperçu du message avant envoi -->
            <div class="mt-3">
              <button tas-outlined-button type="button" class="text-xs"
                      (click)="previewOpen.set(!previewOpen())">
                <tas-icon [iconName]="previewOpen() ? 'feather:chevron-up' : 'feather:eye'" style="font-size:10px"></tas-icon>
                {{ previewOpen() ? "Masquer l'aperçu" : "Aperçu du message" }}
              </button>
            </div>

            @if (previewOpen()) {
              <div class="mt-3 border border-slate-200 rounded-lg overflow-hidden">
                <div class="px-3 py-2 bg-slate-50 border-b border-slate-200">
                  <p class="text-[10px] text-slate-400">À</p>
                  <p class="text-xs text-slate-700">{{ webmasterEmail() || 'webmaster@exemple.ci' }}</p>
                  <p class="text-[10px] text-slate-400 mt-1">Objet</p>
                  <p class="text-xs text-slate-700">{{ previewSubject() }}</p>
                </div>
                <div class="p-3">
                  <pre class="text-[11px] text-slate-600 whitespace-pre-wrap font-sans">{{ previewBody() }}</pre>
                </div>
              </div>
            }
          </div>
        </tas-card>

        <!-- Technical info -->
        <div class="grid grid-cols-3 gap-3">
          <div class="p-3 bg-slate-50 rounded-lg">
            <p class="text-[10px] text-slate-400 mb-0.5">Clé publique
              @if (snippet()!.publicKey?.startsWith('pk_test_')) {
                <span class="ml-1 rounded bg-orange-100 px-1 font-semibold text-orange-700" title="Les leads de ce script arrivent dans le mode test">test</span>
              }
            </p>
            <ng-container [ngTemplateOutlet]="copyableValue" [ngTemplateOutletContext]="{ $implicit: snippet()!.publicKey, id: 'public-key' }" />
          </div>
          <div class="p-3 bg-slate-50 rounded-lg">
            <p class="text-[10px] text-slate-400 mb-0.5">SDK URL</p>
            <ng-container [ngTemplateOutlet]="copyableValue" [ngTemplateOutletContext]="{ $implicit: snippet()!.sdkUrl, id: 'sdk-url' }" />
          </div>
          <div class="p-3 bg-slate-50 rounded-lg">
            <p class="text-[10px] text-slate-400 mb-0.5">SRI Hash</p>
            <ng-container [ngTemplateOutlet]="copyableValue" [ngTemplateOutletContext]="{ $implicit: snippet()!.sriHash, id: 'sri-hash' }" />
          </div>
        </div>

        <!-- Valeur tronquée à l'écran : le bouton copie la valeur entière, le survol l'affiche. -->
        <ng-template #copyableValue let-value let-id="id">
          <div class="flex items-center gap-1">
            <p class="min-w-0 flex-1 text-xs text-slate-700 font-mono truncate" [title]="value ?? ''">{{ value }}</p>
            <button tas-button iconButton type="button" class="shrink-0 text-slate-500 hover:text-slate-800"
                    [attr.aria-label]="copiedId() === id ? 'Copié' : 'Copier'"
                    [title]="copiedId() === id ? 'Copié !' : 'Copier'"
                    (click)="copyText(value, id)">
              <tas-icon [iconName]="copiedId() === id ? 'feather:check' : 'feather:copy'" style="font-size:13px"></tas-icon>
            </button>
          </div>
        </ng-template>
      }
    </div>
  `,
  // Coloration du guide d'installation. `::ng-deep` parce que les jetons sont posés par
  // `[innerHTML]` et ne portent donc pas l'attribut d'encapsulation du composant.
  styles: [`
    .code-block { background: #0f172a; color: #e2e8f0; line-height: 1.6; }
    :host ::ng-deep .code-block .tok-comment { color: #64748b; font-style: italic; }
    :host ::ng-deep .code-block .tok-keyword { color: #c084fc; }
    :host ::ng-deep .code-block .tok-string { color: #86efac; }
    :host ::ng-deep .code-block .tok-number { color: #fdba74; }
    :host ::ng-deep .code-block .tok-type { color: #67e8f9; }
    :host ::ng-deep .code-block .tok-fn { color: #93c5fd; }
    :host ::ng-deep .code-block .tok-decorator { color: #fcd34d; }
    :host ::ng-deep .code-block .tok-tag { color: #f87171; }
    :host ::ng-deep .code-block .tok-attr { color: #fcd34d; }
    :host ::ng-deep .code-block .tok-punct { color: #94a3b8; }
  `],
})
export class ScriptInstaller implements OnInit {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly sourceId = input.required<string>();
  /**
   * FE-18 AC3 — rotation vue par le parent. `_justRegenerated` est un etat local
   * detruit par le rechargement declenche par `keyRotated` : seule cette entree
   * fait survivre le bandeau a ce rechargement.
   */
  public readonly wasRegenerated = input(false);
  /** FE-03 — sans `lead:source:credentials`, pas de rotation de cle. */
  public readonly canManageSecrets = input(false);
  /** Nom de la source, repris en tête du code Angular/React. */
  public readonly sourceLabel = input('');
  /** Règles de correspondance enregistrées : elles disent quels champs le site doit envoyer. */
  public readonly mappingRules = input<MappingRule[]>([]);
  /** Formulaire composé dans le CRM : les onglets Angular/React donnent un composant d'affichage. */
  public readonly hosted = input(false);

  public readonly keyRotated = output<void>();

  public isLoading = signal(true);
  /** Le serveur refuse de construire un script inutilisable (adresse publique de l'API absente). */
  public loadError = signal<string | null>(null);
  public snippet = signal<SnippetResult | null>(null);
  public webmasterEmail = signal('');
  public isSending = signal(false);
  public activeGuide = signal('html');
  public isRegenerating = signal(false);
  public previewOpen = signal(false);

  /** FE-11 AC2 — aperçu de ce que recevra le webmaster. */
  public readonly previewSubject = computed(
    () => "Installation du script de capture de leads sur votre site",
  );

  public readonly previewBody = computed(() => {
    const snippet = this.snippet();
    return [
      'Bonjour,',
      '',
      "Merci d'installer le script ci-dessous sur notre site, juste avant la balise fermante </body>,",
      'sur toutes les pages qui contiennent le formulaire de contact.',
      '',
      snippet?.html ?? '',
      '',
      "Aucune autre modification n'est nécessaire : le script se rattache automatiquement au formulaire.",
      "Une fois en ligne, l'installation sera détectée automatiquement de notre côté.",
      '',
      'Merci d\'avance,',
    ].join('\n');
  });

  /** Rotation demandee par le parent, ou effectuee depuis cet ecran. */
  private _justRegenerated = signal(false);
  public readonly showRegeneratedWarning = computed(
    () => this.wasRegenerated() || this._justRegenerated(),
  );

  public readonly guideTabs = [
    { id: 'html', label: 'HTML' },
    { id: 'wordpress', label: 'WordPress' },
    { id: 'wix', label: 'Wix / Webflow' },
    { id: 'angular', label: 'Angular' },
    { id: 'react', label: 'React' },
  ];

  public readonly expected = computed(() => expectedFields(this.mappingRules()));

  private readonly _frameworkInput = computed(() => {
    const s = this.snippet();
    return {
      apiBaseUrl: (s?.apiBaseUrl ?? '').replace(/\/+$/, ''),
      publicKey: s?.publicKey ?? '',
      sourceLabel: this.sourceLabel(),
      ...this.expected(),
    };
  });
  public readonly angularCode = computed(() => angularSnippet(this._frameworkInput()));

  private readonly _hostedInput = computed(() => {
    const s = this.snippet();
    return {
      sdkUrl: s?.sdkUrl ?? '',
      sriHash: s?.sriHash ?? '',
      publicKey: s?.publicKey ?? '',
      apiBaseUrl: (s?.apiBaseUrl ?? '').replace(/\/+$/, ''),
      containerId: s?.formContainerId || 'sankore-form',
      sourceLabel: this.sourceLabel(),
    };
  });
  public readonly hostedScript = computed(() => hostedScriptTag(this._hostedInput()));
  public readonly angularHostedCode = computed(() => angularHostedSnippet(this._hostedInput()));
  public readonly reactHostedCode = computed(() => reactHostedSnippet(this._hostedInput()));
  public readonly reactCode = computed(() => reactSnippet(this._frameworkInput()));
  public copiedId = signal<string | null>(null);

  ngOnInit(): void {
    this._loadSnippet();
  }

  public copyScript(): void {
    this.copyText(this.snippet()?.html, 'script');
  }

  /** Les extraits sont générés ici même ; seuls les deux balisages `<script>` sont en HTML. */
  public highlight(code: string | null | undefined, lang: HighlightLanguage | undefined): string {
    return highlightCode(code ?? '', lang ?? 'typescript');
  }

  public copyText(text: string | null | undefined, id: string): void {
    const html = text;
    if (!html) return;
    // Hors contexte securise, `navigator.clipboard` est absent ou la promesse est
    // rejetee : le bouton restait sur « Copier » sans le moindre retour.
    if (!navigator.clipboard?.writeText) {
      this._snackbar.error(
        'Copie impossible',
        'Votre navigateur bloque la copie automatique. Sélectionnez le script puis copiez-le à la main.',
      );
      return;
    }
    navigator.clipboard.writeText(html).then(
      () => {
        this.copiedId.set(id);
        setTimeout(() => this.copiedId.set(null), 2000);
      },
      () => {
        this._snackbar.error(
          'Copie impossible',
          'Sélectionnez le script puis copiez-le à la main.',
        );
      },
    );
  }

  /**
   * FE-18 AC3 — regenere la cle publique. L'ancien script cesse immediatement
   * de fonctionner : confirmation explicite avant, bandeau d'avertissement apres.
   */
  public regenerateKey(): void {
    this._confirm.confirm({
      title: 'Régénérer la clé publique ?',
      message:
        "L'ancien script cessera immédiatement de fonctionner. Vous devrez remplacer le script sur votre site avant de recevoir de nouveaux leads.",
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Régénérer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isRegenerating.set(true);
        this._sourcesService.rotatePublicKey(this.sourceId()).pipe(
          catchError(() => {
            this.isRegenerating.set(false);
            return EMPTY;
          }),
        ).subscribe(() => {
          this._justRegenerated.set(true);
          this.isRegenerating.set(false);
          this._snackbar.success(
            'Clé régénérée',
            'Copiez le nouveau script et remplacez-le sur votre site.',
          );
          this._loadSnippet();
          this.keyRotated.emit();
        });
      },
    });
  }

  public sendToWebmaster(): void {
    if (!this.webmasterEmail()) return;
    this.isSending.set(true);
    this._sourcesService.sendSnippet(this.sourceId(), {
      email: this.webmasterEmail(),
    }).pipe(
      catchError(() => {
        this.isSending.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Envoyé', `Le script a été envoyé à ${this.webmasterEmail()}.`);
      this.isSending.set(false);
      this.webmasterEmail.set('');
    });
  }

  private _loadSnippet(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._sourcesService.getSnippet(this.sourceId()).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.error?.title === 'SNIPPET_PUBLIC_URL_NOT_CONFIGURED') {
          this.loadError.set(
            "Le script ne peut pas être généré : l'adresse publique de l'API n'est pas configurée sur le serveur (Leads:Snippet:PublicBaseUrl). Contactez l'administrateur de la plateforme.",
          );
        }
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      this.snippet.set(result);
      this.isLoading.set(false);
    });
  }
}

export default ScriptInstaller;
