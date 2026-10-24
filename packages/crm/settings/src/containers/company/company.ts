import { Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { CompanyInfoApiService, CompanyInfoDto, UpdateCompanyInfoCommandDefaultLanguageEnum } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  BreadcrumbService,
  DEFAULT_INSTITUTION_CURRENCY,
  INSTITUTION_CURRENCIES,
  PermissionsService,
  TenantProvider,
} from '@sankore/crm/common';

const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

class CompanyFormModel {
  public name!: string;
  public description!: string;
  public logoUrl!: string;
  public primaryColor!: string;
  public secondaryColor!: string;
  public defaultLanguage!: string;
  public currency!: string;

  public static fromDto(dto: CompanyInfoDto): CompanyFormModel {
    const m = new CompanyFormModel();
    m.name = dto.name ?? '';
    m.description = dto.description ?? '';
    m.logoUrl = dto.logoUrl ?? '';
    m.primaryColor = dto.primaryColor ?? '';
    m.secondaryColor = dto.secondaryColor ?? '';
    m.defaultLanguage = dto.defaultLanguage != null ? String(dto.defaultLanguage) : '0';
    m.currency = dto.currency || DEFAULT_INSTITUTION_CURRENCY;
    return m;
  }
}

@Component({
  templateUrl: './company.html',
  imports: [
    FormsModule,
    TasCard,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
    TasSpinner,
    FormRoot,
    FormField,
  ],
})
export class CompanyPage {
  private readonly _permissions = inject(PermissionsService);
  public readonly canUpdate = this._permissions.can('company:update');

  private readonly _companyInfoApiService = inject(CompanyInfoApiService);
  private readonly _tenantProvider = inject(TenantProvider);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(true);
  public isSaving = signal(false);
  public isLogoBusy = signal(false);
  /** Vrai quand l'aperçu ne se charge pas : une URL saisie à la main peut ne mener nulle part. */
  public logoBroken = signal(false);

  public readonly logoUrl = computed(() => this.formSchema.logoUrl().value());
  /**
   * Le logo vient-il d'un fichier déposé ? Reconnu à l'adresse de la route publique, la seule que
   * le serveur écrit. Une adresse externe saisie à la main se modifie dans le champ ; un fichier
   * déposé se remplace ou se retire.
   */
  public readonly isUploadedLogo = computed(() => this.logoUrl().includes('/public/branding/'));

  public updateModel = signal(new CompanyFormModel());
  public formSchema = form(this.updateModel, (schema) => {
    required(schema.name, { message: "Le nom de l'organisation est obligatoire" });
  });

  public readonly currencyOptions = [...INSTITUTION_CURRENCIES];
  /** La monnaie enregistrée, pour avertir avant de la changer. */
  public readonly savedCurrency = signal<string | null>(null);
  public readonly currencyChanged = computed(() => {
    const saved = this.savedCurrency();
    return saved !== null && this.formSchema.currency().value() !== saved;
  });

  public readonly languageOptions = [
    { label: 'Français', value: '0' },
    { label: 'English', value: '1' },
  ];

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: "Informations de l'organisation" },
    ]);
    this._companyInfoApiService.getCompanyInfo().subscribe({
      next: (dto) => {
        this.updateModel.set(CompanyFormModel.fromDto(dto));
        this.savedCurrency.set(dto.currency || DEFAULT_INSTITUTION_CURRENCY);
        this.isLoading.set(false);
      },
      error: () => {
        this._snackbarService.error('Erreur', 'Impossible de charger les informations.');
        this.isLoading.set(false);
      },
    });
  }

  public handleSave(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      this.isSaving.set(true);
      await firstValueFrom(
        this._companyInfoApiService
          .updateCompanyInfo({
            name: value.name || null,
            description: value.description || null,
            logoUrl: value.logoUrl || null,
            primaryColor: value.primaryColor || null,
            secondaryColor: value.secondaryColor || null,
            defaultLanguage: value.defaultLanguage as UpdateCompanyInfoCommandDefaultLanguageEnum || null,
            currency: value.currency,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de mettre à jour les informations.');
              this.isSaving.set(false);
              return EMPTY;
            }),
          ),
      );
      // Les écrans ouverts prennent la nouvelle monnaie sans recharger l'application.
      this._tenantProvider.setCurrency(value.currency);
      this.savedCurrency.set(value.currency);
      // Appliquer immédiatement les nouvelles couleurs au thème
      const ctx = this._tenantProvider.context();
      if (ctx) {
        this._tenantProvider.setContext({
          ...ctx,
          primaryColor: value.primaryColor || null,
          secondaryColor: value.secondaryColor || null,
        });
      }
      this._snackbarService.success('Succès', 'Informations mises à jour.');
      this.isSaving.set(false);
    });
  }

  public onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Remis à zéro tout de suite : choisir deux fois le même fichier doit relancer l'envoi.
    input.value = '';
    if (!file) return;

    // Contrôles de confort seulement : le serveur relit le type dans les octets et refuse le reste.
    if (!LOGO_TYPES.includes(file.type)) {
      this._snackbarService.error('Format non pris en charge', 'Le logo doit être une image PNG, JPG ou WebP.');
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      this._snackbarService.error('Logo trop lourd', 'Le logo ne peut pas dépasser 1 Mo.');
      return;
    }

    this.isLogoBusy.set(true);
    this._companyInfoApiService
      .uploadCompanyLogo(file)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbarService.error('Logo non enregistré', err.error?.detail ?? 'Le logo n’a pas pu être envoyé.');
          this.isLogoBusy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((res) => {
        // Reporté dans le formulaire : sans cela, « Enregistrer » renverrait l'ancienne adresse et
        // effacerait le logo qui vient d'être déposé.
        this._setLogoUrl(res.logoUrl ?? '');
        this.isLogoBusy.set(false);
        this._snackbarService.success('Logo mis à jour', 'Il apparaît désormais dans les e-mails envoyés.');
      });
  }

  public removeLogo(): void {
    this.isLogoBusy.set(true);
    this._companyInfoApiService
      .deleteCompanyLogo()
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', 'Le logo n’a pas pu être retiré.');
          this.isLogoBusy.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._setLogoUrl('');
        this.isLogoBusy.set(false);
        this._snackbarService.success('Logo retiré', '');
      });
  }

  private _setLogoUrl(url: string): void {
    this.logoBroken.set(false);
    this.updateModel.update((m) => Object.assign(new CompanyFormModel(), m, { logoUrl: url }));
  }

  public onColorPickerChange(field: 'primaryColor' | 'secondaryColor', hex: string): void {
    this.updateModel.update((m) => {
      const next = Object.assign(new CompanyFormModel(), m);
      next[field] = hex;
      return next;
    });
  }
}

export default CompanyPage;
