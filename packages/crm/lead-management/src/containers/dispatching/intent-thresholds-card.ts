import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { IntentThresholdsDto, LeadSettingsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';

class IntentThresholdsFormModel {
  public warm!: string;
  public hot!: string;
  public cooldown!: boolean;

  public static fromDto(dto: IntentThresholdsDto): IntentThresholdsFormModel {
    const m = new IntentThresholdsFormModel();
    m.warm = String(dto.warm ?? 60);
    m.hot = String(dto.hot ?? 80);
    m.cooldown = dto.cooldownEnabled ?? true;
    return m;
  }
}

const isScore = (raw: string) => /^\d{1,3}$/.test(raw.trim()) && Number(raw) >= 1 && Number(raw) <= 100;

/**
 * Les seuils de température de l'institution : un lead est chaud à partir de `hot` points, tiède à
 * partir de `warm`, froid en dessous. Ils pilotent le délai de premier contact des règles qui en
 * définissent un par température, et l'ordre des premiers contacts dans « Ma journée ». Le
 * refroidissement retire des points à un lead resté sans activité, chaque nuit.
 */
@Component({
  selector: 'intent-thresholds-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasFormField, TasLabel, TasError, TasInput],
  template: `
    <section aria-labelledby="intent-thresholds" class="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-xs">
      <div>
        <h2 id="intent-thresholds" class="text-sm font-bold text-slate-800">Température des leads</h2>
        <p class="mt-0.5 text-xs text-slate-500">Lue sur le score, de 0 à 100, dès l’arrivée du lead.</p>
      </div>
      @if (thresholds(); as t) {
        @if (!editing()) {
          <ul class="flex flex-col gap-1.5 text-sm text-slate-700" role="list">
            <li class="flex items-center gap-2"><span class="size-2 rounded-full bg-red-500" aria-hidden="true"></span>Chaud à partir de <span class="font-semibold tabular-nums">{{ t.hot }}</span></li>
            <li class="flex items-center gap-2"><span class="size-2 rounded-full bg-amber-500" aria-hidden="true"></span>Tiède à partir de <span class="font-semibold tabular-nums">{{ t.warm }}</span></li>
            <li class="flex items-center gap-2"><span class="size-2 rounded-full bg-blue-500" aria-hidden="true"></span>Froid en dessous</li>
          </ul>
          <p class="text-xs text-slate-500">
            {{ t.cooldownEnabled === false
              ? 'Refroidissement désactivé : un lead garde son score sans activité.'
              : 'Sans activité, un lead perd 10 points à 30 jours, 20 à 60 et 30 à 90.' }}
          </p>
          @if (canManage()) {
            <button tas-outlined-button color="primary" type="button" class="self-start" (click)="editing.set(true)">Modifier les seuils</button>
          }
        } @else {
          <form [formRoot]="formSchema" class="flex flex-col gap-3" (submit)="$event.preventDefault()">
            <div class="grid grid-cols-2 gap-3">
              <tas-form-field>
                <tas-label>Chaud dès</tas-label>
                <input tasInput type="text" inputmode="numeric" [formField]="formSchema.hot" />
                @if (formSchema.hot().touched() && formSchema.hot().invalid()) {
                  <tas-error>{{ formSchema.hot().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
              <tas-form-field>
                <tas-label>Tiède dès</tas-label>
                <input tasInput type="text" inputmode="numeric" [formField]="formSchema.warm" />
                @if (formSchema.warm().touched() && formSchema.warm().invalid()) {
                  <tas-error>{{ formSchema.warm().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
            </div>
            <label class="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" class="mt-0.5 accent-primary" [formField]="formSchema.cooldown" />
              <span>
                Refroidir les leads sans activité
                <span class="block text-xs text-slate-500">−10 points à 30 jours, −20 à 60, −30 à 90 ; la première activité les rend.</span>
              </span>
            </label>
            <p class="text-xs text-slate-500">Les leads en cours prennent tout de suite la température de leur score ; le refroidissement s’applique la nuit suivante.</p>
            <div class="flex gap-2">
              <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                      [disabled]="formSchema().invalid() || formSchema().submitting()"
                      [isLoading]="formSchema().submitting()">Enregistrer</button>
              <button tas-text-button type="button" [disabled]="formSchema().submitting()" (click)="cancel()">Annuler</button>
            </div>
          </form>
        }
      }
    </section>
  `,
})
export class IntentThresholdsCard implements OnInit {
  private readonly _api = inject(LeadSettingsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly canManage = input(false);

  public readonly thresholds = signal<IntentThresholdsDto | null>(null);
  public readonly editing = signal(false);

  public readonly model = signal(IntentThresholdsFormModel.fromDto({}));
  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.warm, (ctx) => (isScore(ctx.value()) ? null : { kind: 'range', message: 'Un nombre de 1 à 100' }));
    validate(schema.hot, (ctx) => {
      if (!isScore(ctx.value())) return { kind: 'range', message: 'Un nombre de 1 à 100' };
      return isScore(ctx.valueOf(schema.warm)) && Number(ctx.value()) <= Number(ctx.valueOf(schema.warm))
        ? { kind: 'order', message: 'Au-dessus du seuil tiède' }
        : null;
    });
  });

  ngOnInit(): void {
    this._api.getIntentThresholds().pipe(catchError(() => EMPTY)).subscribe((t) => {
      this.thresholds.set(t);
      this.model.set(IntentThresholdsFormModel.fromDto(t));
    });
  }

  public cancel(): void {
    this.model.set(IntentThresholdsFormModel.fromDto(this.thresholds() ?? {}));
    this.editing.set(false);
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const saved = await firstValueFrom(
        this._api.setIntentThresholds({ warm: Number(value.warm), hot: Number(value.hot), cooldownEnabled: value.cooldown }).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error(
              'Seuils non enregistrés',
              err.error?.detail === 'INTENT_THRESHOLDS_INVALID'
                ? 'Le seuil chaud doit dépasser le seuil tiède, entre 1 et 100.'
                : 'Les seuils n’ont pas pu être enregistrés.',
            );
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!saved) return;
      this.thresholds.set({ warm: saved.warm, hot: saved.hot, cooldownEnabled: saved.cooldownEnabled });
      this.editing.set(false);
      this._snackbar.success(
        'Seuils enregistrés',
        saved.leadsUpdated
          ? `${saved.leadsUpdated} lead${saved.leadsUpdated > 1 ? 's' : ''} en cours ${saved.leadsUpdated > 1 ? 'ont' : 'a'} pris leur nouvelle température.`
          : 'Ils s’appliquent aux prochains scores.',
      );
    });
  }
}
