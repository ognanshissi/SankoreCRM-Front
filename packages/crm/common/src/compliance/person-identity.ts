import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FieldTree,
  FormField,
  maxLength,
  required,
  schema,
} from '@angular/forms/signals';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasSelect } from '@talisoft/ui/select';
import { CustomersPersonIdentityDto, LeadsPersonIdentityDto } from '@sankore/crm-api';
import { GENDER_OPTIONS } from './compliance-labels';

/**
 * Identité d'une personne physique — principal, conjoint, enfant — telle qu'elle
 * est saisie sur la fiche lead comme sur la fiche client.
 *
 * Les champs sont des `string` et jamais `null` : les contrôles rendent du texte,
 * et la conversion vers le DTO (`''` → `null`) se fait à la soumission, par
 * `identityToDto`. `Leads.PersonIdentityDto` et `Customers.PersonIdentityDto` ont
 * exactement la même forme au contrat, d'où un seul modèle pour les deux côtés.
 */
export class PersonIdentityModel {
  public firstName!: string;
  public lastName!: string;
  public usageName!: string;
  public birthDate!: string;
  public gender!: string;
  public addressLine!: string;
  public postalCode!: string;
  public city!: string;
  public countryCode!: string;

  public static empty(): PersonIdentityModel {
    return PersonIdentityModel.fromDto(null);
  }

  public static fromDto(
    dto: LeadsPersonIdentityDto | CustomersPersonIdentityDto | null | undefined,
  ): PersonIdentityModel {
    const m = new PersonIdentityModel();
    m.firstName = dto?.firstName ?? '';
    m.lastName = dto?.lastName ?? '';
    m.usageName = dto?.usageName ?? '';
    // Le contrat déclare `format: date` : l'API renvoie `yyyy-MM-dd`, ce que le
    // sélecteur de date attend tel quel. On tronque quand même, parce qu'un
    // `date-time` renvoyé par erreur viderait le champ sans rien signaler.
    m.birthDate = (dto?.birthDate ?? '').slice(0, 10);
    m.gender = dto?.gender ?? '';
    m.addressLine = dto?.addressLine ?? '';
    m.postalCode = dto?.postalCode ?? '';
    m.city = dto?.city ?? '';
    m.countryCode = dto?.countryCode ?? '';
    return m;
  }
}

function orNull(value: string): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function identityToDto(model: PersonIdentityModel): LeadsPersonIdentityDto {
  return {
    firstName: orNull(model.firstName),
    lastName: orNull(model.lastName),
    usageName: orNull(model.usageName),
    birthDate: orNull(model.birthDate),
    gender: orNull(model.gender),
    addressLine: orNull(model.addressLine),
    postalCode: orNull(model.postalCode),
    city: orNull(model.city),
    countryCode: orNull(model.countryCode),
  };
}

export function identityLabel(
  dto: LeadsPersonIdentityDto | CustomersPersonIdentityDto | null | undefined,
): string {
  const parts = [dto?.firstName, dto?.lastName].filter((p) => !!p);
  return parts.length > 0 ? parts.join(' ') : 'Personne sans nom';
}

/**
 * Validation partagée, à appliquer sur le sous-arbre identité du formulaire
 * parent : `apply(formSchema.identity, personIdentitySchema)`. Nom et prénom
 * obligatoires ; le reste est facultatif côté front — c'est l'API qui dit, par la
 * jauge de complétude, ce qui manque réellement pour convertir.
 */
export const personIdentitySchema = schema<PersonIdentityModel>((path) => {
  required(path.lastName, { message: 'Le nom est obligatoire' });
  required(path.firstName, { message: 'Le prénom est obligatoire' });
  maxLength(path.lastName, 100, { message: 'Le nom ne peut pas dépasser 100 caractères' });
  maxLength(path.firstName, 100, { message: 'Le prénom ne peut pas dépasser 100 caractères' });
  maxLength(path.usageName, 100, { message: "Le nom d'usage ne peut pas dépasser 100 caractères" });
});

/**
 * Champs d'identité, sans carte ni bouton : le parent fournit le `FieldTree` et
 * décide de la mise en page autour. Partagé entre leads et clients pour tenir le
 * « réutilisation, aucune duplication » de BNF-F-09.
 *
 * L'adresse peut être masquée (`showAddress=false`) quand un enfant déclare vivre
 * à l'adresse du principal.
 */
@Component({
  selector: 'person-identity-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormField,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasDatePicker,
    TasSelect,
  ],
  template: `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <tas-form-field>
        <tas-label>Prénom <span class="text-functional-error">*</span></tas-label>
        <input tasInput type="text" placeholder="Prénom" [formField]="field().firstName" />
        @if (field().firstName().touched() && field().firstName().invalid()) {
          <tas-error>{{ field().firstName().errors()[0].message }}</tas-error>
        }
      </tas-form-field>

      <tas-form-field>
        <tas-label>Nom <span class="text-functional-error">*</span></tas-label>
        <input tasInput type="text" placeholder="Nom" [formField]="field().lastName" />
        @if (field().lastName().touched() && field().lastName().invalid()) {
          <tas-error>{{ field().lastName().errors()[0].message }}</tas-error>
        }
      </tas-form-field>

      <tas-form-field>
        <tas-label>Nom d'usage</tas-label>
        <input tasInput type="text" placeholder="Nom d'usage" [formField]="field().usageName" />
        @if (field().usageName().touched() && field().usageName().invalid()) {
          <tas-error>{{ field().usageName().errors()[0].message }}</tas-error>
        }
      </tas-form-field>

      <div>
        <tas-date-picker mode="date" [formField]="field().birthDate">Date de naissance</tas-date-picker>
        @if (field().birthDate().touched() && field().birthDate().invalid()) {
          <tas-error>{{ field().birthDate().errors()[0].message }}</tas-error>
        }
      </div>

      <tas-form-field>
        <tas-label>Genre</tas-label>
        <tas-select
          [options]="genderOptions"
          placeholder="Non précisé"
          [formField]="field().gender"
        ></tas-select>
      </tas-form-field>

      @if (showAddress()) {
        <tas-form-field class="sm:col-span-2">
          <tas-label>Adresse</tas-label>
          <input tasInput type="text" placeholder="Numéro et rue" [formField]="field().addressLine" />
        </tas-form-field>

        <tas-form-field>
          <tas-label>Code postal</tas-label>
          <input tasInput type="text" placeholder="Code postal" [formField]="field().postalCode" />
        </tas-form-field>

        <tas-form-field>
          <tas-label>Ville</tas-label>
          <input tasInput type="text" placeholder="Ville" [formField]="field().city" />
        </tas-form-field>

        <tas-form-field>
          <tas-label>Pays</tas-label>
          <input tasInput type="text" placeholder="Code pays (ex. CI)" [formField]="field().countryCode" />
          <tas-hint>Code pays sur deux lettres.</tas-hint>
        </tas-form-field>
      }
    </div>
  `,
})
export class PersonIdentityFields {
  public readonly field = input.required<FieldTree<PersonIdentityModel>>();
  public readonly showAddress = input(true);

  public readonly genderOptions = [{ label: 'Non précisé', value: '' }, ...GENDER_OPTIONS];
}
