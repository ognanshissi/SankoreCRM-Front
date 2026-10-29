import { Component, inject, input, output, signal, OnInit, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasHint, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SecretHintDto, LeadSourceDetailDto } from '@sankore/crm-api';
import { ENVIRONMENT_CONFIG } from '@sankore/crm/common';
import { LeadSourcesService } from './lead-sources.service';
import { SourceSecrets } from './source-secrets/source-secrets';
import { JSONPATH_HINT, isValidIpOrCidr, isValidJsonPath } from './lead-source-validators';
import { isWebhookSettings, readSettings, writeSettings } from './lead-source-settings.types';

/**
 * FE-17 — Paramétrer une source webhook et remettre les accès au fournisseur
 * FE-18 — Remplacer le secret d'une source
 */
@Component({
  selector: 'webhook-connection',
  standalone: true,
  imports: [
    FormsModule, DatePipe, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasHint, TasError, TasInput, TasInputPassword, SourceSecrets,
  ],
  template: `
    <div class="max-w-3xl flex flex-col gap-4">
      <!-- Webhook URL -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:link" class="text-slate-400" style="font-size:14px"></tas-icon>
            URL du webhook
          </p>
          <p class="text-xs text-slate-400 mt-0.5">
            Le fournisseur doit envoyer ses leads à cette URL via POST.
          </p>
        </div>
        <div class="p-4">
          @if (webhookUrl(); as url) {
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-700 select-all overflow-x-auto">
                {{ url }}
              </div>
              <button tas-outlined-button type="button" class="shrink-0" (click)="copyUrl()">
                <tas-icon [iconName]="urlCopied() ? 'feather:check' : 'feather:copy'" style="font-size:12px"></tas-icon>
                {{ urlCopied() ? 'Copié' : 'Copier' }}
              </button>
            </div>
          } @else {
            <p class="text-xs text-amber-600 flex items-center gap-1">
              <tas-icon iconName="feather:alert-triangle" style="font-size:12px"></tas-icon>
              La clé publique de cette source n'est pas encore générée : l'URL du webhook
              apparaîtra ici dès que le serveur l'aura attribuée.
            </p>
          }
        </div>
      </tas-card>

      <!-- Événements partenaire (webhooks lot 6) -->
      @if (webhookUrl(); as url) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <tas-icon iconName="feather:activity" class="text-slate-400" style="font-size:14px"></tas-icon>
              Événements du fournisseur
            </p>
            <p class="text-xs text-slate-400 mt-0.5">
              Le fournisseur peut signaler ce qui arrive à un lead qu’il a envoyé (« rendez-vous pris »,
              « dossier complété ») : le CRM retrouve le lead et lance les workflows prévus pour cet événement.
            </p>
          </div>
          <div class="p-4 flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-700 select-all overflow-x-auto">
                {{ url }}/events
              </div>
              <button tas-outlined-button type="button" class="shrink-0" (click)="copyEventsUrl(url + '/events')">
                <tas-icon iconName="feather:copy" style="font-size:12px"></tas-icon>
                Copier
              </button>
            </div>
            <ul class="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
              <li>Même secret de signature et mêmes adresses IP autorisées que pour les leads.</li>
              <li>Le lead est retrouvé par son identifiant externe, ou par téléphone parmi les leads de cette source uniquement.</li>
              <li>
                Pour agir sur un événement, ajoutez à un workflow « Lead » un déclencheur
                <span class="font-medium">Événement externe</span> portant son type (par exemple
                <code class="font-mono">appointment.booked</code>).
              </li>
              <li>Le format complet est dans la documentation fournisseur ci-dessous.</li>
            </ul>
          </div>
        </tas-card>
      }

      <!-- HMAC Signature Secret -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:key" class="text-slate-400" style="font-size:14px"></tas-icon>
            Secret de signature HMAC
          </p>
          @if (hmacHint()) {
            <p class="text-xs text-slate-500 mt-0.5">
              Signature exigée : toute requête non signée ou mal signée est refusée (401).
            </p>
          } @else {
            <p class="text-xs text-amber-700 mt-0.5">
              Aucun secret : les envois ne sont pas vérifiés, et la source ne pourra pas être activée tant qu’il manque.
            </p>
          }
        </div>
        <div class="p-4 flex flex-col gap-3">
          @if (source().lastRejectedAt) {
            <div class="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
              Dernier envoi refusé le {{ source().lastRejectedAt | date:'dd/MM/yyyy HH:mm' }} :
              {{ rejectionLabel(source().lastRejectedReason) }}.
            </div>
          }
          <!-- Newly revealed secret -->
          @if (revealedHmacSecret()) {
            <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p class="text-xs font-medium text-green-800 mb-1">
                Secret généré — copiez-le maintenant, il ne sera plus affiché.
              </p>
              <div class="flex items-center gap-2">
                <code class="flex-1 bg-white border border-green-300 rounded px-2 py-1 text-xs font-mono select-all">
                  {{ revealedHmacSecret() }}
                </code>
                <button tas-outlined-button type="button" class="shrink-0 text-xs" (click)="copySecret(revealedHmacSecret()!)">
                  <tas-icon iconName="feather:copy" style="font-size:10px"></tas-icon>
                  Copier
                </button>
              </div>
              @if (hmacOldExpiresAt()) {
                <p class="text-xs text-amber-600 mt-2">
                  L'ancien secret reste accepté jusqu'au {{ hmacOldExpiresAt() | date:'dd/MM/yyyy HH:mm' }}.
                </p>
              }
            </div>
          }

          <!-- Current hint -->
          @if (hmacHint()) {
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs text-slate-400">Secret actuel</p>
                <p class="text-sm text-slate-700 font-mono">{{ hmacHint()!.hint }}</p>
                @if (hmacHint()!.updatedAt) {
                  <p class="text-[10px] text-slate-400 mt-0.5">
                    Mis à jour : {{ hmacHint()!.updatedAt | date:'dd/MM/yyyy HH:mm' }}
                  </p>
                }
              </div>
              @if (canManageSecrets()) {
                <button tas-outlined-button type="button" class="text-xs"
                        [disabled]="isRotatingHmac()"
                        [isLoading]="isRotatingHmac()"
                        (click)="rotateHmac()">
                  <tas-icon iconName="feather:refresh-cw" style="font-size:10px"></tas-icon>
                  Remplacer
                </button>
              }
            </div>
          } @else {
            <!-- FE-17 AC2 — la premiere generation doit etre accessible : le bouton
                 « Remplacer » vivait dans la branche « un secret existe », donc une
                 source neuve n'offrait aucun moyen d'en creer un. -->
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs text-slate-400">Aucun secret HMAC configuré.</p>
              @if (canManageSecrets()) {
                <button tas-outlined-button type="button" class="text-xs shrink-0"
                        [disabled]="isRotatingHmac()"
                        [isLoading]="isRotatingHmac()"
                        (click)="rotateHmac()">
                  <tas-icon iconName="feather:key" style="font-size:10px"></tas-icon>
                  Générer le secret de signature
                </button>
              }
            </div>
          }
        </div>
      </tas-card>

      <!-- Secrets supplémentaires (FE-18) — formulaire partagé avec le mode pull -->
      <source-secrets
        [sourceId]="source().id!"
        [secrets]="source().secrets ?? []"
        [ignore]="['hmac']"
        [canManage]="canManageSecrets()"
        [readonly]="readonly()"
        title="Secrets supplémentaires"
        (secretSaved)="settingsSaved.emit()"
      ></source-secrets>

      <!-- IP Allowlist -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:shield" class="text-slate-400" style="font-size:14px"></tas-icon>
            IP autorisées
          </p>
          <p class="text-xs text-slate-400 mt-0.5">
            Optionnel — restreindre les appels aux adresses IP listées (IPv4, IPv6 ou plages CIDR).
          </p>
        </div>
        <div class="p-4 flex flex-col gap-2">
          @for (ip of allowedIps(); track $index; let i = $index) {
            <div class="flex items-center gap-2">
              <input tasInput type="text" placeholder="203.0.113.0/24"
                     [ngModel]="ip" (ngModelChange)="updateIp(i, $event)"
                     [disabled]="readonly()" class="flex-1 font-mono text-xs" />
              @if (!readonly()) {
                <button tas-icon-button type="button" (click)="removeIp(i)">
                  <tas-icon iconName="feather:x" class="text-red-400" style="font-size:10px"></tas-icon>
                </button>
              }
            </div>
          }
          @if (!readonly()) {
            <button tas-outlined-button type="button" class="self-start text-xs" (click)="addIp()">
              <tas-icon iconName="feather:plus" style="font-size:10px"></tas-icon>
              Ajouter une IP
            </button>
          }
          @if (invalidIps().length > 0) {
            <p class="text-xs text-red-500">Format invalide : {{ invalidIps().join(', ') }}</p>
          }
        </div>
      </tas-card>

      <!-- External ID path -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:hash" class="text-slate-400" style="font-size:14px"></tas-icon>
            Identifiant externe
          </p>
        </div>
        <div class="p-4">
          <tas-form-field>
            <tas-label>Chemin JSONPath de l'identifiant</tas-label>
            <input tasInput type="text" placeholder="$.data.id"
                   [ngModel]="externalIdPath()" (ngModelChange)="externalIdPath.set($event)"
                   [disabled]="readonly()" class="font-mono" />
            <!-- tas-form-field ne projette que tas-label, tas-hint, tas-error et ses
                 controles : en simples paragraphes, l'aide ET l'erreur disparaissaient
                 du DOM, laissant le bouton Enregistrer desactive sans motif visible. -->
            <tas-hint class="text-slate-400">
              Chemin dans le payload JSON pour extraire l'identifiant unique du lead chez le fournisseur.
            </tas-hint>
            @if (externalIdPathInvalid()) {
              <tas-error>{{ jsonPathHint }}</tas-error>
            }
          </tas-form-field>

          <label class="mt-3 flex items-start gap-2 text-sm text-slate-700" [class.opacity-50]="!externalIdPath().trim()">
            <input type="checkbox" class="mt-0.5 h-4 w-4 accent-primary"
                   [checked]="allowUpdates()"
                   [disabled]="readonly() || !externalIdPath().trim()"
                   (change)="allowUpdates.set($any($event.target).checked)" />
            <span>
              Mettre à jour le lead quand le même identifiant revient
              <span class="block text-xs text-slate-400">
                Seuls ses champs personnalisés sont mis à jour, sans effacer les autres. Jamais son statut,
                son propriétaire ni ce qu’un agent a saisi.
              </span>
            </span>
          </label>
        </div>
      </tas-card>

      <!-- Provider documentation -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:file-text" class="text-slate-400" style="font-size:14px"></tas-icon>
            Documentation fournisseur
          </p>
          <p class="text-xs text-slate-400 mt-0.5">
            Téléchargez un PDF personnalisé avec l'URL, le format attendu, le calcul de signature et des exemples.
          </p>
        </div>
        <div class="p-4">
          <button tas-outlined-button type="button"
                  [disabled]="isDownloadingDoc()"
                  [isLoading]="isDownloadingDoc()"
                  (click)="downloadDoc()">
            <tas-icon iconName="feather:download" style="font-size:14px"></tas-icon>
            Télécharger la documentation
          </button>
        </div>
      </tas-card>

      <!-- Save settings -->
      @if (!readonly()) {
        <div class="flex justify-end">
          <button tas-raised-button color="primary" type="button"
                  [disabled]="isSaving() || invalidIps().length > 0 || externalIdPathInvalid()"
                  [isLoading]="isSaving()"
                  (click)="save()">
            <tas-icon iconName="feather:save" style="font-size:14px"></tas-icon>
            Enregistrer
          </button>
        </div>
      }
    </div>
  `,
})
export class WebhookConnection implements OnInit {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _env = inject(ENVIRONMENT_CONFIG);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly source = input.required<LeadSourceDetailDto>();
  public readonly readonly = input(false);
  public readonly canManageSecrets = input(true);
  public readonly settingsSaved = output<void>();

  // Webhook URL
  /**
   * `null` tant que la source n'a pas de cle publique : l'ecran affichait
   * `…/hooks/???` et « Copier » recopiait cette URL inutilisable sans prevenir.
   */
  public readonly webhookUrl = computed((): string | null => {
    const pk = this.source().publicKey;
    if (!pk) return null;
    // FE-17 — l'hote vient de l'environnement : en dev/recette l'URL remise au
    // fournisseur doit pointer sur l'instance courante, pas sur la prod.
    const host = (this._env.ingestUrl || this._env.apiUrl || '').replace(/\/+$/, '');
    return `${host}/api/ingest/hooks/${pk}`;
  });
  public urlCopied = signal(false);
  public readonly jsonPathHint = JSONPATH_HINT;

  // HMAC secret
  public revealedHmacSecret = signal<string | null>(null);
  public hmacOldExpiresAt = signal<string | null>(null);
  public isRotatingHmac = signal(false);

  public readonly hmacHint = computed((): SecretHintDto | null => {
    return (this.source().secrets ?? []).find((s) => s.name === 'hmac') ?? null;
  });

  // IP allowlist
  public allowedIps = signal<string[]>([]);

  // External ID path
  public externalIdPath = signal('');
  public allowUpdates = signal(false);

  // Provider doc
  public isDownloadingDoc = signal(false);

  // Save
  public isSaving = signal(false);

  ngOnInit(): void {
    const src = this.source();
    const settings = readSettings(src.settings, src.mode);
    if (isWebhookSettings(settings)) {
      this.allowedIps.set(settings.allowedIps);
      this.externalIdPath.set(settings.externalIdPath ?? '');
      this.allowUpdates.set(settings.allowUpdates);
    }
  }

  /** Pourquoi le dernier envoi a été refusé, dans les mots de l’administrateur. */
  public rejectionLabel(reason: string | null | undefined): string {
    switch (reason) {
      case 'SIGNATURE_MISSING':
        return 'aucune signature dans la requête';
      case 'SIGNATURE_INVALID':
        return 'signature incorrecte (mauvais secret ou corps modifié)';
      case 'SIGNATURE_EXPIRED':
        return 'signature trop ancienne (horloge du fournisseur décalée de plus de 5 minutes)';
      case 'SIGNATURE_MALFORMED':
        return 'en-tête de signature mal formé (attendu : t=…,v1=…)';
      case 'SIGNATURE_SECRET_MISSING':
        return 'aucun secret configuré pour vérifier la signature';
      case 'IP_NOT_ALLOWED':
        return 'adresse IP non autorisée';
      default:
        return reason ?? 'motif inconnu';
    }
  }

  // ——— Copy ———

  public copyUrl(): void {
    const url = this.webhookUrl();
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      this.urlCopied.set(true);
      setTimeout(() => this.urlCopied.set(false), 2000);
    });
  }

  public copyEventsUrl(url: string): void {
    navigator.clipboard.writeText(url).then(() =>
      this._snackbar.success('Copié', 'L’adresse des événements a été copiée.'));
  }

  public copySecret(value: string): void {
    navigator.clipboard.writeText(value).then(() => {
      this._snackbar.success('Copié', 'Le secret a été copié dans le presse-papiers.');
    });
  }

  // ——— FE-18: Rotate HMAC ———

  public rotateHmac(): void {
    // FE-17 AC2 / FE-18 — le meme appel sert a la premiere generation et au
    // remplacement : a la premiere generation il n'y a pas d'ancien secret, donc
    // on n'annonce pas la periode de tolerance de 7 jours.
    const isFirstGeneration = !this.hmacHint();

    this._confirm.confirm({
      title: isFirstGeneration ? 'Générer le secret de signature ?' : 'Remplacer le secret HMAC ?',
      message: isFirstGeneration
        ? 'Le CRM génère le secret et ne l\'affiche qu\'une seule fois : copiez-le et remettez-le au fournisseur avant de quitter cette page.'
        : 'L\'ancien secret restera accepté pendant 7 jours. Le nouveau secret ne sera affiché qu\'une seule fois.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: isFirstGeneration ? 'Générer' : 'Remplacer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isRotatingHmac.set(true);
        this._sourcesService.rotateHmacSecret(this.source().id!).pipe(
          catchError(() => {
            this.isRotatingHmac.set(false);
            return EMPTY;
          }),
        ).subscribe((result) => {
          this.revealedHmacSecret.set(result.secret ?? null);
          // Une première génération n'a pas d'ancien secret : rien à annoncer.
          this.hmacOldExpiresAt.set(isFirstGeneration ? null : result.oldExpiresAt ?? null);
          this.isRotatingHmac.set(false);
          this._snackbar.success(
            isFirstGeneration ? 'Secret généré' : 'Secret remplacé',
            'Copiez le secret avant de quitter cette page.',
          );
          // Sans ce rechargement l'indice affiche reste celui de l'ancien secret
          // et `source().version` est perimee : l'enregistrement suivant repart
          // avec une version obsolete et peut echouer en 409.
          this.settingsSaved.emit();
        });
      },
    });
  }

  // ——— IP allowlist ———

  public addIp(): void {
    this.allowedIps.update((list) => [...list, '']);
  }

  public removeIp(index: number): void {
    this.allowedIps.update((list) => list.filter((_, i) => i !== index));
  }

  public updateIp(index: number, value: string): void {
    this.allowedIps.update((list) => list.map((ip, i) => i === index ? value : ip));
  }

  public invalidIps(): string[] {
    return this.allowedIps().filter((ip) => !!ip && !isValidIpOrCidr(ip));
  }

  /** FE-17 AC5 — le chemin de l'identifiant externe doit etre un JSONPath. */
  public readonly externalIdPathInvalid = computed(
    () => !!this.externalIdPath() && !isValidJsonPath(this.externalIdPath()),
  );

  // ——— Provider doc ———

  public downloadDoc(): void {
    this.isDownloadingDoc.set(true);
    this._sourcesService.getProviderDoc(this.source().id!).pipe(
      catchError(() => {
        this.isDownloadingDoc.set(false);
        return EMPTY;
      }),
    ).subscribe((blob: any) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `webhook-doc-${this.source().code ?? 'source'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      this.isDownloadingDoc.set(false);
    });
  }

  // ——— Save settings (IPs + external ID path) ———

  public save(): void {
    if (this.invalidIps().length > 0 || this.externalIdPathInvalid()) return;
    this.isSaving.set(true);

    const src = this.source();
    // Les validateurs comparent la valeur `trim()` mais l'enregistrement partait
    // brut : ` $.data.id ` collé depuis un mail passait pour valide et cassait
    // silencieusement la deduplication cote back.
    const externalIdPath = this.externalIdPath().trim();
    this._sourcesService.update(src.id!, {
      version: src.version,
      label: src.label,
      settings: writeSettings(src.settings, src.mode, {
        allowedIps: this.allowedIps().map((ip) => ip.trim()).filter(Boolean),
        externalIdPath: externalIdPath || null,
        // Sans identifiant externe, rien ne permet de reconnaître un lead déjà reçu.
        allowUpdates: !!externalIdPath && this.allowUpdates(),
      }),
    }).pipe(
      catchError(() => {
        this.isSaving.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Enregistré', 'Les paramètres de connexion ont été mis à jour.');
      this.isSaving.set(false);
      this.settingsSaved.emit();
    });
  }
}

export default WebhookConnection;
