import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  apply,
  form,
  FormField,
  FormRoot,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, firstValueFrom, map, Observable, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import {
  ClientHouseholdApiService,
  LeadsApiService,
} from '@sankore/crm-api';
import { SPOUSE_UNION_OPTIONS } from './compliance-labels';
import {
  PersonIdentityFields,
  PersonIdentityModel,
  identityToDto,
  personIdentitySchema,
} from './person-identity';
import { PepFormModel, pepFormToStatus } from './pep-fieldset';
import { pepToDto } from './pep-wire';
import { HouseholdMemberView } from './household-view';

export interface HouseholdMemberDrawerData {
  /** `lead` écrit via `LeadsApiService`, `client` via `ClientHouseholdApiService`. */
  scope: 'lead' | 'client';
  /** Identifiant du lead ou du client porteur du foyer. */
  ownerId: string;
  /** `Spouse` ou `Child` à la création ; ignoré en modification. */
  memberType: 'Spouse' | 'Child';
  /** Membre à modifier, ou `null` pour une création. */
  member: HouseholdMemberView | null;
  /** Adresse du principal, affichée en lecture seule quand la case est cochée. */
  principalAddressLabel: string;
}

class HouseholdMemberFormModel {
  public identity!: PersonIdentityModel;
  public spouseUnionType!: string;
  public usesPrincipalAddress!: boolean;
  public pep!: PepFormModel;

  public static create(
    memberType: 'Spouse' | 'Child',
    member: HouseholdMemberView | null,
  ): HouseholdMemberFormModel {
    const m = new HouseholdMemberFormModel();
    m.identity = PersonIdentityModel.empty();
    m.spouseUnionType = member?.spouseUnionType ?? '';
    // « Même adresse que le principal » est cochée par défaut pour un enfant
    // (BNF-F-03) ; pour un conjoint, on part de ce que l'API dit du membre.
    m.usesPrincipalAddress = member
      ? member.usesPrincipalAddress
      : memberType === 'Child';
    m.pep = member ? PepFormModel.fromStatus(member.pep) : PepFormModel.empty();
    return m;
  }
}

/**
 * Création et modification d'un membre du foyer — conjoint ou enfant — partagé
 * par la fiche lead (BNF-F-03) et la fiche client (BNF-F-09).
 *
 * Le `scope` décide de l'API appelée, et c'est la seule différence entre les deux
 * côtés : les requêtes `Leads.*` et `Customers.*HouseholdMemberRequest` ont la
 * même forme au contrat. Dupliquer ce drawer d'un module à l'autre, c'est
 * dupliquer la règle « type d'union obligatoire pour un conjoint » et la case
 * « même adresse », qui divergeraient au premier correctif.
 *
 * Le statut PPE n'est saisi qu'à la création : en modification, `PUT .../members/{id}`
 * ne porte pas la PPE, qui a son propre endpoint — le drawer renvoie donc le
 * membre créé et laisse l'appelant ouvrir la saisie PPE s'il le souhaite.
 */
@Component({
  selector: 'household-member-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasSelect,
    TasCheckbox,
    PersonIdentityFields,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon [iconName]="titleIcon()" style="font-size:18px"></tas-icon>
          <span>{{ title() }}</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (submitError(); as message) {
          <div class="mb-4 p-3 rounded-lg border border-functional-error/40 bg-functional-error/5">
            <p class="text-sm text-functional-error">{{ message }}</p>
          </div>
        }

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <person-identity-fields
            [field]="formSchema.identity"
            [showAddress]="!formSchema.usesPrincipalAddress().value()"
          ></person-identity-fields>

          @if (isSpouse()) {
            <tas-form-field>
              <tas-label>Type d'union <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="unionOptions"
                placeholder="Choisissez le type d'union"
                [formField]="formSchema.spouseUnionType"
              ></tas-select>
              @if (formSchema.spouseUnionType().touched() && formSchema.spouseUnionType().invalid()) {
                <tas-error>{{ formSchema.spouseUnionType().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }

          <div class="rounded-lg border border-slate-200 p-3">
            <tas-checkbox [formField]="formSchema.usesPrincipalAddress">
              Même adresse que le principal
            </tas-checkbox>
            @if (formSchema.usesPrincipalAddress().value()) {
              <p class="text-xs text-slate-500 mt-2">{{ data.principalAddressLabel }}</p>
            }
          </div>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
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
            {{ isEdition() ? 'Enregistrer' : 'Ajouter' }}
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class HouseholdMemberDrawer {
  public readonly data: HouseholdMemberDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _clientHouseholdApi = inject(ClientHouseholdApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly unionOptions = SPOUSE_UNION_OPTIONS;
  public readonly submitError = signal<string | null>(null);

  public readonly isEdition = computed(() => this.data.member !== null);
  public readonly isSpouse = computed(
    () => (this.data.member?.type ?? this.data.memberType) === 'Spouse',
  );

  public readonly titleIcon = computed(() =>
    this.isSpouse() ? 'feather:heart' : 'feather:smile',
  );

  public readonly title = computed(() => {
    if (this.isEdition()) return 'Modifier le membre du foyer';
    return this.isSpouse() ? 'Ajouter le conjoint' : 'Ajouter un enfant';
  });

  public model = signal(
    HouseholdMemberFormModel.create(this.data.memberType, this.data.member),
  );

  public formSchema = form(this.model, (schema) => {
    apply(schema.identity, personIdentitySchema);
    // Obligatoire pour un conjoint seulement : un `required` inconditionnel
    // rendrait invalide le formulaire d'un enfant, qui n'a pas de type d'union.
    validate(schema.spouseUnionType, (ctx) => {
      const isSpouse = (this.data.member?.type ?? this.data.memberType) === 'Spouse';
      if (isSpouse && !ctx.value()) {
        return {
          kind: 'spouseUnionTypeRequired',
          message: "Le type d'union est obligatoire pour un conjoint",
        };
      }
      return null;
    });
  });

  constructor() {
    const member = this.data.member;
    if (member) {
      this.model.update(() => {
        const next = HouseholdMemberFormModel.create(this.data.memberType, member);
        next.identity = PersonIdentityModel.fromDto(member.identity);
        return next;
      });
    }
  }

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const identity = identityToDto(value.identity);
      const usesPrincipalAddress = value.usesPrincipalAddress;
      const spouseUnionType = this.isSpouse() ? value.spouseUnionType || null : null;

      // L'adresse du principal fait foi : envoyer en plus une adresse saisie
      // ferait divulguer un reste de formulaire que l'agent croit masqué.
      const identityPayload = usesPrincipalAddress
        ? { ...identity, addressLine: null, postalCode: null, city: null, countryCode: null }
        : identity;

      const request$ = this._buildRequest(identityPayload, spouseUnionType, usesPrincipalAddress, value.pep);

      // Sentinelle `'ok'` / `'ko'` plutôt que l'idiome `catchError(() => EMPTY)` du
      // repo : `firstValueFrom` d'un flux vide **rejette** avec `EmptyError`, et la
      // promesse rejetée dans le callback de `submit()` laisserait le formulaire en
      // état « soumission en cours » après une erreur serveur. Un 204 émet `null`,
      // qu'un test de vérité confondrait avec un échec — d'où la sentinelle.
      const outcome = await firstValueFrom(
        request$.pipe(
          map(() => 'ok' as const),
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Erreur', message);
            return of('ko' as const);
          }),
        ),
      );

      if (outcome === 'ok') {
        this._snackbar.success(
          this.isEdition() ? 'Membre modifié' : 'Membre ajouté',
          this.isEdition()
            ? 'Les informations du membre ont été enregistrées.'
            : 'Le membre a été ajouté au foyer.',
        );
        this._dialogRef.close(true);
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _buildRequest(
    identity: ReturnType<typeof identityToDto>,
    spouseUnionType: string | null,
    usesPrincipalAddress: boolean,
    pep: PepFormModel,
  ): Observable<unknown> {
    const member = this.data.member;
    if (this.data.scope === 'lead') {
      if (member) {
        return this._leadsApi.updateLeadHouseholdMember(this.data.ownerId, member.memberId, {
          identity,
          spouseUnionType,
          usesPrincipalAddress,
        });
      }
      return this._leadsApi.addLeadHouseholdMember(this.data.ownerId, {
        type: this.data.memberType,
        identity,
        spouseUnionType,
        usesPrincipalAddress,
        pep: pepToDto(pepFormToStatus(pep)),
      });
    }

    if (member) {
      return this._clientHouseholdApi.updateClientHouseholdMember(
        this.data.ownerId,
        member.memberId,
        { identity, spouseUnionType, usesPrincipalAddress },
      );
    }
    return this._clientHouseholdApi.addClientHouseholdMember(this.data.ownerId, {
      type: this.data.memberType,
      identity,
      spouseUnionType,
      usesPrincipalAddress,
      pep: pepToDto(pepFormToStatus(pep)),
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    switch (body?.code) {
      case 'HOUSEHOLD_SPOUSE_ALREADY_PRESENT':
        return 'Un conjoint actif existe déjà dans ce foyer.';
      case 'HOUSEHOLD_MAX_CHILDREN_REACHED':
        return "Le nombre maximal d'enfants autorisé par la ligne de produit est atteint.";
      case 'HOUSEHOLD_CHILD_MAX_AGE_EXCEEDED':
        return "Cet enfant dépasse l'âge maximal autorisé par la ligne de produit.";
      case 'HOUSEHOLD_DISABLED':
        return "La ligne de produit n'active pas le foyer.";
    }
    if (error.status === 403) {
      return "Vous n'avez pas le droit de modifier ce foyer.";
    }
    const firstValidation = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
    return firstValidation ?? body?.detail ?? body?.title ?? "Impossible d'enregistrer ce membre.";
  }
}

export default HouseholdMemberDrawer;
