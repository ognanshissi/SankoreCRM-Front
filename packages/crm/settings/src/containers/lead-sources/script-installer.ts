import { Component, computed, inject, input, output, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SnippetResult } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';

/**
 * FE-11 — Obtenir et partager le script à installer
 */
@Component({
  selector: 'script-installer',
  standalone: true,
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasInput,
  ],
  template: `
    <div class="max-w-3xl flex flex-col gap-4">
      @if (isLoading()) {
        <div class="flex justify-center py-12">
          <tas-spinner size="8" class="text-primary"></tas-spinner>
        </div>
      } @else if (snippet()) {
        <!-- Regenerated warning -->
        @if (showRegeneratedWarning()) {
          <div class="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
            <p class="text-xs text-amber-700">
              La clé publique a été régénérée. L'ancien script ne fonctionne plus et doit être remplacé sur votre site.
            </p>
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
                <tas-icon [iconName]="copied() ? 'feather:check' : 'feather:copy'" style="font-size:12px"></tas-icon>
                {{ copied() ? 'Copié !' : 'Copier' }}
              </button>
            </div>
          </div>
          <div class="p-4">
            <pre class="bg-slate-900 text-green-400 text-xs p-4 rounded-lg overflow-x-auto whitespace-pre-wrap font-mono select-all">{{ snippet()!.html }}</pre>
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
            <div class="flex gap-1 mb-4">
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
            <p class="text-[10px] text-slate-400 mb-0.5">Clé publique</p>
            <p class="text-xs text-slate-700 font-mono truncate">{{ snippet()!.publicKey }}</p>
          </div>
          <div class="p-3 bg-slate-50 rounded-lg">
            <p class="text-[10px] text-slate-400 mb-0.5">SDK URL</p>
            <p class="text-xs text-slate-700 font-mono truncate">{{ snippet()!.sdkUrl }}</p>
          </div>
          <div class="p-3 bg-slate-50 rounded-lg">
            <p class="text-[10px] text-slate-400 mb-0.5">SRI Hash</p>
            <p class="text-xs text-slate-700 font-mono truncate">{{ snippet()!.sriHash }}</p>
          </div>
        </div>
      }
    </div>
  `,
})
export class ScriptInstaller implements OnInit {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly sourceId = input.required<string>();
  public readonly wasRegenerated = input(false);
  /** FE-03 — sans `lead:source:credentials`, pas de rotation de cle. */
  public readonly canManageSecrets = input(false);

  public readonly keyRotated = output<void>();

  public isLoading = signal(true);
  public snippet = signal<SnippetResult | null>(null);
  public copied = signal(false);
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
  ];

  ngOnInit(): void {
    this._loadSnippet();
  }

  public copyScript(): void {
    const html = this.snippet()?.html;
    if (!html) return;
    navigator.clipboard.writeText(html).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
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
    this._sourcesService.getSnippet(this.sourceId()).pipe(
      catchError(() => {
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
