import { Component, computed, inject, input, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { DryRunResult } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';

/**
 * Noms de parametres de requete dont la valeur ne doit jamais s'afficher.
 * Compares apres normalisation (minuscules, sans `-` ni `_`), en inclusion :
 * `api_key`, `X-Api-Key` et `access_token` sont donc couverts.
 */
const SENSITIVE_PARAM_NAMES = ['key', 'token', 'secret', 'password', 'auth', 'signature'];

/** FE-20 AC2 — plafond d'affichage de la reponse brute. */
const MAX_RESPONSE_CHARS = 100 * 1024;

/** Etape de l'assistant a laquelle rattacher un echec, ou aucune. */
interface FailedStage {
  step: number | null;
  label: string | null;
  advice: string;
}

/**
 * FE-20 — Tester l'appel au fournisseur (exécution à blanc)
 */
@Component({
  selector: 'pull-dry-run',
  standalone: true,
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button],
  template: `
    <div class="max-w-4xl flex flex-col gap-4">
      <!-- Launch -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-slate-700">Test de l'API (exécution à blanc)</h2>
          <p class="text-xs text-slate-400 mt-0.5">
            Appelle l'API du fournisseur sans créer de leads. Permet de valider la configuration.
            Délai maximal : {{ timeoutSeconds }} secondes.
          </p>
        </div>
        @if (!readonly()) {
          <button tas-raised-button color="primary" type="button"
                  [disabled]="isRunning()"
                  [isLoading]="isRunning()"
                  (click)="runTest()">
            <tas-icon iconName="feather:play" style="font-size:14px"></tas-icon>
            Tester
          </button>
        }
      </div>

      @if (isRunning()) {
        <div class="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
          <tas-spinner size="5" class="text-primary"></tas-spinner>
          <div>
            <p class="text-sm font-medium text-blue-700">Test en cours…</p>
            <p class="text-xs text-blue-500">Délai maximal : {{ timeoutSeconds }} secondes.</p>
          </div>
        </div>
      }

      <!-- Error -->
      @if (error()) {
        <div class="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p class="text-sm font-medium text-red-800 flex items-center gap-2">
            <tas-icon iconName="feather:x-circle" class="text-red-500" style="font-size:14px"></tas-icon>
            @if (failedStage().label) {
              Échec du test — étape « {{ failedStage().label }} »
            } @else {
              Échec du test
            }
          </p>
          <p class="text-xs text-red-600 mt-1">{{ error() }}</p>
          <p class="text-xs text-red-500 mt-1">{{ failedStage().advice }}</p>
          @if (failedStage().step !== null) {
            <button tas-outlined-button type="button" class="text-xs mt-2"
                    (click)="goToFailedStage()">
              <tas-icon iconName="feather:arrow-left" style="font-size:10px"></tas-icon>
              Corriger cette étape
            </button>
          }
        </div>
      }

      <!-- Result -->
      @if (result()) {
        <div class="grid grid-cols-3 gap-4">
          <!-- Request -->
          <tas-card class="block col-span-3 lg:col-span-1">
            <div class="p-3 border-b border-slate-100">
              <p class="text-xs font-semibold text-slate-600">Requête envoyée</p>
            </div>
            <div class="p-3 space-y-2">
              <div>
                <p class="text-[10px] text-slate-400">URL</p>
                <p class="text-xs text-slate-700 font-mono break-all">{{ maskedUrl() }}</p>
              </div>
              <div>
                <p class="text-[10px] text-slate-400">Méthode</p>
                <p class="text-xs text-slate-700">{{ result()!.request?.method ?? '—' }}</p>
              </div>
              <div>
                <p class="text-[10px] text-slate-400">Authentification</p>
                <p class="text-xs text-slate-700">{{ result()!.request?.authType ?? '—' }}</p>
              </div>
              <p class="text-[10px] text-slate-400 italic">
                Les secrets sont masqués, y compris dans la query string.
              </p>
            </div>
          </tas-card>

          <!-- Response -->
          <tas-card class="block col-span-3 lg:col-span-2">
            <div class="p-3 border-b border-slate-100 flex items-center justify-between">
              <p class="text-xs font-semibold text-slate-600">Réponse brute</p>
              @if (responseExpanded()) {
                <button tas-outlined-button type="button" class="text-[10px]" (click)="responseExpanded.set(false)">Réduire</button>
              } @else {
                <button tas-outlined-button type="button" class="text-[10px]" (click)="responseExpanded.set(true)">Déplier</button>
              }
            </div>
            <div class="p-3">
              <pre class="bg-slate-900 text-green-400 text-[10px] p-3 rounded-lg overflow-auto font-mono"
                   [class.max-h-40]="!responseExpanded()"
                   [class.max-h-96]="responseExpanded()">{{ rawResponse().text }}</pre>
              @if (rawResponse().truncated) {
                <p class="text-[10px] text-slate-400 italic mt-1">
                  Réponse tronquée à {{ maxResponseKb }} Ko pour l'affichage.
                </p>
              }
            </div>
          </tas-card>
        </div>

        <!-- Simulated leads -->
        <tas-card class="block">
          <div class="p-3 border-b border-slate-100 flex items-center justify-between">
            <p class="text-xs font-semibold text-slate-600">
              Leads qui seraient créés
              <tas-tag severity="info" class="ml-1">{{ result()!.simulatedLeads?.length ?? 0 }}</tas-tag>
            </p>
            <div class="flex items-center gap-3 text-xs text-slate-400">
              <span>Total récupéré : {{ result()!.totalFetched ?? 0 }}</span>
              @if ((result()!.mappingErrors ?? 0) > 0) {
                <tas-tag severity="error">{{ result()!.mappingErrors }} erreur(s) mapping</tas-tag>
              }
            </div>
          </div>
          <div class="divide-y divide-slate-100">
            @for (lead of result()!.simulatedLeads ?? []; track $index) {
              <div class="px-3 py-2 flex items-center gap-3">
                <tas-icon iconName="feather:user" class="text-slate-400" style="font-size:12px"></tas-icon>
                <div class="flex-1 min-w-0 grid grid-cols-4 gap-2 text-xs">
                  <span class="truncate text-slate-700 font-medium">{{ lead.fullName ?? '—' }}</span>
                  <span class="truncate text-slate-500">{{ lead.phoneNumber ?? '—' }}</span>
                  <span class="truncate text-slate-500">{{ lead.email ?? '—' }}</span>
                  <span class="truncate text-slate-400 font-mono">{{ lead.externalId ?? '—' }}</span>
                </div>
                @if (lead.error) {
                  <tas-tag severity="error" class="shrink-0">{{ lead.error }}</tas-tag>
                }
              </div>
            }
            @if ((result()!.simulatedLeads?.length ?? 0) === 0) {
              <div class="p-4 text-center text-xs text-slate-400">Aucun lead extrait.</div>
            }
          </div>
        </tas-card>
      }
    </div>
  `,
})
export class PullDryRun {
  private readonly _sourcesService = inject(LeadSourcesService);

  public readonly sourceId = input.required<string>();
  /** FE-03 — un utilisateur en lecture seule ne doit pas pouvoir tester. */
  public readonly readonly = input(false);
  /**
   * Nom du parametre portant la cle API quand `authHeaderLocation === 'query'`.
   * Renseigne, il est masque en plus de la liste generique.
   */
  public readonly authHeaderName = input<string | null>(null);

  /** Renvoie vers l'etape fautive de l'assistant (FE-20 AC3). */
  public readonly goToStep = output<number>();

  /** Delai maximal annonce a l'utilisateur avant le lancement (FE-20 AC1). */
  public readonly timeoutSeconds = 30;
  public readonly maxResponseKb = MAX_RESPONSE_CHARS / 1024;

  public isRunning = signal(false);
  public result = signal<DryRunResult | null>(null);
  public error = signal<string | null>(null);
  /** Statut HTTP du dernier echec — le contrat documente 404, 422 et 429. */
  public errorStatus = signal<number | null>(null);
  public responseExpanded = signal(false);

  /**
   * SÉCURITÉ — `request.url` contient la clé API en clair quand elle voyage
   * dans la query string (`authHeaderLocation === 'query'`). L'écran annonçait
   * « Les secrets sont masqués » tout en affichant
   * `https://api.x.com/leads?api_key=sk_live_…`, visible dans toute copie ou
   * tout partage d'écran. Le masquage est donc refait côté front.
   */
  public readonly maskedUrl = computed(() => this._maskUrl(this.result()?.request?.url));

  /** FE-20 AC2 — la réponse brute n'est affichée que jusqu'à 100 Ko. */
  public readonly rawResponse = computed((): { text: string; truncated: boolean } => {
    const raw = this.result()?.rawResponseTruncated ?? '';
    if (!raw) return { text: 'Vide', truncated: false };
    if (raw.length <= MAX_RESPONSE_CHARS) return { text: raw, truncated: false };
    return { text: raw.slice(0, MAX_RESPONSE_CHARS), truncated: true };
  });

  /**
   * FE-20 AC3 — rattache l'echec a une etape de l'assistant. Le back ne renvoie
   * pas d'etape structuree : on la deduit du statut HTTP documente, puis du
   * message. Un 429 ou un 422 ne se corrige pas dans l'etape « Requete » :
   * la branche par defaut y renvoyait pourtant, et l'utilisateur modifiait sa
   * requete alors qu'il n'avait qu'a patienter.
   */
  public readonly failedStage = computed((): FailedStage => {
    const status = this.errorStatus();
    if (status === 429) {
      return {
        step: null,
        label: null,
        advice: 'Trop de tests lancés coup sur coup : patientez une minute avant de relancer. La configuration n\'est pas en cause.',
      };
    }
    if (status === 422) {
      return {
        step: null,
        label: null,
        advice: 'La configuration est incomplète pour lancer un test : complétez les étapes de l\'assistant et les secrets de l\'onglet « Connexion », puis relancez.',
      };
    }
    if (status === 404) {
      return {
        step: null,
        label: null,
        advice: 'La source est introuvable : elle a peut-être été supprimée ou archivée. Rechargez la page.',
      };
    }

    const msg = (this.error() ?? '').toLowerCase();
    const has = (...needles: string[]) => needles.some((n) => msg.includes(n));

    if (has('401', '403', 'unauthorized', 'forbidden', 'auth', 'token', 'credential')) {
      return { step: 0, label: 'Connexion', advice: "L'authentification a été refusée : vérifiez le type d'authentification et le secret saisi dans l'onglet « Connexion »." };
    }
    if (has('ssrf', 'adresse', 'host', 'dns', 'resolve', 'refus')) {
      return { step: 0, label: 'Connexion', advice: "L'adresse a été refusée : vérifiez l'URL de base (https:// et hôte public)." };
    }
    if (has('timeout', 'délai', 'delai', 'timed out')) {
      return { step: 1, label: 'Requête', advice: 'Le fournisseur n\'a pas répondu dans le délai imparti : vérifiez le chemin et les paramètres.' };
    }
    if (has('404', '405', '400', 'bad request', 'not found')) {
      return { step: 1, label: 'Requête', advice: 'Le fournisseur a rejeté la requête : vérifiez la méthode, le chemin et les paramètres.' };
    }
    if (has('jsonpath', 'chemin', 'aucun résultat', 'aucun resultat', 'extraction')) {
      return { step: 3, label: 'Extraction', advice: 'Un JSONPath n\'a rien retourné : vérifiez les chemins de la liste, de l\'identifiant et de la date.' };
    }
    return { step: 1, label: 'Requête', advice: 'Reprenez la configuration de la requête puis relancez le test.' };
  });

  public goToFailedStage(): void {
    const step = this.failedStage().step;
    if (step !== null) this.goToStep.emit(step);
  }

  public runTest(): void {
    if (this.readonly()) return;
    this.isRunning.set(true);
    this.result.set(null);
    this.error.set(null);
    this.errorStatus.set(null);

    this._sourcesService.dryRun(this.sourceId()).pipe(
      catchError((err: HttpErrorResponse) => {
        this.errorStatus.set(err?.status ?? null);
        this.error.set(this._describeError(err));
        this.isRunning.set(false);
        return EMPTY;
      }),
    ).subscribe((res) => {
      this.result.set(res);
      this.isRunning.set(false);
    });
  }

  /**
   * `detail` n'est pas toujours renseigné : sur un ProblemDetails de validation,
   * le diagnostic est porté par `title` et `errors`. S'en tenir à `detail`
   * affichait « Erreur inattendue » alors que le serveur nommait le champ fautif.
   */
  private _describeError(err: HttpErrorResponse): string {
    const body = err?.error;
    const detail = typeof body?.detail === 'string' ? body.detail.trim() : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const fields = this._describeFieldErrors(body?.errors);

    const parts = [detail || title, fields].filter((p) => !!p);
    if (parts.length > 0) return parts.join(' — ');
    return err?.message || 'Erreur inattendue lors du test.';
  }

  private _describeFieldErrors(errors: unknown): string {
    if (!errors || typeof errors !== 'object') return '';
    return Object.entries(errors as Record<string, unknown>)
      .map(([path, messages]) => {
        const text = Array.isArray(messages) ? messages.join('. ') : String(messages);
        return path ? `${path} : ${text}` : text;
      })
      .join(' ; ');
  }

  private _maskUrl(url: string | null | undefined): string {
    if (!url) return '—';

    // `https://user:motdepasse@hote/...` fuit aussi un secret.
    let masked = url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/@:]+):[^/@]*@/i, '$1:***@');

    const queryStart = masked.indexOf('?');
    if (queryStart < 0) return masked;

    const base = masked.slice(0, queryStart);
    const [query, fragment] = this._splitFragment(masked.slice(queryStart + 1));

    masked = query
      .split('&')
      .map((pair) => {
        const eq = pair.indexOf('=');
        if (eq < 0) return pair;
        const name = pair.slice(0, eq);
        return this._isSensitiveParam(name) ? `${name}=***` : pair;
      })
      .join('&');

    return `${base}?${masked}${fragment}`;
  }

  private _splitFragment(query: string): [string, string] {
    const hash = query.indexOf('#');
    return hash < 0 ? [query, ''] : [query.slice(0, hash), query.slice(hash)];
  }

  private _isSensitiveParam(name: string): boolean {
    const normalized = name.toLowerCase().replace(/[-_\s]/g, '');
    if (!normalized) return false;

    const configured = (this.authHeaderName() ?? '').toLowerCase().replace(/[-_\s]/g, '');
    if (configured && normalized === configured) return true;

    return SENSITIVE_PARAM_NAMES.some((candidate) => normalized.includes(candidate));
  }
}

export default PullDryRun;
