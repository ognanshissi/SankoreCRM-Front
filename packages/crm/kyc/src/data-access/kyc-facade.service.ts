import { inject, Injectable } from '@angular/core';
import { catchError, delay, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import {
  ClientsApiService,
  ClientSearchItemDto,
  CorrectKycFieldResponse,
  CreateKycFileResponse,
  DecideKycApprovalRequestDecisionEnum,
  DecideKycApprovalRequestLevelEnum,
  DecideKycApprovalResponse,
  KYCApiService,
  KycFileListPage,
  KycApprovalCircuitDto,
  KycFileDto,
  RaiseKycReviewResult,
  RunKycVerificationResponse,
} from '@sankore/crm-api';
import {
  KycCaps,
  KycDashboardFilters,
  KycDashboardPage,
  KycDocumentKind,
  KycImageRef,
  KycFieldConfidence,
  KycHistoryEntry,
  KycMrzData,
  KycOcrField,
  KycVerificationDetail,
} from './kyc.types';

/**
 * Point d'entrée unique du module KYC vers le serveur.
 *
 * Deux zones nettement séparées :
 *
 * 1. **Opérations réelles** — les douze de `KYCApiService`, appelées directement. Le dépôt d'image,
 *    le détail de la vérification et la lecture OCR/MRZ en font désormais partie. Trois attentes du
 *    cahier ne seront pas tenues telles quelles, et chacune est documentée là où elle se lit :
 *    pas de lien d'image temporaire (`KycImageRef`), pas de maximum par critère de score
 *    (`KycScoreContribution`), pas de ligne MRZ brute ni de numéro de pièce en clair (`KycMrzData`).
 * 2. **Bouchons** — ce qui n'a toujours aucun endpoint : l'historique du dossier. Il porte un
 *    `TODO(KYC-B-08)`, renvoie des données marquées `isStub: true`, et reste la seule chose à
 *    remplacer le jour de la livraison backend. Les plafonds en sont sortis (KYC-B-06) : ils
 *    viennent du serveur, consommation comprise — y compris le fait qu'elle n'est pas mesurable.
 *
 * Aucun écran n'appelle `KYCApiService` en direct : sans cette règle, le rebranchement se chercherait
 * dans sept dossiers au lieu d'un fichier.
 */
@Injectable({ providedIn: 'root' })
export class KycFacadeService {
  private readonly _kycApi = inject(KYCApiService);
  private readonly _clientsApi = inject(ClientsApiService);

  // ════════════════════════════════════════════════════════════════════
  // Opérations réelles
  // ════════════════════════════════════════════════════════════════════

  /** `POST /kyc-files` — idempotent : répond 200 avec le dossier existant plutôt que de refuser. */
  public createFile(customerId: string): Observable<CreateKycFileResponse> {
    return this._kycApi.createKycFile({ customerId });
  }

  public getFile(kycFileId: string): Observable<KycFileDto> {
    return this._kycApi.getKycFile(kycFileId);
  }

  /** `GET /kyc-files/by-customer/{id}` — le dossier ouvert d'un client. 404 s'il n'y en a pas. */
  public getFileByCustomer(customerId: string): Observable<KycFileDto> {
    return this._kycApi.getKycFileByCustomer(customerId);
  }

  /**
   * `GET /kyc-files/by-customer/{id}/caps` — les plafonds en vigueur pour un client (KYC-B-06).
   *
   * Les deux montants du cahier (250 000 et 500 000) sont des paramètres du tenant : ils arrivent
   * d'ici, avec leur devise et la largeur de la fenêtre de flux, et ne sont écrits nulle part dans le
   * front. Un changement de politique ne demande donc pas de livraison.
   *
   * La **consommation** est une autre histoire : aucun module ne tient de compte ni de transaction,
   * le serveur répond `null` avec un motif, et ce `null` est conservé tel quel jusqu'à l'écran. Le
   * remplacer par 0 ferait lire « rien consommé » là où personne n'a mesuré — c'est exactement
   * l'erreur que l'ancien bouchon faisait commettre, en affichant 212 000 / 250 000 comme un fait.
   */
  public getCaps(customerId: string): Observable<KycCaps> {
    return this._kycApi.getKycCaps(customerId).pipe(
      map((dto) => ({
        isCapped: dto.isCapped ?? false,
        tier: dto.tier ?? '',
        currency: dto.currency ?? '',
        balanceCap: dto.balanceCap ?? null,
        flowCap: dto.flowCap ?? null,
        flowWindowDays: dto.flowWindowDays ?? null,
        alertPct: dto.alertPct ?? null,
        balance: dto.usage?.balance ?? null,
        flow: dto.usage?.flow ?? null,
        flowWindowStart: dto.usage?.flowWindowStart ?? null,
        usageUnavailableReason: dto.usage?.unavailableReason ?? null,
      })),
    );
  }

  /**
   * `POST /kyc-files/{id}/verify`. Les images doivent **déjà** être dans le magasin documentaire :
   * l'endpoint ne prend que leurs références. 200 = dossier noté ou capture refusée,
   * 202 = service biométrique injoignable, tentative mise en file.
   */
  public runVerification(
    kycFileId: string,
    documentStorageRef: string,
    selfieStorageRef: string,
  ): Observable<RunKycVerificationResponse> {
    return this._kycApi.runKycVerification(kycFileId, { documentStorageRef, selfieStorageRef });
  }

  /**
   * `POST /kyc-files/{id}/corrections` — enregistre la correction et **re-note le dossier** sans
   * relancer l'OCR. C'est ce qui rafraîchit le score après une correction de champ (KYC-F-04).
   */
  public correctField(
    kycFileId: string,
    fieldName: string,
    newValue: string,
    source = 'AgentCorrection',
  ): Observable<CorrectKycFieldResponse> {
    return this._kycApi.correctKycField(kycFileId, { fieldName, source, newValue });
  }

  /** `GET /kyc-files/{id}/approval` — aperçu avant ouverture, étapes persistées ensuite. */
  public getApprovalCircuit(kycFileId: string): Observable<KycApprovalCircuitDto> {
    return this._kycApi.getKycApprovalCircuit(kycFileId);
  }

  /**
   * `POST /kyc-files/{id}/approval/decisions`. Seul le prochain niveau en attente peut décider, et
   * **l'agent qui a soumis ne peut jamais approuver son propre dossier** : le serveur tranche, l'écran
   * ne fait que masquer ce qui est manifestement indisponible. Un 409 signale une course.
   */
  public decide(
    kycFileId: string,
    level: DecideKycApprovalRequestLevelEnum,
    decision: DecideKycApprovalRequestDecisionEnum,
    comment: string | null,
  ): Observable<DecideKycApprovalResponse> {
    return this._kycApi.decideKycApproval(kycFileId, { level, decision, comment });
  }

  /** `POST /kyc-files/{id}/reviews` — le motif est montré à l'agent qui reprend la revue. */
  public raiseReview(kycFileId: string, reason: string): Observable<RaiseKycReviewResult> {
    return this._kycApi.raiseKycReview(kycFileId, { reason });
  }

  /**
   * `POST /kyc-files/{id}/duplicate-flag/clear`. Le niveau de vigilance **n'est pas** abaissé : le
   * dossier a été suspect, et cela reste vrai. L'écran ne doit donc pas promettre le contraire.
   */
  public clearDuplicateFlag(kycFileId: string, reason: string): Observable<unknown> {
    return this._kycApi.clearKycDuplicateFlag(kycFileId, { reason });
  }

  /**
   * `POST /kyc-files/{id}/documents` — dépôt de l'image dans le magasin chiffré.
   *
   * Trois choses à savoir, qui ne se devinent pas depuis la signature :
   *
   * - `kind` part en **query**, pas dans le corps multipart. Le client généré s'en charge, mais
   *   c'est pourquoi la valeur doit être celle de l'énumération serveur et pas un alias local.
   * - Le serveur répond **409** si le dossier n'est plus en collecte : seuls `Collecting`,
   *   `ComplementRequired` et `Verifying` acceptent une image. Un dossier décidé la refuse, parce
   *   qu'une preuve attachée à un dossier clos ne serait jamais relue.
   * - Déposer demande `kyc:manage`, **relire demande `kyc:document:reveal`** — la même permission
   *   que révéler le numéro du document, puisque l'image le contient. Un agent qui peut déposer ne
   *   peut donc pas forcément réafficher.
   *
   * L'aperçu renvoyé est l'objet local : voir `KycImageRef.url`.
   */
  public uploadImage(
    kycFileId: string,
    kind: KycDocumentKind,
    file: File,
  ): Observable<KycImageRef> {
    return this._kycApi.uploadKycDocument(kycFileId, kind, file).pipe(
      map((response) => ({
        // Non-nul en pratique : le serveur ne répond 201 qu'avec la référence. Le client généré
        // type tout en optionnel, et renvoyer `''` ferait échouer la vérification avec un message
        // incompréhensible plutôt qu'ici.
        storageRef: response.storageRef ?? '',
        url: URL.createObjectURL(file),
      })),
    );
  }

  /**
   * `GET /kyc-files/{id}/verification` — où en est le dossier après la vérification.
   *
   * Sous `kyc:read`, pas `kyc:verify` : rouvrir un panneau ne doit pas coûter le droit de relancer
   * une vérification biométrique. Ne transporte aucun champ OCR ni numéro de pièce — c'est
   * précisément ce qui lui permet de vivre derrière `kyc:read`.
   */
  public getVerificationDetail(kycFileId: string): Observable<KycVerificationDetail> {
    return this._kycApi.getKycVerification(kycFileId).pipe(
      map((dto) => ({
        score: dto.confidenceScore ?? 0,
        level: dto.confidenceLevel ?? 'Unknown',
        contributions: Object.entries(dto.breakdown ?? {}).map(([key, score]) => ({
          key,
          label: SCORE_CRITERION_LABELS[key] ?? humanizeKey(key),
          score,
        })),
        flagCodes: dto.flags ?? [],
        faceMatchPercent: dto.face?.matchPercent ?? null,
        // Voir KycVerificationDetail : ce code n'est pas persisté, seul `POST /verify` le porte.
        captureRejectionReason: null,
        // Ce que le serveur a gardé, présenté tel quel — pas une reconstruction déguisée en brut.
        rawPayload: dto as unknown as Record<string, unknown>,
      })),
    );
  }

  /**
   * `GET /kyc-files/{id}/identity-document` — les champs lus, avec leur confiance (KYC-F-02).
   *
   * Le numéro de la pièce est en tête de liste et masqué (`CI•••••••78`), non éditable : un agent
   * doit reconnaître la pièce qu'il corrige, et le numéro en clair est une autre permission
   * (`kyc:document:reveal`), auditée. Il n'arrive pas dans `fields` — il en est retiré avant
   * écriture, pour ne pas stocker en clair la valeur que la colonne voisine chiffre.
   */
  public getOcrFields(kycFileId: string): Observable<KycOcrField[]> {
    return this._kycApi.getKycIdentityDocument(kycFileId).pipe(
      map((dto) => {
        const confidences = dto.fieldConfidences ?? {};

        const read: KycOcrField[] = Object.entries(dto.fields ?? {}).map(([name, value]) => ({
          name,
          label: OCR_FIELD_LABELS[name] ?? humanizeKey(name),
          value,
          confidence: toConfidenceBand(confidences[name]),
          editable: true,
        }));

        if (!dto.maskedNumber) return read;

        return [
          {
            name: 'documentNumber',
            label: 'Numéro de la pièce',
            value: dto.maskedNumber,
            // Jamais une confiance : la valeur affichée est notre masque, pas une lecture OCR.
            confidence: 'unknown' as const,
            editable: false,
          },
          ...read,
        ];
      }),
    );
  }

  /**
   * `GET /kyc-files/{id}/identity-document` — la zone codée seule.
   *
   * Deuxième appel sur la même ressource que `getOcrFields`, assumé : l'endpoint lit une ligne et
   * déchiffre un champ, et partager la réponse imposerait un cache dont la péremption après une
   * correction serait un bug plus coûteux que l'aller-retour. À fusionner si le composant est repris.
   */
  public getMrz(kycFileId: string): Observable<KycMrzData | null> {
    return this._kycApi.getKycIdentityDocument(kycFileId).pipe(
      map((dto) =>
        dto.mrz
          ? { rawLine: null as null, checksumValid: dto.mrz.checksumValid ?? false, fields: dto.mrz.fields ?? {} }
          : null,
      ),
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // Bouchons — endpoints absents de KYC-B-08
  // ════════════════════════════════════════════════════════════════════

  /**
   * `GET /kyc-files` — la liste du tableau de bord, paginée par le serveur.
   *
   * Trois choses à savoir :
   *
   * - **Le périmètre d'agence est appliqué côté serveur** et ne peut pas être élargi. Demander une
   *   agence hors périmètre renvoie une page vide, pas un refus : un refus confirmerait que l'agence
   *   existe.
   * - **`awaitingMe` est un indice de tri, pas un droit.** Il vient des rôles de l'appelant. Un
   *   remplaçant qui détient une délégation M12 sans le rôle ne verra pas le dossier mis en avant et
   *   pourra quand même le signer depuis le dossier lui-même.
   * - **Le serveur plafonne `pageSize` à 100.** Demander davantage ne renvoie pas davantage.
   *
   * Les noms des clients sont résolus ici, un appel par client de la page : ils vivent en clair dans
   * M01 pour que sa recherche reste un parcours d'index, et M01 n'expose pas de lecture par lot. Un
   * client irrésolu laisse sa ligne avec un libellé de repli plutôt que de vider la page.
   */
  public searchFiles(filters: KycDashboardFilters): Observable<KycDashboardPage> {
    return this._kycApi
      .listKycFiles(
        filters.status || undefined,
        filters.agencyId || undefined,
        filters.vigilanceLevel || undefined,
        filters.from || undefined,
        filters.to || undefined,
        // Le serveur compte les pages à partir de 1, l'écran à partir de 0.
        filters.page + 1,
        filters.pageSize,
      )
      .pipe(switchMap((page) => this._withCustomerNames(page)));
  }

  /** Complète les lignes avec le nom du client, en parallèle et sans faire échouer la page. */
  private _withCustomerNames(page: KycFileListPage): Observable<KycDashboardPage> {
    const rows = page.rows ?? [];

    if (rows.length === 0) {
      return of({ rows: [], totalCount: page.totalCount ?? 0, awaitingMeCount: page.awaitingMeCount ?? 0 });
    }

    const ids = [...new Set(rows.map((r) => r.customerId).filter((id): id is string => !!id))];

    return forkJoin(
      ids.map((id) =>
        this._clientsApi.getClient(id).pipe(
          map((client) => [id, client.displayName ?? id] as const),
          // Un client archivé ou hors périmètre M01 ne doit pas effacer la ligne : le dossier KYC
          // existe et l'agent doit pouvoir l'ouvrir.
          catchError(() => of([id, 'Client indisponible'] as const)),
        ),
      ),
    ).pipe(
      map((pairs) => {
        const names = new Map(pairs);

        return {
          rows: rows.map((r) => ({
            kycFileId: r.kycFileId ?? '',
            customerId: r.customerId ?? '',
            customerName: names.get(r.customerId ?? '') ?? 'Client indisponible',
            status: r.status ?? '',
            confidenceScore: r.confidenceScore ?? null,
            vigilanceLevel: r.vigilanceLevel ?? '',
            updatedAt: r.updatedAt ?? '',
            requiredAction: REQUIRED_ACTION_LABELS[r.requiredActionCode ?? 'NONE'] ?? null,
            awaitingMe: r.awaitingMe ?? false,
          })),
          totalCount: page.totalCount ?? 0,
          awaitingMeCount: page.awaitingMeCount ?? 0,
        };
      }),
    );
  }


  /**
   * TODO(KYC-B-08) — historique du dossier.
   * Attendu : `GET /kyc-files/{id}/history` agrégeant vérifications, corrections, décisions et revues,
   * avec auteur, date, et masquage des valeurs sensibles selon les permissions. Les corrections et les
   * revues ne sont aujourd'hui qu'en écriture.
   */
  public getHistory(kycFileId: string): Observable<KycHistoryEntry[]> {
    return of(STUB_HISTORY).pipe(delay(300));
  }

  /**
   * Recherche de clients existants, pour le choix du client à enrôler (KYC-F-01).
   *
   * `searchClients` prend onze paramètres positionnels : seuls `name`, `page` et `pageSize` nous
   * concernent, les autres restent `undefined`. On passe par la façade plutôt que d'injecter
   * `ClientsApiService` dans l'écran, pour la même raison que `getCustomerName` : le module KYC a
   * un seul point de contact avec le serveur.
   */
  public searchCustomers(name: string, pageSize = 10): Observable<ClientSearchItemDto[]> {
    return this._clientsApi
      .searchClients(
        undefined,
        undefined,
        undefined,
        name,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        pageSize,
      )
      .pipe(map((page) => page.items ?? []));
  }

  /** Nom affichable d'un client, pour les écrans KYC qui ne connaissent que son identifiant. */
  public getCustomerName(customerId: string): Observable<string> {
    return this._clientsApi.getClient(customerId).pipe(
      map((client) => {
        const dto = client as Record<string, unknown>;
        const parts = [dto['firstName'], dto['lastName']].filter(Boolean).join(' ').trim();
        return (
          (dto['displayName'] as string) ||
          (dto['legalName'] as string) ||
          parts ||
          (dto['clientNumber'] as string) ||
          'Client'
        );
      }),
    );
  }

  /** Utilisé par les écrans pour signaler honnêtement qu'ils affichent des données simulées. */
  public readonly hasStubbedData = true;
}

// ——————————————————————————————————————————————————————————————————————
// Données de démonstration. Volontairement reconnaissables : pas de nom plausible, pas de score
// flatteur, et `isStub` porté jusque dans l'interface.
// ——————————————————————————————————————————————————————————————————————

const STUB_HISTORY: KycHistoryEntry[] = [
  { kind: 'creation',     label: 'Dossier ouvert',            detail: null,         authorName: 'Système',          at: new Date(Date.now() - 86_400_000 * 2).toISOString(), masked: false },
  { kind: 'verification', label: 'Vérification exécutée',     detail: 'Score 72',   authorName: 'Service biométrique', at: new Date(Date.now() - 86_400_000).toISOString(), masked: false },
  { kind: 'correction',   label: 'Champ corrigé',             detail: "Date d'expiration", authorName: 'Agent de démonstration', at: new Date(Date.now() - 7_200_000).toISOString(), masked: true },
  { kind: 'decision',     label: 'Complément demandé',        detail: "Chef d'agence", authorName: 'Chef de démonstration', at: new Date(Date.now() - 3_600_000).toISOString(), masked: false },
];

// ——————————————————————————————————————————————————————————————————————
// Libellés et bandes de confiance.
//
// Les clés viennent du service de biométrie, qui est externe : on en traduit celles qu'on connaît
// et on rend les autres lisibles plutôt que de les masquer. Une clé inconnue doit s'afficher, pas
// disparaître — c'est ainsi qu'on apprend que le service en a ajouté une.
// ——————————————————————————————————————————————————————————————————————

const OCR_FIELD_LABELS: Record<string, string> = {
  surname: 'Nom',
  last_name: 'Nom',
  given_names: 'Prénom(s)',
  first_name: 'Prénom(s)',
  birth_date: 'Date de naissance',
  date_of_birth: 'Date de naissance',
  expiry_date: "Date d'expiration",
  date_of_expiry: "Date d'expiration",
  nationality: 'Nationalité',
  issuing_country: 'Pays émetteur',
  sex: 'Sexe',
  place_of_birth: 'Lieu de naissance',
};

const SCORE_CRITERION_LABELS: Record<string, string> = {
  face: 'Visage',
  face_match: 'Visage',
  mrz: 'Zone codée',
  mrz_checksum: 'Zone codée',
  fields: 'Lecture des champs',
  field_consistency: 'Lecture des champs',
  anomalies: 'Anomalies',
};

/** `snake_case` ou `camelCase` → « Snake case ». Lisible sans prétendre à une traduction. */
function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * 0..1 → bande affichable. `undefined` devient `'unknown'` et **jamais** `'high'` : le service ne
 * note pas tous les champs, et une pièce lue avant que les confiances ne soient conservées n'en a
 * aucune. Afficher « sûr » faute de mesure est l'erreur que cette fonction existe pour empêcher.
 */
function toConfidenceBand(value: number | undefined): KycFieldConfidence {
  if (value === undefined || value === null || Number.isNaN(value)) return 'unknown';
  if (value >= 0.9) return 'high';
  if (value >= 0.7) return 'medium';
  return 'low';
}

/**
 * Les codes d'action du serveur, mis en français ici.
 *
 * Le serveur rend un code et non une phrase : la formulation appartient à l'écran, et faire voyager
 * du français dans un contrat JSON y enfermerait l'une des deux langues du produit.
 */
const REQUIRED_ACTION_LABELS: Record<string, string | null> = {
  COLLECT_DOCUMENTS: 'Pièces à collecter',
  AWAIT_VERIFICATION: 'Vérification en cours',
  AWAIT_APPROVAL: 'En attente de validation',
  PROVIDE_COMPLEMENT: 'Complément demandé',
  AWAIT_REVIEW: 'Revue en cours',
  RENEW_FILE: 'Dossier à renouveler',
  NONE: null,
};
