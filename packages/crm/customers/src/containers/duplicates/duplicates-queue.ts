import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import {
  FormField,
  FormRoot,
  form,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { EMPTY, catchError, firstValueFrom, map, of } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  ClientDuplicatesApiService,
  ClientMergeRequestDto,
  ClientMergesApiService,
  DuplicateCandidateClientDto,
  DuplicateCandidateDto,
  UsersApiService,
} from '@sankore/crm-api';
import {
  AuthenticationService,
  BreadcrumbService,
  PermissionsService,
} from '@sankore/crm/common';
import {
  clientStatusLabel,
  clientStatusSeverity,
  clientTypeLabel,
  kycStatusLabel,
} from '../../models/client-labels';
import { NEW_MERGE_SEGMENT, mergeStatusLabel } from './merge-compare';

export type DuplicatesTab = 'candidats' | 'approbations';

const TABS: { id: DuplicatesTab; label: string }[] = [
  { id: 'candidats', label: 'Doublons potentiels' },
  { id: 'approbations', label: 'À approuver' },
];

/** Longueur minimale d'un motif exploitable dans la piste d'audit. */
const MIN_REASON_LENGTH = 5;

/**
 * Libellés des critères concordants renvoyés par la détection.
 *
 * `DuplicateReasonDto` ne porte qu'une `key` libre et un `weight` : le contrat
 * n'en énumère pas les valeurs. Les clés inconnues sont donc affichées telles
 * quelles, en séparant le CamelCase — un critère nouveau se lit à l'écran au
 * lieu de disparaître.
 */
const REASON_LABELS: Record<string, string> = {
  Name: 'Nom identique',
  FullName: 'Nom identique',
  PhoneticName: 'Nom phonétiquement proche',
  PhoneticKey: 'Nom phonétiquement proche',
  FirstName: 'Prénom identique',
  LastName: 'Nom de famille identique',
  MaidenName: 'Nom de jeune fille identique',
  Phone: 'Même numéro de téléphone',
  PhoneNumber: 'Même numéro de téléphone',
  Email: 'Même adresse e-mail',
  Address: 'Même adresse postale',
  DateOfBirth: 'Même date de naissance',
  BirthPlace: 'Même lieu de naissance',
  IdentityDocument: "Même pièce d'identité",
  IdentityDocumentNumber: "Même numéro de pièce d'identité",
  NationalId: "Même numéro de pièce d'identité",
  RegistrationNumber: "Même numéro d'immatriculation",
  TaxIdNumber: 'Même identifiant fiscal',
  MotherName: 'Même nom de la mère',
  FatherName: 'Même nom du père',
  Nationality: 'Même nationalité',
  Agency: 'Même agence',
};

export function duplicateReasonLabel(key: string | null | undefined): string {
  if (!key) return 'Critère non précisé';
  return REASON_LABELS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

/** Côté d'une paire, libellés déjà résolus pour le template. */
export interface DuplicateSide {
  clientId: string;
  displayName: string;
  clientNumber: string;
  agencyCode: string;
  typeLabel: string;
  statusLabel: string;
  statusSeverity: Severity;
  kycLabel: string;
}

export interface DuplicatePairRow {
  id: string;
  score: number;
  /** Largeur de la jauge, bornée : le contrat ne garantit pas un score sur 100. */
  scoreWidth: number;
  detectedAt: string | null;
  reasons: { key: string; label: string; weight: number }[];
  left: DuplicateSide;
  right: DuplicateSide;
  /**
   * Les deux côtés dans un tableau prêt à parcourir : un littéral `[left, right]`
   * dans le template recréerait la liste à chaque cycle de détection.
   */
  sides: DuplicateSide[];
}

export interface PendingMergeRow {
  id: string;
  statusLabel: string;
  survivorName: string;
  survivorNumber: string;
  absorbedName: string;
  absorbedNumber: string;
  requestedAt: string | null;
  requesterName: string;
  fieldChoiceCount: number;
}

function side(client: DuplicateCandidateClientDto | undefined): DuplicateSide {
  return {
    clientId: client?.clientId ?? '',
    displayName: client?.displayName || 'Client sans nom',
    clientNumber: client?.clientNumber || '—',
    agencyCode: client?.agencyCode || '—',
    typeLabel: clientTypeLabel(client?.clientType),
    statusLabel: clientStatusLabel(client?.status),
    statusSeverity: clientStatusSeverity(client?.status),
    kycLabel: kycStatusLabel(client?.kycStatus),
  };
}

export class RejectDuplicateFormModel {
  public reason!: string;

  public static instantiate(): RejectDuplicateFormModel {
    const model = new RejectDuplicateFormModel();
    model.reason = '';
    return model;
  }
}

@Component({
  selector: 'duplicates-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './duplicates-queue.html',
  imports: [
    TasCard,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TimeagoPipe,
    FormRoot,
    FormField,
  ],
})
export class DuplicatesQueuePage implements OnInit {
  private readonly _duplicatesApi = inject(ClientDuplicatesApiService);
  private readonly _mergesApi = inject(ClientMergesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canMerge = this._permissions.can('customers:merge');

  public readonly tabs = TABS;
  public readonly activeTab = signal<DuplicatesTab>('candidats');

  public readonly isLoadingCandidates = signal(true);
  public readonly candidatesFailed = signal(false);
  public readonly candidates = signal<DuplicateCandidateDto[]>([]);
  public readonly hasMoreCandidates = signal(false);

  public readonly isLoadingMerges = signal(true);
  public readonly mergesFailed = signal(false);
  public readonly pendingMerges = signal<ClientMergeRequestDto[]>([]);

  /** Identifiant de la paire dont le formulaire de rejet est ouvert. */
  public readonly rejectingId = signal<string | null>(null);

  private readonly _userNames = signal<Record<string, string>>({});
  private _candidatePage = 1;
  private readonly _pageSize = 20;

  public model = signal(RejectDuplicateFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    // `required` laisse passer une suite d'espaces : la piste d'audit se
    // retrouverait avec un motif vide, ce qui est exactement ce qu'on veut éviter.
    validate(schema.reason, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return null;
      return value.length >= MIN_REASON_LENGTH
        ? null
        : {
            kind: 'minLength',
            message: `Précisez le motif (${MIN_REASON_LENGTH} caractères minimum)`,
          };
    });
  });

  public readonly myUserId = computed(() => this._auth.connectedUser()?.id ?? null);

  public readonly pairs = computed<DuplicatePairRow[]>(() =>
    this.candidates().map((candidate) => {
      const left = side(candidate.clientA);
      const right = side(candidate.clientB);
      return {
        id: candidate.id ?? '',
        score: candidate.score ?? 0,
        scoreWidth: Math.max(0, Math.min(100, candidate.score ?? 0)),
        detectedAt: candidate.detectedAt ?? null,
        reasons: (candidate.reasons ?? []).map((reason) => ({
          key: reason.key ?? '',
          label: duplicateReasonLabel(reason.key),
          weight: reason.weight ?? 0,
        })),
        left,
        right,
        sides: [left, right],
      };
    }),
  );

  public readonly mergeRows = computed<PendingMergeRow[]>(() => {
    const names = this._userNames();
    return this.pendingMerges().map((merge) => ({
      id: merge.id ?? '',
      statusLabel: mergeStatusLabel(merge.status),
      survivorName: merge.survivorDisplayName || 'Client sans nom',
      survivorNumber: merge.survivorClientNumber || '—',
      absorbedName: merge.absorbedDisplayName || 'Client sans nom',
      absorbedNumber: merge.absorbedClientNumber || '—',
      requestedAt: merge.requestedAt ?? null,
      requesterName:
        (merge.requestedBy && names[merge.requestedBy]) || 'Utilisateur inconnu',
      fieldChoiceCount: Object.keys(merge.fieldChoices ?? {}).length,
    }));
  });

  public readonly pairCount = computed(() => this.pairs().length);
  public readonly mergeCount = computed(() => this.mergeRows().length);

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Clients', link: ['/customers'] },
      { label: 'Doublons' },
    ]);

    const requested = this._route.snapshot.queryParams['onglet'];
    if (TABS.some((tab) => tab.id === requested)) {
      this.activeTab.set(requested as DuplicatesTab);
    }

    this._loadCandidates(true);
    this._loadPendingMerges();
  }

  // ——— Onglets ———

  public selectTab(tab: DuplicatesTab): void {
    if (this.activeTab() === tab) return;
    this.activeTab.set(tab);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { onglet: tab === 'candidats' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public refresh(): void {
    if (this.activeTab() === 'candidats') {
      this.rejectingId.set(null);
      this._loadCandidates(true);
      return;
    }
    this._loadPendingMerges();
  }

  public loadMoreCandidates(): void {
    this._candidatePage += 1;
    this._loadCandidates(false);
  }

  // ——— Actions sur une paire ———

  /** AC3 — la fusion s'ouvre sur l'écran comparatif, sans demande créée à ce stade. */
  public openMerge(pair: DuplicatePairRow): void {
    if (!pair.left.clientId || !pair.right.clientId) {
      this._snackbar.error(
        'Erreur',
        "Cette paire ne référence pas deux clients : impossible d'ouvrir la fusion.",
      );
      return;
    }
    this._router.navigate(['/customers/fusions', NEW_MERGE_SEGMENT], {
      queryParams: {
        survivant: pair.left.clientId,
        absorbe: pair.right.clientId,
      },
    });
  }

  public startReject(pair: DuplicatePairRow): void {
    this.model.set(RejectDuplicateFormModel.instantiate());
    this.rejectingId.set(pair.id);
  }

  public cancelReject(): void {
    this.rejectingId.set(null);
  }

  /** AC2 — la paire quitte la file et le rejet part avec son motif. */
  public confirmReject(): void {
    const candidateId = this.rejectingId();
    if (!candidateId) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const succeeded = await firstValueFrom(
        this._duplicatesApi
          .rejectDuplicateCandidate(candidateId, { reason: value.reason.trim() })
          .pipe(
            map(() => true),
            // `of(false)` plutôt que `EMPTY` : `firstValueFrom` rejette sur un
            // flux qui se termine sans émettre, et l'erreur remonterait ici en
            // promesse non gérée au lieu d'être déjà signalée à l'utilisateur.
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Erreur', this._errorMessage(error, 'écarter cette paire'));
              return of(false);
            }),
          ),
      );

      if (!succeeded) return;

      this.candidates.update((list) => list.filter((c) => c.id !== candidateId));
      this.rejectingId.set(null);
      this._snackbar.success(
        'Paire écartée',
        "Le rejet et son motif sont enregistrés dans la piste d'audit.",
      );
    });
  }

  public openMergeRequest(row: PendingMergeRow): void {
    if (!row.id) return;
    this._router.navigate(['/customers/fusions', row.id]);
  }

  public backToClients(): void {
    this._router.navigate(['/customers']);
  }

  // ——— Chargement ———

  /**
   * Le filtre `status` de `listDuplicateCandidates` est un entier dont le contrat
   * ne nomme aucune valeur : on charge sans filtre et on écarte localement les
   * paires déjà tranchées (`reviewedAt` renseigné). Le tri serveur — score le
   * plus élevé d'abord — est conservé.
   */
  private _loadCandidates(reset: boolean): void {
    if (reset) {
      this._candidatePage = 1;
      this.candidates.set([]);
    }
    this.isLoadingCandidates.set(true);
    this.candidatesFailed.set(false);

    this._duplicatesApi
      .listDuplicateCandidates(undefined, this._candidatePage, this._pageSize)
      .pipe(
        catchError(() => {
          this.candidatesFailed.set(true);
          this.isLoadingCandidates.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        const pending = (result.items ?? []).filter(
          (item) => !!item.id && !item.reviewedAt,
        );
        this.candidates.update((list) => (reset ? pending : [...list, ...pending]));
        this.hasMoreCandidates.set(result.hasNextPage === true);
        this.isLoadingCandidates.set(false);
      });
  }

  /**
   * AC4 — les demandes que j'ai initiées sont retirées : le serveur refuse
   * l'auto-approbation (`SELF_APPROVAL_FORBIDDEN`), les afficher ne mènerait
   * qu'à une erreur. Le filtre « en attente » repose sur l'absence de décision
   * (`decidedAt`/`executedAt`), le statut étant une chaîne non énumérée.
   */
  private _loadPendingMerges(): void {
    this.isLoadingMerges.set(true);
    this.mergesFailed.set(false);

    this._mergesApi
      .listClientMerges(undefined, 1, 100)
      .pipe(
        catchError(() => {
          this.mergesFailed.set(true);
          this.isLoadingMerges.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        const mine = this.myUserId();
        const waiting = (result.items ?? []).filter(
          (merge) =>
            !!merge.id &&
            !merge.decidedAt &&
            !merge.executedAt &&
            merge.requestedBy !== mine,
        );
        this.pendingMerges.set(waiting);
        this.isLoadingMerges.set(false);
        if (waiting.length > 0) this._loadUserNames();
      });
  }

  /** `ClientMergeRequestDto` ne porte que l'identifiant du demandeur. */
  private _loadUserNames(): void {
    if (Object.keys(this._userNames()).length > 0) return;

    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 200)
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        const names: Record<string, string> = {};
        for (const user of result.items ?? []) {
          if (user.id) names[user.id] = user.fullName || user.email || 'Utilisateur';
        }
        this._userNames.set(names);
      });
  }

  private _errorMessage(error: HttpErrorResponse, action: string): string {
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return firstError ?? error.error?.title ?? `Impossible d'${action}.`;
  }
}

export default DuplicatesQueuePage;
