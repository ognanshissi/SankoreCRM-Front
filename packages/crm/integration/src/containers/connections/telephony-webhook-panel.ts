import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ConnectionSecretStatusDto } from '@sankore/crm-api';
import { ENVIRONMENT_CONFIG } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY, tap } from 'rxjs';
import {
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../../data-access/integration-facade.service';

/** L'emplacement de coffre que le webhook de téléphonie vérifie. */
const WEBHOOK_SECRET_SLOT = 'webhook-secret';

/**
 * Webhook de téléphonie : l'URL à remettre au fournisseur, et le secret qui signe ses
 * événements.
 *
 * **L'URL est composée ici, à partir d'un gabarit écrit en dur, parce qu'AUCUN endpoint ne
 * l'expose.** Le chemin vient du contrat — `POST /integration/telephony/webhooks/{connectionId}` —
 * et il n'a PAS le préfixe `/api/v1` que portent toutes les autres routes : c'est le choix du
 * back (la route est exempte de la résolution d'hôte, elle dérive son tenant de la connexion).
 * Conséquence à connaître avant de toucher à cette ligne : si le back change son préfixe ou
 * déplace cette route, l'écran continuera d'afficher une URL d'apparence correcte que le
 * fournisseur appellera dans le vide, sans que rien ici ne le signale. Il n'y a pas de moyen
 * de le détecter côté front.
 *
 * L'hôte vient de l'environnement, comme pour les webhooks de sources de leads : en recette,
 * l'URL remise au fournisseur doit pointer sur l'instance courante, pas sur la production.
 */
@Component({
  selector: 'telephony-webhook-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon, TasTag],
  template: `
    <div class="flex flex-col gap-4">
      <!-- URL -->
      <div>
        <p class="text-sm font-medium text-slate-700">URL à déclarer chez le fournisseur</p>
        <p class="text-xs text-slate-500 mt-0.5">
          Le fournisseur doit y envoyer ses événements d'appel en POST. C'est elle qui alimente le
          journal : sans elle, aucun appel n'apparaît, et le rattrapage périodique ne les
          découvrira qu'avec un quart d'heure de retard.
        </p>

        <div class="mt-2 flex items-center gap-2">
          <div
            class="flex-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 select-all"
          >
            {{ webhookUrl() }}
          </div>
          <button tas-outlined-button type="button" class="shrink-0" (click)="copyUrl()">
            <tas-icon [iconName]="urlCopied() ? 'feather:check' : 'feather:copy'" style="font-size:12px"></tas-icon>
            {{ urlCopied() ? 'Copié' : 'Copier' }}
          </button>
        </div>
      </div>

      <!-- Secret -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium text-slate-700">Secret de signature</p>
              @if (isLoading()) {
                <span class="text-xs text-slate-400">lecture…</span>
              } @else if (secret()?.isConfigured) {
                <tas-tag severity="success">Renseigné</tas-tag>
              } @else {
                <tas-tag severity="warning">Non renseigné</tas-tag>
              }
            </div>
            @if (secret()?.isConfigured && secret()?.maskedValue) {
              <p class="mt-1 font-mono text-xs text-slate-500">{{ secret()?.maskedValue }}</p>
            }
            <p class="mt-1 text-xs text-slate-500">
              Les événements signés avec un autre secret sont refusés. Le coffre n'en rend jamais
              la valeur : seul l'indice masqué revient.
            </p>
          </div>

          @if (canManage()) {
            <button
              tas-outlined-button
              color="primary"
              type="button"
              class="shrink-0"
              [disabled]="isRotating()"
              [isLoading]="isRotating()"
              (click)="confirmRegenerate()"
            >
              <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
              {{ secret()?.isConfigured ? 'Régénérer' : 'Générer' }}
            </button>
          }
        </div>

        @if (revealedSecret(); as value) {
          <div class="mt-3 rounded-lg border border-green-300 bg-green-50 p-3">
            <p class="text-xs font-medium text-green-900">
              Secret généré — copiez-le maintenant. Il ne sera plus jamais affiché, par aucun
              écran, et aucune route ne permet de le relire.
            </p>
            <div class="mt-2 flex items-center gap-2">
              <code
                class="flex-1 overflow-x-auto rounded border border-green-300 bg-white px-2 py-1 font-mono text-xs select-all"
              >
                {{ value }}
              </code>
              <button tas-outlined-button type="button" class="shrink-0" (click)="copySecret(value)">
                <tas-icon iconName="feather:copy" style="font-size:10px"></tas-icon>
                Copier
              </button>
              <button tas-text-button type="button" class="shrink-0" (click)="hideSecret()">
                J'ai copié
              </button>
            </div>
            <p class="mt-2 text-xs text-amber-700">
              Collez-le dans la console du fournisseur : jusque-là, ses événements sont signés avec
              l'ancien secret et seront REFUSÉS.
            </p>
          </div>
        }

        @if (loadError()) {
          <p class="mt-3 flex items-center gap-2 text-sm text-functional-error">
            <tas-icon iconName="feather:alert-triangle" iconSize="sm"></tas-icon>
            {{ loadError() }}
          </p>
        }
      </div>

      <!--
        Ce qui manque, dit plutôt que simulé : aucune lecture n'expose la date du dernier
        événement reçu, et aucune route ne régénère un secret côté serveur.
      -->
      <div class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <tas-icon iconName="feather:info" class="mt-0.5 shrink-0 text-slate-500" style="font-size:14px"></tas-icon>
        <div class="text-xs text-slate-600">
          <p>
            <span class="font-medium">La date du dernier événement reçu n'est pas disponible :</span>
            aucune lecture de l'API ne la porte. Le « dernier test » ci-dessous est un appel sortant
            vers le fournisseur, et il ne dit rien de ce qu'il nous a envoyé. Pour vérifier qu'un
            appel remonte, ouvrez le journal des appels.
          </p>
          <p class="mt-1">
            <span class="font-medium">La régénération se fait côté navigateur :</span> le serveur
            n'expose pas de rotation. SANKORE tire une valeur aléatoire ici, la dépose dans le
            coffre et l'affiche une seule fois.
          </p>
        </div>
      </div>
    </div>
  `,
})
export class TelephonyWebhookPanel {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _env = inject(ENVIRONMENT_CONFIG);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly connectionId = input.required<string>();
  public readonly canManage = input(false);

  /** Le panneau ne recharge pas la connexion lui-même : l'écran hôte s'en charge. */
  public readonly secretChanged = output<void>();

  public readonly isLoading = signal(true);
  public readonly isRotating = signal(false);
  public readonly loadError = signal<string | null>(null);
  public readonly urlCopied = signal(false);

  /**
   * Le secret en clair, le temps d'un affichage. Un `signal` et rien d'autre : ni
   * `localStorage`, ni `sessionStorage`, ni journal console — une valeur écrite là
   * survivrait à la page et serait relisible par n'importe quel script du domaine, ce qui
   * est exactement ce que le coffre côté serveur est fait pour empêcher.
   */
  public readonly revealedSecret = signal<string | null>(null);

  private readonly _statuses = signal<ConnectionSecretStatusDto[]>([]);

  public readonly secret = computed(
    () => this._statuses().find((row) => row.name === WEBHOOK_SECRET_SLOT) ?? null,
  );

  public readonly webhookUrl = computed(() => {
    const host = (this._env.ingestUrl || this._env.apiUrl || '').replace(/\/+$/, '');
    // GABARIT ÉCRIT EN DUR, et sans `/api/v1` : voir le commentaire de classe.
    return `${host}/integration/telephony/webhooks/${this.connectionId()}`;
  });

  constructor() {
    effect(() => {
      const connectionId = this.connectionId();
      if (!this.canManage()) {
        // `GET connections/{id}/secrets` exige Integration.Connection.Manage : sans le
        // droit, l'appel répondrait 403 et le panneau afficherait une panne au lieu d'une
        // règle d'accès.
        this.isLoading.set(false);
        return;
      }
      this._load(connectionId);
    });
  }

  public copyUrl(): void {
    navigator.clipboard.writeText(this.webhookUrl()).then(
      () => {
        this.urlCopied.set(true);
        setTimeout(() => this.urlCopied.set(false), 2000);
      },
      () => this._snackbar.error('Copie impossible', "L'URL n'a pas pu être copiée."),
    );
  }

  public copySecret(value: string): void {
    navigator.clipboard.writeText(value).then(
      () =>
        this._snackbar.success(
          'Copié',
          'Collez-le dans la console du fournisseur avant de quitter cette page.',
        ),
      () =>
        this._snackbar.error(
          'Copie impossible',
          'Sélectionnez la valeur et copiez-la à la main : elle ne sera plus affichée.',
        ),
    );
  }

  public hideSecret(): void {
    this.revealedSecret.set(null);
  }

  public confirmRegenerate(): void {
    const isFirst = !this.secret()?.isConfigured;

    this._confirm.confirm({
      title: isFirst ? 'Générer le secret de webhook ?' : 'Remplacer le secret de webhook ?',
      message: isFirst
        ? "SANKORE tire une valeur aléatoire, la dépose dans le coffre et l'affiche une seule fois : copiez-la et déclarez-la chez le fournisseur avant de quitter cette page."
        : "Le nouveau secret remplace l'ancien immédiatement, sans période de tolérance : à partir de l'enregistrement, tout événement signé avec l'ancien secret est REFUSÉ, donc les appels en cours peuvent manquer au journal jusqu'à ce que vous ayez mis à jour la console du fournisseur. La nouvelle valeur n'est affichée qu'une seule fois et n'est relisible par aucune route.",
      closable: true,
      showCancelButton: true,
      acceptButtonProps: {
        label: isFirst ? 'Générer' : 'Remplacer',
        theme: 'warn',
      },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._regenerate(),
    });
  }

  private _regenerate(): void {
    const value = generateWebhookSecret();
    this.isRotating.set(true);

    let saved = false;
    this._facade
      // Pas d'expiration : le contrat s'en sert pour prévenir avant une rotation, et une
      // date inventée ici ferait apparaître une échéance que personne n'a décidée.
      .setSecret(this.connectionId(), WEBHOOK_SECRET_SLOT, value, null)
      .pipe(
        tap(() => {
          saved = true;
        }),
        catchError((err: HttpErrorResponse) => {
          this.isRotating.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, "Le secret n'a pas pu être enregistré."),
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isRotating.set(false);
        if (!saved) return;

        this.revealedSecret.set(value);
        this._snackbar.success(
          'Secret enregistré',
          'Copiez-le maintenant : il ne sera plus affiché.',
        );
        this._load(this.connectionId());
        this.secretChanged.emit();
      });
  }

  private _load(connectionId: string): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._facade
      .getSecretStatus(connectionId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadError.set(
            integrationErrorMessage(err, "L'état du secret de webhook n'a pas pu être lu."),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((statuses) => {
        this._statuses.set(statuses);
        this.isLoading.set(false);
      });
  }
}

/**
 * 32 octets tirés de `crypto.getRandomValues`, rendus en base64 url-safe.
 *
 * C'est un pis-aller assumé : la bonne place d'une génération de secret est le serveur, qui
 * seul peut garantir l'entropie de sa source et ne jamais faire transiter la valeur en
 * clair. Le contrat n'expose aucune rotation, et les deux autres solutions sont pires —
 * laisser l'administrateur inventer un mot de passe (qui sera court et réutilisé), ou ne
 * rien proposer (l'emplacement reste vide et le webhook refuse tout). `getRandomValues` est
 * un générateur cryptographique, pas `Math.random`, et la valeur ne quitte ce composant que
 * pour l'appel qui la dépose dans le coffre.
 */
function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
