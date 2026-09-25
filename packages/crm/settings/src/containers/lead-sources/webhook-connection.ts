import { Component, inject, input, output, signal, OnInit, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
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
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasInput, TasInputPassword, SourceSecrets,
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
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-xs text-slate-700 select-all overflow-x-auto">
              {{ webhookUrl() }}
            </div>
            <button tas-outlined-button type="button" class="shrink-0" (click)="copyUrl()">
              <tas-icon [iconName]="urlCopied() ? 'feather:check' : 'feather:copy'" style="font-size:12px"></tas-icon>
              {{ urlCopied() ? 'Copié' : 'Copier' }}
            </button>
          </div>
        </div>
      </tas-card>

      <!-- HMAC Signature Secret -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:key" class="text-slate-400" style="font-size:14px"></tas-icon>
            Secret de signature HMAC
          </p>
          <p class="text-xs text-slate-400 mt-0.5">
            Le fournisseur signe chaque requête avec ce secret. Le CRM vérifie la signature.
          </p>
        </div>
        <div class="p-4 flex flex-col gap-3">
          <!-- Newly revealed secret -->
          @if (revealedHmacSecret()) {
            <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
              <p class="text-xs font-medium text-green-800 mb-1">
                Nouveau secret généré — copiez-le maintenant, il ne sera plus affiché.
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
                  L'ancien secret reste accepté jusqu'au {{ hmacOldExpiresAt() }}.
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
                  <p class="text-[10px] text-slate-400 mt-0.5">Mis à jour : {{ hmacHint()!.updatedAt }}</p>
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
            <p class="text-xs text-slate-400">Aucun secret HMAC configuré.</p>
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
            <p class="text-xs text-slate-400 mt-1">
              Chemin dans le payload JSON pour extraire l'identifiant unique du lead chez le fournisseur.
            </p>
            @if (externalIdPathInvalid()) {
              <p class="text-xs text-red-500 mt-1">{{ jsonPathHint }}</p>
            }
          </tas-form-field>
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
  public readonly webhookUrl = computed(() => {
    const pk = this.source().publicKey;
    // FE-17 — l'hote vient de l'environnement : en dev/recette l'URL remise au
    // fournisseur doit pointer sur l'instance courante, pas sur la prod.
    const host = (this._env.ingestUrl || this._env.apiUrl || '').replace(/\/+$/, '');
    return `${host}/api/ingest/hooks/${pk ?? '???'}`;
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
    }
  }

  // ——— Copy ———

  public copyUrl(): void {
    navigator.clipboard.writeText(this.webhookUrl()).then(() => {
      this.urlCopied.set(true);
      setTimeout(() => this.urlCopied.set(false), 2000);
    });
  }

  public copySecret(value: string): void {
    navigator.clipboard.writeText(value).then(() => {
      this._snackbar.success('Copié', 'Le secret a été copié dans le presse-papiers.');
    });
  }

  // ——— FE-18: Rotate HMAC ———

  public rotateHmac(): void {
    this._confirm.confirm({
      title: 'Remplacer le secret HMAC ?',
      message: 'L\'ancien secret restera accepté pendant 7 jours. Le nouveau secret ne sera affiché qu\'une seule fois.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Remplacer', theme: 'warn' },
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
          this.hmacOldExpiresAt.set(result.oldExpiresAt ?? null);
          this.isRotatingHmac.set(false);
          this._snackbar.success('Secret remplacé', 'Copiez le nouveau secret avant de quitter cette page.');
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
    if (this.invalidIps().length > 0) return;
    this.isSaving.set(true);

    const src = this.source();
    this._sourcesService.update(src.id!, {
      version: src.version,
      label: src.label,
      settings: writeSettings(src.settings, src.mode, {
        allowedIps: this.allowedIps().filter(Boolean),
        externalIdPath: this.externalIdPath() || null,
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
