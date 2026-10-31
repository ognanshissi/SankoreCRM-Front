import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { LeadSourceDetailDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';

/** Le plafond de la dimension « source » du score (`LeadSourceConfig.MaxScorePoints`). */
export const MAX_SOURCE_SCORE_POINTS = 20;

class SourceScorePointsFormModel {
  public points!: string;

  public static fromSource(source: LeadSourceDetailDto | null): SourceScorePointsFormModel {
    const m = new SourceScorePointsFormModel();
    m.points = String(source?.scorePoints ?? source?.defaultScorePoints ?? '');
    return m;
  }
}

/**
 * Ce que vaut un lead de cette source dans son score, sur 20 : l'admin sait que telle campagne
 * amène des curieux et que tel partenaire signe. Avant, tout lead arrivé par une source configurée
 * comptait comme « Site web », 12 points. Le score des leads déjà là ne bouge qu'à leur prochain
 * recalcul (qualification, activité…).
 */
@Component({
  selector: 'source-score-points',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCard, TasFormField, TasLabel, TasError, TasHint, TasSuffix, TasInput],
  template: `
    <tas-card class="block mt-4">
      <div class="p-4 border-b border-slate-100">
        <p class="text-sm font-semibold text-slate-700">Valeur de la source</p>
        <p class="mt-0.5 text-xs text-slate-500">
          Les points qu’un lead de cette source apporte à son score, sur {{ max }}. Plus la source amène des
          leads qui signent, plus la valeur est haute.
        </p>
      </div>
      <form [formRoot]="formSchema" class="p-4 flex flex-wrap items-start gap-4" (submit)="$event.preventDefault()">
        <!-- Largeur sur un conteneur : tas-form-field remplace les classes posées sur lui. -->
        <div class="w-40">
        <tas-form-field>
          <tas-label>Points</tas-label>
          <input tasInput type="text" inputmode="numeric" class="tabular-nums" [formField]="formSchema.points" />
          <button tasSuffix type="button" tabindex="-1" aria-hidden="true"
                  class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">/ {{ max }}</button>
          @if (formSchema.points().touched() && formSchema.points().invalid()) {
            <tas-error>{{ formSchema.points().errors()[0].message }}</tas-error>
          } @else {
            <tas-hint>Valeur du canal : {{ defaultPoints() }}</tas-hint>
          }
        </tas-form-field>
        </div>
        @if (canWrite()) {
          <div class="flex items-center gap-2 pt-6">
            <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                    [disabled]="formSchema().invalid() || formSchema().submitting() || !changed()"
                    [isLoading]="formSchema().submitting()">Enregistrer</button>
            @if (isCustom()) {
              <button tas-text-button color="primary" type="button" [disabled]="formSchema().submitting()" (click)="reset()">
                Revenir à la valeur du canal
              </button>
            }
          </div>
        }
      </form>
    </tas-card>
  `,
})
export class SourceScorePoints {
  public readonly source = input.required<LeadSourceDetailDto>();
  public readonly canWrite = input(false);
  /** Les points à enregistrer, ou `null` pour la valeur du canal. Le parent enregistre et recharge. */
  public readonly save = output<number | null>();

  public readonly max = MAX_SOURCE_SCORE_POINTS;
  public readonly defaultPoints = computed(() => this.source().defaultScorePoints ?? 0);
  public readonly isCustom = computed(() => this.source().scorePoints != null);

  public readonly model = signal(SourceScorePointsFormModel.fromSource(null));
  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.points, (ctx) => {
      const raw = String(ctx.value() ?? '').trim();
      const n = Number(raw);
      return raw === '' || !Number.isInteger(n) || n < 0 || n > MAX_SOURCE_SCORE_POINTS
        ? { kind: 'range', message: `Un nombre entier de 0 à ${MAX_SOURCE_SCORE_POINTS}` }
        : null;
    });
  });

  public readonly changed = computed(() => Number(this.model().points) !== (this.source().scorePoints ?? this.defaultPoints()));

  constructor() {
    // Repart de la source à chaque rechargement : c'est le serveur qui dit ce qui est enregistré.
    effect(() => this.model.set(SourceScorePointsFormModel.fromSource(this.source())));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      this.save.emit(Number(field().value().points));
    });
  }

  public reset(): void {
    this.save.emit(null);
  }
}
