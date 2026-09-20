import { Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { LeadsApiService, SystemCaptureLeadRequestSourceEnum } from '@sankore/crm-api';

const SOURCE_OPTIONS = [
  { label: 'Web',             value: SystemCaptureLeadRequestSourceEnum.Web },
  { label: 'Agent mobile',    value: SystemCaptureLeadRequestSourceEnum.MobileAgent },
  { label: 'Agence',          value: SystemCaptureLeadRequestSourceEnum.Agency },
  { label: 'Centre d\'appels', value: SystemCaptureLeadRequestSourceEnum.CallCenter },
  { label: 'WhatsApp',        value: SystemCaptureLeadRequestSourceEnum.WhatsApp },
  { label: 'Partenaire',      value: SystemCaptureLeadRequestSourceEnum.Partner },
  { label: 'Import',          value: SystemCaptureLeadRequestSourceEnum.FileImport },
  { label: 'Campagne',        value: SystemCaptureLeadRequestSourceEnum.Campaign },
];

@Component({
  selector: 'system-capture-drawer',
  imports: [
    FormsModule, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasIcon, TasSpinner, TasTag, Button, TasFormField, TasLabel, TasError, TasInput, TasSelect, TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Capture système</tas-title>
      </tas-drawer-title>
      <tas-drawer-content>
        <div class="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
          <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
          <div>
            <p class="text-xs font-medium text-amber-800">Outil administrateur</p>
            <p class="text-xs text-amber-700 mt-0.5">Simule une capture de lead provenant d'un système externe (API, webhook).</p>
          </div>
        </div>

        <div class="flex flex-col gap-3">
          <tas-form-field>
            <tas-label>Nom complet</tas-label>
            <input tasInput type="text" placeholder="Ex : Amadou Diallo" [ngModel]="fullName()" (ngModelChange)="fullName.set($event)" />
          </tas-form-field>
          <tas-form-field>
            <tas-label>Téléphone <span class="text-red-500">*</span></tas-label>
            <input tasInput type="text" placeholder="+221 77 123 45 67" [ngModel]="phone()" (ngModelChange)="phone.set($event)" />
          </tas-form-field>
          <tas-form-field>
            <tas-label>Email</tas-label>
            <input tasInput type="email" placeholder="email@example.com" [ngModel]="email()" (ngModelChange)="email.set($event)" />
          </tas-form-field>
          <tas-form-field>
            <tas-label>Source</tas-label>
            <tas-select [options]="sourceOptions" optionLabel="label" optionValue="value"
              placeholder="Sélectionnez" [ngModel]="source()" (ngModelChange)="source.set($event)"></tas-select>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Produit d'intérêt</tas-label>
            <input tasInput type="text" placeholder="Ex : Loan" [ngModel]="product()" (ngModelChange)="product.set($event)" />
          </tas-form-field>
        </div>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button" [disabled]="isSubmitting() || !phone().trim()" (click)="submit()">
            @if (isSubmitting()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
            Capturer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class SystemCaptureDrawer {
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly sourceOptions = SOURCE_OPTIONS;
  public fullName = signal('');
  public phone = signal('');
  public email = signal('');
  public source = signal('');
  public product = signal('');
  public isSubmitting = signal(false);

  public submit(): void {
    if (!this.phone().trim()) return;
    this.isSubmitting.set(true);
    this._leadsApi.systemCaptureLead({
      fullName: this.fullName() || null,
      phoneNumber: this.phone().trim(),
      email: this.email() || null,
      source: (this.source() as any) || undefined,
      interestedProduct: this.product() || null,
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Capture système échouée.'); this.isSubmitting.set(false); return EMPTY; }),
    ).subscribe((result) => {
      this._snackbar.success('Lead capturé', `Lead créé (ID : ${result.leadId}).`);
      this._dialogRef.close(true);
    });
  }

  public close(): void { this._dialogRef.close(false); }
}
