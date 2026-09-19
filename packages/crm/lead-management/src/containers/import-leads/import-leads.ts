import {
  ChangeDetectionStrategy,
  Component,
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
import {
  ImportLeadRow,
  ImportLeadRowSourceEnum,
  ImportRowFailure,
  LeadsApiService,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { catchError, EMPTY, finalize } from 'rxjs';

const SOURCE_OPTIONS = [
  { label: 'Import fichier', value: ImportLeadRowSourceEnum.FileImport },
  { label: 'Web', value: ImportLeadRowSourceEnum.Web },
  { label: 'Partenaire', value: ImportLeadRowSourceEnum.Partner },
  { label: 'Campagne', value: ImportLeadRowSourceEnum.Campaign },
  { label: 'Référencement', value: ImportLeadRowSourceEnum.Referral },
];

const EXPECTED_HEADERS: Record<string, keyof ImportLeadRow> = {
  nom_complet: 'fullName',
  fullname: 'fullName',
  prenom: 'firstName',
  firstname: 'firstName',
  nom: 'lastName',
  lastname: 'lastName',
  telephone: 'phoneNumber',
  phonenumber: 'phoneNumber',
  phone: 'phoneNumber',
  email: 'email',
  produit: 'interestedProduct',
  interestedproduct: 'interestedProduct',
  langue: 'preferredLanguage',
  preferredlanguage: 'preferredLanguage',
  genre: 'gender',
  gender: 'gender',
  date_naissance: 'dateOfBirth',
  dateofbirth: 'dateOfBirth',
  montant: 'desiredAmount',
  desiredamount: 'desiredAmount',
  devise: 'desiredCurrency',
  desiredcurrency: 'desiredCurrency',
  campagne: 'campaign',
  campaign: 'campaign',
  commentaire: 'comment',
  comment: 'comment',
  reference_externe: 'externalReference',
  externalreference: 'externalReference',
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(';');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (values[i] ?? '').trim()));
    return row;
  });
}

function mapRow(raw: Record<string, string>, defaultSource: ImportLeadRowSourceEnum): ImportLeadRow {
  const row: ImportLeadRow = { source: defaultSource };
  for (const [csvCol, value] of Object.entries(raw)) {
    if (!value) continue;
    const key = EXPECTED_HEADERS[csvCol.toLowerCase().replace(/[\s-]/g, '')];
    if (!key) continue;
    if (key === 'desiredAmount') {
      row.desiredAmount = Number(value) || undefined;
    } else if (key === 'latitude' || key === 'longitude') {
      (row as any)[key] = Number(value) || undefined;
    } else {
      (row as any)[key] = value;
    }
  }
  return row;
}

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
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Importer des leads</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">

          @if (step() === 'upload') {
            <p class="text-sm text-slate-500">
              Importez un fichier CSV (séparateur <code class="px-1 py-0.5 bg-slate-100 rounded text-xs">;</code>)
              contenant vos leads. Le fichier doit comporter une ligne d'en-tête.
            </p>

            <div class="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p class="text-xs font-medium text-slate-600 mb-1.5">Colonnes reconnues</p>
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
              accept=".csv"
              [formControl]="fileControl"
            ></tas-file-uploader>

            @if (parseError()) {
              <p class="text-sm text-functional-error">{{ parseError() }}</p>
            }

            @if (previewRows().length > 0) {
              <div class="border border-slate-200 rounded-lg overflow-hidden">
                <div class="bg-slate-50 px-3 py-2 flex items-center justify-between">
                  <p class="text-xs font-medium text-slate-600">
                    {{ totalRows() }} lignes détectées
                  </p>
                  @if (previewRows().length < totalRows()) {
                    <span class="text-xs text-slate-400">Aperçu des {{ previewRows().length }} premières</span>
                  }
                </div>
                <div class="overflow-x-auto">
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="bg-slate-50 border-b border-slate-200">
                        @for (h of previewHeaders(); track h) {
                          <th class="px-3 py-1.5 text-left font-medium text-slate-500 whitespace-nowrap">{{ h }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of previewRows(); track $index) {
                        <tr class="border-b border-slate-100 last:border-0">
                          @for (h of previewHeaders(); track h) {
                            <td class="px-3 py-1.5 text-slate-600 whitespace-nowrap max-w-[160px] truncate">{{ row[h] ?? '' }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            }
          }

          @if (step() === 'result') {
            <div class="flex flex-col gap-4">
              <div class="grid grid-cols-3 gap-3">
                <div class="rounded-lg bg-green-50 p-3 text-center">
                  <p class="text-lg font-semibold text-green-700 tabular-nums">{{ result().succeeded }}</p>
                  <p class="text-xs text-green-600">Importés</p>
                </div>
                <div class="rounded-lg bg-amber-50 p-3 text-center">
                  <p class="text-lg font-semibold text-amber-700 tabular-nums">{{ result().skipped }}</p>
                  <p class="text-xs text-amber-600">Doublons ignorés</p>
                </div>
                <div class="rounded-lg bg-red-50 p-3 text-center">
                  <p class="text-lg font-semibold text-red-700 tabular-nums">{{ result().failed }}</p>
                  <p class="text-xs text-red-600">En erreur</p>
                </div>
              </div>

              @if (result().failures?.length) {
                <div class="border border-red-200 rounded-lg overflow-hidden">
                  <div class="bg-red-50 px-3 py-2">
                    <p class="text-xs font-medium text-red-700">Détail des erreurs</p>
                  </div>
                  <ul class="divide-y divide-red-100 max-h-60 overflow-y-auto">
                    @for (f of result().failures!; track $index) {
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
      </tas-drawer-content>

      <tas-drawer-action>
        @if (step() === 'upload') {
          <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="submit()"
            [disabled]="parsedRows().length === 0 || isSubmitting()"
            [isLoading]="isSubmitting()"
          >
            Importer {{ parsedRows().length }} leads
          </button>
        } @else {
          <button tas-filled-button color="primary" type="button" (click)="close(true)">Fermer</button>
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
  public defaultSource = signal(ImportLeadRowSourceEnum.FileImport);
  public fileControl = new FormControl<File | null>(null);

  public step = signal<'upload' | 'result'>('upload');
  public isSubmitting = signal(false);
  public parseError = signal('');

  public previewHeaders = signal<string[]>([]);
  public previewRows = signal<Record<string, string>[]>([]);
  public totalRows = signal(0);
  public parsedRows = signal<ImportLeadRow[]>([]);

  public result = signal<{ succeeded?: number; skipped?: number; failed?: number; failures?: ImportRowFailure[] | null }>({});

  constructor() {
    this.fileControl.valueChanges.subscribe((file) => this.onFileSelected(file));
  }

  public onFileSelected(file: File | null): void {
    this.parseError.set('');
    this.previewHeaders.set([]);
    this.previewRows.set([]);
    this.totalRows.set(0);
    this.parsedRows.set([]);

    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const rawRows = parseCsv(text);
        if (rawRows.length === 0) {
          this.parseError.set('Le fichier est vide ou ne contient pas de données valides.');
          return;
        }

        const headers = Object.keys(rawRows[0]);
        this.previewHeaders.set(headers);
        this.previewRows.set(rawRows.slice(0, 5));
        this.totalRows.set(rawRows.length);

        const mapped = rawRows.map((r) => mapRow(r, this.defaultSource()));
        const valid = mapped.filter((r) => r.phoneNumber || r.fullName || r.firstName);
        this.parsedRows.set(valid);

        if (valid.length === 0) {
          this.parseError.set(
            'Aucune ligne exploitable. Vérifiez que le fichier contient au moins une colonne "telephone", "nom_complet" ou "prenom".',
          );
        } else if (valid.length < rawRows.length) {
          this.parseError.set(
            `${rawRows.length - valid.length} ligne(s) ignorée(s) : ni téléphone, ni nom détecté.`,
          );
        }
      } catch {
        this.parseError.set('Impossible de lire le fichier. Vérifiez le format CSV.');
      }
    };
    reader.readAsText(file);
  }

  public submit(): void {
    this.isSubmitting.set(true);
    this._leadsApi
      .importLeads({ rows: this.parsedRows() })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', "L'import a échoué, réessayez plus tard.");
          return EMPTY;
        }),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe((res) => {
        this.result.set(res);
        this.step.set('result');
        if ((res.succeeded ?? 0) > 0) {
          this._snackbar.success('Import terminé', `${res.succeeded} lead(s) importé(s) avec succès.`);
        }
      });
  }

  public close(imported = false): void {
    this._dialogRef.close(imported ? true : undefined);
  }
}
