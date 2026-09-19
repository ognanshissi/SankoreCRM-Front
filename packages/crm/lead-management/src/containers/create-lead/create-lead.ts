import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, debounceTime, distinctUntilChanged, EMPTY, filter, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasError, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasInputPhone } from '@talisoft/ui/input-phone';
import {
  AgenciesApiService,
  CaptureLeadRequest,
  CaptureLeadRequestProspectTypeEnum,
  CaptureLeadRequestSourceEnum,
  DuplicateMatchResult,
  LeadsApiService,
  ProductsApiService,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { DuplicateWarningBanner } from '@sankore/crm/common';

export class CreateLeadFormModel {
  public firstName!: string;
  public lastName!: string;
  public phoneNumber!: string;
  public email!: string;
  public nationalId!: string;
  public prospectType!: CaptureLeadRequestProspectTypeEnum;
  public companyName!: string;
  public source!: CaptureLeadRequestSourceEnum;
  public interestedProduct!: string;
  public desiredAmount!: string;
  public desiredCurrency!: string;
  public agencyId!: string;
  public comment!: string;

  public static instantiate(): CreateLeadFormModel {
    const m = new CreateLeadFormModel();
    m.firstName = '';
    m.lastName = '';
    m.phoneNumber = '';
    m.email = '';
    m.nationalId = '';
    m.prospectType = CaptureLeadRequestProspectTypeEnum.NUMBER_0;
    m.companyName = '';
    m.source = CaptureLeadRequestSourceEnum.Agency;
    m.interestedProduct = '';
    m.desiredAmount = '';
    m.desiredCurrency = 'XOF';
    m.agencyId = '';
    m.comment = '';
    return m;
  }
}

export const PROSPECT_TYPE_OPTIONS = [
  { label: 'Individuel', value: CaptureLeadRequestProspectTypeEnum.NUMBER_0.toString() },
  { label: 'Entreprise', value: CaptureLeadRequestProspectTypeEnum.NUMBER_1.toString() },
];

export const SOURCE_OPTIONS = [
  { label: 'Agence', value: CaptureLeadRequestSourceEnum.Agency },
  { label: "Centre d'appels", value: CaptureLeadRequestSourceEnum.CallCenter },
  { label: 'Référencement', value: CaptureLeadRequestSourceEnum.Referral },
  { label: 'WhatsApp', value: CaptureLeadRequestSourceEnum.WhatsApp },
  { label: 'Web', value: CaptureLeadRequestSourceEnum.Web },
  { label: 'Partenaire', value: CaptureLeadRequestSourceEnum.Partner },
];

export const CURRENCY_OPTIONS = [
  { label: 'XOF', value: 'XOF' },
  { label: 'EUR', value: 'EUR' },
  { label: 'USD', value: 'USD' },
];

@Component({
  selector: 'create-lead',
  templateUrl: './create-lead.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
    TasInputPhone,
    FormRoot,
    FormField,
    TasInputPhone,
    TasInputPhone,
    DuplicateWarningBanner,
  ],
})
export class CreateLeadComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _productSpecialitiesService = inject(ProductsApiService);

  public duplicates = signal<DuplicateMatchResult[]>([]);
  public isCheckingDuplicates = signal(false);

  public readonly prospectTypeOptions = PROSPECT_TYPE_OPTIONS;
  public readonly sourceOptions = SOURCE_OPTIONS;
  public readonly currencyOptions = CURRENCY_OPTIONS;

  public agencies = signal<{ label: string; value: string }[]>([]);
  public model = signal(CreateLeadFormModel.instantiate());
  public productOptions = toSignal(
    this._productSpecialitiesService.listProducts().pipe(
      map((products) =>
        products.map((product) => ({
          name: product.name,
          code: product.code,
        })),
      ),
    ),
  );

  public formSchema = form(this.model, (schema) => {
    required(schema.firstName, { message: 'Le prénom est obligatoire' });
    required(schema.lastName, { message: 'Le nom est obligatoire' });
    required(schema.phoneNumber, {
      message: 'Le numéro de téléphone est obligatoire',
    });
  });

  public isCompany = computed(
    () =>
      this.formSchema.prospectType().value().toString() ===
      CaptureLeadRequestProspectTypeEnum.NUMBER_1.toString(),
  );

  constructor() {
    this._loadAgencies();

    toObservable(computed(() => this.formSchema.phoneNumber().value()))
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        map(phone => (phone ?? '').replace(/[^0-9+]/g, '')),
        filter(phone => phone.length >= 8),
        debounceTime(400),
        distinctUntilChanged(),
        tap(() => this.isCheckingDuplicates.set(true)),
        switchMap(phone =>
          this._leadsApiService.findLeadDuplicates(phone).pipe(
            catchError(() => of([] as DuplicateMatchResult[]))
          )
        ),
      )
      .subscribe(results => {
        this.duplicates.set(results);
        this.isCheckingDuplicates.set(false);
      });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const request: CaptureLeadRequest = {
        firstName: value.firstName || null,
        lastName: value.lastName || null,
        phoneNumber: value.phoneNumber || null,
        email: value.email || null,
        nationalId: value.nationalId || null,
        prospectType: value.prospectType,
        companyName: this.isCompany() ? value.companyName || null : null,
        source: value.source,
        interestedProduct: value.interestedProduct || null,
        desiredAmount: value.desiredAmount ? Number(value.desiredAmount) : null,
        desiredCurrency: value.desiredCurrency || null,
        agencyId: value.agencyId || null,
        comment: value.comment || null,
      };

      const result = await firstValueFrom(
        this._leadsApiService.captureLead(request).pipe(
          catchError(() => {
            this._snackbarService.error(
              'Erreur',
              'Impossible de créer le lead, réessayez plus tard.',
            );
            return EMPTY;
          }),
        ),
      );

      if (result) {
        this._snackbarService.success('Succès', 'Lead créé avec succès');
        this._dialogRef.close(result.leadId);
        this._router.navigate(['/leads', result.leadId]);
      }
    });
  }

  public viewDuplicate(leadId: string): void {
    this._dialogRef.close();
    this._router.navigate(['/leads', leadId]);
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _loadAgencies(): void {
    this._agenciesApiService
      .listAgencies(false, 1, 200)
      .pipe(
        map((res) =>
          (res.items ?? []).map((a) => ({
            label: a.name ?? '',
            value: a.id ?? '',
          })),
        ),
      )
      .subscribe({
        next: (opts) => this.agencies.set(opts),
      });
  }
}
