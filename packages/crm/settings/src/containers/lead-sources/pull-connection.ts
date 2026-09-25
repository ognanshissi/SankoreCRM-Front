import { Component, computed, input, output } from '@angular/core';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { LeadSourceDetailDto } from '@sankore/crm-api';
import { SecretSlot, SourceSecrets } from './source-secrets/source-secrets';
import { isPullSettings, readSettings } from './lead-source-settings.types';

/**
 * FE-19 — Onglet « Connexion » du mode `ScheduledPull`.
 *
 * L'assistant renvoyait l'utilisateur vers « l'onglet Connexion » pour saisir
 * ses secrets, mais cet onglet n'existait que pour `ServerWebhook` : une source
 * pull ne pouvait donc pas etre configurée. Les emplacements de secrets sont
 * deduits du type d'authentification choisi dans l'assistant.
 */
@Component({
  selector: 'pull-connection',
  standalone: true,
  imports: [TasCard, TasIcon, SourceSecrets],
  template: `
    <div class="max-w-3xl flex flex-col gap-4">
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <tas-icon iconName="feather:link" class="text-slate-400" style="font-size:14px"></tas-icon>
            Connexion au fournisseur
          </p>
        </div>
        <div class="p-4 grid grid-cols-2 gap-4">
          <div>
            <p class="text-xs text-slate-400 mb-1">URL de base</p>
            <p class="text-sm text-slate-800 font-mono break-all">{{ baseUrl() || '—' }}</p>
          </div>
          <div>
            <p class="text-xs text-slate-400 mb-1">Authentification</p>
            <p class="text-sm text-slate-800">{{ authLabel() }}</p>
          </div>
        </div>
        @if (!baseUrl()) {
          <div class="px-4 pb-4">
            <p class="text-xs text-amber-600">
              Renseignez d'abord l'étape « Connexion » de l'onglet « API fournisseur ».
            </p>
          </div>
        }
      </tas-card>

      <source-secrets
        [sourceId]="source().id!"
        [secrets]="source().secrets ?? []"
        [slots]="slots()"
        [canManage]="canManageSecrets()"
        [readonly]="readonly()"
        title="Secrets d'accès"
        subtitle="Saisis une seule fois, jamais réaffichés. Ils ne transitent pas par la configuration."
        (secretSaved)="secretSaved.emit()"
      ></source-secrets>
    </div>
  `,
})
export class PullConnection {
  public readonly source = input.required<LeadSourceDetailDto>();
  public readonly canManageSecrets = input(true);
  public readonly readonly = input(false);
  public readonly secretSaved = output<void>();

  private readonly _pull = computed(() => {
    const s = readSettings(this.source().settings, this.source().mode);
    return isPullSettings(s) ? s.pull : null;
  });

  public readonly baseUrl = computed(() => this._pull()?.baseUrl ?? '');

  public readonly authLabel = computed(() => {
    switch (this._pull()?.authType) {
      case 'ApiKey': return 'Clé API';
      case 'Bearer': return 'Bearer Token';
      case 'OAuthClientCredentials': return 'OAuth Client Credentials';
      case 'Basic': return 'Basic Auth';
      default: return 'Aucune';
    }
  });

  /** Emplacements attendus selon le type d'authentification (FE-19 AC2). */
  public readonly slots = computed((): SecretSlot[] => {
    const pull = this._pull();
    switch (pull?.authType) {
      case 'ApiKey':
        return [{
          name: 'apiKey',
          label: 'Clé API',
          description: `Envoyée dans ${pull.authHeaderLocation === 'query' ? 'le paramètre' : "l'en-tête"} « ${pull.authHeaderName} ».`,
        }];
      case 'Bearer':
        return [{ name: 'bearerToken', label: 'Jeton Bearer' }];
      case 'OAuthClientCredentials':
        return [{
          name: 'oauthClientSecret',
          label: 'Client secret OAuth',
          description: pull.oauthClientId ? `Client ID : ${pull.oauthClientId}` : undefined,
        }];
      case 'Basic':
        return [{ name: 'basicPassword', label: 'Mot de passe (Basic Auth)' }];
      default:
        return [];
    }
  });
}

export default PullConnection;
