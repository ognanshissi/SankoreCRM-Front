import { Component, inject, signal } from '@angular/core';
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
import { CompanyInfoApiService, CompanyInfoDto, Languages } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { BreadcrumbService, TenantProvider } from '@sankore/crm/common';

class CompanyFormModel {
  public name!: string;
  public description!: string;
  public logoUrl!: string;
  public primaryColor!: string;
  public secondaryColor!: string;
  public defaultLanguage!: string;

  public static fromDto(dto: CompanyInfoDto): CompanyFormModel {
    const m = new CompanyFormModel();
    m.name = dto.name ?? '';
    m.description = dto.description ?? '';
    m.logoUrl = dto.logoUrl ?? '';
    m.primaryColor = dto.primaryColor ?? '';
    m.secondaryColor = dto.secondaryColor ?? '';
    m.defaultLanguage = dto.defaultLanguage != null ? String(dto.defaultLanguage) : '0';
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
  private readonly _companyInfoApiService = inject(CompanyInfoApiService);
  private readonly _tenantProvider = inject(TenantProvider);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(true);
  public isSaving = signal(false);

  public updateModel = signal(new CompanyFormModel());
  public formSchema = form(this.updateModel, (schema) => {
    required(schema.name, { message: "Le nom de l'organisation est obligatoire" });
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
            defaultLanguage: Number(value.defaultLanguage) as Languages,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de mettre à jour les informations.');
              this.isSaving.set(false);
              return EMPTY;
            }),
          ),
      );
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

  public onColorPickerChange(field: 'primaryColor' | 'secondaryColor', hex: string): void {
    this.updateModel.update((m) => {
      const next = Object.assign(new CompanyFormModel(), m);
      next[field] = hex;
      return next;
    });
  }
}

export default CompanyPage;
