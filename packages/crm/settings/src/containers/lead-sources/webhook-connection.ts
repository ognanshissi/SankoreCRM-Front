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
import { LeadSourcesService } from './lead-sources.service';

/**
 * FE-17 — Paramétrer une source webhook et remettre les accès au fournisseur
 * FE-18 — Remplacer le secret d'une source
 */
@Component({
  selector: 'webhook-connection',
  standalone: true,
  imports: [
    FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasInput, TasInputPassword,
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

      <!-- Other Secrets (API key, password, etc.) -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:lock" class="text-slate-400" style="font-size:14px"></tas-icon>
            Secrets supplémentaires
          </p>
        </div>
        <div class="p-4 flex flex-col gap-3">
          @for (secret of otherSecrets(); track secret.name) {
            <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <p class="text-xs font-medium text-slate-700">{{ secret.name }}</p>
                <p class="text-xs text-slate-400 font-mono">{{ secret.hint }}</p>
                @if (secret.expiresAt) {
                  <p class="text-[10px] text-amber-500 mt-0.5">Expire : {{ secret.expiresAt }}</p>
                }
              </div>
              @if (canManageSecrets()) {
                <button tas-outlined-button type="button" class="text-xs"
                        (click)="showReplaceSecret(secret.name!)">
                  <tas-icon iconName="feather:edit-2" style="font-size:10px"></tas-icon>
                  Remplacer
                </button>
              }
            </div>
          }

          <!-- Replace secret form -->
          @if (replacingSecretName()) {
            <div class="p-3 border border-slate-200 rounded-lg flex flex-col gap-3">
              <p class="text-xs font-medium text-slate-700">
                Remplacer le secret « {{ replacingSecretName() }} »
              </p>
              <tas-input-password placeholder="Nouvelle valeur" [(value)]="newSecretValue">
                Valeur
              </tas-input-password>
              <tas-form-field>
                <tas-label>Expiration (optionnel)</tas-label>
                <input tasInput type="datetime-local"
                       [ngModel]="newSecretExpiry()" (ngModelChange)="newSecretExpiry.set($event)" />
              </tas-form-field>
              <div class="flex justify-end gap-2">
                <button tas-outlined-button type="button" (click)="cancelReplaceSecret()">Annuler</button>
                <button tas-raised-button color="primary" type="button"
                        [disabled]="isSettingSecret() || !newSecretValue()"
                        [isLoading]="isSettingSecret()"
                        (click)="confirmReplaceSecret()">
                  Enregistrer
                </button>
              </div>
            </div>
          }
        </div>
      </tas-card>

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
                  [disabled]="isSaving() || invalidIps().length > 0"
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
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly source = input.required<LeadSourceDetailDto>();
  public readonly readonly = input(false);
  public readonly canManageSecrets = input(true);
  public readonly settingsSaved = output<void>();

  // Webhook URL
  public readonly webhookUrl = computed(() => {
    const pk = this.source().publicKey;
    return `https://ingest.sankore-crm.com/api/ingest/hooks/${pk ?? '???'}`;
  });
  public urlCopied = signal(false);

  // HMAC secret
  public revealedHmacSecret = signal<string | null>(null);
  public hmacOldExpiresAt = signal<string | null>(null);
  public isRotatingHmac = signal(false);

  public readonly hmacHint = computed((): SecretHintDto | null => {
    return (this.source().secrets ?? []).find((s) => s.name === 'hmac') ?? null;
  });

  public readonly otherSecrets = computed((): SecretHintDto[] => {
    return (this.source().secrets ?? []).filter((s) => s.name !== 'hmac');
  });

  // Replace secret form (FE-18)
  public replacingSecretName = signal<string | null>(null);
  public newSecretValue = signal('');
  public newSecretExpiry = signal('');
  public isSettingSecret = signal(false);

  // IP allowlist
  public allowedIps = signal<string[]>([]);

  // External ID path
  public externalIdPath = signal('');

  // Provider doc
  public isDownloadingDoc = signal(false);

  // Save
  public isSaving = signal(false);

  ngOnInit(): void {
    const settings = this.source().settings as any ?? {};
    this.allowedIps.set(settings.allowedIps ?? []);
    this.externalIdPath.set(settings.externalIdPath ?? '');
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

  // ——— FE-18: Replace other secret ———

  public showReplaceSecret(name: string): void {
    this.replacingSecretName.set(name);
    this.newSecretValue.set('');
    this.newSecretExpiry.set('');
  }

  public cancelReplaceSecret(): void {
    this.replacingSecretName.set(null);
  }

  public confirmReplaceSecret(): void {
    const name = this.replacingSecretName();
    if (!name || !this.newSecretValue()) return;

    this.isSettingSecret.set(true);
    this._sourcesService.setSecret(this.source().id!, name, {
      value: this.newSecretValue(),
      expiresAt: this.newSecretExpiry() || null,
    }).pipe(
      catchError(() => {
        this.isSettingSecret.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Secret mis à jour', `Le secret « ${name} » a été remplacé.`);
      this.isSettingSecret.set(false);
      this.replacingSecretName.set(null);
      this.settingsSaved.emit();
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
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
    const ipv6 = /^[0-9a-fA-F:]+(\/(12[0-8]|[1-9]\d?))?$/;
    return this.allowedIps().filter((ip) => {
      if (!ip) return false;
      return !ipv4.test(ip) && !ipv6.test(ip);
    });
  }

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
      settings: {
        ...(src.settings ?? {}),
        allowedIps: this.allowedIps().filter(Boolean),
        externalIdPath: this.externalIdPath() || null,
      } as any,
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
