import { Component, computed, inject, signal, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgenciesApiService,
  AgencyDto,
  ClientImportApiService,
  ClientImportJobCreatedResult,
  ClientImportRowFailure,
  ClientImportStatusDto,
  ClientRowValidationResult,
  ValidateClientImportResponse,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';

type Step = 'source' | 'upload' | 'google-config' | 'validating' | 'preview' | 'importing' | 'done';
type Source = 'csv' | 'excel' | 'google-sheets';

/**
 * Le contrat n'offre **pas** d'import Google Contacts pour les clients, là où les utilisateurs en
 * ont un (`POST /users/import/google-contacts`). Ne pas recopier la quatrième tuile : elle
 * n'aurait aucun endpoint derrière.
 */
const SOURCE_OPTIONS: { key: Source; label: string; icon: string; available: boolean }[] = [
  { key: 'csv', label: 'Fichier CSV', icon: 'feather:file-text', available: true },
  { key: 'excel', label: 'Fichier Excel', icon: 'feather:file', available: true },
  { key: 'google-sheets', label: 'Google Sheets', icon: 'feather:grid', available: true },
];

const FILE_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'upload', label: 'Fichier' },
  { key: 'preview', label: 'Validation' },
  { key: 'done', label: 'Terminé' },
];

// Google Sheets n'a pas d'étape de validation : `POST /clients/import/validate` n'accepte qu'un
// fichier, et l'endpoint Google répond 202 sans prévisualisation.
const GOOGLE_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'google-config', label: 'Configuration' },
  { key: 'importing', label: 'Import' },
  { key: 'done', label: 'Terminé' },
];

/**
 * Colonnes attendues, telles que les trois endpoints les énoncent mot pour mot dans leur
 * description. Elles sont affichées à l'écran : sans elles, on ne découvre l'orthographe exacte
 * d'une colonne qu'après un import à quatre cents lignes invalides.
 */
const EXPECTED_COLUMNS = [
  'FirstName', 'LastName', 'Gender', 'DateOfBirth', 'Nationality',
  'IdentityDocumentType', 'IdentityDocumentNumber', 'Profession',
  'LegalName', 'LegalFormCode', 'RegistrationNumber', 'TaxIdNumber', 'IncorporationDate',
  'PhoneNumber', 'Email', 'AgencyCode', 'PreferredLanguage',
  'AddressStreet', 'AddressCity', 'AddressCountry',
];

/**
 * `ClientImportStatusDto.status` est une **chaîne libre** au contrat : contrairement à
 * `UserImportStatusDto`, aucune énumération n'y est déclarée, donc le générateur n'a produit
 * aucun type à comparer. Les valeurs reprises ici sont celles de l'import d'utilisateurs
 * (`Pending | Processing | Completed | Failed`), la description disant que chaque ligne passe par
 * la même machinerie. La comparaison est faite en un seul endroit, insensible à la casse : si le
 * serveur écrivait `completed`, l'écran resterait bloqué sur un spinner perpétuel.
 */
const TERMINAL_STATUSES = ['completed', 'failed'];

const GOOGLE_SHEET_URL_PATTERN =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]{15,}(?:[/?#].*)?$/;

/**
 * Option commune aux deux imports, isolée dans son propre formulaire : le fichier et Google Sheets
 * la transmettent différemment (paramètre de requête d'un côté, corps JSON de l'autre) mais
 * l'utilisateur la choisit au même titre.
 */
class ImportOptionsFormModel {
  public defaultAgencyId!: string;

  public static instantiate(): ImportOptionsFormModel {
    const m = new ImportOptionsFormModel();
    m.defaultAgencyId = '';
    return m;
  }
}

class GoogleSheetImportFormModel {
  public spreadsheetUrl!: string;

  public static instantiate(): GoogleSheetImportFormModel {
    const m = new GoogleSheetImportFormModel();
    m.spreadsheetUrl = '';
    return m;
  }
}

@Component({
  selector: 'import-clients-page',
  templateUrl: './import-clients.html',
  imports: [
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasFileUploader,
    TasTable,
    FormRoot,
    FormField,
  ],
})
export class ImportClientsPage implements OnInit, OnDestroy {
  private readonly _importApi = inject(ClientImportApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollDeadline: ReturnType<typeof setTimeout> | null = null;

  // Les trois opérations déclarent la même permission dans leur description : `customers:create`.
  public readonly canImport = this._permissions.can('customers:create');

  public readonly sourceOptions = SOURCE_OPTIONS;
  public readonly expectedColumns = EXPECTED_COLUMNS;

  public step = signal<Step>('source');
  public selectedSource = signal<Source>('csv');
  public showColumns = signal(false);

  public readonly isGoogleSource = computed(() => this.selectedSource() === 'google-sheets');
  public readonly stepsMeta = computed(() => (this.isGoogleSource() ? GOOGLE_STEPS : FILE_STEPS));
  public readonly stepIdx = computed(() => {
    const map: Record<Step, number> = {
      source: 0,
      upload: 1,
      'google-config': 1,
      validating: 1,
      preview: 2,
      importing: 2,
      done: 3,
    };
    return map[this.step()] ?? 0;
  });

  public rawFile = signal<File | null>(null);

  /**
   * Agence par défaut, proposée sur les deux imports : `POST /clients/import/file` l'accepte en
   * paramètre de requête et `ClientGoogleSheetImportRequest` dans son corps. Elle ne sert qu'aux
   * lignes dépourvues de colonne `AgencyCode` — d'où le caractère facultatif, et la mention à
   * l'écran plutôt qu'un champ obligatoire de plus.
   *
   * `tas-select` travaille en chaînes : la valeur vide signifie « aucune » et n'est pas envoyée.
   */
  public agencies = signal<AgencyDto[]>([]);
  public isLoadingAgencies = signal(false);
  public readonly agencyOptions = computed(() =>
    this.agencies().map((a) => ({ label: a.name ?? '', value: a.id ?? '' })),
  );

  // Aucun validateur : le champ est facultatif, mais il passe par `form()` comme tout champ de
  // saisie du projet.
  public optionsModel = signal(ImportOptionsFormModel.instantiate());
  public optionsForm = form(this.optionsModel);
  public readonly defaultAgencyId = computed(
    () => this.optionsForm.defaultAgencyId().value() ?? '',
  );

  // Google
  public googleError = signal('');
  public googleSheetModel = signal(GoogleSheetImportFormModel.instantiate());
  public googleSheetForm = form(this.googleSheetModel, (schema) => {
    validate(schema.spreadsheetUrl, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) {
        return { kind: 'required', message: "L'URL du classeur Google Sheets est obligatoire" };
      }
      return GOOGLE_SHEET_URL_PATTERN.test(value)
        ? null
        : {
            kind: 'pattern',
            message:
              'Renseignez une URL de classeur Google Sheets, de la forme https://docs.google.com/spreadsheets/d/…',
          };
    });
  });

  // Validation serveur
  public validationResult = signal<ValidateClientImportResponse | null>(null);
  public validationRows = signal<ClientRowValidationResult[]>([]);
  public previewTableConfig = signal<TableConfig>(this._tableConfig(0));

  // Suivi de l'import
  public importProgress = signal(0);
  public importTotal = signal(0);
  public importSucceeded = signal(0);
  public importFailed = signal(0);
  public importSkipped = signal(0);
  public importError = signal('');
  public currentJobId = signal('');
  public trackingStopped = signal(false);

  /**
   * `ClientImportStatusDto.failures` détaille les lignes refusées, ce que le statut d'import
   * d'utilisateurs ne donne pas. On les affiche : un compteur « 12 échoué(s) » sans dire
   * lesquelles oblige à refaire l'import pour savoir quoi corriger.
   */
  public importFailures = signal<ClientImportRowFailure[]>([]);
  public failuresTableConfig = signal<TableConfig>(this._tableConfig(0));

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Importer des clients' },
    ]);
    this._loadAgencies();
  }

  ngOnDestroy(): void {
    // Sans ça, le sondage survit à la destruction de l'écran et continue d'appeler l'API.
    this._stopPoll();
  }

  public selectSource(source: Source): void {
    if (!this.canImport()) return;
    this.selectedSource.set(source);
    this.googleError.set('');
    this.step.set(source === 'google-sheets' ? 'google-config' : 'upload');
  }

  public backToSource(): void {
    this.googleError.set('');
    this.step.set('source');
  }

  /**
   * `tas-file-uploader` refuse lui-même un fichier trop lourd et affiche son nom,
   * sa taille et le motif du refus : il ne reste ici que le fichier retenu.
   */
  public onFileChanged(file: File | null): void {
    this.rawFile.set(file);
  }

  public validateFile(): void {
    if (this.step() === 'validating') return;
    const file = this.rawFile();
    if (!file) return;

    this.step.set('validating');
    this._importApi.validateClientImport(file).pipe(
      catchError((error: HttpErrorResponse) => {
        this._snackbar.error(
          'Erreur',
          this._apiErrorMessage(error, 'Impossible de valider le fichier.'),
        );
        this.step.set('upload');
        return EMPTY;
      }),
    ).subscribe((result: ValidateClientImportResponse) => {
      this.validationResult.set(result);
      const rows = result.rows ?? [];
      this.validationRows.set(rows);
      this.previewTableConfig.set(this._tableConfig(rows.length));
      this.step.set('preview');

      if ((result.invalidRows ?? 0) > 0) {
        this._snackbar.info('Validation terminée', `${result.invalidRows} ligne(s) invalide(s) détectée(s).`);
      } else {
        this._snackbar.success('Validation réussie', `${result.validRows} ligne(s) valide(s).`);
      }
    });
  }

  public startImport(): void {
    if (this.step() === 'importing') return;
    const file = this.rawFile();
    if (!file) return;

    this.step.set('importing');
    this._resetImportCounters();
    this.importTotal.set(this.validationResult()?.totalRows ?? 0);

    this._importApi.importClientsFromFile(file, this.defaultAgencyId() || undefined).pipe(
      catchError((error: HttpErrorResponse) => {
        this._snackbar.error(
          'Erreur',
          this._apiErrorMessage(error, "Impossible de lancer l'import."),
        );
        this.step.set('preview');
        return EMPTY;
      }),
    ).subscribe((result: ClientImportJobCreatedResult) => {
      this._startTracking(result?.importJobId, 'preview');
    });
  }

  public submitGoogleSheetImport(): void {
    if (this.step() === 'importing' || this.googleSheetForm().submitting()) return;
    this.googleError.set('');

    submit(this.googleSheetForm, async (field) => {
      const spreadsheetUrl = (field()?.value().spreadsheetUrl ?? '').trim();
      const result = await firstValueFrom(
        this._importApi.importClientsFromGoogleSheet({
          spreadsheetUrl,
          // `defaultAgencyId` est un `uuid` nullable : on envoie `null` plutôt qu'une chaîne
          // vide, que le serveur refuserait au format.
          defaultAgencyId: this.defaultAgencyId() || null,
        }).pipe(
          catchError((error: HttpErrorResponse) => {
            const message = this._apiErrorMessage(
              error,
              "Impossible de lancer l'import depuis Google Sheets.",
            );
            this.googleError.set(message);
            this._snackbar.error('Import Google Sheets', message);
            // `of(null)` et non `EMPTY` : `firstValueFrom` sur un flux vide rejette avec une
            // EmptyError, qui ferait échouer la soumission après l'affichage du message.
            return of(null);
          }),
        ),
      );

      if (result) {
        this._resetImportCounters();
        this._startTracking(result.importJobId, 'google-config');
      }
    });
  }

  public resumeTracking(): void {
    if (!this.trackingStopped()) return;
    const jobId = this.currentJobId();
    if (!jobId) return;
    this.trackingStopped.set(false);
    this._pollImportStatus(jobId);
  }

  public reset(): void {
    this._stopPoll();
    this.step.set('source');
    this.selectedSource.set('csv');
    this.rawFile.set(null);
    this.validationResult.set(null);
    this.validationRows.set([]);
    this.googleError.set('');
    this.currentJobId.set('');
    this.trackingStopped.set(false);
    this.importError.set('');
    this.importFailures.set([]);
    this.optionsModel.set(ImportOptionsFormModel.instantiate());
    this.optionsForm().reset();
    this.googleSheetModel.set(GoogleSheetImportFormModel.instantiate());
    this.googleSheetForm().reset();
  }

  public agencyName(agencyId: string): string {
    return this.agencies().find((a) => a.id === agencyId)?.name ?? '';
  }

  /**
   * Point d'entrée unique du suivi : les deux sources (fichier, Google Sheets) répondent 202 +
   * `importJobId`, et `GET /clients/import/{importJobId}/status` est le même pour les deux.
   */
  private _startTracking(jobId: string | undefined, stepOnFailure: Step): void {
    if (!jobId) {
      this._snackbar.error(
        'Suivi impossible',
        "Le serveur a accepté l'import sans renvoyer d'identifiant de job : impossible d'en suivre l'avancement.",
      );
      this.step.set(stepOnFailure);
      return;
    }
    this.currentJobId.set(jobId);
    this.trackingStopped.set(false);
    this.step.set('importing');
    this._pollImportStatus(jobId);
  }

  private _pollImportStatus(jobId: string): void {
    this._stopPoll();
    this._pollTimer = setInterval(() => {
      this._importApi.getClientImportStatus(jobId).pipe(
        catchError((error: HttpErrorResponse) => {
          // Un 404 signifie que le job n'existe pas : inutile de sonder indéfiniment.
          if (error?.status === 404) {
            this._stopPoll();
            this._snackbar.error('Suivi interrompu', "Le job d'import est introuvable côté serveur.");
            this.trackingStopped.set(true);
          }
          return of(null);
        }),
      ).subscribe((status: ClientImportStatusDto | null) => {
        if (!status) return;
        this.importProgress.set((status.succeeded ?? 0) + (status.failed ?? 0) + (status.skipped ?? 0));
        // Google Sheets n'a pas d'étape de validation : le total ne peut venir que du statut.
        if ((status.totalRows ?? 0) > 0) this.importTotal.set(status.totalRows ?? 0);

        if (!this._isTerminal(status.status)) return;

        this._stopPoll();
        this.importSucceeded.set(status.succeeded ?? 0);
        this.importFailed.set(status.failed ?? 0);
        this.importSkipped.set(status.skipped ?? 0);
        this.importError.set(status.errorMessage ?? '');
        const failures = status.failures ?? [];
        this.importFailures.set(failures);
        this.failuresTableConfig.set(this._tableConfig(failures.length));
        this.step.set('done');

        if ((status.status ?? '').toLowerCase() === 'completed') {
          this._snackbar.success('Import terminé', `${status.succeeded ?? 0} client(s) créé(s).`);
        } else {
          this._snackbar.error('Import échoué', status.errorMessage ?? 'Une erreur est survenue.');
        }
      });
    }, 3000);

    // Le sondage s'arrête au bout de 2 minutes : on le dit à l'utilisateur et on lui laisse
    // relancer le suivi, plutôt que de le laisser sur un spinner perpétuel.
    this._pollDeadline = setTimeout(() => {
      if (!this._pollTimer) return;
      this._stopPoll();
      this.trackingStopped.set(true);
      this._snackbar.info(
        'Suivi suspendu',
        "L'import se poursuit côté serveur. Relancez le suivi pour connaître son état.",
      );
    }, 120_000);
  }

  private _isTerminal(status: string | null | undefined): boolean {
    return TERMINAL_STATUSES.includes((status ?? '').toLowerCase());
  }

  private _loadAgencies(): void {
    this.isLoadingAgencies.set(true);
    this._agenciesApi.listAgencies(false, 1, 0).pipe(
      catchError(() => {
        // L'agence par défaut est facultative : son absence ne doit pas empêcher l'import,
        // seulement le choix. On le dit sans transformer ça en échec d'écran.
        this._snackbar.info(
          'Agences indisponibles',
          "La liste des agences n'a pas pu être chargée : l'import reste possible, chaque ligne devra porter sa colonne AgencyCode.",
        );
        this.isLoadingAgencies.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      this.agencies.set(result.items ?? []);
      this.isLoadingAgencies.set(false);
    });
  }

  private _tableConfig(totalElements: number): TableConfig {
    return {
      property: 'rowNumber',
      pagination: {
        // Les lignes sont déjà toutes en mémoire : c'est bien une pagination client.
        serverSide: false,
        pageIndex: 0,
        pageSize: 20,
        pageSizeOptions: [10, 20, 50],
        totalElements,
      },
    };
  }

  private _stopPoll(): void {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._pollDeadline) { clearTimeout(this._pollDeadline); this._pollDeadline = null; }
  }

  private _resetImportCounters(): void {
    this.importProgress.set(0);
    this.importTotal.set(0);
    this.importSucceeded.set(0);
    this.importFailed.set(0);
    this.importSkipped.set(0);
    this.importError.set('');
    this.importFailures.set([]);
  }

  /**
   * Remonte le message du serveur plutôt qu'un texte générique : sur ces imports, le refus
   * (classeur inaccessible, colonnes manquantes, agence inconnue) n'est diagnosticable que par lui.
   */
  private _apiErrorMessage(error: HttpErrorResponse, fallback: string): string {
    const body = error?.error;
    if (typeof body === 'string' && body.trim()) return body.trim();

    const validationErrors = body?.errors as Record<string, string[] | string> | undefined;
    if (validationErrors && typeof validationErrors === 'object') {
      const first = Object.values(validationErrors)[0];
      const message = Array.isArray(first) ? first[0] : first;
      if (message) return String(message);
    }
    if (body?.detail) return String(body.detail);
    if (body?.title) return String(body.title);
    if (error?.status === 0) return 'Le serveur est injoignable.';
    return fallback;
  }
}

export default ImportClientsPage;
