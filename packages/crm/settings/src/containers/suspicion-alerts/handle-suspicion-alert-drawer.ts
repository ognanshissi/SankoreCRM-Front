import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import {
  ComplianceApiService,
  HandleSuspicionAlertRequestStatusEnum,
  SuspicionAlertDto,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTag } from '@talisoft/ui/tag';
import { isSuspicionAlertClosed, suspicionAlertErrorMessage, suspicionAlertStatusMeta } from './suspicion-alert-labels';

export interface HandleSuspicionAlertDrawerData {
  alert: SuspicionAlertDto;
  raisedByName: string;
  handledByName: string | null;
}

const HANDLING_OPTIONS = [
  { label: 'Mettre en examen', value: HandleSuspicionAlertRequestStatusEnum.UnderReview },
  { label: 'Déclaration de soupçon à la CENTIF', value: HandleSuspicionAlertRequestStatusEnum.Declared },
  { label: 'Classer sans déclaration', value: HandleSuspicionAlertRequestStatusEnum.ClosedWithoutDeclaration },
];

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

class HandleSuspicionAlertFormModel {
  public status: string = HandleSuspicionAlertRequestStatusEnum.UnderReview;
  public declaredOn = '';
  public declarationReference = '';
  public notes = '';
}

/**
 * Le traitement d'une alerte par le responsable conformité : mise en examen, déclaration à la
 * CENTIF (date et référence obligatoires), ou classement sans déclaration (motif obligatoire).
 * Une alerte déclarée ou classée s'ouvre en lecture seule.
 */
@Component({
  selector: 'handle-suspicion-alert-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasDatePicker, TasIcon, TasTag, Button,
    FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>{{ isClosed ? 'Alerte LBC/FT' : 'Traiter l’alerte LBC/FT' }}</tas-drawer-title>
      <tas-drawer-content>
        <dl class="mb-5 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt class="text-slate-500">Client</dt>
          <dd class="font-semibold text-slate-900">
            {{ data.alert.clientName || '—' }}
            @if (data.alert.clientNumber) { <span class="font-normal text-slate-500 tabular-nums">· {{ data.alert.clientNumber }}</span> }
          </dd>
          <dt class="text-slate-500">Signalé par</dt>
          <dd class="text-slate-800">{{ data.raisedByName }}, le {{ formatDate(data.alert.raisedAt) }}</dd>
          <dt class="text-slate-500">Statut</dt>
          <dd><tas-tag [severity]="statusMeta.severity">{{ statusMeta.label }}</tas-tag></dd>
          <dt class="text-slate-500">Faits</dt>
          <dd class="text-slate-800 whitespace-pre-line">{{ data.alert.facts }}</dd>
          @if (data.alert.declarationReference) {
            <dt class="text-slate-500">Déclaration CENTIF</dt>
            <dd class="text-slate-800">Réf. {{ data.alert.declarationReference }}, le {{ formatDate(data.alert.declaredOn) }}</dd>
          }
          @if (data.alert.notes) {
            <dt class="text-slate-500">Notes</dt>
            <dd class="text-slate-800 whitespace-pre-line">{{ data.alert.notes }}</dd>
          }
          @if (data.handledByName) {
            <dt class="text-slate-500">Traité par</dt>
            <dd class="text-slate-800">{{ data.handledByName }}, le {{ formatDate(data.alert.handledAt) }}</dd>
          }
        </dl>

        <div class="mb-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
          <tas-icon iconName="feather:lock" class="mt-0.5 shrink-0" style="font-size:15px"></tas-icon>
          <p>La déclaration se fait auprès de la CENTIF, hors de la plateforme : consignez-en ici la date et la référence.
            N'informez jamais le client.</p>
        </div>

        @if (!isClosed) {
          <form [formRoot]="formSchema" class="flex flex-col gap-4">
            <tas-form-field>
              <tas-label>Décision <span class="text-functional-error">*</span></tas-label>
              <tas-select [options]="handlingOptions" [formField]="formSchema.status"></tas-select>
            </tas-form-field>

            @if (isDeclared()) {
              <div>
                <tas-date-picker mode="date" [max]="today" [formField]="formSchema.declaredOn">
                  Date de la déclaration <span class="text-functional-error">*</span>
                </tas-date-picker>
                @if (formSchema.declaredOn().touched() && formSchema.declaredOn().invalid()) {
                  <tas-error>{{ formSchema.declaredOn().errors()[0].message }}</tas-error>
                }
              </div>
              <tas-form-field>
                <tas-label>Référence de la déclaration <span class="text-functional-error">*</span></tas-label>
                <input tasInput type="text" placeholder="Référence attribuée par la CENTIF" [formField]="formSchema.declarationReference" />
                @if (formSchema.declarationReference().touched() && formSchema.declarationReference().invalid()) {
                  <tas-error>{{ formSchema.declarationReference().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
            }

            <tas-form-field>
              <tas-label>
                {{ isClosedWithoutDeclaration() ? 'Motif du classement' : 'Notes' }}
                @if (isClosedWithoutDeclaration()) { <span class="text-functional-error">*</span> }
              </tas-label>
              <textarea tasInput rows="4" [formField]="formSchema.notes"
                        [placeholder]="isClosedWithoutDeclaration() ? 'Pourquoi le soupçon n’est pas retenu.' : 'Facultatif'"></textarea>
              @if (formSchema.notes().touched() && formSchema.notes().invalid()) {
                <tas-error>{{ formSchema.notes().errors()[0].message }}</tas-error>
              } @else if (!isUnderReview()) {
                <tas-hint>Une déclaration ou un classement clôt l'alerte : elle ne pourra plus être modifiée.</tas-hint>
              }
            </tas-form-field>
          </form>
        }
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" class="rounded-full" (click)="dialogRef.close(false)">
            {{ isClosed ? 'Fermer' : 'Annuler' }}
          </button>
          @if (!isClosed) {
            <button tas-raised-button color="primary" type="button" class="rounded-full"
                    [disabled]="formSchema().invalid() || formSchema().submitting()"
                    [isLoading]="formSchema().submitting()"
                    (click)="handleSubmit()">Enregistrer</button>
          }
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class HandleSuspicionAlertDrawer {
  protected readonly data = inject<HandleSuspicionAlertDrawerData>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(ComplianceApiService);
  private readonly _snackbar = inject(SnackbarService);

  protected readonly isClosed = isSuspicionAlertClosed(this.data.alert.status);
  protected readonly statusMeta = suspicionAlertStatusMeta(this.data.alert.status);
  protected readonly handlingOptions = HANDLING_OPTIONS;
  protected readonly today = todayIso();

  public readonly model = signal(new HandleSuspicionAlertFormModel());
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.status, { message: 'Choisissez une décision' });
    validate(schema.declaredOn, (ctx) =>
      ctx.valueOf(schema.status) === HandleSuspicionAlertRequestStatusEnum.Declared && !ctx.value()
        ? { kind: 'required', message: 'La date de la déclaration est obligatoire' }
        : null,
    );
    validate(schema.declarationReference, (ctx) =>
      ctx.valueOf(schema.status) === HandleSuspicionAlertRequestStatusEnum.Declared && !ctx.value().trim()
        ? { kind: 'required', message: 'La référence de la déclaration est obligatoire' }
        : null,
    );
    maxLength(schema.declarationReference, 100, { message: '100 caractères au plus' });
    validate(schema.notes, (ctx) =>
      ctx.valueOf(schema.status) === HandleSuspicionAlertRequestStatusEnum.ClosedWithoutDeclaration && !ctx.value().trim()
        ? { kind: 'required', message: 'Le motif du classement est obligatoire' }
        : null,
    );
    maxLength(schema.notes, 4000, { message: '4000 caractères au plus' });
  });

  private readonly _status = computed(() => this.formSchema.status().value());
  public readonly isUnderReview = computed(() => this._status() === HandleSuspicionAlertRequestStatusEnum.UnderReview);
  public readonly isDeclared = computed(() => this._status() === HandleSuspicionAlertRequestStatusEnum.Declared);
  public readonly isClosedWithoutDeclaration = computed(
    () => this._status() === HandleSuspicionAlertRequestStatusEnum.ClosedWithoutDeclaration,
  );

  public formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    // `declaredOn` est une date seule : `new Date('2026-10-25')` la lirait en UTC et pourrait reculer d'un jour.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const status = value.status as HandleSuspicionAlertRequestStatusEnum;
      const declared = status === HandleSuspicionAlertRequestStatusEnum.Declared;

      const handled = await firstValueFrom(
        this._api.handleSuspicionAlert(this.data.alert.id!, {
          status,
          declaredOn: declared ? value.declaredOn.split('T')[0] : null,
          declarationReference: declared ? value.declarationReference.trim() : null,
          notes: value.notes.trim() || null,
        }).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Alerte LBC/FT', suspicionAlertErrorMessage(err.error?.error, 'Le traitement n’a pas pu être enregistré.'));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!handled) return;

      this._snackbar.success('Alerte mise à jour', HANDLING_OPTIONS.find((o) => o.value === status)?.label ?? '');
      this.dialogRef.close(true);
    });
  }
}
