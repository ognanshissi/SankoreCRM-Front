import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { email, form, FormField, FormRoot, maxLength, readonly, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { CompanyInfoApiService, LegalIdentityDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';

class LegalIdentityFormModel {
  public legalName!: string;
  public legalForm!: string;
  public headOfficeAddress!: string;
  public phone!: string;
  public email!: string;
  public website!: string;
  public rccm!: string;
  public taxpayerNumber!: string;
  public taxRegime!: string;
  public quoteFooter!: string;

  public static fromDto(dto: LegalIdentityDto | null): LegalIdentityFormModel {
    const m = new LegalIdentityFormModel();
    m.legalName = dto?.legalName ?? '';
    m.legalForm = dto?.legalForm ?? '';
    m.headOfficeAddress = dto?.headOfficeAddress ?? '';
    m.phone = dto?.phone ?? '';
    m.email = dto?.email ?? '';
    m.website = dto?.website ?? '';
    m.rccm = dto?.rccm ?? '';
    m.taxpayerNumber = dto?.taxpayerNumber ?? '';
    m.taxRegime = dto?.taxRegime ?? '';
    m.quoteFooter = dto?.quoteFooter ?? '';
    return m;
  }
}

/** Même règle que le serveur (`SetLegalIdentityValidator.BeAWebAddress`). */
function isWebAddress(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (/\s/.test(v)) return false;
  try {
    const url = new URL(v.includes('://') ? v : `https://${v}`);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

const tooLong = (max: number) => `${max} caractères au plus`;

/**
 * « Identité légale » de l'institution (devis en lignes, lot 2) : ce que l'en-tête et le bas d'un
 * devis impriment. Rien n'est obligatoire : la liste des mentions d'un devis est à faire
 * confirmer par un expert-comptable, et le devis imprime ce qui est rempli.
 */
@Component({
  selector: 'legal-identity-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCard, TasFormField, TasLabel, TasError, TasHint, TasInput],
  template: `
    <tas-card>
      <form [formRoot]="formSchema" class="p-4 flex flex-col gap-4" (submit)="$event.preventDefault()">
        <div>
          <p class="text-sm font-semibold text-slate-700">Identité légale</p>
          <p class="text-xs text-slate-400 mt-0.5">Imprimée en en-tête et en bas des devis. Remplissez ce qui s’applique à votre institution.</p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <tas-form-field>
            <tas-label>Raison sociale</tas-label>
            <input tasInput type="text" placeholder="Vide : le nom de l’organisation" [formField]="formSchema.legalName" />
            @if (formSchema.legalName().touched() && formSchema.legalName().invalid()) {
              <tas-error>{{ formSchema.legalName().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Forme juridique</tas-label>
            <input tasInput type="text" placeholder="SA, SARL, SAS…" [formField]="formSchema.legalForm" />
            @if (formSchema.legalForm().touched() && formSchema.legalForm().invalid()) {
              <tas-error>{{ formSchema.legalForm().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </div>

        <tas-form-field>
          <tas-label>Adresse du siège</tas-label>
          <textarea tasInput rows="3" placeholder="Rue, boîte postale, ville, pays" [formField]="formSchema.headOfficeAddress"></textarea>
          @if (formSchema.headOfficeAddress().touched() && formSchema.headOfficeAddress().invalid()) {
            <tas-error>{{ formSchema.headOfficeAddress().errors()[0].message }}</tas-error>
          }
        </tas-form-field>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <tas-form-field>
            <tas-label>Téléphone</tas-label>
            <input tasInput type="tel" [formField]="formSchema.phone" />
            @if (formSchema.phone().touched() && formSchema.phone().invalid()) {
              <tas-error>{{ formSchema.phone().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>E-mail</tas-label>
            <input tasInput type="email" [formField]="formSchema.email" />
            @if (formSchema.email().touched() && formSchema.email().invalid()) {
              <tas-error>{{ formSchema.email().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Site web</tas-label>
            <input tasInput type="text" placeholder="www.exemple.ci" [formField]="formSchema.website" />
            @if (formSchema.website().touched() && formSchema.website().invalid()) {
              <tas-error>{{ formSchema.website().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <tas-form-field>
            <tas-label>RCCM</tas-label>
            <input tasInput type="text" placeholder="CI-ABJ-…" [formField]="formSchema.rccm" />
            @if (formSchema.rccm().touched() && formSchema.rccm().invalid()) {
              <tas-error>{{ formSchema.rccm().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>N° de compte contribuable</tas-label>
            <input tasInput type="text" [formField]="formSchema.taxpayerNumber" />
            @if (formSchema.taxpayerNumber().touched() && formSchema.taxpayerNumber().invalid()) {
              <tas-error>{{ formSchema.taxpayerNumber().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Régime d’imposition</tas-label>
            <input tasInput type="text" placeholder="Réel normal…" [formField]="formSchema.taxRegime" />
            @if (formSchema.taxRegime().touched() && formSchema.taxRegime().invalid()) {
              <tas-error>{{ formSchema.taxRegime().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </div>

        <tas-form-field>
          <tas-label>Bas de devis</tas-label>
          <textarea tasInput rows="3" placeholder="Capital, coordonnées bancaires, mentions…" [formField]="formSchema.quoteFooter"></textarea>
          @if (formSchema.quoteFooter().touched() && formSchema.quoteFooter().invalid()) {
            <tas-error>{{ formSchema.quoteFooter().errors()[0].message }}</tas-error>
          } @else {
            <tas-hint>Les mentions obligatoires d’un devis sont à faire confirmer par votre expert-comptable.</tas-hint>
          }
        </tas-form-field>

        @if (canUpdate()) {
          <div class="flex justify-end">
            <button tas-outlined-button color="primary" type="button" (click)="handleSubmit()"
                    [disabled]="formSchema().invalid() || formSchema().submitting()"
                    [isLoading]="formSchema().submitting()">Enregistrer l’identité légale</button>
          </div>
        }
      </form>
    </tas-card>
  `,
})
export class LegalIdentityCard implements OnInit {
  private readonly _api = inject(CompanyInfoApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly canUpdate = input(false);

  public readonly model = signal(LegalIdentityFormModel.fromDto(null));
  public readonly formSchema = form(this.model, (schema) => {
    readonly(schema, () => !this.canUpdate());
    maxLength(schema.legalName, 150, { message: tooLong(150) });
    maxLength(schema.legalForm, 60, { message: tooLong(60) });
    maxLength(schema.headOfficeAddress, 300, { message: tooLong(300) });
    maxLength(schema.phone, 30, { message: tooLong(30) });
    maxLength(schema.email, 150, { message: tooLong(150) });
    email(schema.email, { message: 'Adresse invalide' });
    maxLength(schema.website, 200, { message: tooLong(200) });
    validate(schema.website, (ctx) => (isWebAddress(ctx.value()) ? null : { kind: 'url', message: 'Une adresse web, par exemple www.exemple.ci' }));
    maxLength(schema.rccm, 60, { message: tooLong(60) });
    maxLength(schema.taxpayerNumber, 30, { message: tooLong(30) });
    maxLength(schema.taxRegime, 60, { message: tooLong(60) });
    maxLength(schema.quoteFooter, 1000, { message: tooLong(1000) });
  });

  ngOnInit(): void {
    this._api.getLegalIdentity().pipe(catchError(() => EMPTY))
      .subscribe((dto) => this.model.set(LegalIdentityFormModel.fromDto(dto)));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const blank = (s: string) => s.trim() || null;
      const failed = await firstValueFrom(
        this._api.setLegalIdentity({
          legalName: blank(v.legalName),
          legalForm: blank(v.legalForm),
          headOfficeAddress: blank(v.headOfficeAddress),
          phone: blank(v.phone),
          email: blank(v.email),
          website: blank(v.website),
          rccm: blank(v.rccm),
          taxpayerNumber: blank(v.taxpayerNumber),
          taxRegime: blank(v.taxRegime),
          quoteFooter: blank(v.quoteFooter),
        }).pipe(
          catchError((err: HttpErrorResponse) => {
            const first = err.error?.errors ? Object.values(err.error.errors as Record<string, string[]>)[0]?.[0] : null;
            this._snackbar.error('Identité légale non enregistrée', first ?? 'L’identité légale n’a pas pu être enregistrée.');
            return [true];
          }),
        ),
        { defaultValue: false },
      );
      if (failed === true) return;
      this._snackbar.success('Identité légale enregistrée', 'Les prochains devis l’imprimeront.');
    });
  }
}
