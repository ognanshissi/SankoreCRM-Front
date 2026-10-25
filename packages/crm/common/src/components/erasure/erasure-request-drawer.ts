import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, minLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import {
  CreateErasureRequestBodySubjectTypeEnum,
  ErasureEligibilityDto,
  ErasureRequestsApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { erasureBlockerLabel, erasureErrorMessage } from './erasure-labels';

export interface ErasureRequestDrawerData {
  subjectType: 'Lead' | 'Client';
  subjectId: string;
  /** Le nom affiché dans le tiroir — jamais envoyé au serveur, qui n'en garde pas. */
  label: string;
}

class ErasureRequestFormModel {
  public reason = '';
  public evidence = '';
}

/**
 * « Demander l'effacement » (purge de données, lot 3) : l'aperçu de ce qui se passera, puis le
 * motif et la preuve de la demande. Rien n'est effacé ici — une AUTRE personne décide.
 */
@Component({
  selector: 'erasure-request-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasIcon, TasSpinner, Button,
    FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>Demander l'effacement</tas-drawer-title>
      <tas-drawer-content>
        <p class="mb-4 text-sm text-slate-600">
          <span class="font-semibold text-slate-900">{{ data.label }}</span> demande que ses données soient effacées.
          Votre demande sera décidée par une autre personne (conformité).
        </p>

        @if (isLoading()) {
          <div class="flex justify-center py-6"><tas-spinner size="6" class="text-primary"></tas-spinner></div>
        } @else if (eligibility(); as e) {
          @if (e.eligible) {
            <div class="mb-5 flex gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900" role="status">
              <tas-icon iconName="feather:check-circle" class="mt-0.5 shrink-0" style="font-size:15px"></tas-icon>
              <p>À l'approbation, ses données seront <span class="font-semibold">effacées</span> dans tous les modules
                (fiche, échanges, appels, pièces KYC). C'est irréversible.</p>
            </div>
          } @else {
            <div class="mb-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
              <tas-icon iconName="feather:clock" class="mt-0.5 shrink-0" style="font-size:15px"></tas-icon>
              <div>
                <p>{{ blockerLabel(e.blocker) }}</p>
                <p class="mt-1">À l'approbation, la personne sera <span class="font-semibold">restreinte</span> — plus de
                  prospection ni de contact, données non consultables —
                  @if (e.eligibleFrom) {
                    puis effacée automatiquement le {{ formatDate(e.eligibleFrom) }}.
                  } @else {
                    puis effacée automatiquement au terme de la conservation légale qui suivra la clôture.
                  }
                </p>
              </div>
            </div>
          }
        }

        <form [formRoot]="formSchema" class="flex flex-col gap-4">
          <tas-form-field>
            <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="3" [formField]="formSchema.reason"
                      placeholder="Ex. : la personne ne souhaite plus être contactée et demande l'effacement de ses données."></textarea>
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Preuve de la demande <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" [formField]="formSchema.evidence"
                   placeholder="Ex. : courrier reçu le 20/10/2026, réf. EFF-0042" />
            @if (formSchema.evidence().touched() && formSchema.evidence().invalid()) {
              <tas-error>{{ formSchema.evidence().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Le motif et la preuve sont conservés après l'effacement : n'y écrivez pas le nom de la personne.</tas-hint>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" class="rounded-full" (click)="dialogRef.close(false)">Annuler</button>
          <button tas-raised-button color="primary" type="button" class="rounded-full"
                  [disabled]="isLoading() || !eligibility() || formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()"
                  (click)="handleSubmit()">Envoyer la demande</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ErasureRequestDrawer implements OnInit {
  protected readonly data = inject<ErasureRequestDrawerData>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(ErasureRequestsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly isLoading = signal(true);
  public readonly eligibility = signal<ErasureEligibilityDto | null>(null);
  public readonly blockerLabel = erasureBlockerLabel;

  public readonly model = signal(new ErasureRequestFormModel());
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    minLength(schema.reason, 5, { message: 'Précisez le motif' });
    maxLength(schema.reason, 500, { message: '500 caractères au plus' });
    required(schema.evidence, { message: 'La preuve de la demande est obligatoire' });
    minLength(schema.evidence, 5, { message: 'Précisez la preuve' });
    maxLength(schema.evidence, 500, { message: '500 caractères au plus' });
  });

  public ngOnInit(): void {
    this._api.getErasureEligibility(this.data.subjectType, this.data.subjectId).pipe(
      catchError((err: HttpErrorResponse) => {
        this.isLoading.set(false);
        this._snackbar.error('Effacement', erasureErrorMessage(err.error?.error, 'Impossible de vérifier cette personne.'));
        this.dialogRef.close(false);
        return EMPTY;
      }),
    ).subscribe((verdict) => {
      this.isLoading.set(false);
      if (verdict.alreadyErased) {
        this._snackbar.info('Effacement', 'Les données de cette personne ont déjà été effacées.');
        this.dialogRef.close(false);
        return;
      }
      this.eligibility.set(verdict);
    });
  }

  public formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const created = await firstValueFrom(
        this._api.createErasureRequest({
          subjectType: this.data.subjectType as CreateErasureRequestBodySubjectTypeEnum,
          subjectId: this.data.subjectId,
          reason: value.reason.trim(),
          evidence: value.evidence.trim(),
        }).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Effacement', erasureErrorMessage(err.error?.error, 'La demande n’a pas pu être enregistrée.'));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (created) {
        this._snackbar.success('Demande enregistrée', 'Elle sera décidée par une autre personne.');
        this.dialogRef.close(true);
      }
    });
  }
}
