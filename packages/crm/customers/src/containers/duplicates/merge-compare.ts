import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  FormField,
  FormRoot,
  form,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { EMPTY, catchError, firstValueFrom, forkJoin, map, of } from 'rxjs';
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
  ClientDetailDto,
  ClientMergeRequestDto,
  ClientMergesApiService,
  ClientsApiService,
  RevealSensitiveFieldRequestFieldEnum,
} from '@sankore/crm-api';
import {
  AuthenticationService,
  BreadcrumbService,
  PermissionsService,
} from '@sankore/crm/common';
import { SensitiveField } from '../../components/sensitive-field';
import {
  clientStatusLabel,
  clientStatusSeverity,
  clientTypeLabel,
  genderLabel,
  identityDocumentLabel,
  isLegalClient,
  kycStatusLabel,
  maritalStatusLabel,
} from '../../models/client-labels';

/**
 * Segment d'URL qui ouvre l'écran en création de demande.
 *
 * La route du socle est `/customers/fusions/:mergeRequestId` et ne connaît pas de
 * chemin dédié à la création : ce mot réservé occupe donc la place de l'identifiant,
 * les deux clients à comparer arrivant en paramètres de requête. Un identifiant réel
 * ouvre l'écran en revue.
 */
export const NEW_MERGE_SEGMENT = 'nouveau';

/** Longueur minimale d'un motif exploitable dans la piste d'audit. */
const MIN_REASON_LENGTH = 5;

/**
 * Libellés du statut d'une demande de fusion.
 *
 * `ClientMergeRequestDto.status` est déclaré `type: string` sans énumération et le
 * filtre `status` de la liste est un entier anonyme : on couvre les noms plausibles
 * et on affiche la valeur brute pour le reste, plutôt que d'avaler un statut inconnu.
 */
const MERGE_STATUS_LABELS: Record<string, string> = {
  Pending: 'En attente d’approbation',
  PendingApproval: 'En attente d’approbation',
  AwaitingApproval: 'En attente d’approbation',
  Approved: 'Approuvée',
  Rejected: 'Rejetée',
  Executed: 'Exécutée',
  Completed: 'Exécutée',
  Cancelled: 'Annulée',
};

export function mergeStatusLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'Statut inconnu';
  return MERGE_STATUS_LABELS[value] ?? String(value);
}

export function mergeStatusSeverity(value: string | null | undefined): Severity {
  switch (value) {
    case 'Approved':
    case 'Executed':
    case 'Completed':
      return 'success';
    case 'Rejected':
    case 'Cancelled':
      return 'error';
    default:
      return 'info';
  }
}

export type MergeSide = 'survivor' | 'absorbed';

const LANGUAGE_LABELS: Record<string, string> = { Fr: 'Français', En: 'Anglais' };

/** Les dates du contrat arrivent en `yyyy-MM-dd` : le découpage évite le décalage UTC. */
function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

interface MergeFieldDef {
  /** Clé envoyée dans `fieldChoices` : le nom de la propriété du contrat. */
  key: string;
  label: string;
  /** Champ réservé aux personnes physiques ou morales. */
  scope?: 'individual' | 'legal';
  /** Champ sensible : la valeur reste masquée sauf révélation autorisée. */
  sensitive?: RevealSensitiveFieldRequestFieldEnum;
  read: (client: ClientDetailDto) => string | null | undefined;
}

/**
 * Champs arbitrables, dans l'ordre d'affichage.
 *
 * L'agence, le statut, le KYC et le risque en sont volontairement absents : ils
 * dépendent du cycle de vie de la fiche survivante et ne se choisissent pas champ
 * par champ. Ils restent visibles dans l'en-tête des deux colonnes.
 */
const MERGE_FIELDS: MergeFieldDef[] = [
  { key: 'firstName', label: 'Prénom', scope: 'individual', read: (c) => c.firstName },
  { key: 'lastName', label: 'Nom', scope: 'individual', read: (c) => c.lastName },
  {
    key: 'maidenName',
    label: 'Nom de jeune fille',
    scope: 'individual',
    read: (c) => c.maidenName,
  },
  {
    key: 'gender',
    label: 'Genre',
    scope: 'individual',
    read: (c) => (c.gender ? genderLabel(c.gender) : null),
  },
  {
    key: 'dateOfBirth',
    label: 'Date de naissance',
    scope: 'individual',
    sensitive: RevealSensitiveFieldRequestFieldEnum.DateOfBirth,
    read: (c) => c.dateOfBirthMasked,
  },
  {
    key: 'birthPlace',
    label: 'Lieu de naissance',
    scope: 'individual',
    read: (c) => c.birthPlace,
  },
  { key: 'nationality', label: 'Nationalité', read: (c) => c.nationality },
  {
    key: 'maritalStatus',
    label: 'Situation familiale',
    scope: 'individual',
    read: (c) => (c.maritalStatus ? maritalStatusLabel(c.maritalStatus) : null),
  },
  { key: 'fatherName', label: 'Nom du père', scope: 'individual', read: (c) => c.fatherName },
  { key: 'motherName', label: 'Nom de la mère', scope: 'individual', read: (c) => c.motherName },
  { key: 'profession', label: 'Profession', scope: 'individual', read: (c) => c.profession },
  { key: 'employer', label: 'Employeur', scope: 'individual', read: (c) => c.employer },
  {
    key: 'preferredLanguage',
    label: 'Langue de contact',
    read: (c) =>
      c.preferredLanguage ? (LANGUAGE_LABELS[c.preferredLanguage] ?? c.preferredLanguage) : null,
  },
  {
    key: 'dependentsCount',
    label: 'Personnes à charge',
    scope: 'individual',
    read: (c) =>
      c.dependentsCount === null || c.dependentsCount === undefined
        ? null
        : String(c.dependentsCount),
  },
  {
    key: 'declaredIncome',
    label: 'Revenu déclaré',
    scope: 'individual',
    sensitive: RevealSensitiveFieldRequestFieldEnum.DeclaredIncome,
    read: (c) => c.declaredIncomeMasked,
  },
  {
    key: 'identityDocumentType',
    label: "Type de pièce d'identité",
    scope: 'individual',
    read: (c) => (c.identityDocumentType ? identityDocumentLabel(c.identityDocumentType) : null),
  },
  {
    key: 'identityDocumentNumber',
    label: "Numéro de pièce d'identité",
    scope: 'individual',
    sensitive: RevealSensitiveFieldRequestFieldEnum.IdentityDocumentNumber,
    read: (c) => c.identityDocumentNumberMasked,
  },
  {
    key: 'identityDocumentIssuedOn',
    label: 'Pièce délivrée le',
    scope: 'individual',
    read: (c) => formatDate(c.identityDocumentIssuedOn),
  },
  {
    key: 'identityDocumentExpiresOn',
    label: 'Pièce valable jusqu’au',
    scope: 'individual',
    read: (c) => formatDate(c.identityDocumentExpiresOn),
  },
  { key: 'legalName', label: 'Raison sociale', scope: 'legal', read: (c) => c.legalName },
  { key: 'legalFormCode', label: 'Forme juridique', scope: 'legal', read: (c) => c.legalFormCode },
  {
    key: 'registrationNumber',
    label: "Numéro d'immatriculation",
    scope: 'legal',
    sensitive: RevealSensitiveFieldRequestFieldEnum.RegistrationNumber,
    read: (c) => c.registrationNumberMasked,
  },
  {
    key: 'taxIdNumber',
    label: 'Identifiant fiscal',
    scope: 'legal',
    sensitive: RevealSensitiveFieldRequestFieldEnum.TaxIdNumber,
    read: (c) => c.taxIdNumberMasked,
  },
  {
    key: 'incorporationDate',
    label: 'Date de constitution',
    scope: 'legal',
    read: (c) => formatDate(c.incorporationDate),
  },
  { key: 'segmentCode', label: 'Segment commercial', read: (c) => c.segmentCode },
];

export interface MergeCell {
  side: MergeSide;
  clientId: string;
  /** Valeur affichable, déjà masquée pour un champ sensible. */
  display: string;
  sensitive: RevealSensitiveFieldRequestFieldEnum | null;
  maskedValue: string | null;
  fieldLabel: string;
  isEmpty: boolean;
}

export interface MergeFieldRow {
  key: string;
  label: string;
  isSensitive: boolean;
  /** Valeur commune, utilisée par la section des champs identiques. */
  sameValue: string;
  cells: MergeCell[];
}

/** En-tête d'une colonne : ce qui situe la fiche sans être arbitrable. */
export interface MergeColumn {
  side: MergeSide;
  clientId: string;
  displayName: string;
  clientNumber: string;
  typeLabel: string;
  statusLabel: string;
  statusSeverity: Severity;
  agencyCode: string;
  kycLabel: string;
  createdAt: string | null;
  phone: { contactPointId: string; maskedValue: string } | null;
  email: { contactPointId: string; maskedValue: string } | null;
}

/** Ligne du récapitulatif en lecture seule (mode revue). */
export interface ChoiceSummaryRow {
  key: string;
  label: string;
  sideLabel: string;
  cell: MergeCell | null;
  /** Valeur brute du contrat quand la clé ou le côté ne se résolvent pas. */
  rawValue: string | null;
}

export class MergeReasonFormModel {
  public reason!: string;

  public static instantiate(): MergeReasonFormModel {
    const model = new MergeReasonFormModel();
    model.reason = '';
    return model;
  }
}

export class ApproveMergeFormModel {
  public comment!: string;

  public static instantiate(): ApproveMergeFormModel {
    const model = new ApproveMergeFormModel();
    model.comment = '';
    return model;
  }
}

@Component({
  selector: 'merge-compare',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './merge-compare.html',
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
    SensitiveField,
  ],
})
export class MergeComparePage {
  private readonly _mergesApi = inject(ClientMergesApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly canMerge = this._permissions.can('customers:merge');

  /** Raccourci de template pour les champs révélables. */
  protected readonly SENSITIVE = RevealSensitiveFieldRequestFieldEnum;

  /** Paramètre de route : un identifiant de demande, ou `nouveau` en création. */
  public readonly mergeRequestId = input.required<string>();
  /** Paramètres de requête, liés par `withComponentInputBinding()`. */
  public readonly survivant = input<string>();
  public readonly absorbe = input<string>();

  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly notFound = signal(false);

  public readonly request = signal<ClientMergeRequestDto | null>(null);
  /** Fiche gardée par défaut, telle qu'elle arrive (paramètre ou demande). */
  private readonly _firstClient = signal<ClientDetailDto | null>(null);
  private readonly _secondClient = signal<ClientDetailDto | null>(null);
  /** Inversion du sens de la fusion, disponible seulement en création. */
  public readonly swapped = signal(false);

  public readonly choices = signal<Record<string, MergeSide>>({});
  public readonly showIdentical = signal(false);
  public readonly step = signal<'choix' | 'recapitulatif' | 'envoyee'>('choix');
  public readonly createdRequestId = signal<string | null>(null);
  public readonly createdStatusLabel = signal<string>('');

  public model = signal(MergeReasonFormModel.instantiate());
  /** Motif de la demande : le contrat l'accepte nul, il reste donc facultatif. */
  public formSchema = form(this.model);

  public rejectModel = signal(MergeReasonFormModel.instantiate());
  public rejectFormSchema = form(this.rejectModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    // `required` laisse passer une suite d'espaces, et le rejet d'une fusion
    // doit rester lisible pour le demandeur comme pour l'audit.
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

  public approveModel = signal(ApproveMergeFormModel.instantiate());
  public approveFormSchema = form(this.approveModel);

  public readonly isRejecting = signal(false);

  public readonly isCreation = computed(() => this.mergeRequestId() === NEW_MERGE_SEGMENT);

  public readonly survivorClient = computed(() =>
    this.swapped() ? this._secondClient() : this._firstClient(),
  );
  public readonly absorbedClient = computed(() =>
    this.swapped() ? this._firstClient() : this._secondClient(),
  );

  public readonly myUserId = computed(() => this._auth.connectedUser()?.id ?? null);

  /** Le serveur refuse qu'un demandeur décide de sa propre demande. */
  public readonly isMyOwnRequest = computed(() => {
    const request = this.request();
    return !!request && !!this.myUserId() && request.requestedBy === this.myUserId();
  });

  public readonly isDecided = computed(() => {
    const request = this.request();
    return !!request && (!!request.decidedAt || !!request.executedAt);
  });

  public readonly canDecide = computed(
    () =>
      !this.isCreation() &&
      this.canMerge() &&
      !!this.request() &&
      !this.isDecided() &&
      !this.isMyOwnRequest(),
  );

  /** Les valeurs ne se choisissent qu'au moment de créer la demande. */
  public readonly canChoose = computed(() => this.isCreation() && this.step() === 'choix');

  public readonly statusLabel = computed(() => mergeStatusLabel(this.request()?.status));
  public readonly statusSeverity = computed(() => mergeStatusSeverity(this.request()?.status));

  /**
   * Un rapprochement entre une personne physique et une personne morale est
   * presque toujours une erreur de détection : on affiche les deux jeux de
   * champs et on le signale plutôt que de masquer la moitié des divergences.
   */
  public readonly hasMixedTypes = computed(() => {
    const survivor = this.survivorClient();
    const absorbed = this.absorbedClient();
    if (!survivor || !absorbed) return false;
    return isLegalClient(survivor.clientType) !== isLegalClient(absorbed.clientType);
  });

  public readonly columns = computed<MergeColumn[]>(() => {
    const survivor = this.survivorClient();
    const absorbed = this.absorbedClient();
    if (!survivor || !absorbed) return [];
    return [this._column('survivor', survivor), this._column('absorbed', absorbed)];
  });

  private readonly _rows = computed<{ divergent: MergeFieldRow[]; identical: MergeFieldRow[] }>(
    () => {
      const survivor = this.survivorClient();
      const absorbed = this.absorbedClient();
      if (!survivor || !absorbed) return { divergent: [], identical: [] };

      const mixed = this.hasMixedTypes();
      const legal = isLegalClient(survivor.clientType);
      const divergent: MergeFieldRow[] = [];
      const identical: MergeFieldRow[] = [];

      for (const field of MERGE_FIELDS) {
        if (!mixed && field.scope === 'individual' && legal) continue;
        if (!mixed && field.scope === 'legal' && !legal) continue;

        const survivorValue = (field.read(survivor) ?? '').trim();
        const absorbedValue = (field.read(absorbed) ?? '').trim();

        // Un champ vide des deux côtés n'apporte rien : ni divergence, ni
        // information à conserver.
        if (!survivorValue && !absorbedValue) continue;

        const row: MergeFieldRow = {
          key: field.key,
          label: field.label,
          isSensitive: !!field.sensitive,
          sameValue: survivorValue || absorbedValue,
          cells: [
            this._cell('survivor', survivor, field, survivorValue),
            this._cell('absorbed', absorbed, field, absorbedValue),
          ],
        };

        if (survivorValue === absorbedValue) identical.push(row);
        else divergent.push(row);
      }

      return { divergent, identical };
    },
  );

  public readonly divergentRows = computed(() => this._rows().divergent);
  public readonly identicalRows = computed(() => this._rows().identical);
  public readonly identicalCount = computed(() => this.identicalRows().length);
  /** Un champ sensible se compare sur sa valeur masquée : à dire, pas à taire. */
  public readonly hasSensitiveIdentical = computed(() =>
    this.identicalRows().some((row) => row.isSensitive),
  );

  public readonly survivorKeptCount = computed(
    () => this.divergentRows().filter((row) => this.choiceOf(row.key) === 'survivor').length,
  );
  public readonly absorbedKeptCount = computed(
    () => this.divergentRows().filter((row) => this.choiceOf(row.key) === 'absorbed').length,
  );

  /** Récapitulatif des arbitrages, lisible en revue comme avant l'envoi. */
  public readonly choiceSummary = computed<ChoiceSummaryRow[]>(() => {
    const request = this.request();
    const rows = this.divergentRows();

    // En création, le récapitulatif suit les champs divergents affichés.
    if (!request) {
      return rows.map((row) => {
        const side = this.choiceOf(row.key);
        return {
          key: row.key,
          label: row.label,
          sideLabel: side === 'absorbed' ? 'Fiche absorbée' : 'Fiche conservée',
          cell: row.cells.find((cell) => cell.side === side) ?? null,
          rawValue: null,
        };
      });
    }

    // En revue, le contrat fait foi : on part de `fieldChoices` tel qu'il revient.
    return Object.entries(request.fieldChoices ?? {}).map(([key, raw]) => {
      const row = rows.find((r) => r.key.toLowerCase() === key.toLowerCase());
      const side = this._resolveSide(raw);
      return {
        key,
        label: row?.label ?? MERGE_FIELDS.find((f) => f.key === key)?.label ?? key,
        sideLabel:
          side === 'absorbed'
            ? 'Fiche absorbée'
            : side === 'survivor'
              ? 'Fiche conservée'
              : 'Côté non reconnu',
        cell: side ? (row?.cells.find((cell) => cell.side === side) ?? null) : null,
        rawValue: side && row ? null : raw,
      };
    });
  });

  constructor() {
    effect(() => {
      const id = this.mergeRequestId();
      if (id === NEW_MERGE_SEGMENT) {
        this._startCreation(this.survivant(), this.absorbe());
        return;
      }
      this._loadRequest(id);
    });

    effect(() => {
      this._breadcrumb.set([
        { label: 'Clients', link: ['/customers'] },
        { label: 'Doublons', link: ['/customers/doublons'] },
        { label: this.isCreation() ? 'Nouvelle fusion' : 'Demande de fusion' },
      ]);
    });
  }

  // ——— Arbitrage des valeurs ———

  public choiceOf(key: string): MergeSide | null {
    return this.choices()[key] ?? null;
  }

  /** AC2 — cliquer sur une valeur la retient pour la fiche survivante. */
  public choose(key: string, side: MergeSide): void {
    if (!this.canChoose()) return;
    this.choices.update((current) => ({ ...current, [key]: side }));
  }

  public toggleIdentical(): void {
    this.showIdentical.update((shown) => !shown);
  }

  /** Inverse le sens de la fusion : la fiche absorbée devient la survivante. */
  public swapSides(): void {
    if (!this.canChoose()) return;
    this.swapped.update((value) => !value);
    this._resetChoices();
  }

  // ——— Création de la demande ———

  public goToRecap(): void {
    if (!this.survivorClient() || !this.absorbedClient()) return;
    this.step.set('recapitulatif');
  }

  public backToChoices(): void {
    this.step.set('choix');
  }

  public confirmRequest(): void {
    const survivor = this.survivorClient();
    const absorbed = this.absorbedClient();
    const survivorId = survivor?.id;
    const absorbedId = absorbed?.id;
    if (!survivorId || !absorbedId) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const reason = (value?.reason ?? '').trim();

      const result = await firstValueFrom(
        this._mergesApi
          .requestClientMerge({
            survivorClientId: survivorId,
            absorbedClientId: absorbedId,
            fieldChoices: this._buildFieldChoices(survivorId, absorbedId),
            reason: reason || null,
          })
          .pipe(
            // `of(null)` plutôt que `EMPTY` : `firstValueFrom` rejette sur un flux
            // vide, et l'erreur remonterait en promesse non gérée alors qu'elle est
            // déjà signalée à l'utilisateur.
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Erreur', this._errorMessage(error, 'demander la fusion'));
              return of(null);
            }),
          ),
      );

      if (!result) return;

      this.createdRequestId.set(result.mergeRequestId ?? null);
      this.createdStatusLabel.set(mergeStatusLabel(result.status));
      this.step.set('envoyee');
      this._snackbar.success(
        'Demande enregistrée',
        'La fusion attend l’approbation d’un autre utilisateur.',
      );
    });
  }

  // ——— Décision de l'approbateur ———

  public startReject(): void {
    this.rejectModel.set(MergeReasonFormModel.instantiate());
    this.isRejecting.set(true);
  }

  public cancelReject(): void {
    this.isRejecting.set(false);
  }

  public approve(): void {
    const id = this.request()?.id;
    if (!id || !this.canDecide()) return;

    submit(this.approveFormSchema, async (field) => {
      const comment = (field()?.value()?.comment ?? '').trim();

      const succeeded = await firstValueFrom(
        this._mergesApi.approveClientMerge(id, { comment: comment || null }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error, 'approuver cette fusion'));
            return of(false);
          }),
        ),
      );

      if (!succeeded) return;

      this._snackbar.success(
        'Fusion approuvée',
        'Les deux fiches sont fusionnées et la fiche absorbée passe en lecture seule.',
      );
      this._loadRequest(id);
    });
  }

  public confirmReject(): void {
    const id = this.request()?.id;
    if (!id || !this.canDecide()) return;

    submit(this.rejectFormSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const succeeded = await firstValueFrom(
        this._mergesApi.rejectClientMerge(id, { reason: value.reason.trim() }).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._errorMessage(error, 'rejeter cette fusion'));
            return of(false);
          }),
        ),
      );

      if (!succeeded) return;

      this.isRejecting.set(false);
      this._snackbar.success('Fusion rejetée', 'Le demandeur retrouvera le motif sur la demande.');
      this._loadRequest(id);
    });
  }

  // ——— Navigation ———

  public retry(): void {
    const id = this.mergeRequestId();
    if (id === NEW_MERGE_SEGMENT) {
      this._startCreation(this.survivant(), this.absorbe());
      return;
    }
    this._loadRequest(id);
  }

  public backToQueue(): void {
    this._router.navigate(['/customers/doublons']);
  }

  public goToPendingApprovals(): void {
    this._router.navigate(['/customers/doublons'], {
      queryParams: { onglet: 'approbations' },
    });
  }

  public openCreatedRequest(): void {
    const id = this.createdRequestId();
    if (!id) return;
    this._router.navigate(['/customers/fusions', id]);
  }

  public openClient(clientId: string): void {
    if (!clientId) return;
    this._router.navigate(['/customers', clientId]);
  }

  // ——— Chargement ———

  private _startCreation(survivorId: string | undefined, absorbedId: string | undefined): void {
    this.request.set(null);
    if (!survivorId || !absorbedId || survivorId === absorbedId) {
      this.isLoading.set(false);
      this.notFound.set(true);
      return;
    }
    this._loadClients(survivorId, absorbedId);
  }

  private _loadRequest(mergeRequestId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this.notFound.set(false);

    this._mergesApi
      .getClientMerge(mergeRequestId)
      .pipe(
        catchError((error: { status?: number }) => {
          if (error?.status === 404) this.notFound.set(true);
          else this.loadFailed.set(true);
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((request) => {
        this.request.set(request);
        this.step.set('choix');
        if (!request.survivorClientId || !request.absorbedClientId) {
          this.isLoading.set(false);
          this.loadFailed.set(true);
          return;
        }
        this._loadClients(request.survivorClientId, request.absorbedClientId);
      });
  }

  private _loadClients(survivorId: string, absorbedId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this.swapped.set(false);

    forkJoin({
      survivor: this._clientsApi.getClient(survivorId),
      absorbed: this._clientsApi.getClient(absorbedId),
    })
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ survivor, absorbed }) => {
        this._firstClient.set(survivor);
        this._secondClient.set(absorbed);
        this._resetChoices();
        this.isLoading.set(false);
      });
  }

  /**
   * Choix par défaut : la fiche conservée gagne, sauf quand elle n'a rien à
   * offrir sur ce champ — une fusion ne doit jamais perdre une information.
   * En revue, les choix viennent de la demande : ils ne se recalculent pas.
   */
  private _resetChoices(): void {
    const request = this.request();
    if (request) {
      const resolved: Record<string, MergeSide> = {};
      for (const [key, raw] of Object.entries(request.fieldChoices ?? {})) {
        const side = this._resolveSide(raw);
        const field = MERGE_FIELDS.find((f) => f.key.toLowerCase() === key.toLowerCase());
        if (side && field) resolved[field.key] = side;
      }
      this.choices.set(resolved);
      return;
    }

    const defaults: Record<string, MergeSide> = {};
    for (const row of this.divergentRows()) {
      const survivorCell = row.cells.find((cell) => cell.side === 'survivor');
      defaults[row.key] = survivorCell?.isEmpty ? 'absorbed' : 'survivor';
    }
    this.choices.set(defaults);
  }

  /**
   * `fieldChoices` est un dictionnaire de chaînes libres : on y écrit
   * l'identifiant du client dont la valeur est retenue, forme non ambiguë et
   * vérifiable côté serveur. À la relecture, on accepte aussi les formes
   * symboliques qu'une autre implémentation pourrait produire.
   */
  private _buildFieldChoices(survivorId: string, absorbedId: string): Record<string, string> {
    const payload: Record<string, string> = {};
    for (const row of this.divergentRows()) {
      payload[row.key] = this.choiceOf(row.key) === 'absorbed' ? absorbedId : survivorId;
    }
    return payload;
  }

  private _resolveSide(raw: string | null | undefined): MergeSide | null {
    if (!raw) return null;
    const request = this.request();
    if (request?.survivorClientId && raw === request.survivorClientId) return 'survivor';
    if (request?.absorbedClientId && raw === request.absorbedClientId) return 'absorbed';

    switch (raw.toLowerCase()) {
      case 'survivor':
      case 'survivant':
      case 'a':
      case 'clienta':
        return 'survivor';
      case 'absorbed':
      case 'absorbe':
      case 'b':
      case 'clientb':
        return 'absorbed';
      default:
        return null;
    }
  }

  private _column(side: MergeSide, client: ClientDetailDto): MergeColumn {
    const contactPoints = (client.contactPoints ?? []).filter((point) => point.isActive !== false);
    const phone = contactPoints.find((point) => point.type === 'Phone' && point.isPrimary)
      ?? contactPoints.find((point) => point.type === 'Phone');
    const email = contactPoints.find((point) => point.type === 'Email' && point.isPrimary)
      ?? contactPoints.find((point) => point.type === 'Email');

    return {
      side,
      clientId: client.id ?? '',
      displayName: client.displayName || 'Client sans nom',
      clientNumber: client.clientNumber || '—',
      typeLabel: clientTypeLabel(client.clientType),
      statusLabel: clientStatusLabel(client.status),
      statusSeverity: clientStatusSeverity(client.status),
      agencyCode: client.agencyCode || '—',
      kycLabel: kycStatusLabel(client.kycStatus),
      createdAt: client.createdAt ?? null,
      phone:
        phone?.id && phone.valueMasked
          ? { contactPointId: phone.id, maskedValue: phone.valueMasked }
          : null,
      email:
        email?.id && email.valueMasked
          ? { contactPointId: email.id, maskedValue: email.valueMasked }
          : null,
    };
  }

  private _cell(
    side: MergeSide,
    client: ClientDetailDto,
    field: MergeFieldDef,
    value: string,
  ): MergeCell {
    return {
      side,
      clientId: client.id ?? '',
      display: value || 'Non renseigné',
      sensitive: field.sensitive ?? null,
      maskedValue: value || null,
      fieldLabel: field.label.toLowerCase(),
      isEmpty: !value,
    };
  }

  private _errorMessage(error: HttpErrorResponse, action: string): string {
    const validationErrors = error.error?.errors as Record<string, string[]> | undefined;
    const firstError = validationErrors
      ? Object.values(validationErrors).flat()[0]
      : undefined;
    return firstError ?? error.error?.title ?? error.error?.detail ?? `Impossible de ${action}.`;
  }
}

export default MergeComparePage;
