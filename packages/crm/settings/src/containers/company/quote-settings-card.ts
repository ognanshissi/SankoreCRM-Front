import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { form, FormField, FormRoot, maxLength, readonly, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { CompanyInfoApiService, QuoteSettingsDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';

class QuoteSettingsFormModel {
  public prefix!: string;
  public validityDays!: string;
  public paymentTerms!: string;

  public static fromDto(dto: QuoteSettingsDto | null): QuoteSettingsFormModel {
    const m = new QuoteSettingsFormModel();
    m.prefix = dto?.prefix ?? 'DEV';
    m.validityDays = String(dto?.validityDays ?? 30);
    m.paymentTerms = dto?.paymentTerms ?? '';
    return m;
  }
}

/** Même règle que le serveur (`CompanyInfo.NormalizeQuotePrefix`). */
const PREFIX = /^[A-Z0-9](?:[A-Z0-9-]{0,8}[A-Z0-9])?$/;

/**
 * « Devis » (devis en lignes, lot 2) : numérotation, validité et conditions de paiement par
 * défaut. Le numéro est « préfixe-année-rang » et repart à 1 chaque janvier.
 */
@Component({
  selector: 'quote-settings-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCard, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSuffix],
  template: `
    <tas-card>
      <form [formRoot]="formSchema" class="p-4 flex flex-col gap-4" (submit)="$event.preventDefault()">
        <div>
          <p class="text-sm font-semibold text-slate-700">Devis</p>
          <p class="text-xs text-slate-400 mt-0.5">Numérotation et valeurs proposées sur chaque nouveau devis.</p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <tas-form-field>
            <tas-label>Préfixe <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" [formField]="formSchema.prefix" />
            @if (formSchema.prefix().touched() && formSchema.prefix().invalid()) {
              <tas-error>{{ formSchema.prefix().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Prochain numéro : <span class="font-mono">{{ nextNumber() }}</span></tas-hint>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Validité <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" inputmode="numeric" [formField]="formSchema.validityDays" />
            <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default pr-3 text-sm text-slate-500">jours</button>
            @if (formSchema.validityDays().touched() && formSchema.validityDays().invalid()) {
              <tas-error>{{ formSchema.validityDays().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </div>

        <tas-form-field>
          <tas-label>Conditions de paiement</tas-label>
          <textarea tasInput rows="2" placeholder="Ex. 50 % à la commande, solde à la livraison" [formField]="formSchema.paymentTerms"></textarea>
          @if (formSchema.paymentTerms().touched() && formSchema.paymentTerms().invalid()) {
            <tas-error>{{ formSchema.paymentTerms().errors()[0].message }}</tas-error>
          } @else {
            <tas-hint>Proposées sur chaque devis, modifiables devis par devis.</tas-hint>
          }
        </tas-form-field>

        @if (canUpdate()) {
          <div class="flex justify-end">
            <button tas-outlined-button color="primary" type="button" (click)="handleSubmit()"
                    [disabled]="formSchema().invalid() || formSchema().submitting()"
                    [isLoading]="formSchema().submitting()">Enregistrer les devis</button>
          </div>
        }
      </form>
    </tas-card>
  `,
})
export class QuoteSettingsCard implements OnInit {
  private readonly _api = inject(CompanyInfoApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly canUpdate = input(false);
  public readonly settings = signal<QuoteSettingsDto | null>(null);

  public readonly model = signal(QuoteSettingsFormModel.fromDto(null));
  public readonly formSchema = form(this.model, (schema) => {
    readonly(schema, () => !this.canUpdate());
    required(schema.prefix, { message: 'Le préfixe est obligatoire' });
    validate(schema.prefix, (ctx) =>
      PREFIX.test(ctx.value().trim().toUpperCase()) ? null : { kind: 'prefix', message: 'De 1 à 10 lettres, chiffres ou tirets, par exemple DEV' });
    required(schema.validityDays, { message: 'La validité est obligatoire' });
    validate(schema.validityDays, (ctx) => {
      const v = ctx.value().trim();
      return /^\d+$/.test(v) && +v >= 1 && +v <= 365 ? null : { kind: 'days', message: 'Entre 1 et 365 jours' };
    });
    maxLength(schema.paymentTerms, 500, { message: '500 caractères au plus' });
  });

  /** L'aperçu suit le préfixe saisi ; le rang vient du serveur. */
  public readonly nextNumber = computed(() => {
    const s = this.settings();
    const typed = this.model().prefix.trim().toUpperCase();
    if (!s?.nextNumber || !s.prefix) return '—';
    const rank = s.nextNumber.slice(s.prefix.length);
    return `${PREFIX.test(typed) ? typed : s.prefix}${rank}`;
  });

  ngOnInit(): void {
    this._load();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const failed = await firstValueFrom(
        this._api.setQuoteSettings({
          prefix: v.prefix.trim().toUpperCase(),
          validityDays: Number(v.validityDays.trim()),
          paymentTerms: v.paymentTerms.trim() || null,
        }).pipe(
          catchError((err: HttpErrorResponse) => {
            const first = err.error?.errors ? Object.values(err.error.errors as Record<string, string[]>)[0]?.[0] : null;
            this._snackbar.error('Réglage des devis non enregistré', first ?? 'Le réglage des devis n’a pas pu être enregistré.');
            return [true];
          }),
        ),
        { defaultValue: false },
      );
      if (failed === true) return;
      this._snackbar.success('Devis réglés', 'Les prochains devis suivront ce réglage.');
      this._load();
    });
  }

  private _load(): void {
    this._api.getQuoteSettings().pipe(catchError(() => EMPTY)).subscribe((s) => {
      this.settings.set(s);
      this.model.set(QuoteSettingsFormModel.fromDto(s));
    });
  }
}
