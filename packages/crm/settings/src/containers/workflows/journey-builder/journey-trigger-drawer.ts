import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, readonly, submit } from '@angular/forms/signals';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';

export interface JourneyTriggerDrawerData {
  /** Le libellé du déclencheur, ou null quand le parcours n'en a pas. */
  label: string | null;
  product: string;
  canEdit: boolean;
  /** Remplace le déclencheur avec ce filtre produit ; vrai quand c'est fait. */
  save: (product: string) => Promise<boolean>;
}

class TriggerFormModel {
  public product!: string;

  public static of(product: string): TriggerFormModel {
    const m = new TriggerFormModel();
    m.product = product;
    return m;
  }
}

/** Le déclencheur du parcours et son filtre produit, dans un tiroir comme les étapes. */
@Component({
  selector: 'journey-trigger-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasFormField, TasLabel, TasHint, TasInput, Button, FormRoot, FormField],
  template: `
    <tas-side-drawer width="460px">
      <tas-drawer-title>
        <div>
          <p class="text-xs text-slate-500">Déclencheur</p>
          <p class="text-base font-semibold text-slate-900">{{ data.label ?? 'Aucun' }}</p>
        </div>
      </tas-drawer-title>
      <tas-drawer-content>
        @if (data.label) {
          <form [formRoot]="formSchema" class="flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Produit concerné</tas-label>
              <input tasInput type="text" placeholder="Tous les produits" [formField]="formSchema.product" />
              <tas-hint>Le parcours ne démarre que pour les dossiers de ce produit. Laissez vide pour tous.</tas-hint>
            </tas-form-field>
          </form>
        } @else {
          <p class="text-sm text-slate-500">Choisissez un déclencheur dans la palette des étapes.</p>
        }
      </tas-drawer-content>
      @if (data.label && data.canEdit) {
        <tas-drawer-action>
          <div class="flex justify-end gap-2 p-4 border-t border-slate-200">
            <button tas-outlined-button type="button" (click)="_dialogRef.close()">Annuler</button>
            <button tas-raised-button color="primary" type="button"
              [disabled]="formSchema().submitting()" [isLoading]="formSchema().submitting()" (click)="handleSubmit()">
              Enregistrer
            </button>
          </div>
        </tas-drawer-action>
      }
    </tas-side-drawer>
  `,
})
export class JourneyTriggerDrawer {
  public readonly data = inject<JourneyTriggerDrawerData>(DIALOG_DATA);
  protected readonly _dialogRef = inject(DialogRef<void>);

  public model = signal(TriggerFormModel.of(this.data.product));
  public formSchema = form(this.model, (schema) => {
    readonly(schema.product, { when: () => !this.data.canEdit });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      if (await this.data.save(field().value().product.trim())) this._dialogRef.close();
    });
  }
}
