import { Component, computed, inject, signal, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, finalize, firstValueFrom, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  ImportJobCreatedResult,
  UserImportApiService,
  UserImportStatusDto,
  UserImportStatusDtoStatusEnum,
  ValidateImportResponse,
  RowValidationResult,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';

type Step = 'source' | 'upload' | 'google-config' | 'validating' | 'preview' | 'importing' | 'done';
type Source = 'csv' | 'excel' | 'google-sheets' | 'google-contacts';

const SOURCE_OPTIONS: { key: Source; label: string; icon: string; available: boolean }[] = [
  { key: 'csv', label: 'Fichier CSV', icon: 'feather:file-text', available: true },
  { key: 'excel', label: 'Fichier Excel', icon: 'feather:file', available: true },
  { key: 'google-sheets', label: 'Google Sheets', icon: 'feather:grid', available: true },
  { key: 'google-contacts', label: 'Google Contacts', icon: 'feather:users', available: true },
];

const FILE_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'upload', label: 'Fichier' },
  { key: 'preview', label: 'Validation' },
  { key: 'done', label: 'Terminé' },
];

// Les sources Google n'ont pas d'étape de validation : le contrat n'offre `POST /users/import/validate`
// que pour un fichier, et les deux endpoints Google répondent 202 sans prévisualisation.
const GOOGLE_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'google-config', label: 'Configuration' },
  { key: 'importing', label: 'Import' },
  { key: 'done', label: 'Terminé' },
];

// `UserGoogleSheetImportRequest.spreadsheetUrl` est un simple `string` nullable : le contrat
// n'impose aucun format. On refuse donc en amont ce que le serveur ne pourra pas ouvrir, plutôt
// que de lui envoyer n'importe quelle chaîne non vide — seule une URL de classeur
// `docs.google.com/spreadsheets/d/<id>` (ou `/d/e/<id>` pour un classeur publié) est acceptée.
const GOOGLE_SHEET_URL_PATTERN =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]{15,}(?:[/?#].*)?$/;

class GoogleSheetImportFormModel {
  public spreadsheetUrl!: string;

  public static instantiate(): GoogleSheetImportFormModel {
    const m = new GoogleSheetImportFormModel();
    m.spreadsheetUrl = '';
    return m;
  }
}

@Component({
  selector: 'import-users-page',
  templateUrl: './import-users.html',
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
    FormRoot,
    FormField,
  ],
})
export class ImportUsersPage implements OnInit, OnDestroy {
  private readonly _importApi = inject(UserImportApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollDeadline: ReturnType<typeof setTimeout> | null = null;

  // Les deux opérations Google ne déclarent aucune permission dans le contrat : on reprend celle
  // qui protège déjà cet écran et l'import de fichier (`hasPermissionGuard('user:create')`).
  public readonly canImport = this._permissions.can('user:create');

  public readonly sourceOptions = SOURCE_OPTIONS;

  public step = signal<Step>('source');
  public selectedSource = signal<Source>('csv');

  public readonly isGoogleSource = computed(
    () => this.selectedSource() === 'google-sheets' || this.selectedSource() === 'google-contacts',
  );
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

  public fileName = signal('');
  public uploadError = signal('');
  public rawFile = signal<File | null>(null);

  // Google
  public googleError = signal('');
  public isLaunchingContacts = signal(false);
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

  // Server validation
  public validationResult = signal<ValidateImportResponse | null>(null);
  public validationRows = signal<RowValidationResult[]>([]);

  // Import status
  public importProgress = signal(0);
  public importTotal = signal(0);
  public importSucceeded = signal(0);
  public importFailed = signal(0);
  public importSkipped = signal(0);
  public importError = signal('');
  public currentJobId = signal('');
  public trackingStopped = signal(false);

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Importer des utilisateurs' },
    ]);
  }

  ngOnDestroy(): void {
    // Sans ça, le sondage survivait à la destruction de l'écran et continuait d'appeler l'API.
    this._stopPoll();
  }

  public selectSource(source: Source): void {
    if (!this.canImport()) return;
    this.selectedSource.set(source);
    this.googleError.set('');
    this.step.set(
      source === 'google-sheets' || source === 'google-contacts' ? 'google-config' : 'upload',
    );
  }

  public backToSource(): void {
    this.googleError.set('');
    this.step.set('source');
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      this.uploadError.set('Fichier trop volumineux (max 10 Mo).');
      return;
    }
    this.fileName.set(file.name);
    this.uploadError.set('');
    this.rawFile.set(file);
    input.value = '';
  }

  public validateFile(): void {
    if (this.step() === 'validating') return;
    const file = this.rawFile();
    if (!file) return;

    this.step.set('validating');
    this._importApi.validateUserImport(file).pipe(
      catchError((error: HttpErrorResponse) => {
        this._snackbar.error(
          'Erreur',
          this._apiErrorMessage(error, 'Impossible de valider le fichier.'),
        );
        this.step.set('upload');
        return EMPTY;
      }),
    ).subscribe((result: ValidateImportResponse) => {
      this.validationResult.set(result);
      this.validationRows.set(result.rows ?? []);
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

    this._importApi.importUsersFromFile(file).pipe(
      catchError((error: HttpErrorResponse) => {
        this._snackbar.error(
          'Erreur',
          this._apiErrorMessage(error, "Impossible de lancer l'import."),
        );
        this.step.set('preview');
        return EMPTY;
      }),
    ).subscribe((result: ImportJobCreatedResult) => {
      this._startTracking(result?.importJobId, 'preview');
    });
  }

  public submitGoogleSheetImport(): void {
    if (this.step() === 'importing' || this.googleSheetForm().submitting()) return;
    this.googleError.set('');

    submit(this.googleSheetForm, async (field) => {
      const spreadsheetUrl = (field()?.value().spreadsheetUrl ?? '').trim();
      const result = await firstValueFrom(
        this._importApi.importUsersFromGoogleSheet({ spreadsheetUrl }).pipe(
          catchError((error: HttpErrorResponse) => {
            this._reportGoogleFailure(
              error,
              "Impossible de lancer l'import depuis Google Sheets.",
              'Import Google Sheets',
            );
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

  public startGoogleContactsImport(): void {
    if (this.isLaunchingContacts() || this.step() === 'importing') return;
    this.isLaunchingContacts.set(true);
    this.googleError.set('');

    // L'endpoint n'accepte aucun corps : le serveur utilise le compte Google qui lui est rattaché.
    this._importApi.importUsersFromGoogleContacts().pipe(
      catchError((error: HttpErrorResponse) => {
        this._reportGoogleFailure(
          error,
          "Impossible de lancer l'import depuis Google Contacts. L'autorisation Google du serveur est peut-être absente ou expirée.",
          'Import Google Contacts',
        );
        return of(null);
      }),
      finalize(() => this.isLaunchingContacts.set(false)),
    ).subscribe((result: ImportJobCreatedResult | null) => {
      if (!result) return;
      this._resetImportCounters();
      this._startTracking(result.importJobId, 'google-config');
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
    this.fileName.set('');
    this.uploadError.set('');
    this.validationResult.set(null);
    this.validationRows.set([]);
    this.googleError.set('');
    this.currentJobId.set('');
    this.trackingStopped.set(false);
    this.importError.set('');
    this.googleSheetModel.set(GoogleSheetImportFormModel.instantiate());
    this.googleSheetForm().reset();
  }

  /**
   * Point d'entrée unique du suivi : les trois sources (fichier, Google Sheets, Google Contacts)
   * répondent 202 + `importJobId`, et `GET /users/import/{id}/status` est le même pour toutes.
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
      this._importApi.getUserImportStatus(jobId).pipe(
        catchError((error: HttpErrorResponse) => {
          // Un 404 signifie que le job n'existe pas : inutile de sonder indéfiniment.
          if (error?.status === 404) {
            this._stopPoll();
            this._snackbar.error('Suivi interrompu', "Le job d'import est introuvable côté serveur.");
            this.trackingStopped.set(true);
          }
          return of(null);
        }),
      ).subscribe((status: UserImportStatusDto | null) => {
        if (!status) return;
        this.importProgress.set((status.succeeded ?? 0) + (status.failed ?? 0) + (status.skipped ?? 0));
        // Les sources Google n'ont pas d'étape de validation : le total ne peut venir que du statut.
        if ((status.totalRows ?? 0) > 0) this.importTotal.set(status.totalRows ?? 0);

        if (status.status === UserImportStatusDtoStatusEnum.Completed ||
            status.status === UserImportStatusDtoStatusEnum.Failed) {
          this._stopPoll();
          this.importSucceeded.set(status.succeeded ?? 0);
          this.importFailed.set(status.failed ?? 0);
          this.importSkipped.set(status.skipped ?? 0);
          this.importError.set(status.errorMessage ?? '');
          this.step.set('done');

          if (status.status === UserImportStatusDtoStatusEnum.Completed) {
            this._snackbar.success('Import terminé', `${status.succeeded ?? 0} utilisateur(s) créé(s).`);
          } else {
            this._snackbar.error('Import échoué', status.errorMessage ?? 'Une erreur est survenue.');
          }
        }
      });
    }, 3000);

    // Le sondage s'arrêtait en silence au bout de 2 minutes et laissait l'écran sur un spinner
    // perpétuel : on le dit maintenant à l'utilisateur et on lui laisse relancer le suivi.
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
  }

  private _reportGoogleFailure(error: HttpErrorResponse, fallback: string, title: string): void {
    const message = this._apiErrorMessage(error, fallback);
    this.googleError.set(message);
    this._snackbar.error(title, message);
  }

  /**
   * Remonte le message du serveur plutôt qu'un texte générique : sur ces imports, le refus
   * (classeur inaccessible, autorisation Google manquante) n'est diagnosticable que par lui.
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

export default ImportUsersPage;
