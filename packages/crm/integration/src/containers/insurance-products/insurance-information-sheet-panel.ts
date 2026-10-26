import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { disabled, form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { InformationSheetDto, InsuranceProductDto, IntegrationApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import { integrationErrorMessage } from '../../data-access/integration-facade.service';

/** Limite du serveur (INSURANCE_INFORMATION_SHEET_TOO_LARGE au-delà). */
const MAX_SHEET_BYTES = 15 * 1024 * 1024;

class ExclusionsFormModel {
  public exclusions!: string;

  public static fromProduct(product: InsuranceProductDto | null): ExclusionsFormModel {
    const model = new ExclusionsFormModel();
    model.exclusions = product?.exclusions ?? '';
    return model;
  }
}

function sheetErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error?.error as { code?: string; error?: string } | undefined;
  switch (body?.code ?? body?.error) {
    case 'INSURANCE_INFORMATION_SHEET_NOT_PDF':
      return "Le fichier n'est pas un PDF. Déposez la fiche telle que l'assureur l'a remise.";
    case 'INSURANCE_INFORMATION_SHEET_TOO_LARGE':
      return 'Le fichier dépasse 15 Mo. Demandez à l’assureur une version allégée.';
    default:
      return integrationErrorMessage(error, fallback);
  }
}

export function formatSheetSize(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Fiche d'information d'un produit d'assurance : le PDF de l'assureur, versionné, et les
 * exclusions recopiées en clair à côté.
 *
 * Un produit sans fiche n'est pas proposable (INFORMATION_SHEET_MISSING) : à chaque dépôt,
 * on prévient l'écran parent pour qu'il relise l'offrabilité du produit.
 */
@Component({
  selector: 'insurance-information-sheet-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './insurance-information-sheet-panel.html',
  imports: [
    Button,
    DatePipe,
    FormField,
    FormRoot,
    TasCard,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSwitch,
    TasTable,
    TasTag,
  ],
})
export class InsuranceInformationSheetPanel {
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly productId = input.required<string>();
  public readonly product = input<InsuranceProductDto | null>(null);
  public readonly canManage = input(false);

  /** Une fiche, des exclusions ou le caractère « vie » ont changé : le parent relit le produit. */
  public readonly changed = output<void>();

  public readonly isLoading = signal(true);
  public readonly isUploading = signal(false);
  public readonly openingId = signal<string | null>(null);
  public readonly sheets = signal<InformationSheetDto[]>([]);

  public readonly isSavingLifeInsurance = signal(false);
  public readonly isLifeInsurance = linkedSignal(() => this.product()?.isLifeInsurance ?? false);

  public readonly currentSheet = computed(
    () => this.sheets().find((sheet) => sheet.isCurrent) ?? null,
  );

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 5, pageSizeOptions: [5, 10, 25] },
  });

  public readonly exclusionsModel = signal(ExclusionsFormModel.fromProduct(null));
  public readonly exclusionsForm = form(this.exclusionsModel, (schema) => {
    disabled(schema.exclusions, () => !this.canManage());
  });

  public readonly exclusionLines = computed(() =>
    (this.exclusionsForm.exclusions().value() ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  constructor() {
    effect(() => {
      const productId = this.productId();
      untracked(() => this._loadSheets(productId));
    });

    // Le parent relit le produit après chaque dépôt de fiche : sans ce garde, des
    // exclusions en cours de saisie seraient écrasées par la valeur du serveur.
    effect(() => {
      const product = this.product();
      untracked(() => {
        if (!this.exclusionsForm().dirty()) {
          this.exclusionsModel.set(ExclusionsFormModel.fromProduct(product));
        }
      });
    });
  }

  public shortHash(sha: string | null | undefined): string {
    return sha ? sha.slice(0, 12) : '—';
  }

  public formatSize(bytes: number | null | undefined): string {
    return formatSheetSize(bytes);
  }

  public onFileSelected(event: Event): void {
    const fileInput = event.target as HTMLInputElement;
    const file = fileInput.files?.[0];
    // Vidé tout de suite : sinon redéposer le même fichier après une erreur ne
    // déclenche plus `change`.
    fileInput.value = '';
    if (!file) return;

    const looksLikePdf =
      file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      this._snackbar.error('Fichier refusé', "La fiche d'information doit être un PDF.");
      return;
    }
    if (file.size > MAX_SHEET_BYTES) {
      this._snackbar.error('Fichier trop lourd', 'La fiche ne peut pas dépasser 15 Mo.');
      return;
    }

    this.isUploading.set(true);
    this._api
      .uploadInsuranceInformationSheet(this.productId(), file)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Dépôt impossible',
            sheetErrorMessage(error, "La fiche d'information n'a pas pu être déposée."),
          );
          this.isUploading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((sheet) => {
        this.isUploading.set(false);
        this._snackbar.success(
          sheet.version ? `Version ${sheet.version} déposée` : 'Fiche déposée',
          'Les prochaines remises au client utiliseront cette version.',
        );
        this._loadSheets(this.productId());
        this.changed.emit();
      });
  }

  public openSheet(sheet: InformationSheetDto, download = false): void {
    if (!sheet.id) return;
    this.openingId.set(sheet.id);

    this._api
      .getInsuranceInformationSheetContent(sheet.id)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Fiche indisponible',
            integrationErrorMessage(error, "La fiche d'information n'a pas pu être lue."),
          );
          this.openingId.set(null);
          return EMPTY;
        }),
      )
      .subscribe((content) => {
        this.openingId.set(null);
        // Le client généré type la réponse en `object`, mais l'Accept `application/pdf`
        // le fait passer en `responseType: 'blob'`.
        const blob = new Blob([content as Blob], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        if (download) {
          link.download = sheet.fileName || `fiche-information-v${sheet.version ?? ''}.pdf`;
        } else {
          link.target = '_blank';
          link.rel = 'noopener';
        }
        link.click();
        // L'onglet ouvert lit l'URL après coup : la révoquer tout de suite le laisserait vide.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      });
  }

  public saveExclusions(): void {
    submit(this.exclusionsForm, async (field) => {
      const value = field()?.value();
      let saved = false;

      await firstValueFrom(
        this._api
          .setInsuranceProductExclusions(this.productId(), {
            exclusions:
              (value?.exclusions ?? '')
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .join('\n') || null,
          })
          .pipe(
            tap(() => (saved = true)),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(error, "Les exclusions n'ont pas pu être enregistrées."),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!saved) return;

      // Le formulaire redevient « intact » pour que la relecture du produit repousse la
      // valeur enregistrée par le serveur.
      this.exclusionsForm().reset();
      this._snackbar.success('Exclusions enregistrées', 'Elles sont affichées à côté de la fiche.');
      this.changed.emit();
    });
  }

  public setLifeInsurance(isLifeInsurance: boolean): void {
    this.isSavingLifeInsurance.set(true);
    this._api
      .setInsuranceProductLifeInsurance(this.productId(), { isLifeInsurance })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(error, "Le caractère « assurance vie » n'a pas pu être enregistré."),
          );
          this.isSavingLifeInsurance.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isSavingLifeInsurance.set(false);
        this.isLifeInsurance.set(isLifeInsurance);
        this._snackbar.success(
          'Enregistré',
          isLifeInsurance
            ? 'Le produit est une assurance vie : le droit de renonciation de 30 jours s’applique.'
            : "Le produit n'est plus traité comme une assurance vie.",
        );
        this.changed.emit();
      });
  }

  private _loadSheets(productId: string): void {
    this.isLoading.set(true);
    this._api
      .listInsuranceInformationSheets(productId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(error, "L'historique des fiches n'a pas pu être chargé."),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((sheets) => {
        this.sheets.set(sheets ?? []);
        this.isLoading.set(false);
      });
  }
}
