import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { OpportunityDto, UpdateOpportunityRequest } from '@sankore/crm-api';
import { institutionCurrency } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';

export interface EditProjectInfoDrawerData {
  project: OpportunityDto;
  productOptions: { value: string; label: string }[];
  amountLabel: string;
  /** L'écriture de la page, qui relit le projet et traduit les refus : vrai quand elle a abouti. */
  save: (patch: UpdateOpportunityRequest) => Promise<boolean>;
  /** Ouvert depuis un refus « montant obligatoire » : le curseur va au montant. */
  focus?: 'amount';
}

class EditProjectInfoFormModel {
  public title!: string;
  public product!: string;
  public description!: string;
  /** En texte, comme l'input le rend : converti à l'envoi. */
  public amount!: string;

  public static from(p: OpportunityDto): EditProjectInfoFormModel {
    const m = new EditProjectInfoFormModel();
    m.title = p.title ?? '';
    m.product = p.product ?? '';
    m.description = p.description ?? '';
    m.amount = p.estimatedAmount?.amount ? String(p.estimatedAmount.amount) : '';
    return m;
  }
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  return cleaned ? Number(cleaned) : null;
}

/**
 * Titre, produit, montant et besoin exprimé du projet. En tiroir depuis la refonte du 2026-10-27 :
 * le formulaire ouvert en bas de page obligeait à y faire défiler l'agent depuis un refus d'étape.
 */
@Component({
  selector: 'edit-project-info-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot, FormField, Button, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Modifier le projet</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Titre <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" [formField]="formSchema.title" />
            @if (formSchema.title().touched() && formSchema.title().invalid()) {
              <tas-error>{{ formSchema.title().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Produit</tas-label>
            <tas-select [options]="data.productOptions" [formField]="formSchema.product"></tas-select>
            <tas-hint>Changer de produit peut changer le parcours : le projet se replace alors sur l'étape de même phase.</tas-hint>
          </tas-form-field>

          <tas-form-field>
            <tas-label>{{ data.amountLabel }}</tas-label>
            <input tasInput type="text" inputmode="numeric" [formField]="formSchema.amount" />
            @if (formSchema.amount().touched() && formSchema.amount().invalid()) {
              <tas-error>{{ formSchema.amount().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Besoin exprimé</tas-label>
            <textarea tasInput rows="5" [formField]="formSchema.description"></textarea>
            @if (formSchema.description().touched() && formSchema.description().invalid()) {
              <tas-error>{{ formSchema.description().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
            (click)="handleSubmit()"
          >
            Enregistrer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class EditProjectInfoDrawer implements AfterViewInit {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  public readonly data = inject<EditProjectInfoDrawerData>(DIALOG_DATA);

  public readonly model = signal(EditProjectInfoFormModel.from(this.data.project));
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.title, { message: 'Le titre est obligatoire' });
    maxLength(schema.title, 200, { message: '200 caractères au plus' });
    maxLength(schema.description, 2000, { message: '2 000 caractères au plus' });
    validate(schema.amount, (ctx) => {
      const amount = parseAmount(ctx.value());
      return amount !== null && (Number.isNaN(amount) || amount <= 0)
        ? { kind: 'amount', message: 'Saisissez un montant positif, en chiffres' }
        : null;
    });
  });

  public ngAfterViewInit(): void {
    if (this.data.focus === 'amount') {
      setTimeout(() => this._host.nativeElement.querySelector<HTMLInputElement>('input[inputmode="numeric"]')?.focus());
    }
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const amount = parseAmount(v.amount);
      const done = await this.data.save({
        title: v.title.trim(),
        product: v.product,
        description: v.description.trim(),
        ...(amount !== null
          ? { estimatedAmount: amount, estimatedCurrency: this.data.project.estimatedAmount?.currency ?? institutionCurrency() }
          : {}),
      });
      if (done) this._dialogRef.close(true);
      return undefined;
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
