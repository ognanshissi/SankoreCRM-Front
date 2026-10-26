import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { disabled, form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { ConnectionDetailDto, IntegrationApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import { integrationErrorMessage } from '../../data-access/integration-facade.service';

class InsurerMandatesFormModel {
  public hasCollectionMandate!: boolean;
  public collectionMandateReference!: string;
  public hasCoverNoteMandate!: boolean;
  public coverNoteMandateReference!: string;
  public hasCommissionNettingAgreement!: boolean;
  public commissionNettingReference!: string;

  public static fromDto(dto: ConnectionDetailDto | null): InsurerMandatesFormModel {
    const model = new InsurerMandatesFormModel();
    model.hasCollectionMandate = dto?.hasCollectionMandate ?? false;
    model.collectionMandateReference = dto?.collectionMandateReference ?? '';
    model.hasCoverNoteMandate = dto?.hasCoverNoteMandate ?? false;
    model.coverNoteMandateReference = dto?.coverNoteMandateReference ?? '';
    model.hasCommissionNettingAgreement = dto?.hasCommissionNettingAgreement ?? false;
    model.commissionNettingReference = dto?.commissionNettingReference ?? '';
    return model;
  }
}

function mandateErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error?.error as { code?: string; error?: string } | undefined;
  switch (body?.code ?? body?.error) {
    case 'INTEGRATION_MANDATE_REFERENCE_REQUIRED':
      return 'Un mandat accordé doit porter la référence du document qui l’accorde.';
    case 'INTEGRATION_MANDATE_NOT_INSURANCE':
      return 'Les mandats ne concernent que les connexions assurance.';
    default:
      return integrationErrorMessage(error, fallback);
  }
}

/**
 * Mandats que l'assureur confie à l'institution, sur une connexion assurance.
 *
 * Le mandat d'encaissement décide qui touche la prime : sans lui, ni le prélèvement ni
 * l'encaissement par l'agent ne sont permis, et le contrat attend la confirmation de
 * paiement de l'assureur. La compensation des commissions, accordée à part, décide si
 * l'institution peut retenir sa commission sur les primes qu'elle reverse.
 */
@Component({
  selector: 'insurer-mandates-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    FormField,
    FormRoot,
    TasCheckbox,
    TasError,
    TasFormField,
    TasHint,
    TasInput,
    TasLabel,
    TasTag,
  ],
  template: `
    <form [formRoot]="formSchema" class="flex flex-col gap-4">
      <!-- Mandat d'encaissement -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="flex items-center justify-between gap-3">
          <!-- Libellé hors de tas-checkbox : le composant tire son id de Date.now(), deux
               cases créées dans la même milliseconde partagent le même id et un clic sur
               le second libellé cocherait la première case. -->
          <div class="flex items-center gap-2">
            <tas-checkbox [formField]="formSchema.hasCollectionMandate"></tas-checkbox>
            <span class="text-sm font-medium text-slate-700">Mandat d'encaissement</span>
          </div>
          <tas-tag [severity]="formSchema.hasCollectionMandate().value() ? 'success' : 'neutral'">
            {{ formSchema.hasCollectionMandate().value() ? 'Accordé' : 'Non accordé' }}
          </tas-tag>
        </div>
        <p class="text-xs text-slate-500 mt-2">
          Sans ce mandat, la prime ne peut être ni prélevée ni encaissée par l'agent pour cet
          assureur : c'est l'assureur qui l'encaisse, et le contrat reste « En attente de
          paiement » jusqu'à ce qu'il confirme le paiement.
        </p>
        @if (formSchema.hasCollectionMandate().value()) {
          <tas-form-field class="mt-3 block">
            <tas-label>
              Référence du mandat <span class="text-functional-error">*</span>
            </tas-label>
            <input
              tasInput
              type="text"
              placeholder="ex : convention n° 2026-014"
              [formField]="formSchema.collectionMandateReference"
            />
            <tas-hint>La référence du document par lequel l'assureur accorde le mandat.</tas-hint>
            @if (
              formSchema.collectionMandateReference().touched() &&
              formSchema.collectionMandateReference().invalid()
            ) {
              <tas-error>{{ formSchema.collectionMandateReference().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        }
      </div>

      <!-- Mandat de note de couverture -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <tas-checkbox [formField]="formSchema.hasCoverNoteMandate"></tas-checkbox>
            <span class="text-sm font-medium text-slate-700">Mandat de note de couverture</span>
          </div>
          <tas-tag [severity]="formSchema.hasCoverNoteMandate().value() ? 'success' : 'neutral'">
            {{ formSchema.hasCoverNoteMandate().value() ? 'Accordé' : 'Non accordé' }}
          </tas-tag>
        </div>
        <p class="text-xs text-slate-500 mt-2">
          Le mandat est enregistré dès maintenant ; l'émission de la note de couverture
          elle-même viendra plus tard.
        </p>
        @if (formSchema.hasCoverNoteMandate().value()) {
          <tas-form-field class="mt-3 block">
            <tas-label>
              Référence du mandat <span class="text-functional-error">*</span>
            </tas-label>
            <input
              tasInput
              type="text"
              placeholder="ex : avenant n° 3"
              [formField]="formSchema.coverNoteMandateReference"
            />
            <tas-hint>La référence du document par lequel l'assureur accorde le mandat.</tas-hint>
            @if (
              formSchema.coverNoteMandateReference().touched() &&
              formSchema.coverNoteMandateReference().invalid()
            ) {
              <tas-error>{{ formSchema.coverNoteMandateReference().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        }
      </div>

      <!-- Compensation des commissions -->
      <div class="rounded-lg border border-slate-200 p-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <tas-checkbox [formField]="formSchema.hasCommissionNettingAgreement"></tas-checkbox>
            <span class="text-sm font-medium text-slate-700">Compensation des commissions</span>
          </div>
          <tas-tag
            [severity]="formSchema.hasCommissionNettingAgreement().value() ? 'success' : 'neutral'"
          >
            {{ formSchema.hasCommissionNettingAgreement().value() ? 'Accordée' : 'Non accordée' }}
          </tas-tag>
        </div>
        <p class="text-xs text-slate-500 mt-2">
          Avec l'accord exprès de l'assureur, l'institution peut déduire sa commission des
          primes qu'elle lui reverse. Sans cet accord, elle reverse l'intégralité des primes
          encaissées et l'assureur lui paie sa commission à part.
        </p>
        @if (formSchema.hasCommissionNettingAgreement().value()) {
          <tas-form-field class="mt-3 block">
            <tas-label>
              Référence de l'accord <span class="text-functional-error">*</span>
            </tas-label>
            <input
              tasInput
              type="text"
              placeholder="ex : lettre d'accord du 12/03/2026"
              [formField]="formSchema.commissionNettingReference"
            />
            <tas-hint>La référence du document par lequel l'assureur donne son accord.</tas-hint>
            @if (
              formSchema.commissionNettingReference().touched() &&
              formSchema.commissionNettingReference().invalid()
            ) {
              <tas-error>{{ formSchema.commissionNettingReference().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        }
      </div>

      @if (canManage()) {
        <div class="flex items-center justify-end">
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="handleSave()"
            [disabled]="
              !formSchema().dirty() || formSchema().invalid() || formSchema().submitting()
            "
            [isLoading]="formSchema().submitting()"
          >
            Enregistrer
          </button>
        </div>
      } @else {
        <p class="text-sm text-slate-500">
          La modification des mandats et de la compensation demande le droit de gestion des
          connexions.
        </p>
      }
    </form>
  `,
})
export class InsurerMandatesPanel {
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly connection = input<ConnectionDetailDto | null>(null);
  public readonly canManage = input(false);

  /** Mandats enregistrés : le parent relit la connexion (sa version a changé). */
  public readonly saved = output<void>();

  public readonly model = signal(InsurerMandatesFormModel.fromDto(null));

  public readonly formSchema = form(this.model, (schema) => {
    disabled(schema, () => !this.canManage());

    // Le serveur refuse un mandat accordé sans référence
    // (INTEGRATION_MANDATE_REFERENCE_REQUIRED) : on le dit avant l'envoi.
    validate(schema.collectionMandateReference, ({ value, valueOf }) =>
      valueOf(schema.hasCollectionMandate) && !(value() ?? '').trim()
        ? { kind: 'required', message: 'Indiquez la référence du mandat d’encaissement' }
        : null,
    );
    validate(schema.coverNoteMandateReference, ({ value, valueOf }) =>
      valueOf(schema.hasCoverNoteMandate) && !(value() ?? '').trim()
        ? { kind: 'required', message: 'Indiquez la référence du mandat de note de couverture' }
        : null,
    );
    validate(schema.commissionNettingReference, ({ value, valueOf }) =>
      valueOf(schema.hasCommissionNettingAgreement) && !(value() ?? '').trim()
        ? { kind: 'required', message: 'Indiquez la référence de l’accord de compensation' }
        : null,
    );
  });

  constructor() {
    // La connexion est relue par le parent après un test ou un enregistrement : on ne
    // repousse les mandats que s'ils n'ont pas été modifiés entre-temps.
    effect(() => {
      const dto = this.connection();
      untracked(() => {
        if (!this.formSchema().dirty()) {
          this.model.set(InsurerMandatesFormModel.fromDto(dto));
        }
      });
    });
  }

  public handleSave(): void {
    const connection = this.connection();
    const connectionId = connection?.id;
    if (!connectionId) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      // Mandats et compensation sont deux endpoints distincts : on n'appelle que celui
      // dont la partie a changé, pour ne pas journaliser une modification qui n'en est pas une.
      const mandatesChanged =
        value.hasCollectionMandate !== (connection.hasCollectionMandate ?? false) ||
        value.collectionMandateReference.trim() !== (connection.collectionMandateReference ?? '') ||
        value.hasCoverNoteMandate !== (connection.hasCoverNoteMandate ?? false) ||
        value.coverNoteMandateReference.trim() !== (connection.coverNoteMandateReference ?? '');
      const nettingChanged =
        value.hasCommissionNettingAgreement !== (connection.hasCommissionNettingAgreement ?? false) ||
        value.commissionNettingReference.trim() !== (connection.commissionNettingReference ?? '');

      let mandatesOk = !mandatesChanged;
      let nettingOk = !nettingChanged;

      if (mandatesChanged) {
        await firstValueFrom(
          this._api
            .setIntegrationConnectionMandates(connectionId, {
              hasCollectionMandate: value.hasCollectionMandate,
              // Une référence sans mandat ne veut rien dire : elle n'est pas envoyée.
              collectionMandateReference: value.hasCollectionMandate
                ? value.collectionMandateReference.trim()
                : null,
              hasCoverNoteMandate: value.hasCoverNoteMandate,
              coverNoteMandateReference: value.hasCoverNoteMandate
                ? value.coverNoteMandateReference.trim()
                : null,
            })
            .pipe(
              tap(() => (mandatesOk = true)),
              catchError((error: HttpErrorResponse) => {
                this._snackbar.error(
                  'Erreur',
                  mandateErrorMessage(error, "Les mandats n'ont pas pu être enregistrés."),
                );
                return EMPTY;
              }),
            ),
          { defaultValue: null },
        );
      }

      if (nettingChanged) {
        await firstValueFrom(
          this._api
            .setIntegrationConnectionCommissionNetting(connectionId, {
              agreed: value.hasCommissionNettingAgreement,
              reference: value.hasCommissionNettingAgreement
                ? value.commissionNettingReference.trim()
                : null,
            })
            .pipe(
              tap(() => (nettingOk = true)),
              catchError((error: HttpErrorResponse) => {
                this._snackbar.error(
                  'Erreur',
                  mandateErrorMessage(
                    error,
                    "L'accord de compensation des commissions n'a pas pu être enregistré.",
                  ),
                );
                return EMPTY;
              }),
            ),
          { defaultValue: null },
        );
      }

      if (!mandatesOk && !nettingOk) return;

      if (mandatesOk && nettingOk) {
        // Intact à nouveau, pour que la relecture de la connexion repousse ce que le
        // serveur a enregistré.
        this.formSchema().reset();
        this._snackbar.success('Enregistré', "Les mandats et la compensation de l'assureur sont à jour.");
      }
      // Échec partiel : le formulaire reste « modifié » pour que la saisie refusée ne soit
      // pas écrasée par la relecture ; la partie acceptée, relue, ne sera pas renvoyée.
      this.saved.emit();
    });
  }
}
