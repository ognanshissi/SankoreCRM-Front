import { Injectable, inject } from '@angular/core';
import { ConnectionListDto } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { IntegrationFacadeService } from './integration-facade.service';
import { ConnectionKind, ConnectionMode, errorFamilyMessage } from './integration-referential';

/**
 * États consolidés de la création d'un client dans le core banking.
 *
 * `Batched` n'existe pas côté serveur : c'est une attente dont on sait qu'elle ne partira
 * qu'avec le prochain lot. La distinguer de `Pending` change ce qu'on annonce à l'agent —
 * « bientôt » contre « à la prochaine remise de lot ».
 */
export type CbsProvisioningState =
  | 'NotRequested'
  | 'Pending'
  | 'Sent'
  | 'Batched'
  | 'Created'
  | 'Rejected'
  | 'Cancelled';

export interface CbsProvisioningStatus {
  state: CbsProvisioningState;
  connectionId: string | null;
  connectionName: string | null;
  /** Mode de la connexion : `Batch` signifie que la création ne part qu'en lot. */
  connectionMode: string | null;
  /** Système du tenant, nécessaire à la matrice de capacités. */
  connectionKind: string | null;
  externalCustomerNumber: string | null;
  /**
   * Numéro de compte CBS, demandé par INT-19 pour l'état « Créé ».
   *
   * Hors contrat : aucun champ de numéro de compte n'existe nulle part. La seule piste est
   * `getReference(connectionId, 'Account', crmId)`, dont l'`entityType` est un `string` libre.
   * Elle ne répond que si le serveur tient une référence de compte sous cette clé pour l'id du
   * CLIENT — ce que rien ne garantit. Reste donc `null` la plupart du temps, et la ligne
   * correspondante n'est alors pas affichée : il n'y a rien à inventer ici.
   */
  externalAccountNumber: string | null;
  commandId: string | null;
  attempts: number;
  createdAt: string | null;
  completedAt: string | null;
  nextAttemptAt: string | null;
  /** Message métier, jamais technique : `errorFamilyMessage()` du référentiel. */
  businessMessage: string | null;
  /** Vrai tant que l'état peut encore changer tout seul → le sondage continue. */
  isTransient: boolean;
}

/** Préavis « ce système ne crée les clients qu'en lot », affichable avant toute validation. */
export interface CbsBatchNotice {
  isBatchOnly: boolean;
  connectionName: string | null;
  /** `syncIntervalMinutes.Customers` de la connexion, `null` si le tenant ne l'a pas réglé. */
  delayMinutes: number | null;
}

/**
 * Ce que le système du tenant sait faire, par mode et par type de connexion.
 *
 * **Il n'existe aucun endpoint de capacités dans le contrat.** La vraie matrice (quelles
 * opérations l'adaptateur déclare — `PriceProduct` est la seule que le swagger nomme, et
 * seulement côté assurance) attend une livraison serveur. En attendant, les deux seules
 * informations disponibles sont `kind` et `mode` de la connexion, et la seule règle qu'on peut
 * en tirer honnêtement est celle-ci : un système qui n'échange que par fichiers ne répond pas
 * à une demande de solde en temps réel. Ne complète pas cette fonction par déduction sur le
 * `kind` : « Temenos sait faire X » est une affirmation sur une installation, pas sur un
 * produit.
 */
export interface CbsCapabilities {
  canReadLiveBalance: boolean;
  /** Pourquoi l'action est masquée, dit à l'agent. `null` quand elle est disponible. */
  liveBalanceUnsupportedReason: string | null;
}

export function cbsCapabilities(
  kind: ConnectionKind | string | null | undefined,
  mode: ConnectionMode | string | null | undefined,
): CbsCapabilities {
  if (mode === 'Batch') {
    return {
      canReadLiveBalance: false,
      liveBalanceUnsupportedReason:
        'Ce système bancaire échange par fichiers : il ne renvoie pas de solde en temps réel. Les montants affichés sont ceux de la dernière synchronisation.',
    };
  }
  return { canReadLiveBalance: true, liveBalanceUnsupportedReason: null };
}

/**
 * État de la création d'un client dans le core banking, dérivé du contrat existant.
 *
 * **Il n'existe aucun endpoint « statut de provisionnement ».** L'état est reconstitué depuis
 * trois lectures : la connexion core banking active, la commande `CreateCustomer` du client, et
 * la référence externe que le CBS a attribuée. La dérivation vit ici et nulle part ailleurs :
 * écrite deux fois, elle finirait par faire dire deux choses différentes du même client au
 * dossier KYC et à la fiche client.
 */
@Injectable({ providedIn: 'root' })
export class CbsProvisioningService {
  private readonly _facade = inject(IntegrationFacadeService);

  /**
   * La connexion core banking active du tenant. Le contrat en garantit au plus une
   * (« A tenant may have only ONE active core banking connection »), donc le premier
   * `isActive` est LA connexion, pas un choix arbitraire.
   */
  public getActiveCoreBankingConnection(): Observable<ConnectionListDto | null> {
    return this._facade
      .listAllConnections('CoreBanking')
      .pipe(map((connections) => connections.find((c) => c.isActive === true) ?? null));
  }

  public getStatus(customerId: string): Observable<CbsProvisioningStatus> {
    return this.getActiveCoreBankingConnection().pipe(
      switchMap((connection) => {
        // Aucune connexion core banking active : l'intégration n'est pas configurée. Ce n'est
        // pas une erreur et il n'y a rien à sonder — l'état reste `NotRequested`.
        if (!connection?.id) return of(this._notRequested(null));

        const connectionId = connection.id;

        return forkJoin({
          commands: this._facade.listCommands({
            entityType: 'Customer',
            crmId: customerId,
            connectionId,
            page: 1,
            pageSize: 20,
          }),
          // « externalId is null when that connection holds no reference for the entity yet —
          // a 200, not a 404, because an entity not yet created on the other side is an
          // ordinary state. » Un échec de lecture (droit manquant, panne) n'a pas davantage à
          // faire disparaître l'état de la commande : on retombe sur `null`, sans alarme.
          customerRef: this._facade.getReference(connectionId, 'Customer', customerId).pipe(
            map((reference) => reference.externalId ?? null),
            catchError(() => of(null)),
          ),
          accountRef: this._facade.getReference(connectionId, 'Account', customerId).pipe(
            map((reference) => reference.externalId ?? null),
            catchError(() => of(null)),
          ),
        }).pipe(
          map(({ commands, customerRef, accountRef }) => {
            const rows = commands.rows ?? [];
            // Le contrat pagine les commandes « oldest first ». La création qui compte est donc
            // la DERNIÈRE du tableau : prendre la première renvoie une tentative rejouée depuis
            // longtemps, et l'écran annonce un rejet déjà corrigé — une erreur silencieuse.
            const creations = rows.filter((row) => row.commandType === 'CreateCustomer');
            const command = creations.length > 0 ? creations[creations.length - 1] : null;

            if (!command) {
              return {
                ...this._notRequested(connection),
                externalCustomerNumber: customerRef,
                externalAccountNumber: accountRef,
                // Une référence existe sans commande visible : le client est bien là, créé par
                // une reprise ou un lot dont la commande a été purgée. L'annoncer « non
                // demandé » serait faux.
                state: customerRef ? ('Created' as CbsProvisioningState) : 'NotRequested',
              };
            }

            const state = this._deriveState(command.status, connection.mode);

            return {
              state,
              connectionId,
              connectionName: connection.name ?? null,
              connectionMode: connection.mode ?? null,
              connectionKind: connection.kind ?? null,
              externalCustomerNumber: customerRef,
              externalAccountNumber: accountRef,
              commandId: command.commandId ?? null,
              attempts: command.attempts ?? 0,
              createdAt: command.createdAt ?? null,
              completedAt: command.completedAt ?? null,
              nextAttemptAt: command.nextAttemptAt ?? null,
              // Un rejet ne se raconte QUE par famille d'erreur. `errorCode`, `errorDetail`,
              // `errorFamily` brut et l'UUID de commande restent réservés à l'écran Commandes :
              // c'est un critère d'acceptation d'INT-19, pas une préférence d'affichage. Ne
              // « complète » pas ce message avec le détail technique.
              businessMessage:
                state === 'Rejected' ? errorFamilyMessage(command.errorFamily) : null,
              isTransient: state === 'Pending' || state === 'Sent' || state === 'Batched',
            } satisfies CbsProvisioningStatus;
          }),
        );
      }),
    );
  }

  /**
   * Le préavis à afficher AVANT la validation d'un dossier : il suffit de savoir que la
   * connexion active est en mode `Batch`, aucune commande n'est nécessaire.
   */
  public getBatchNotice(): Observable<CbsBatchNotice> {
    return this.getActiveCoreBankingConnection().pipe(
      switchMap((connection) => {
        if (!connection?.id || connection.mode !== 'Batch') {
          return of({ isBatchOnly: false, connectionName: null, delayMinutes: null });
        }
        return this.getCustomerSyncIntervalMinutes(connection.id).pipe(
          map((delayMinutes) => ({
            isBatchOnly: true,
            connectionName: connection.name ?? null,
            delayMinutes,
          })),
        );
      }),
    );
  }

  /**
   * Le délai annoncé d'un envoi en lot.
   *
   * Le contrat ne publie aucun « délai de traitement batch ». Le seul réglage qui en parle est
   * `settings.syncIntervalMinutes.Customers`, que seul le détail de la connexion porte — la
   * liste ne renvoie pas `settings`. D'où cet appel séparé, fait uniquement quand la connexion
   * est en mode `Batch`. S'il n'est pas réglé, on annonce « à la prochaine remise de lot »
   * plutôt que d'inventer une durée.
   */
  public getCustomerSyncIntervalMinutes(connectionId: string): Observable<number | null> {
    return this._facade.getConnection(connectionId).pipe(
      map((detail) => detail.settings?.syncIntervalMinutes?.Customers ?? null),
      catchError(() => of(null)),
    );
  }

  /**
   * `status` → `state`. Un statut inconnu est conservé tel quel : une valeur ajoutée côté
   * serveur doit se voir à l'écran, pas disparaître dans un `default` muet.
   */
  private _deriveState(
    status: string | null | undefined,
    mode: string | null | undefined,
  ): CbsProvisioningState {
    switch (status) {
      case 'Pending':
        // `Batched` se déduit du MODE de la connexion, pas du `batchFileId` : ce champ n'existe
        // que sur le détail d'une commande (`IntegrationCommandDto`), jamais sur l'item de
        // liste. Le lire coûterait un appel par affichage pour confirmer ce que le mode dit
        // déjà. Le jour où la liste porte `batchFileId`, c'est ici qu'il s'ajoute.
        return mode === 'Batch' ? 'Batched' : 'Pending';
      case 'Sent':
        return 'Sent';
      case 'Succeeded':
        return 'Created';
      case 'Rejected':
        return 'Rejected';
      case 'Cancelled':
        return 'Cancelled';
      default:
        return (status as CbsProvisioningState) ?? 'NotRequested';
    }
  }

  private _notRequested(connection: ConnectionListDto | null): CbsProvisioningStatus {
    return {
      state: 'NotRequested',
      connectionId: connection?.id ?? null,
      connectionName: connection?.name ?? null,
      connectionMode: connection?.mode ?? null,
      connectionKind: connection?.kind ?? null,
      externalCustomerNumber: null,
      externalAccountNumber: null,
      commandId: null,
      attempts: 0,
      createdAt: null,
      completedAt: null,
      nextAttemptAt: null,
      businessMessage: null,
      isTransient: false,
    };
  }
}

/** Libellé, couleur et phrase d'un état, pour un agent : aucun jargon, aucun identifiant. */
export function cbsProvisioningMeta(state: CbsProvisioningState): {
  label: string;
  severity: Severity;
  description: string;
} {
  switch (state) {
    case 'Pending':
      return {
        label: 'En attente',
        severity: 'warning',
        description: 'La création du client dans le système bancaire est en attente.',
      };
    case 'Sent':
      return {
        label: 'Envoyé',
        severity: 'info',
        description: 'La demande est partie vers le système bancaire. Réponse en cours.',
      };
    case 'Batched':
      return {
        label: 'En lot',
        severity: 'info',
        description: 'La demande partira avec le prochain envoi de fichiers.',
      };
    case 'Created':
      return {
        label: 'Créé',
        severity: 'success',
        description: 'Le client existe dans le système bancaire : il peut opérer.',
      };
    case 'Rejected':
      return {
        label: 'Rejeté',
        severity: 'error',
        description: 'Le système bancaire a refusé la création.',
      };
    case 'Cancelled':
      return {
        label: 'Abandonné',
        severity: 'neutral',
        description: 'La demande de création a été abandonnée.',
      };
    case 'NotRequested':
    default:
      return {
        label: 'Non demandé',
        severity: 'neutral',
        description: 'Aucune création de client n’a encore été demandée au système bancaire.',
      };
  }
}

/** Délai d'un envoi en lot, en langage d'agent. Sans réglage, on ne promet pas de durée. */
export function cbsBatchDelayLabel(delayMinutes: number | null | undefined): string {
  if (!delayMinutes || delayMinutes <= 0) return 'à la prochaine remise de lot';
  if (delayMinutes < 60) return `dans un délai de ${delayMinutes} minutes`;
  const hours = Math.round(delayMinutes / 60);
  return hours <= 1 ? "dans un délai d'une heure" : `dans un délai de ${hours} heures`;
}
