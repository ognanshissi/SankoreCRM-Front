import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { KeyAccountSettingsDto, LeadSettingsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { currencyUnit, TenantProvider } from '@sankore/crm/common';
import {
  ACTIVITY_SECTOR_OPTIONS,
  activitySectorLabel,
  amountText,
  formatAmount,
  parseAmount,
} from '../edit-lead/lead-view.models';

class KeyAccountsFormModel {
  public good!: string;
  public major!: string;
  public sectors!: string[];

  public static fromDto(dto: KeyAccountSettingsDto): KeyAccountsFormModel {
    const m = new KeyAccountsFormModel();
    m.good = dto.goodPurchases ? amountText(dto.goodPurchases) : '';
    m.major = dto.majorPurchases ? amountText(dto.majorPurchases) : '';
    m.sectors = [...(dto.targetSectors ?? [])];
    return m;
  }
}

const positiveOrEmpty = (raw: string) => {
  const amount = parseAmount(raw);
  return amount === null || (!Number.isNaN(amount) && amount > 0);
};

/**
 * Ce qui fait un gros prospect pour l'institution (grands comptes, lot 2) : deux seuils de volume
 * d'achat annuel et les secteurs ciblés. Ils donnent la dimension « Potentiel » du score d'un lead
 * entreprise, jusqu'à 20 points — 12 pour un grand compte, 6 pour un bon client, jusqu'à 4 pour
 * l'effectif, 4 pour un secteur ciblé. Rien n'est compté tant que rien n'est réglé.
 */
@Component({
  selector: 'key-accounts-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSuffix],
  template: `
    <section aria-labelledby="key-accounts" class="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-xs">
      <div>
        <h2 id="key-accounts" class="text-sm font-bold text-slate-800">Grands comptes</h2>
        <p class="mt-0.5 text-xs text-slate-500">Le potentiel d’un lead entreprise, jusqu’à 20 points du score.</p>
      </div>
      @if (settings(); as s) {
        @if (!editing()) {
          @if (s.isConfigured) {
            <ul class="flex flex-col gap-1.5 text-sm text-slate-700" role="list">
              <li>Grand compte dès <span class="font-semibold tabular-nums">{{ s.majorPurchases ? formatAmount(s.majorPurchases, currency()) : '—' }}</span> d’achats par an<span class="text-xs text-slate-500">&nbsp;(12 points)</span></li>
              <li>Bon client dès <span class="font-semibold tabular-nums">{{ s.goodPurchases ? formatAmount(s.goodPurchases, currency()) : '—' }}</span><span class="text-xs text-slate-500">&nbsp;(6 points)</span></li>
              <li>
                Secteurs ciblés :
                <span class="font-semibold">{{ sectorSummary() }}</span><span class="text-xs text-slate-500">&nbsp;(4 points)</span>
              </li>
            </ul>
            <p class="text-xs text-slate-500">L’effectif compte aussi : 4 points à 250 personnes et plus, 3 de 50 à 249, 1 de 10 à 49.</p>
          } @else {
            <p class="text-sm text-slate-600">Pas encore réglé : le score ne tient pas compte de la taille des entreprises.</p>
          }
          @if (canManage()) {
            <button tas-outlined-button color="primary" type="button" class="self-start" (click)="editing.set(true)">
              {{ s.isConfigured ? 'Modifier' : 'Régler les grands comptes' }}
            </button>
          }
        } @else {
          <form [formRoot]="formSchema" class="flex flex-col gap-3" (submit)="$event.preventDefault()">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <tas-form-field>
                <tas-label>Grand compte dès</tas-label>
                <input tasInput type="text" inputmode="numeric" placeholder="Ex. 50 000 000" [formField]="formSchema.major" />
                <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">{{ unit() }}</button>
                @if (formSchema.major().touched() && formSchema.major().invalid()) {
                  <tas-error>{{ formSchema.major().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
              <tas-form-field>
                <tas-label>Bon client dès</tas-label>
                <input tasInput type="text" inputmode="numeric" placeholder="Ex. 10 000 000" [formField]="formSchema.good" />
                <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">{{ unit() }}</button>
                @if (formSchema.good().touched() && formSchema.good().invalid()) {
                  <tas-error>{{ formSchema.good().errors()[0].message }}</tas-error>
                } @else {
                  <tas-hint>Volume d’achat annuel estimé.</tas-hint>
                }
              </tas-form-field>
            </div>
            <fieldset class="flex flex-col gap-2">
              <legend class="mb-1 text-sm font-medium text-slate-700">Secteurs ciblés</legend>
              <div class="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                @for (sector of sectorOptions; track sector.value) {
                  <label class="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                    <input type="checkbox" class="mt-0.5 accent-primary"
                           [checked]="model().sectors.includes(sector.value)"
                           (change)="toggleSector(sector.value, $any($event.target).checked)" />
                    <span>{{ sector.label }}</span>
                  </label>
                }
              </div>
            </fieldset>
            <p class="text-xs text-slate-500">Les leads entreprise en cours sont recalculés aussitôt après l’enregistrement.</p>
            <div class="flex gap-2">
              <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                      [disabled]="formSchema().invalid() || formSchema().submitting()"
                      [isLoading]="formSchema().submitting()">Enregistrer</button>
              <button tas-text-button color="primary" type="button" [disabled]="formSchema().submitting()" (click)="cancel()">Annuler</button>
            </div>
          </form>
        }
      }
    </section>
  `,
})
export class KeyAccountsCard implements OnInit {
  private readonly _api = inject(LeadSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);
  public readonly currency = inject(TenantProvider).currency;
  public readonly unit = computed(() => currencyUnit(this.currency()));

  public readonly canManage = input(false);

  public readonly settings = signal<KeyAccountSettingsDto | null>(null);
  public readonly editing = signal(false);
  public readonly sectorOptions = ACTIVITY_SECTOR_OPTIONS;
  public readonly formatAmount = formatAmount;

  public readonly sectorSummary = computed(() => {
    const sectors = this.settings()?.targetSectors ?? [];
    return sectors.length ? sectors.map((s) => activitySectorLabel(s)).join(', ') : 'aucun';
  });

  public readonly model = signal(KeyAccountsFormModel.fromDto({}));
  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.good, (ctx) =>
      positiveOrEmpty(ctx.value()) ? null : { kind: 'amount', message: 'Un montant positif, en chiffres' });
    validate(schema.major, (ctx) => {
      if (!positiveOrEmpty(ctx.value())) return { kind: 'amount', message: 'Un montant positif, en chiffres' };
      const major = parseAmount(ctx.value());
      const good = parseAmount(ctx.valueOf(schema.good));
      return major !== null && good !== null && !Number.isNaN(good) && major <= good
        ? { kind: 'order', message: 'Au-dessus du seuil « bon client »' }
        : null;
    });
  });

  ngOnInit(): void {
    this._api.getKeyAccountSettings().pipe(catchError(() => EMPTY)).subscribe((s) => {
      this.settings.set(s);
      this.model.set(KeyAccountsFormModel.fromDto(s));
    });
  }

  public toggleSector(code: string, checked: boolean): void {
    this.model.update((m) => {
      const next = Object.assign(new KeyAccountsFormModel(), m);
      next.sectors = checked ? [...m.sectors.filter((s) => s !== code), code] : m.sectors.filter((s) => s !== code);
      return next;
    });
  }

  public cancel(): void {
    this.model.set(KeyAccountsFormModel.fromDto(this.settings() ?? {}));
    this.editing.set(false);
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const saved = await firstValueFrom(
        this._api
          .setKeyAccountSettings({
            goodPurchases: parseAmount(value.good) ?? 0,
            majorPurchases: parseAmount(value.major) ?? 0,
            targetSectors: value.sectors,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error(
                'Réglage non enregistré',
                err.error?.detail === 'KEY_ACCOUNT_THRESHOLDS_INVALID'
                  ? 'Le seuil « grand compte » doit dépasser le seuil « bon client ».'
                  : 'Le réglage des grands comptes n’a pas pu être enregistré.',
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );
      if (!saved) return;
      this.settings.set(saved);
      this.editing.set(false);
      this._snackbar.success('Grands comptes enregistrés', 'Les leads entreprise en cours sont en cours de recalcul.');
    });
  }
}
