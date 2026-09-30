import { Component, computed, inject, output, signal, OnDestroy } from '@angular/core';
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
import { TasSelect } from '@talisoft/ui/select';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { RouterLink } from '@angular/router';
import {
  ImportLeadsAccepted,
  ImportRowFailure,
  LeadImportApiService,
  LeadImportStatusResponse,
  LeadImportStatusResponseStatusEnum,
  LeadRowValidationResult,
  LeadsApiService,
  ValidateLeadImportResponse,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';

type Step =
  | 'source'
  | 'upload'
  | 'google-config'
  | 'validating'
  | 'preview'
  | 'importing'
  | 'done';
type Source = 'csv' | 'excel' | 'google-sheets' | 'google-contacts';

const SOURCE_OPTIONS: { key: Source; label: string; icon: string }[] = [
  { key: 'csv', label: 'Fichier CSV', icon: 'feather:file-text' },
  { key: 'excel', label: 'Fichier Excel', icon: 'feather:file' },
  { key: 'google-sheets', label: 'Google Sheets', icon: 'feather:grid' },
  { key: 'google-contacts', label: 'Google Contacts', icon: 'feather:users' },
];

const FILE_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'upload', label: 'Fichier' },
  { key: 'preview', label: 'Validation' },
  { key: 'done', label: 'Terminé' },
];

// Les sources Google n'ont pas d'étape de validation : `POST /leads/import/validate` n'accepte qu'un
// fichier, et les deux endpoints Google répondent 202 sans prévisualisation.
const GOOGLE_STEPS = [
  { key: 'source', label: 'Source' },
  { key: 'google-config', label: 'Configuration' },
  { key: 'importing', label: 'Import' },
  { key: 'done', label: 'Terminé' },
];

/**
 * Valeurs de `source` acceptées par les quatre opérations d'import.
 *
 * Le swagger les déclare `type: integer` avec `enum [0..10]` : c'est donc un **entier** qui part sur
 * le réseau, alors que `LeadDto.source` se lit en chaîne. L'ordre de ce tableau donne l'indice, il ne
 * doit pas être réarrangé — `indexOf` en dépend.
 */
const LEAD_SOURCE_NAMES = [
  'Web',
  'MobileAgent',
  'Agency',
  'CallCenter',
  'Sms',
  'Ussd',
  'WhatsApp',
  'Referral',
  'Partner',
  'FileImport',
  'Campaign',
] as const;

type LeadSourceValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

const LEAD_SOURCE_LABELS: Record<(typeof LEAD_SOURCE_NAMES)[number], string> = {
  Web: 'Web',
  MobileAgent: 'Agent mobile',
  Agency: 'Agence',
  CallCenter: "Centre d'appels",
  Sms: 'SMS',
  Ussd: 'USSD',
  WhatsApp: 'WhatsApp',
  Referral: 'Recommandation',
  Partner: 'Partenaire',
  FileImport: 'Import de fichier',
  Campaign: 'Campagne',
};

/** Défaut raisonnable pour un import : les leads viennent d'un fichier. */
const DEFAULT_SOURCE_NAME = 'FileImport';

const GOOGLE_SHEET_URL_PATTERN =
  /^https:\/\/docs\.google\.com\/spreadsheets\/d\/(?:e\/)?[A-Za-z0-9_-]{15,}(?:[/?#].*)?$/;

/**
 * Options communes aux quatre sources : paramètres de requête pour `validate` et `file`, champs de
 * corps pour les deux requêtes Google. Les trois sont facultatives au contrat — aucun validateur,
 * mais elles passent par `form()` comme toute saisie du projet.
 */
class ImportOptionsFormModel {
  public source!: string;
  public interestedProduct!: string;
  public preferredLanguage!: string;

  public static instantiate(): ImportOptionsFormModel {
    const m = new ImportOptionsFormModel();
    m.source = DEFAULT_SOURCE_NAME;
    m.interestedProduct = '';
    m.preferredLanguage = '';
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

/**
 * Assistant d'import de leads, écrit une fois pour deux hôtes : le drawer de la liste des leads
 * (`containers/import-leads/import-leads.ts`) et la page `/leads/import`.
 *
 * Il s'appuie entièrement sur le pipeline serveur, comme les imports utilisateurs et clients :
 * `POST /leads/import/validate` à blanc, puis fichier ou Google, puis sondage du job. La version
 * précédente découpait le CSV dans le navigateur et postait un JSON déguisé en fichier — le serveur
 * re-découpe de toute façon le fichier lui-même, et lui seul sait détecter les doublons.
 *
 * Attention à la répartition des services : les trois opérations d'écriture sont sur
 * `LeadImportApiService`, mais le suivi est `LeadsApiService.getImportStatus`.
 */
@Component({
  selector: 'lead-import-wizard',
  templateUrl: './lead-import-wizard.html',
  imports: [
    RouterLink,
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
export class LeadImportWizard implements OnDestroy {
  private readonly _importApi = inject(LeadImportApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollDeadline: ReturnType<typeof setTimeout> | null = null;

  /** Émis dès qu'un import a créé au moins un lead, pour que l'hôte recharge sa liste. */
  public readonly imported = output<void>();

  public readonly canImport = this._permissions.can('lead:import');

  public readonly sourceOptions = SOURCE_OPTIONS;
  public readonly leadSourceOptions = LEAD_SOURCE_NAMES.map((name) => ({
    label: LEAD_SOURCE_LABELS[name],
    value: name as string,
  }));

  public step = signal<Step>('source');
  public selectedSource = signal<Source>('csv');

  public readonly isGoogleSource = computed(
    () =>
      this.selectedSource() === 'google-sheets' ||
      this.selectedSource() === 'google-contacts',
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

  public rawFile = signal<File | null>(null);

  public optionsModel = signal(ImportOptionsFormModel.instantiate());
  public optionsForm = form(this.optionsModel);

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

  // Validation serveur
  public validationResult = signal<ValidateLeadImportResponse | null>(null);
  public validationRows = signal<LeadRowValidationResult[]>([]);
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
  public importFailures = signal<ImportRowFailure[]>([]);
  /** Les échecs sont identifiés par `row` et non `rowNumber` : c'est le champ du contrat des leads. */
  public failuresTableConfig = signal<TableConfig>(this._tableConfig(0, 'row'));

  ngOnDestroy(): void {
    // Sans ça, le sondage survit à la fermeture du drawer et continue d'appeler l'API.
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

  public onFileChanged(file: File | null): void {
    this.rawFile.set(file);
  }

  public validateFile(): void {
    if (this.step() === 'validating') return;
    const file = this.rawFile();
    if (!file) return;

    this.step.set('validating');
    this._importApi
      .validateLeadImport(
        file,
        this._interestedProduct(),
        this._preferredLanguage(),
        this._sourceValue(),
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            this._apiErrorMessage(error, 'Impossible de valider le fichier.'),
          );
          this.step.set('upload');
          return EMPTY;
        }),
      )
      .subscribe((result: ValidateLeadImportResponse) => {
        this.validationResult.set(result);
        const rows = result.rows ?? [];
        this.validationRows.set(rows);
        this.previewTableConfig.set(this._tableConfig(rows.length));
        this.step.set('preview');

        if ((result.invalidRows ?? 0) > 0) {
          this._snackbar.info(
            'Validation terminée',
            `${result.invalidRows} ligne(s) invalide(s) détectée(s).`,
          );
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

    this._importApi
      .importLeadsFromFile(
        file,
        this._interestedProduct(),
        this._preferredLanguage(),
        this._sourceValue(),
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            this._apiErrorMessage(error, "Impossible de lancer l'import."),
          );
          this.step.set('preview');
          return EMPTY;
        }),
      )
      .subscribe((result: ImportLeadsAccepted) => {
        this._startTracking(result?.importJobId, 'preview');
      });
  }

  public submitGoogleSheetImport(): void {
    if (this.step() === 'importing' || this.googleSheetForm().submitting()) return;
    this.googleError.set('');

    submit(this.googleSheetForm, async (field) => {
      const spreadsheetUrl = (field()?.value().spreadsheetUrl ?? '').trim();
      const result = await firstValueFrom(
        this._importApi
          .importLeadsFromGoogleSheet({
            spreadsheetUrl,
            interestedProduct: this._interestedProduct() ?? null,
            preferredLanguage: this._preferredLanguage() ?? null,
            source: this._sourceValue() ?? null,
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._reportGoogleFailure(
                error,
                "Impossible de lancer l'import depuis Google Sheets.",
                'Import Google Sheets',
              );
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

  public startGoogleContactsImport(): void {
    if (this.isLaunchingContacts() || this.step() === 'importing') return;
    this.isLaunchingContacts.set(true);
    this.googleError.set('');

    this._importApi
      .importLeadsFromGoogleContacts({
        interestedProduct: this._interestedProduct() ?? null,
        preferredLanguage: this._preferredLanguage() ?? null,
        source: this._sourceValue() ?? null,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._reportGoogleFailure(
            error,
            "Impossible de lancer l'import depuis Google Contacts. L'autorisation Google du serveur est peut-être absente ou expirée.",
            'Import Google Contacts',
          );
          return of(null);
        }),
        finalize(() => this.isLaunchingContacts.set(false)),
      )
      .subscribe((result: ImportLeadsAccepted | null) => {
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

  public sourceLabel(name: string): string {
    return LEAD_SOURCE_LABELS[name as (typeof LEAD_SOURCE_NAMES)[number]] ?? name;
  }

  /**
   * `source` part en **entier** : l'indice dans `LEAD_SOURCE_NAMES`. `tas-select` ne travaille qu'en
   * chaînes, la conversion ne peut donc se faire qu'ici, à l'envoi.
   */
  private _sourceValue(): LeadSourceValue | undefined {
    const name = this.optionsForm.source().value();
    const index = LEAD_SOURCE_NAMES.indexOf(name as (typeof LEAD_SOURCE_NAMES)[number]);
    return index >= 0 ? (index as LeadSourceValue) : undefined;
  }

  private _interestedProduct(): string | undefined {
    return this.optionsForm.interestedProduct().value().trim() || undefined;
  }

  private _preferredLanguage(): string | undefined {
    return this.optionsForm.preferredLanguage().value().trim() || undefined;
  }

  /**
   * Point d'entrée unique du suivi : les trois sources répondent 202 + `importJobId`, et
   * `GET /leads/import/{id}` est le même pour toutes. Sans identifiant, on ne prétend pas que
   * l'import a réussi — c'est ce que faisait la version précédente.
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
      this._leadsApi
        .getImportStatus(jobId)
        .pipe(
          catchError((error: HttpErrorResponse) => {
            // Un 404 signifie que le job n'existe pas : inutile de sonder indéfiniment.
            if (error?.status === 404) {
              this._stopPoll();
              this._snackbar.error(
                'Suivi interrompu',
                "Le job d'import est introuvable côté serveur.",
              );
              this.trackingStopped.set(true);
            }
            return of(null);
          }),
        )
        .subscribe((status: LeadImportStatusResponse | null) => {
          if (!status) return;
          this.importProgress.set(
            (status.succeeded ?? 0) + (status.failed ?? 0) + (status.skipped ?? 0),
          );
          // Les sources Google n'ont pas d'étape de validation : le total ne peut venir que du statut.
          if ((status.totalRows ?? 0) > 0) this.importTotal.set(status.totalRows ?? 0);

          if (
            status.status !== LeadImportStatusResponseStatusEnum.Completed &&
            status.status !== LeadImportStatusResponseStatusEnum.Failed
          ) {
            return;
          }

          this._stopPoll();
          this.importSucceeded.set(status.succeeded ?? 0);
          this.importFailed.set(status.failed ?? 0);
          this.importSkipped.set(status.skipped ?? 0);
          this.importError.set(status.errorMessage ?? '');
          const failures = status.failures ?? [];
          this.importFailures.set(failures);
          this.failuresTableConfig.set(this._tableConfig(failures.length, 'row'));
          this.step.set('done');

          if (status.status === LeadImportStatusResponseStatusEnum.Completed) {
            this._snackbar.success('Import terminé', `${status.succeeded ?? 0} lead(s) importé(s).`);
          } else {
            this._snackbar.error('Import échoué', status.errorMessage ?? 'Une erreur est survenue.');
          }

          // L'hôte ne recharge que s'il y a de quoi : un job entièrement en échec ne change rien à
          // la liste.
          if ((status.succeeded ?? 0) > 0) this.imported.emit();
        });
    }, 3000);

    // Le sondage s'arrête au bout de 2 minutes : on le dit, et on laisse relancer le suivi plutôt
    // que de laisser l'écran sur un spinner perpétuel.
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
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._pollDeadline) {
      clearTimeout(this._pollDeadline);
      this._pollDeadline = null;
    }
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

  private _tableConfig(totalElements: number, property = 'rowNumber'): TableConfig {
    return {
      property,
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

  private _reportGoogleFailure(
    error: HttpErrorResponse,
    fallback: string,
    title: string,
  ): void {
    const message = this._apiErrorMessage(error, fallback);
    this.googleError.set(message);
    this._snackbar.error(title, message);
  }

  /**
   * Remonte le message du serveur plutôt qu'un texte générique : sur ces imports, le refus (colonnes
   * manquantes, classeur inaccessible, 422 de validation) n'est diagnosticable que par lui.
   */
  private _apiErrorMessage(error: HttpErrorResponse, fallback: string): string {
    const body = error?.error;
    if (typeof body === 'string' && body.trim()) return body.trim();

    const validationErrors = body?.errors as Record<string, string[] | string> | undefined;
    if (validationErrors && typeof validationErrors === 'object') {
      const messages = Object.entries(validationErrors).map(([path, value]) => {
        const text = Array.isArray(value) ? value.join('. ') : String(value);
        return path ? `${path} : ${text}` : text;
      });
      if (messages.length > 0) return messages.join(' ; ');
    }
    if (body?.detail) return String(body.detail);
    if (body?.title) return String(body.title);
    if (error?.status === 403) return "Vous n'avez pas la permission d'importer des leads.";
    if (error?.status === 0) return 'Le serveur est injoignable.';
    return fallback;
  }
}
