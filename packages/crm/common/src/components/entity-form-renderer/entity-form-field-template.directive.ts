import { Directive, inject, input, TemplateRef } from '@angular/core';
import { FieldTree } from '@angular/forms/signals';
import { FormField as EntityFormField } from '@sankore/crm-api';
import { FieldEntry } from './entity-form-values';

export interface EntityFormFieldTemplateContext {
  /** La ligne du formulaire : `entry.text`, `entry.flag`, `entry.list`, `entry.currency`. */
  $implicit: FieldTree<FieldEntry>;
  field: EntityFormField;
  error: string | null;
}

/**
 * Remplace le rendu d'un champ par celui de l'écran hôte, sans renoncer au reste du formulaire :
 *
 * ```html
 * <entity-form-renderer [form]="form()" mode="quick">
 *   <ng-template entityFormField="phoneNumber" let-entry let-field="field" let-error="error">
 *     <tas-input-phone [formField]="entry.text" />
 *   </ng-template>
 * </entity-form-renderer>
 * ```
 *
 * C'est la porte prévue pour les champs natifs qu'un composant générique rend mal — un téléphone
 * avec son indicatif, un produit qui déclenche une recherche de client existant — et qui restent
 * placés, libellés et conditionnés par la mise en page du tenant.
 */
@Directive({ selector: 'ng-template[entityFormField]' })
export class EntityFormFieldTemplate {
  public readonly key = input.required<string>({ alias: 'entityFormField' });
  public readonly template = inject<TemplateRef<EntityFormFieldTemplateContext>>(TemplateRef);

  public static ngTemplateContextGuard(
    _dir: EntityFormFieldTemplate,
    ctx: unknown,
  ): ctx is EntityFormFieldTemplateContext {
    return true;
  }
}
