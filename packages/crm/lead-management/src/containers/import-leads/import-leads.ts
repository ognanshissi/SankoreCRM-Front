import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasTag } from '@talisoft/ui/tag';
import {
  ImportLeadRow,
  ImportLeadRowSourceEnum,
  ImportRowFailure,
  LeadsApiService,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { catchError, EMPTY, finalize } from 'rxjs';

// ─── Column mapping types ────────────────────────────────────────────────────

type LeadField = keyof ImportLeadRow;

interface ColumnMapping {
  csvHeader: string;
  mappedField: LeadField | '';
  autoDetected: boolean;
}

interface PreviewRow {
  raw: Record<string, string>;
  mapped: ImportLeadRow;
  errors: string[];
  valid: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { label: 'Import fichier', value: ImportLeadRowSourceEnum.FileImport },
  { label: 'Web', value: ImportLeadRowSourceEnum.Web },
  { label: 'Partenaire', value: ImportLeadRowSourceEnum.Partner },
  { label: 'Campagne', value: ImportLeadRowSourceEnum.Campaign },
  { label: 'Référencement', value: ImportLeadRowSourceEnum.Referral },
];

const FIELD_LABELS: Record<LeadField, string> = {
  fullName: 'Nom complet',
  firstName: 'Prénom',
  lastName: 'Nom',
  phoneNumber: 'Téléphone',
  email: 'E-mail',
  source: 'Source',
  interestedProduct: 'Produit souhaité',
  preferredLanguage: 'Langue',
  gender: 'Genre',
  dateOfBirth: 'Date de naissance',
  desiredAmount: 'Montant souhaité',
  desiredCurrency: 'Devise',
  campaign: 'Campagne',
  channel: 'Canal',
  comment: 'Commentaire',
  externalReference: 'Réf. externe',
  ownerId: 'Propriétaire (ID)',
  agencyId: 'Agence (ID)',
  latitude: 'Latitude',
  longitude: 'Longitude',
};

const FIELD_OPTIONS: { label: string; value: string }[] = [
  { label: '— Ignorer —', value: '' },
  ...Object.entries(FIELD_LABELS).map(([value, label]) => ({ label, value })),
];

const HEADER_ALIASES: Record<string, LeadField> = {
  nom_complet: 'fullName',
  fullname: 'fullName',
  full_name: 'fullName',
  prenom: 'firstName',
  firstname: 'firstName',
  first_name: 'firstName',
  nom: 'lastName',
  lastname: 'lastName',
  last_name: 'lastName',
  telephone: 'phoneNumber',
  phonenumber: 'phoneNumber',
  phone_number: 'phoneNumber',
  phone: 'phoneNumber',
  email: 'email',
  produit: 'interestedProduct',
  interestedproduct: 'interestedProduct',
  interested_product: 'interestedProduct',
  langue: 'preferredLanguage',
  preferredlanguage: 'preferredLanguage',
  preferred_language: 'preferredLanguage',
  genre: 'gender',
  gender: 'gender',
  date_naissance: 'dateOfBirth',
  dateofbirth: 'dateOfBirth',
  date_of_birth: 'dateOfBirth',
  montant: 'desiredAmount',
  desiredamount: 'desiredAmount',
  desired_amount: 'desiredAmount',
  devise: 'desiredCurrency',
  desiredcurrency: 'desiredCurrency',
  desired_currency: 'desiredCurrency',
  campagne: 'campaign',
  campaign: 'campaign',
  commentaire: 'comment',
  comment: 'comment',
  reference_externe: 'externalReference',
  externalreference: 'externalReference',
  external_reference: 'externalReference',
  agence: 'agencyId',
  agencyid: 'agencyId',
  agency_id: 'agencyId',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Detect delimiter: semicolon or comma
  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : ',';

  const headers = firstLine.split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (values[i] ?? '').trim().replace(/^["']|["']$/g, '')));
    return row;
  });
  return { headers, rows };
}

function autoDetectMapping(headers: string[]): ColumnMapping[] {
  return headers.map((csvHeader) => {
    const normalized = csvHeader.toLowerCase().replace(/[\s\-]/g, '');
    const mappedField = HEADER_ALIASES[normalized] ?? '';
    return { csvHeader, mappedField, autoDetected: !!mappedField };
  });
}

function mapRowWithMapping(
  raw: Record<string, string>,
  mappings: ColumnMapping[],
  defaultSource: ImportLeadRowSourceEnum,
): ImportLeadRow {
  const row: ImportLeadRow = { source: defaultSource };
  for (const mapping of mappings) {
    if (!mapping.mappedField) continue;
    const value = raw[mapping.csvHeader];
    if (!value) continue;
    const field = mapping.mappedField;
    if (field === 'desiredAmount' || field === 'latitude' || field === 'longitude') {
      (row as any)[field] = Number(value) || undefined;
    } else {
      (row as any)[field] = value;
    }
  }
  return row;
}

function validateRow(row: ImportLeadRow): string[] {
  const errors: string[] = [];
  if (!row.phoneNumber && !row.fullName && !row.firstName) {
    errors.push('Ni téléphone, ni nom détecté');
  }
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
    errors.push('E-mail invalide');
  }
  if (row.desiredAmount != null && isNaN(Number(row.desiredAmount))) {
    errors.push('Montant non numérique');
  }
  return errors;
}

// ─── Component ───────────────────────────────────────────────────────────────

type Step = 'upload' | 'mapping' | 'preview' | 'import';

@Component({
  selector: 'import-leads',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFileUploader,
    TasIcon,
    TasSelect,
    TasFormField,
    TasLabel,
    TasTag,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Importer des leads</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Step indicator -->
        <div class="flex items-center gap-2 mb-6">
          @for (s of steps; track s.key; let i = $index) {
            <div class="flex items-center gap-2" [class.flex-1]="i < steps.length - 1">
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors"
                [class]="stepIndex() > i
                  ? 'bg-green-100 text-green-700'
                  : stepIndex() === i
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 text-slate-400'"
              >
                @if (stepIndex() > i) {
                  <tas-icon iconName="feather:check" style="font-size:12px"></tas-icon>
                } @else {
                  {{ i + 1 }}
                }
              </div>
              <span
                class="text-xs font-medium whitespace-nowrap"
                [class]="stepIndex() >= i ? 'text-slate-700' : 'text-slate-400'"
              >{{ s.label }}</span>
              @if (i < steps.length - 1) {
                <div class="flex-1 h-px bg-slate-200 mx-1"></div>
              }
            </div>
          }
        </div>

        <!-- ═══ Step 1: Upload ═══ -->
        @if (step() === 'upload') {
          <div class="flex flex-col gap-5">
            <p class="text-sm text-slate-500">
              Importez un fichier CSV contenant vos leads.
              Le fichier doit comporter une ligne d'en-tête.
            </p>

            <div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p class="text-xs font-medium text-slate-600 mb-1.5">Colonnes reconnues automatiquement</p>
              <p class="text-xs text-slate-400 leading-relaxed">
                telephone, prenom, nom, nom_complet, email, produit, genre,
                date_naissance, montant, devise, campagne, commentaire,
                reference_externe, langue
              </p>
            </div>

            <tas-form-field>
              <tas-label>Source par défaut</tas-label>
              <tas-select
                [options]="sourceOptions"
                [ngModel]="defaultSource()"
                (ngModelChange)="defaultSource.set($event)"
              ></tas-select>
            </tas-form-field>

            <tas-file-uploader
              accept=".csv,.xlsx,.xls"
              [formControl]="fileControl"
            ></tas-file-uploader>

            @if (parseError()) {
              <p class="text-sm text-functional-error">{{ parseError() }}</p>
            }
          </div>
        }

        <!-- ═══ Step 2: Mapping ═══ -->
        @if (step() === 'mapping') {
          <div class="flex flex-col gap-4">
            <p class="text-sm text-slate-500">
              Vérifiez et ajustez le mapping des colonnes de votre fichier vers les champs du lead.
            </p>

            <div class="border border-slate-200 rounded-lg overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-slate-50 border-b border-slate-200">
                    <th class="px-3 py-2 text-left text-xs font-medium text-slate-500">Colonne du fichier</th>
                    <th class="px-3 py-2 text-left text-xs font-medium text-slate-500">Champ CRM</th>
                    <th class="px-3 py-2 text-center text-xs font-medium text-slate-500 w-16">Auto</th>
                  </tr>
                </thead>
                <tbody>
                  @for (col of columnMappings(); track col.csvHeader) {
                    <tr class="border-b border-slate-100 last:border-0">
                      <td class="px-3 py-2">
                        <code class="text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{{ col.csvHeader }}</code>
                      </td>
                      <td class="px-3 py-1.5">
                        <tas-select
                          [options]="fieldOptions"
                          placeholder="Ignorer"
                          [ngModel]="col.mappedField"
                          (ngModelChange)="updateMapping(col.csvHeader, $event)"
                        ></tas-select>
                      </td>
                      <td class="px-3 py-2 text-center">
                        @if (col.autoDetected && col.mappedField) {
                          <tas-icon iconName="feather:zap" class="text-amber-500" style="font-size:14px"></tas-icon>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            @if (mappingWarning()) {
              <div class="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200">
                <tas-icon iconName="feather:alert-triangle" class="text-amber-600 flex-shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
                <p class="text-xs text-amber-700">{{ mappingWarning() }}</p>
              </div>
            }
          </div>
        }

        <!-- ═══ Step 3: Preview ═══ -->
        @if (step() === 'preview') {
          <div class="flex flex-col gap-4">
            <!-- Summary -->
            <div class="grid grid-cols-3 gap-3">
              <div class="rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
                <p class="text-lg font-semibold text-slate-700 tabular-nums">{{ totalRows() }}</p>
                <p class="text-xs text-slate-500">Lignes totales</p>
              </div>
              <div class="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                <p class="text-lg font-semibold text-green-700 tabular-nums">{{ validRowCount() }}</p>
                <p class="text-xs text-green-600">Valides</p>
              </div>
              <div class="rounded-lg bg-red-50 border border-red-200 p-3 text-center">
                <p class="text-lg font-semibold text-red-700 tabular-nums">{{ errorRowCount() }}</p>
                <p class="text-xs text-red-600">En erreur</p>
              </div>
            </div>

            <!-- Preview table -->
            <div class="border border-slate-200 rounded-lg overflow-hidden">
              <div class="bg-slate-50 px-3 py-2 flex items-center justify-between">
                <p class="text-xs font-medium text-slate-600">
                  Aperçu des {{ previewRows().length }} premières lignes
                </p>
                @if (errorRowCount() > 0) {
                  <span class="text-xs text-slate-400">
                    Les lignes en erreur ne bloqueront pas l'import des lignes valides.
                  </span>
                }
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="bg-slate-50 border-b border-slate-200">
                      <th class="px-3 py-1.5 text-left font-medium text-slate-500 w-10">#</th>
                      @for (h of previewMappedHeaders(); track h.field) {
                        <th class="px-3 py-1.5 text-left font-medium text-slate-500 whitespace-nowrap">{{ h.label }}</th>
                      }
                      <th class="px-3 py-1.5 text-left font-medium text-slate-500">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of previewRows(); track $index) {
                      <tr
                        class="border-b border-slate-100 last:border-0"
                        [class.bg-red-50]="!row.valid"
                      >
                        <td class="px-3 py-1.5 text-slate-400 tabular-nums">{{ $index + 1 }}</td>
                        @for (h of previewMappedHeaders(); track h.field) {
                          <td class="px-3 py-1.5 text-slate-600 whitespace-nowrap max-w-[160px] truncate">
                            {{ row.raw[h.csvHeader] ?? '' }}
                          </td>
                        }
                        <td class="px-3 py-1.5">
                          @if (row.valid) {
                            <tas-tag severity="success">OK</tas-tag>
                          } @else {
                            <span class="text-functional-error text-xs" [title]="row.errors.join(', ')">
                              {{ row.errors[0] }}
                            </span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>

            @if (errorRowCount() > 0 && totalRows() > 10) {
              <p class="text-xs text-slate-400">
                {{ errorRowCount() }} ligne(s) en erreur sur {{ totalRows() }}.
                Seules les {{ validRowCount() }} lignes valides seront importées.
              </p>
            }
          </div>
        }

        <!-- ═══ Step 4: Import ═══ -->
        @if (step() === 'import') {
          <div class="flex flex-col gap-5">

            @if (isSubmitting()) {
              <div class="flex flex-col items-center gap-4 py-10">
                <div class="w-12 h-12 rounded-full border-[3px] border-primary/20 border-t-primary animate-spin"></div>
                <p class="text-sm text-slate-600 font-medium">Import en cours...</p>
                <p class="text-xs text-slate-400">{{ validRowCount() }} leads en cours de traitement</p>
              </div>
            }

            @if (!isSubmitting() && importResult()) {
              <div class="flex flex-col gap-4">
                <div class="grid grid-cols-3 gap-3">
                  <div class="rounded-lg bg-green-50 p-3 text-center">
                    <p class="text-lg font-semibold text-green-700 tabular-nums">{{ importResult()!.succeeded }}</p>
                    <p class="text-xs text-green-600">Importés</p>
                  </div>
                  <div class="rounded-lg bg-amber-50 p-3 text-center">
                    <p class="text-lg font-semibold text-amber-700 tabular-nums">{{ importResult()!.skipped }}</p>
                    <p class="text-xs text-amber-600">Doublons ignorés</p>
                  </div>
                  <div class="rounded-lg bg-red-50 p-3 text-center">
                    <p class="text-lg font-semibold text-red-700 tabular-nums">{{ importResult()!.failed }}</p>
                    <p class="text-xs text-red-600">En erreur</p>
                  </div>
                </div>

                @if (importResult()!.failures?.length) {
                  <div class="border border-red-200 rounded-lg overflow-hidden">
                    <div class="bg-red-50 px-3 py-2 flex items-center justify-between">
                      <p class="text-xs font-medium text-red-700">Détail des erreurs</p>
                      <button
                        class="text-xs text-red-600 hover:text-red-800 underline transition-colors"
                        (click)="exportErrorReport()"
                      >
                        Exporter le rapport
                      </button>
                    </div>
                    <ul class="divide-y divide-red-100 max-h-60 overflow-y-auto">
                      @for (f of importResult()!.failures!; track $index) {
                        <li class="px-3 py-2 text-xs">
                          <span class="font-medium text-slate-700">Ligne {{ f.row }}</span>
                          @if (f.phoneNumber) {
                            <span class="text-slate-400 ml-1">({{ f.phoneNumber }})</span>
                          }
                          <span class="text-red-600 ml-1">{{ f.error }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                }
              </div>
            }

          </div>
        }

      </tas-drawer-content>

      <tas-drawer-action>
        @if (step() === 'upload') {
          <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="goToMapping()"
            [disabled]="rawRows().length === 0"
          >
            Suivant : Mapping
          </button>
        }

        @if (step() === 'mapping') {
          <button tas-outlined-button color="primary" type="button" (click)="step.set('upload')">
            <tas-icon iconName="feather:arrow-left" style="font-size:14px"></tas-icon>
            Retour
          </button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="goToPreview()"
            [disabled]="activeMappingCount() === 0"
          >
            Suivant : Aperçu
          </button>
        }

        @if (step() === 'preview') {
          <button tas-outlined-button color="primary" type="button" (click)="step.set('mapping')">
            <tas-icon iconName="feather:arrow-left" style="font-size:14px"></tas-icon>
            Retour
          </button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="submitImport()"
            [disabled]="validRowCount() === 0"
          >
            Importer {{ validRowCount() }} leads
          </button>
        }

        @if (step() === 'import') {
          @if (isSubmitting()) {
            <button tas-outlined-button color="primary" type="button" disabled>
              Import en cours...
            </button>
          } @else {
            <button tas-filled-button color="primary" type="button" (click)="close(true)">Fermer</button>
          }
        }
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ImportLeadsComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly sourceOptions = SOURCE_OPTIONS;
  public readonly fieldOptions = FIELD_OPTIONS;
  public readonly steps = [
    { key: 'upload', label: 'Fichier' },
    { key: 'mapping', label: 'Mapping' },
    { key: 'preview', label: 'Aperçu' },
    { key: 'import', label: 'Import' },
  ] as const;

  // State
  public step = signal<Step>('upload');
  public stepIndex = computed(() => this.steps.findIndex((s) => s.key === this.step()));

  public defaultSource = signal(ImportLeadRowSourceEnum.FileImport);
  public fileControl = new FormControl<File | null>(null);
  public parseError = signal('');

  // Parsed data
  public csvHeaders = signal<string[]>([]);
  public rawRows = signal<Record<string, string>[]>([]);
  public totalRows = computed(() => this.rawRows().length);

  // Mapping
  public columnMappings = signal<ColumnMapping[]>([]);
  public activeMappingCount = computed(() =>
    this.columnMappings().filter((m) => !!m.mappedField).length,
  );
  public mappingWarning = computed(() => {
    const mappings = this.columnMappings();
    const hasPhone = mappings.some((m) => m.mappedField === 'phoneNumber');
    const hasName = mappings.some((m) => m.mappedField === 'fullName' || m.mappedField === 'firstName');
    if (!hasPhone && !hasName) {
      return 'Aucune colonne téléphone ou nom n\'est mappée. Les leads ne pourront pas être identifiés.';
    }
    return '';
  });

  // Preview
  public allPreviewRows = signal<PreviewRow[]>([]);
  public previewRows = computed(() => this.allPreviewRows().slice(0, 10));
  public previewMappedHeaders = computed(() =>
    this.columnMappings()
      .filter((m) => !!m.mappedField)
      .map((m) => ({
        csvHeader: m.csvHeader,
        field: m.mappedField,
        label: FIELD_LABELS[m.mappedField as LeadField] ?? m.mappedField,
      })),
  );
  public validRowCount = computed(() => this.allPreviewRows().filter((r) => r.valid).length);
  public errorRowCount = computed(() => this.allPreviewRows().filter((r) => !r.valid).length);

  // Import
  public isSubmitting = signal(false);
  public importResult = signal<{
    succeeded?: number;
    skipped?: number;
    failed?: number;
    failures?: ImportRowFailure[] | null;
  } | null>(null);

  constructor() {
    this.fileControl.valueChanges.subscribe((file) => this._onFileSelected(file));
  }

  // ─── Step navigation ─────────────────────────────────────────────────────

  public goToMapping(): void {
    if (this.rawRows().length === 0) return;
    if (this.columnMappings().length === 0) {
      this.columnMappings.set(autoDetectMapping(this.csvHeaders()));
    }
    this.step.set('mapping');
  }

  public goToPreview(): void {
    const mappings = this.columnMappings();
    const source = this.defaultSource();
    const rows = this.rawRows().map((raw) => {
      const mapped = mapRowWithMapping(raw, mappings, source);
      const errors = validateRow(mapped);
      return { raw, mapped, errors, valid: errors.length === 0 } as PreviewRow;
    });
    this.allPreviewRows.set(rows);
    this.step.set('preview');
  }

  public updateMapping(csvHeader: string, newField: LeadField | ''): void {
    this.columnMappings.update((mappings) =>
      mappings.map((m) =>
        m.csvHeader === csvHeader ? { ...m, mappedField: newField, autoDetected: false } : m,
      ),
    );
  }

  // ─── File parsing ────────────────────────────────────────────────────────

  private _onFileSelected(file: File | null): void {
    this.parseError.set('');
    this.csvHeaders.set([]);
    this.rawRows.set([]);
    this.columnMappings.set([]);
    this.allPreviewRows.set([]);

    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const { headers, rows } = parseCsv(text);
        if (rows.length === 0) {
          this.parseError.set('Le fichier est vide ou ne contient pas de données valides.');
          return;
        }
        this.csvHeaders.set(headers);
        this.rawRows.set(rows);
        this.columnMappings.set(autoDetectMapping(headers));
      } catch {
        this.parseError.set('Impossible de lire le fichier. Vérifiez le format CSV.');
      }
    };
    reader.readAsText(file);
  }

  // ─── Import ──────────────────────────────────────────────────────────────

  public submitImport(): void {
    const validRows = this.allPreviewRows()
      .filter((r) => r.valid)
      .map((r) => r.mapped);

    if (validRows.length === 0) return;

    this.step.set('import');
    this.isSubmitting.set(true);

    const blob = new Blob([JSON.stringify({ rows: validRows })], { type: 'application/json' });

    this._leadsApi
      .importLeads(blob)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', "L'import a échoué, réessayez plus tard.");
          return EMPTY;
        }),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe((res) => {
        this.importResult.set({
          succeeded: validRows.length,
          skipped: 0,
          failed: 0,
          failures: null,
        });
        this._snackbar.success(
          'Import accepté',
          `${validRows.length} lead(s) envoyé(s) pour import.`,
        );
      });
  }

  // ─── Error report export ─────────────────────────────────────────────────

  public exportErrorReport(): void {
    const failures = this.importResult()?.failures;
    if (!failures?.length) return;

    const header = 'Ligne;Téléphone;Erreur';
    const lines = failures.map((f) => `${f.row};${f.phoneNumber ?? ''};${f.error ?? ''}`);
    const csv = [header, ...lines].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rapport-import-leads.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Drawer ──────────────────────────────────────────────────────────────

  public close(imported = false): void {
    this._dialogRef.close(imported ? true : undefined);
  }
}
