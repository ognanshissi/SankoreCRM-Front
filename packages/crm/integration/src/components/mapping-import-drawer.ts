import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MappingImportReport } from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasIcon } from '@talisoft/ui/icon';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTitle } from '@talisoft/ui/title';
import { catchError, EMPTY } from 'rxjs';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../data-access/integration-facade.service';
import { MappingDomain } from '../data-access/integration-referential';

/**
 * Téléchargement du CSV d'un domaine, partagé par l'écran et ce drawer (« Exporter le
 * modèle » réutilise l'export du domaine : le fichier exporté EST le format d'import).
 * Il vit ici, du côté du composant, pour que la dépendance aille de l'écran vers le
 * drawer et pas dans les deux sens.
 *
 * Le contrat annonce un BOM UTF-8 ; s'il manque, Excel lit le fichier en ANSI et casse
 * les accents des libellés — on ne l'ajoute donc que s'il est absent, pour ne pas en
 * écrire deux. Le nom de fichier porte le code du domaine et non son libellé français :
 * un nom accentué avec des espaces se transporte mal d'un poste à l'autre.
 */
export function downloadMappingCsv(csv: string, domain: MappingDomain): void {
  const content = csv.startsWith('﻿') ? csv : `﻿${csv}`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `correspondances-${domain.toLowerCase()}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface MappingImportDrawerData {
  connectionId: string;
  domain: MappingDomain;
  domainLabel: string;
  crmLabel: string;
}

/**
 * Une ligne rejetée du rapport. Comme pour le tableau de l'écran, un alias de type —
 * et non une interface — pour satisfaire la contrainte `TableEntity` de `tas-table`.
 */
export type RejectedImportRow = {
  id: string;
  rowNumber: number | null;
  crmCode: string;
  externalCode: string;
  errors: string[];
};

/** Poids maximal du fichier. Un fichier de correspondances tient en quelques kilo-octets. */
const MAX_FILE_SIZE_MB = 2;

@Component({
  selector: 'mapping-import-drawer',
  templateUrl: './mapping-import-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasAlert,
    TasIcon,
    Button,
    TasFileUploader,
    TasTable,
  ],
})
export class MappingImportDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean, MappingImportDrawer>>(DialogRef);
  private readonly _data = inject<MappingImportDrawerData>(DIALOG_DATA);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly domainLabel = this._data.domainLabel;
  public readonly crmLabel = this._data.crmLabel;
  public readonly maxFileSizeMb = MAX_FILE_SIZE_MB;

  public readonly file = signal<File | null>(null);
  public readonly fileError = signal('');

  public readonly isValidating = signal(false);
  public readonly isImporting = signal(false);
  public readonly isExportingTemplate = signal(false);

  public readonly report = signal<MappingImportReport | null>(null);
  /** `validated` = rapport à blanc ; `imported` = l'import a été appliqué. */
  public readonly stage = signal<'none' | 'validated' | 'imported'>('none');

  private _imported = false;

  public readonly totalRows = computed(() => this.report()?.totalRows ?? 0);
  public readonly validRows = computed(() => this.report()?.validRows ?? 0);
  public readonly invalidRows = computed(() => this.report()?.invalidRows ?? 0);

  public readonly rejectedRows = computed<RejectedImportRow[]>(() =>
    (this.report()?.rows ?? [])
      .filter((row) => row.isValid === false)
      .map((row, index) => ({
        // `rowNumber` est optionnel dans le DTO généré : l'index sert de clé de repli,
        // sans quoi deux lignes sans numéro se suivraient sous la même clé (NG0955).
        id: row.rowNumber != null ? `row-${row.rowNumber}` : `index-${index}`,
        rowNumber: row.rowNumber ?? null,
        crmCode: row.crmCode ?? '',
        externalCode: row.externalCode ?? '',
        errors: row.errors ?? [],
      })),
  );

  /** Pagination locale : le rapport arrive entier, il n'y a pas de page à demander. */
  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 25,
      pageSizeOptions: [25, 50, 100],
    },
  });

  public onFileChange(file: File | null): void {
    // Tout rapport affiché porte sur le fichier précédent : le garder visible après un
    // changement de fichier laisserait importer sur la foi d'une vérification périmée.
    this.report.set(null);
    this.stage.set('none');
    this.fileError.set('');

    if (!file) {
      this.file.set(null);
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.fileError.set(
        `Seuls les fichiers .csv sont acceptés (max ${MAX_FILE_SIZE_MB} Mo). Exportez le modèle pour obtenir le bon format.`,
      );
      this.file.set(null);
      return;
    }

    this.file.set(file);
  }

  /**
   * Vérification à blanc : le contrat lit le fichier, renvoie exactement le rapport que
   * l'import renverrait, et n'écrit rien.
   */
  public verify(): void {
    const file = this.file();
    if (!file) return;

    this.isValidating.set(true);

    this._facade
      .validateMappingImport(this._data.connectionId, this._data.domain, file)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isValidating.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, "Le fichier n'a pas pu être lu."),
          );
          return EMPTY;
        }),
      )
      .subscribe((report) => {
        this.report.set(report);
        this.stage.set('validated');
        this.isValidating.set(false);
      });
  }

  public runImport(): void {
    const file = this.file();
    if (!file || this.stage() !== 'validated') return;

    this.isImporting.set(true);

    this._facade
      .importMappings(this._data.connectionId, this._data.domain, file)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isImporting.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, "L'import n'a pas abouti."),
          );
          return EMPTY;
        }),
      )
      .subscribe((report) => {
        this.report.set(report);
        this.stage.set('imported');
        this.isImporting.set(false);
        this._imported = true;

        const imported = report.validRows ?? 0;
        const rejected = report.invalidRows ?? 0;
        this._snackbar.success(
          'Import terminé',
          rejected > 0
            ? `${imported} ligne(s) importée(s), ${rejected} rejetée(s).`
            : `${imported} ligne(s) importée(s).`,
        );

        // Rien à relire quand tout est passé : on ferme et l'écran recharge. S'il reste
        // des lignes rejetées, le drawer reste ouvert pour qu'elles soient lues avant
        // de corriger le fichier.
        if (rejected === 0) this._dialogRef.close(true);
      });
  }

  /** Le fichier exporté est exactement le format d'import : c'est le meilleur modèle. */
  public exportTemplate(): void {
    this.isExportingTemplate.set(true);

    this._facade
      .exportMappings(this._data.connectionId, this._data.domain)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isExportingTemplate.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, "L'export du modèle a échoué."),
          );
          return EMPTY;
        }),
      )
      .subscribe((csv) => {
        downloadMappingCsv(csv, this._data.domain);
        this.isExportingTemplate.set(false);
      });
  }

  public close(): void {
    this._dialogRef.close(this._imported);
  }
}
