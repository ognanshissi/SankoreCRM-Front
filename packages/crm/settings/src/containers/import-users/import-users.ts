import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { catchError, EMPTY, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  UserImportApiService,
  UserImportStatusDto,
  UserImportStatusDtoStatusEnum,
  ValidateImportResponse,
  RowValidationResult,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';

type Step = 'source' | 'upload' | 'validating' | 'preview' | 'importing' | 'done';
type Source = 'csv' | 'excel' | 'google-sheets' | 'google-contacts';

const SOURCE_OPTIONS: { key: Source; label: string; icon: string; available: boolean }[] = [
  { key: 'csv', label: 'Fichier CSV', icon: 'feather:file-text', available: true },
  { key: 'excel', label: 'Fichier Excel', icon: 'feather:file', available: true },
  { key: 'google-sheets', label: 'Google Sheets', icon: 'feather:grid', available: false },
  { key: 'google-contacts', label: 'Google Contacts', icon: 'feather:users', available: false },
];

@Component({
  selector: 'import-users-page',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button],
  template: `
    <div class="pb-6">
      <div class="flex items-start justify-between mb-6">
        <div>
          <h1 class="text-lg font-semibold text-slate-800">Importer des utilisateurs</h1>
          <p class="text-sm text-slate-500 mt-0.5">Importez des utilisateurs depuis un fichier ou un service externe.</p>
        </div>
      </div>

      <!-- Stepper -->
      <div class="flex items-center gap-2 mb-6">
        @for (s of stepsMeta; track s.key; let i = $index) {
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              [class]="stepIdx() > i ? 'bg-green-100 text-green-700' : stepIdx() === i ? 'bg-primary/15 text-primary' : 'bg-slate-100 text-slate-400'">
              @if (stepIdx() > i) { <tas-icon iconName="feather:check" style="font-size:12px"></tas-icon> }
              @else { {{ i + 1 }} }
            </div>
            <span class="text-xs font-medium" [class]="stepIdx() >= i ? 'text-slate-700' : 'text-slate-400'">{{ s.label }}</span>
            @if (i < stepsMeta.length - 1) { <div class="w-6 h-px" [class]="stepIdx() > i ? 'bg-green-300' : 'bg-slate-200'"></div> }
          </div>
        }
      </div>

      <!-- Step 1: Source -->
      @if (step() === 'source') {
        <div class="grid grid-cols-4 gap-3">
          @for (src of sourceOptions; track src.key) {
            <button type="button" class="p-4 rounded-lg border transition-all text-center bg-white shadow"
              [class]="src.available ? 'border-slate-200 hover:border-primary hover:shadow-sm cursor-pointer' : 'border-slate-100 opacity-50 cursor-not-allowed'"
              [disabled]="!src.available" (click)="selectSource(src.key)">
              <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-2">
                <tas-icon [iconName]="src.icon" class="text-slate-500" size="20"></tas-icon>
              </div>
              <p class="text-sm font-medium text-slate-800">{{ src.label }}</p>
              @if (!src.available) { <tas-tag severity="warning" class="mt-2">À venir</tas-tag> }
            </button>
          }
        </div>
      }

      <!-- Step 2: Upload -->
      @if (step() === 'upload') {
        <tas-card class="block">
          <div class="p-6">
            <div class="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center hover:border-slate-300 transition-colors cursor-pointer"
              (click)="fileInput.click()">
              <tas-icon iconName="feather:upload" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-600">Glissez un fichier ou cliquez pour sélectionner</p>
              <p class="text-xs text-slate-400 mt-1">{{ selectedSource() === 'csv' ? 'Fichiers .csv' : 'Fichiers .xlsx, .xls, .csv' }} — max 10 Mo</p>
            </div>
            <input #fileInput type="file" class="hidden"
              [accept]="selectedSource() === 'csv' ? '.csv' : '.xlsx,.xls,.csv'"
              (change)="onFileSelected($event)" />
            @if (fileName()) {
              <div class="mt-3 flex items-center gap-2 text-sm text-slate-600">
                <tas-icon iconName="feather:file" style="font-size:14px"></tas-icon>
                {{ fileName() }}
              </div>
            }
            @if (uploadError()) {
              <p class="text-xs text-red-500 mt-2">{{ uploadError() }}</p>
            }
            <div class="flex justify-end mt-4 gap-2">
              <button tas-outlined-button type="button" (click)="step.set('source')">Retour</button>
              <button tas-raised-button color="primary" type="button" [disabled]="!rawFile()" (click)="validateFile()">
                Valider le fichier
              </button>
            </div>
          </div>
        </tas-card>
      }

      <!-- Step 2b: Validating -->
      @if (step() === 'validating') {
        <tas-card class="block">
          <div class="p-6 text-center">
            <tas-spinner size="8" class="text-primary mb-4"></tas-spinner>
            <p class="text-sm font-medium text-slate-700">Validation du fichier en cours…</p>
            <p class="text-xs text-slate-400 mt-1">Le serveur analyse le contenu et vérifie chaque ligne.</p>
          </div>
        </tas-card>
      }

      <!-- Step 3: Preview (server-validated) -->
      @if (step() === 'preview') {
        <div class="mb-4 flex items-center gap-3">
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 text-slate-700 text-xs font-medium">
            <tas-icon iconName="feather:file-text" style="font-size:12px"></tas-icon>
            {{ validationResult()?.totalRows ?? 0 }} ligne(s)
          </div>
          <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
            <tas-icon iconName="feather:check-circle" style="font-size:12px"></tas-icon>
            {{ validationResult()?.validRows ?? 0 }} valide(s)
          </div>
          @if ((validationResult()?.invalidRows ?? 0) > 0) {
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50 text-red-700 text-xs font-medium">
              <tas-icon iconName="feather:x-circle" style="font-size:12px"></tas-icon>
              {{ validationResult()?.invalidRows ?? 0 }} invalide(s)
            </div>
          }
        </div>
        <tas-card class="block">
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="bg-slate-50 text-slate-500">
                  <th class="px-3 py-2 text-left font-medium">#</th>
                  <th class="px-3 py-2 text-left font-medium">Prénom</th>
                  <th class="px-3 py-2 text-left font-medium">Nom</th>
                  <th class="px-3 py-2 text-left font-medium">Email</th>
                  <th class="px-3 py-2 text-left font-medium">Agence</th>
                  <th class="px-3 py-2 text-left font-medium">Rôle</th>
                  <th class="px-3 py-2 text-left font-medium">Statut</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (row of validationRows(); track $index) {
                  <tr [class]="row.isValid ? '' : 'bg-red-50/40'">
                    <td class="px-3 py-2 text-slate-400 tabular-nums">{{ row.rowNumber }}</td>
                    <td class="px-3 py-2 text-slate-800">{{ row.firstName || '—' }}</td>
                    <td class="px-3 py-2 text-slate-800">{{ row.lastName || '—' }}</td>
                    <td class="px-3 py-2 text-slate-800 font-mono">{{ row.email || '—' }}</td>
                    <td class="px-3 py-2 text-slate-600">{{ row.agencyCode || '—' }}</td>
                    <td class="px-3 py-2 text-slate-600">{{ row.roleCode || '—' }}</td>
                    <td class="px-3 py-2">
                      @if (row.isValid) { <tas-tag severity="success">OK</tas-tag> }
                      @else {
                        <div class="flex flex-col gap-0.5">
                          @for (err of row.errors ?? []; track $index) {
                            <tas-tag severity="error">{{ err }}</tas-tag>
                          }
                        </div>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="p-4 border-t border-slate-100 flex justify-between">
            <button tas-outlined-button type="button" (click)="step.set('upload')">Retour</button>
            <button tas-raised-button color="primary" type="button"
              [disabled]="(validationResult()?.validRows ?? 0) === 0"
              (click)="startImport()">
              Importer {{ validationResult()?.validRows ?? 0 }} utilisateur(s)
            </button>
          </div>
        </tas-card>
      }

      <!-- Step 4: Importing -->
      @if (step() === 'importing') {
        <tas-card class="block">
          <div class="p-6 text-center">
            <tas-spinner size="8" class="text-primary mb-4"></tas-spinner>
            <p class="text-sm font-medium text-slate-700">Import en cours…</p>
            <p class="text-xs text-slate-400 mt-1">{{ importProgress() }} traité(s)</p>
            @if ((validationResult()?.totalRows ?? 0) > 0) {
              <div class="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden max-w-sm mx-auto">
                <div class="h-full bg-primary rounded-full transition-all"
                  [style.width.%]="(importProgress() / (validationResult()?.totalRows ?? 1)) * 100"></div>
              </div>
            }
          </div>
        </tas-card>
      }

      <!-- Step 5: Done -->
      @if (step() === 'done') {
        <tas-card class="block">
          <div class="p-6 text-center">
            <div class="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:32px"></tas-icon>
            </div>
            <h2 class="text-lg font-semibold text-slate-800 mb-2">Import terminé</h2>
            <div class="flex items-center justify-center gap-4 mt-3">
              <div class="text-center">
                <p class="text-2xl font-bold text-green-600 tabular-nums">{{ importSucceeded() }}</p>
                <p class="text-xs text-slate-400">Créé(s)</p>
              </div>
              @if (importSkipped() > 0) {
                <div class="text-center">
                  <p class="text-2xl font-bold text-amber-600 tabular-nums">{{ importSkipped() }}</p>
                  <p class="text-xs text-slate-400">Ignoré(s)</p>
                </div>
              }
              <div class="text-center">
                <p class="text-2xl font-bold text-red-600 tabular-nums">{{ importFailed() }}</p>
                <p class="text-xs text-slate-400">Échoué(s)</p>
              </div>
            </div>
            @if (importError()) {
              <p class="text-xs text-red-500 mt-3">{{ importError() }}</p>
            }
            <button tas-outlined-button color="primary" type="button" class="mt-6" (click)="reset()">
              Nouvel import
            </button>
          </div>
        </tas-card>
      }
    </div>
  `,
})
export class ImportUsersPage implements OnInit {
  private readonly _importApi = inject(UserImportApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  public readonly sourceOptions = SOURCE_OPTIONS;
  public readonly stepsMeta = [
    { key: 'source', label: 'Source' },
    { key: 'upload', label: 'Fichier' },
    { key: 'preview', label: 'Validation' },
    { key: 'done', label: 'Terminé' },
  ];

  public step = signal<Step>('source');
  public readonly stepIdx = computed(() => {
    const map: Record<string, number> = { source: 0, upload: 1, validating: 1, preview: 2, importing: 2, done: 3 };
    return map[this.step()] ?? 0;
  });

  public selectedSource = signal<Source>('csv');
  public fileName = signal('');
  public uploadError = signal('');
  public rawFile = signal<File | null>(null);

  // Server validation
  public validationResult = signal<ValidateImportResponse | null>(null);
  public validationRows = signal<RowValidationResult[]>([]);

  // Import status
  public importProgress = signal(0);
  public importSucceeded = signal(0);
  public importFailed = signal(0);
  public importSkipped = signal(0);
  public importError = signal('');

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Importer des utilisateurs' },
    ]);
  }

  public selectSource(source: Source): void {
    this.selectedSource.set(source);
    this.step.set('upload');
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
    const file = this.rawFile();
    if (!file) return;

    this.step.set('validating');
    this._importApi.validateUserImport(file).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de valider le fichier.');
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
    const file = this.rawFile();
    if (!file) return;

    this.step.set('importing');
    this.importProgress.set(0);
    this.importSucceeded.set(0);
    this.importFailed.set(0);
    this.importSkipped.set(0);
    this.importError.set('');

    this._importApi.importUsersFromFile(file).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de lancer l\'import.');
        this.step.set('preview');
        return EMPTY;
      }),
    ).subscribe((result: any) => {
      const jobId = result?.importJobId;
      if (jobId) {
        this._pollImportStatus(jobId);
      } else {
        this._snackbar.error('Erreur', 'Aucun identifiant de job reçu.');
        this.step.set('preview');
      }
    });
  }

  public reset(): void {
    this._stopPoll();
    this.step.set('source');
    this.rawFile.set(null);
    this.fileName.set('');
    this.uploadError.set('');
    this.validationResult.set(null);
    this.validationRows.set([]);
    this.importError.set('');
  }

  private _pollImportStatus(jobId: string): void {
    this._pollTimer = setInterval(() => {
      this._importApi.getUserImportStatus(jobId).pipe(
        catchError(() => of(null)),
      ).subscribe((status: UserImportStatusDto | null) => {
        if (!status) return;
        this.importProgress.set((status.succeeded ?? 0) + (status.failed ?? 0) + (status.skipped ?? 0));

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
    setTimeout(() => this._stopPoll(), 120_000);
  }

  private _stopPoll(): void {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }
}

export default ImportUsersPage;
