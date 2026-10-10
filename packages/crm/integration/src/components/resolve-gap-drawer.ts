import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  form,
  FormField,
  FormRoot,
  minLength,
  required,
  submit,
} from '@angular/forms/signals';
import { ReconciliationGapRow, ResolveReconciliationGapResult } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../data-access/integration-facade.service';
import { gapTypeLabel } from '../data-access/integration-referential';

/** Une comparaison champ par champ, quand `details` la porte explicitement. */
export interface ComparedValues {
  field: string | null;
  crm: string;
  external: string;
}

/**
 * `details` est une chaîne libre au contrat : aucun schéma ne décrit son contenu, et la ligne
 * d'écart ne porte **aucune** comparaison structurée champ par champ. On n'extrait donc une vue
 * côte à côte que lorsque le texte étiquette lui-même les deux côtés (`crm=… / external=…`) ;
 * sinon le texte est rendu tel quel. Deviner quel fragment appartient à quel système reviendrait
 * à inverser un jour les deux colonnes d'un constat de conformité — un risque qu'un affichage
 * plus joli ne justifie pas.
 */
const CRM_SIDE = /(?:^|[\s,;(|])crm\s*[:=]\s*([^;,|)]+)/i;
const EXTERNAL_SIDE =
  /(?:^|[\s,;(|])(?:external|externe|ext|bo|back[-\s]?office|core)\s*[:=]\s*([^;,|)]+)/i;
/** Nom du champ comparé quand il préfixe la ligne : « KycTier: crm=2, external=3 ». */
const FIELD_PREFIX = /^\s*([A-Za-zÀ-ÿ0-9 _.-]{1,40}?)\s*[:=]\s*(?=crm\b)/i;

export function parseComparedValues(details: string | null | undefined): ComparedValues | null {
  if (!details) return null;
  const crm = CRM_SIDE.exec(details);
  const external = EXTERNAL_SIDE.exec(details);
  if (!crm || !external) return null;

  const field = FIELD_PREFIX.exec(details);
  return {
    field: field ? field[1].trim() : null,
    crm: crm[1].trim(),
    external: external[1].trim(),
  };
}

export interface ResolveGapDrawerData {
  gap: ReconciliationGapRow;
}

/**
 * Longueur minimale de la note. Le contrat dit seulement que la note est
 * obligatoire (« a compliance finding closed without a reason is untraceable ») :
 * une note de deux caractères la satisfait sans rien justifier, et c'est ce qui
 * rend un contrôle illisible six mois plus tard.
 */
const NOTE_MIN_LENGTH = 10;

class ResolveGapFormModel {
  public note!: string;

  public static instantiate(): ResolveGapFormModel {
    const model = new ResolveGapFormModel();
    model.note = '';
    return model;
  }
}

@Component({
  selector: 'resolve-gap-drawer',
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
    TasHint,
    TasInput,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title class="text-lg">Marquer cet écart comme résolu</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div class="rounded-lg border border-slate-200 p-4">
            <p class="text-sm font-semibold text-slate-700">{{ gapLabel() }}</p>

            <div class="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p class="text-xs text-slate-400">Identifiant CRM</p>
                <p class="font-mono text-xs text-slate-700 break-all">
                  {{ gap.crmId || '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-slate-400">Identifiant externe</p>
                <p class="font-mono text-xs text-slate-700 break-all">
                  {{ gap.externalId || '—' }}
                </p>
              </div>
            </div>

            <div class="mt-3 border-t border-slate-100 pt-3">
              <p class="text-xs text-slate-400">Valeurs comparées</p>
              <!--
                Côte à côte seulement quand le champ details étiquette lui-même les deux côtés : le
                contrat ne porte aucune comparaison structurée, et attribuer un fragment au
                mauvais système sur un constat de conformité coûte plus que l'affichage gagné.
              -->
              @if (compared(); as values) {
                @if (values.field) {
                  <p class="mt-1 text-xs font-medium text-slate-600">{{ values.field }}</p>
                }
                <div class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="rounded-lg border border-slate-200 p-2">
                    <p class="text-xs text-slate-400">Valeur CRM</p>
                    <p class="text-sm font-medium text-slate-800 break-all">{{ values.crm }}</p>
                  </div>
                  <div class="rounded-lg border border-slate-200 p-2">
                    <p class="text-xs text-slate-400">Valeur système externe</p>
                    <p class="text-sm font-medium text-slate-800 break-all">
                      {{ values.external }}
                    </p>
                  </div>
                </div>
              } @else {
                <p class="text-sm text-slate-700">{{ gap.details || '—' }}</p>
              }
            </div>
          </div>

          <p class="text-sm text-slate-500">
            Marquer l'écart comme résolu enregistre votre décision et ne change rien
            dans les deux systèmes. Si la divergence est toujours vraie, la
            comparaison de la nuit prochaine la rouvre.
          </p>

          <!--
            Dit explicitement : l'API ne propose pas de « garder la valeur CRM » ni de « garder
            la valeur back-office ». Un bouton qui le prétendrait n'écrirait nulle part, et
            l'écart reviendrait la nuit suivante sans que personne comprenne pourquoi.
          -->
          <p class="text-sm text-slate-500">
            La correction elle-même se fait dans le système concerné : aucune action de cet
            écran ne recopie une valeur d'un système vers l'autre.
          </p>

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>
                Commentaire <span class="text-functional-error">*</span>
              </tas-label>
              <textarea
                tasInput
                rows="5"
                placeholder="Ce qui a été vérifié, et pourquoi l'écart peut être refermé."
                [formField]="formSchema.note"
              ></textarea>
              @if (formSchema.note().touched() && formSchema.note().invalid()) {
                <tas-error>{{ formSchema.note().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>
                  Ce commentaire reste attaché à l'écart et sert de justification lors
                  d'une inspection.
                </tas-hint>
              }
            </tas-form-field>
          </form>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">
          Annuler
        </button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          Marquer comme résolu
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ResolveGapDrawer {
  private readonly _dialogRef =
    inject<DialogRef<ResolveReconciliationGapResult, ResolveGapDrawer>>(DialogRef);
  private readonly _data = inject<ResolveGapDrawerData>(DIALOG_DATA);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly gap: ReconciliationGapRow = this._data.gap;

  public model = signal(ResolveGapFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.note, { message: 'Le commentaire est obligatoire' });
    minLength(schema.note, NOTE_MIN_LENGTH, {
      message: `Décrivez la décision en ${NOTE_MIN_LENGTH} caractères au moins : une note plus courte ne justifie rien.`,
    });
  });

  public gapLabel(): string {
    return gapTypeLabel(this.gap.gapType);
  }

  public compared(): ComparedValues | null {
    return parseComparedValues(this.gap.details);
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const gapId = this.gap.gapId;
      if (!gapId) return;

      const result = await firstValueFrom(
        this._facade.resolveReconciliationGap(gapId, value.note.trim()).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error(
              'Erreur',
              integrationErrorMessage(err, "Impossible de refermer cet écart."),
            );
            return EMPTY;
          }),
        ),
      );

      if (result) {
        this._snackbar.success('Écart résolu', 'Votre commentaire a été enregistré.');
        this._dialogRef.close(result);
      }
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
