import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasTag } from '@talisoft/ui/tag';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import {
  ClientHouseholdApiService,
  RemoveHouseholdMemberResult,
} from '@sankore/crm-api';
import { HouseholdMemberView } from '@sankore/crm/common';

export interface RemoveHouseholdMemberDrawerData {
  clientId: string;
  /** Membre à retirer, désignations déjà rapprochées par l'onglet Foyer. */
  member: HouseholdMemberView;
}

class RemoveHouseholdMemberFormModel {
  public reason!: string;

  public static instantiate(): RemoveHouseholdMemberFormModel {
    const m = new RemoveHouseholdMemberFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * Retrait motivé d'un membre du foyer client (BNF-F-09).
 *
 * L'avertissement est affiché **avant** l'appel, à partir des désignations déjà
 * connues du membre : la réponse du serveur ne donne qu'un compte
 * (`designationsToReview`), ce qui arriverait trop tard pour que l'agent décide.
 * L'écart entre les deux est rendu au retour par l'onglet, qui annonce le compte
 * réellement basculé.
 *
 * Le retrait est logique : la ligne est conservée et le motif reste lisible dans
 * l'historique du foyer — d'où le motif obligatoire.
 */
@Component({
  selector: 'remove-household-member-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:user-minus" style="font-size:18px"></tas-icon>
          <span>Retirer {{ member.displayName }} du foyer</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (submitError(); as message) {
          <div class="mb-4 p-3 rounded-lg border border-functional-error/40 bg-functional-error/5">
            <p class="text-sm text-functional-error">{{ message }}</p>
          </div>
        }

        <div class="flex flex-col gap-5">
          <div class="rounded-lg border border-slate-200 p-3">
            <p class="text-sm font-medium text-slate-800">{{ member.displayName }}</p>
            <p class="text-xs text-slate-500 mt-0.5">
              {{ member.typeLabel }}@if (member.unionLabel) { — {{ member.unionLabel }} }
              @if (member.age !== null) { · {{ member.age }} ans }
            </p>
            @if (member.fromLead) {
              <p class="text-xs text-slate-500 mt-2">Membre repris du lead à la conversion.</p>
            }
          </div>

          <!-- Avertissement : ce que le retrait va faire basculer -->
          @if (designations().length > 0) {
            <div
              class="rounded-lg border border-amber-300 bg-amber-50 p-3"
              role="alert"
            >
              <div class="flex items-start gap-2">
                <tas-icon
                  iconName="feather:alert-triangle"
                  class="text-amber-600 mt-0.5"
                  style="font-size:16px"
                ></tas-icon>
                <div class="min-w-0">
                  <p class="text-sm font-medium text-amber-900">
                    {{ designations().length }}
                    {{
                      designations().length > 1
                        ? 'désignations connues passeront'
                        : 'désignation connue passera'
                    }}
                    « À revoir »
                  </p>
                  <p class="text-xs text-amber-800 mt-0.5">
                    Rien n'est supprimé : les clauses bénéficiaires concernées restent en
                    place et devront être revues produit par produit.
                  </p>
                  <ul class="mt-2 flex flex-col gap-1">
                    @for (d of designations(); track d.holdingId + d.roleLabel) {
                      <li class="text-xs text-amber-900 flex items-center gap-1.5 flex-wrap">
                        <span class="font-medium">{{ d.productLabel }}</span>
                        <span>— {{ d.roleLabel }}</span>
                        <tas-tag severity="neutral">{{ d.statusLabel }}</tas-tag>
                      </li>
                    }
                  </ul>
                </div>
              </div>
            </div>
          } @else {
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p class="text-sm text-slate-700">
                Aucune désignation connue sur ce membre.
              </p>
              <p class="text-xs text-slate-500 mt-0.5">
                Le serveur signalera malgré tout toute désignation qu'il ferait basculer.
              </p>
            </div>
          }

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>
                Motif du retrait <span class="text-functional-error">*</span>
              </tas-label>
              <textarea
                tasInput
                rows="3"
                placeholder="Expliquez pourquoi ce membre quitte le foyer (divorce, décès, enfant majeur, erreur de saisie…)"
                [formField]="formSchema.reason"
              ></textarea>
              @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
                <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
              }
              <tas-hint>Ce motif est conservé dans l'historique du foyer.</tas-hint>
            </tas-form-field>
          </form>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">
            Annuler
          </button>
          <button
            tas-raised-button
            color="warn"
            type="button"
            (click)="handleSubmit()"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
          >
            Retirer du foyer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RemoveHouseholdMemberDrawer {
  private readonly _data: RemoveHouseholdMemberDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<RemoveHouseholdMemberResult | null>);
  private readonly _householdApi = inject(ClientHouseholdApiService);

  public readonly member = this._data.member;
  public readonly submitError = signal<string | null>(null);

  /**
   * Toutes les désignations connues du membre, statut compris : le front ne trie
   * pas lesquelles basculeront. `HouseholdDesignationView` ne porte que le libellé
   * du statut, et comparer un libellé pour deviner la règle serait un calcul
   * métier côté front — c'est le serveur qui tranche, et son compte est annoncé au
   * retour.
   */
  public readonly designations = computed(() => this.member.designations);

  public model = signal(RemoveHouseholdMemberFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif du retrait est obligatoire' });
  });

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const reason = field().value().reason.trim();

      const result = await firstValueFrom(
        this._householdApi
          .removeClientHouseholdMember(this._data.clientId, this.member.memberId, { reason })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this.submitError.set(this._errorMessage(error));
              return EMPTY;
            }),
          ),
      );

      if (result !== undefined) {
        this._dialogRef.close(result);
      }
    });
  }

  public close(): void {
    this._dialogRef.close(null);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    switch (body?.code) {
      case 'HOUSEHOLD_MEMBER_NOT_FOUND':
        return "Ce membre n'appartient plus au foyer : rechargez l'onglet.";
      case 'HOUSEHOLD_MEMBER_ALREADY_REMOVED':
        return 'Ce membre a déjà été retiré du foyer.';
      case 'REASON_REQUIRED':
        return 'Le serveur exige un motif de retrait.';
    }
    if (error.status === 403) {
      return "Vous n'avez pas le droit de modifier ce foyer.";
    }
    const firstValidation = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
    return (
      firstValidation ?? body?.detail ?? body?.title ?? 'Impossible de retirer ce membre du foyer.'
    );
  }
}

export default RemoveHouseholdMemberDrawer;
