import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { CallOutcomeDto, TelephonyApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import { telephonyErrorMessage } from '../../data-access/telephony-referential';

export interface CallOutcomeDrawerData {
  /** `null` pour une création ; le résultat existant pour une modification. */
  outcome: CallOutcomeDto | null;
  /** Ordre d'affichage proposé à la création : à la fin de la liste. */
  nextDisplayOrder: number;
}

class CallOutcomeFormModel {
  public code!: string;
  public label!: string;
  public countsAsContact!: boolean;
  public requiresCallbackDate!: boolean;
  /** Chaîne : l'input rend du texte, la conversion a lieu à la soumission. */
  public displayOrder!: string;

  public static instantiate(data: CallOutcomeDrawerData): CallOutcomeFormModel {
    const model = new CallOutcomeFormModel();
    const outcome = data.outcome;
    model.code = outcome?.code ?? '';
    model.label = outcome?.label ?? '';
    model.countsAsContact = outcome?.countsAsContact ?? false;
    model.requiresCallbackDate = outcome?.requiresCallbackDate ?? false;
    model.displayOrder = String(outcome?.displayOrder ?? data.nextDisplayOrder);
    return model;
  }
}

/**
 * Création et modification d'un résultat d'appel.
 *
 * **Les deux drapeaux de comportement ne sont PAS modifiables, et l'écran le dit en
 * toutes lettres au lieu de griser deux cases sans explication.** `PUT call-outcomes/{code}`
 * ne prend que le libellé et l'ordre : `countsAsContact` décide si un appel arrête le SLA
 * de premier contact d'un lead, et le retourner réécrirait ce que voulait dire chaque appel
 * déjà qualifié sous ce code — un mois de chiffres de SLA recalculés par un écran de
 * paramétrage. Le contrat indique la manœuvre, et le drawer la propose : créer un nouveau
 * résultat et désactiver l'ancien, ce qui laisse l'historique dire ce qu'il disait.
 *
 * Le code est aussi définitif : il est la clé vers laquelle pointent les appels qualifiés.
 */
@Component({
  selector: 'lib-call-outcome-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasTag,
    Button,
    TasCheckbox,
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
        <tas-title>
          {{ isEdit ? 'Modifier le résultat d’appel' : 'Nouveau résultat d’appel' }}
        </tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          @if (isEdit) {
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p class="font-mono text-xs text-slate-700">{{ formSchema.code().value() }}</p>
              <p class="mt-1 text-xs text-slate-500">
                Le code ne change pas : les appels déjà qualifiés pointent dessus.
              </p>
            </div>
          } @else {
            <tas-form-field>
              <tas-label>Code <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" placeholder="RAPPEL_CONVENU" [formField]="formSchema.code" />
              @if (formSchema.code().touched() && formSchema.code().invalid()) {
                <tas-error>{{ formSchema.code().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>
                  Mis en majuscules par le serveur, et définitif. Unique dans votre
                  établissement — y compris face à un code désactivé, qu'il faut réactiver plutôt
                  que recréer.
                </tas-hint>
              }
            </tas-form-field>
          }

          <tas-form-field>
            <tas-label>Libellé <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Rappel convenu" [formField]="formSchema.label" />
            @if (formSchema.label().touched() && formSchema.label().invalid()) {
              <tas-error>{{ formSchema.label().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Ce que l'agent lira dans la liste au moment de qualifier son appel.</tas-hint>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Ordre d'affichage</tas-label>
            <input tasInput type="number" [formField]="formSchema.displayOrder" />
            @if (formSchema.displayOrder().touched() && formSchema.displayOrder().invalid()) {
              <tas-error>{{ formSchema.displayOrder().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Les plus petits apparaissent en premier dans le formulaire de qualification.</tas-hint>
            }
          </tas-form-field>

          @if (isEdit) {
            <!--
              Les drapeaux sont affichés comme des FAITS, pas comme des champs désactivés :
              une case grisée sans phrase laisse chercher le droit qui manque.
            -->
            <div class="rounded-lg border border-slate-200 p-3">
              <p class="text-sm font-medium text-slate-700">Comportement, définitif</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <tas-tag [severity]="outcome?.countsAsContact ? 'success' : 'neutral'">
                  {{ outcome?.countsAsContact ? 'Compte comme un contact' : 'Ne compte pas comme un contact' }}
                </tas-tag>
                <tas-tag [severity]="outcome?.requiresCallbackDate ? 'info' : 'neutral'">
                  {{ outcome?.requiresCallbackDate ? 'Date de rappel obligatoire' : 'Sans date de rappel' }}
                </tas-tag>
              </div>
              <p class="mt-2 text-xs text-slate-500">
                Ces deux comportements ne se modifient pas. « Compte comme un contact » décide si
                l'appel arrête le délai de premier contact d'un lead : le retourner changerait
                après coup ce que voulait dire chaque appel déjà qualifié sous ce code, et un mois
                d'indicateurs serait recalculé par cet écran. Pour changer le comportement, créez
                un nouveau résultat et désactivez celui-ci : l'historique continue alors de dire
                ce qu'il disait.
              </p>
            </div>
          } @else {
            <div class="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
              <p class="text-sm font-medium text-slate-700">Comportement</p>
              <p class="text-xs text-slate-500">
                Ces deux choix sont DÉFINITIFS : ils ne seront plus modifiables après la création,
                parce que les appels qualifiés sous ce code en dépendent.
              </p>
              <tas-checkbox [formField]="formSchema.countsAsContact">
                <span class="text-sm text-slate-700">Compte comme un contact</span>
              </tas-checkbox>
              <p class="-mt-2 text-xs text-slate-500">
                Un appel qualifié ainsi arrête le délai de premier contact du lead et entre dans
                les indicateurs de contact.
              </p>
              <tas-checkbox [formField]="formSchema.requiresCallbackDate">
                <span class="text-sm text-slate-700">Date de rappel obligatoire</span>
              </tas-checkbox>
              <p class="-mt-2 text-xs text-slate-500">
                L'agent ne pourra pas valider sa qualification sans renseigner une date de rappel.
              </p>
            </div>
          }

          @if (submitError()) {
            <p class="text-sm text-functional-error">{{ submitError() }}</p>
          }

          <div class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <tas-icon
              iconName="feather:info"
              class="mt-0.5 shrink-0 text-slate-500"
              style="font-size:14px"
            ></tas-icon>
            <p class="text-xs text-slate-600">
              Un résultat d'appel ne se supprime jamais : il se désactive. Un appel qualifié l'an
              dernier pointe dessus, et le retirer laisserait cet appel expliqué par rien.
            </p>
          </div>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting() || isUnchanged()"
          [isLoading]="formSchema().submitting()"
        >
          {{ isEdit ? 'Enregistrer' : 'Créer le résultat' }}
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CallOutcomeDrawer {
  private readonly _data: CallOutcomeDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly outcome = this._data.outcome;
  public readonly isEdit = this._data.outcome !== null;
  public readonly submitError = signal<string | null>(null);

  public model = signal(CallOutcomeFormModel.instantiate(this._data));

  public formSchema = form(this.model, (schema) => {
    validate(schema.code, (ctx) => {
      if (this.isEdit) return null;
      const code = (ctx.value() ?? '').trim();
      if (!code) return { kind: 'required', message: 'Le code est obligatoire' };
      // Le serveur met en majuscules ; on refuse d'avance ce qu'un code ne peut pas être,
      // plutôt que de laisser créer « rappel convenu » et le voir devenir autre chose.
      return /^[A-Za-z0-9_]{2,40}$/.test(code)
        ? null
        : {
            kind: 'pattern',
            message: 'Lettres, chiffres et tirets bas seulement, de 2 à 40 caractères',
          };
    });

    validate(schema.label, (ctx) =>
      (ctx.value() ?? '').trim()
        ? null
        : { kind: 'required', message: 'Le libellé est obligatoire' },
    );

    validate(schema.displayOrder, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (raw === '') return { kind: 'required', message: "L'ordre est obligatoire" };
      const parsed = Number(raw);
      return Number.isInteger(parsed) && parsed >= 0
        ? null
        : { kind: 'range', message: 'Entrez un entier positif ou nul' };
    });
  });

  public readonly isUnchanged = computed(() => {
    if (!this.isEdit) return false;
    const label = (this.formSchema.label().value() ?? '').trim();
    const order = (this.formSchema.displayOrder().value() ?? '').trim();
    return (
      label === (this.outcome?.label ?? '') &&
      order === String(this.outcome?.displayOrder ?? 0)
    );
  });

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const displayOrder = Number(value.displayOrder.trim());

      // Les deux endpoints répondent 204 : un drapeau, pas un test sur la valeur reçue.
      let saved = false;

      const request$ = this.isEdit
        ? this._api.updateTelephonyCallOutcome(this.outcome?.code ?? '', {
            label: value.label.trim(),
            displayOrder,
          })
        : this._api.createTelephonyCallOutcome({
            code: value.code.trim(),
            label: value.label.trim(),
            countsAsContact: value.countsAsContact,
            requiresCallbackDate: value.requiresCallbackDate,
            displayOrder,
          });

      await firstValueFrom(
        request$.pipe(
          tap(() => {
            saved = true;
          }),
          catchError((error: HttpErrorResponse) => {
            const message = telephonyErrorMessage(
              error,
              this.isEdit
                ? "Le résultat d'appel n'a pas pu être modifié."
                : "Le résultat d'appel n'a pas pu être créé.",
            );
            this.submitError.set(message);
            this._snackbar.error('Enregistrement refusé', message);
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success(
        this.isEdit ? 'Résultat modifié' : 'Résultat créé',
        this.isEdit
          ? 'Les agents verront le nouveau libellé à leur prochaine qualification.'
          : 'Il est actif et proposé dès la prochaine qualification.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
