import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormField, FormRoot, form, required, submit } from '@angular/forms/signals';
import {
  ConnectionListDto,
  InsuranceProductWriteRequestPeriodicityEnum,
  InsuranceProductWriteRequestPricingModeEnum,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { EMPTY, catchError, firstValueFrom } from 'rxjs';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  INSURANCE_PERIODICITIES,
  INSURANCE_PRICING_MODES,
} from '../../data-access/integration-referential';

class CreateInsuranceProductFormModel {
  public connectionId!: string;
  public insurerProductCode!: string;
  public name!: string;
  public periodicity!: string;
  public pricingMode!: string;
  public effectiveFrom!: string;

  public static instantiate(): CreateInsuranceProductFormModel {
    const model = new CreateInsuranceProductFormModel();
    model.connectionId = '';
    model.insurerProductCode = '';
    model.name = '';
    model.periodicity = '';
    model.pricingMode = '';
    model.effectiveFrom = new Date().toISOString().slice(0, 10);
    return model;
  }
}

/**
 * Drawer de déclaration d'un produit d'assurance.
 *
 * Ne demande que le socle requis par `InsuranceProductWriteRequest` : le produit est
 * créé inactif, et toute la configuration (garanties, tarif, éligibilité) se fait
 * ensuite sur l'écran d'édition, qui dispose de l'id. L'assureur et son code produit
 * sont l'identité du produit et ne seront plus modifiables.
 */
@Component({
  selector: 'create-insurance-product-drawer',
  templateUrl: './create-insurance-product-drawer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasAlert,
    Button,
    TasError,
    TasFormField,
    TasHint,
    TasInput,
    TasLabel,
    TasSelect,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasSpinner,
    TasTitle,
  ],
})
export class CreateInsuranceProductDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  // `tas-select` attend `{ [key: string]: any }[]` : les listes du référentiel sont en
  // lecture seule, on les recopie plutôt que de relâcher le type du composant.
  public readonly periodicityOptions = INSURANCE_PERIODICITIES.map((option) => ({ ...option }));
  public readonly pricingModeOptions = INSURANCE_PRICING_MODES.map((option) => ({ ...option }));

  public isLoadingInsurers = signal(true);
  public insurers = signal<ConnectionListDto[]>([]);

  public readonly insurerOptions = computed(() =>
    this.insurers().map((connection) => ({
      label: connection.name ?? 'Connexion sans nom',
      value: connection.id ?? '',
    })),
  );

  public model = signal(CreateInsuranceProductFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.connectionId, { message: "Choisissez l'assureur" });
    required(schema.insurerProductCode, {
      message: "Le code du produit chez l'assureur est obligatoire",
    });
    required(schema.name, { message: 'Le nom du produit est obligatoire' });
    required(schema.periodicity, { message: 'Choisissez la périodicité de la prime' });
    required(schema.pricingMode, { message: 'Choisissez le mode de tarification' });
    required(schema.effectiveFrom, { message: "La date d'entrée en vigueur est obligatoire" });
  });

  public readonly selectedPricingModeDescription = computed(() => {
    const mode = this.formSchema.pricingMode().value();
    return this.pricingModeOptions.find((option) => option.value === mode)?.description ?? null;
  });

  constructor() {
    this._facade
      .listAllConnections('Insurance')
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(error, 'Impossible de charger les assureurs.'),
          );
          this.isLoadingInsurers.set(false);
          return EMPTY;
        }),
      )
      .subscribe((connections) => {
        this.insurers.set(connections);
        this.isLoadingInsurers.set(false);
      });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const product = await firstValueFrom(
        this._facade
          .createInsuranceProduct({
            connectionId: value.connectionId,
            insurerProductCode: value.insurerProductCode.trim(),
            product: {
              name: value.name.trim(),
              // Les valeurs viennent des options du référentiel, identiques à
              // l'énumération du contrat ; `tas-select` ne rend que des chaînes.
              periodicity: value.periodicity as InsuranceProductWriteRequestPeriodicityEnum,
              pricingMode: value.pricingMode as InsuranceProductWriteRequestPricingModeEnum,
              effectiveFrom: value.effectiveFrom,
            },
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(error, 'Impossible de déclarer ce produit.'),
              );
              return EMPTY;
            }),
          ),
      );

      if (!product?.id) return;

      this._snackbar.success(
        'Produit déclaré',
        'Complétez sa configuration, puis activez-le pour que vos agents le proposent.',
      );
      this._dialogRef.close(product.id);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
