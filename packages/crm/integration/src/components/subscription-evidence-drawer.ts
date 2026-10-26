import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY } from 'rxjs';
import { EvidenceEventDto, IntegrationApiService } from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasSpinner } from '@talisoft/ui/spinner';
import { afterSaleErrorMessage } from './insurance-after-sale-labels';

export interface SubscriptionEvidenceDrawerData {
  holdingId: string;
  productLabel: string;
}

/**
 * Journal de preuves d'une souscription : chaque étape horodatée (fiche remise, signature,
 * consentement, paiement, envoi, réponses, émission, documents remis, demandes sur la police).
 *
 * Frise en HTML simple et non `tas-table` : liste courte, en lecture seule, dans un tiroir de
 * détail — la frise est le sujet, pas la pagination.
 */
@Component({
  selector: 'subscription-evidence-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasAlert, Button, TasSpinner, DatePipe],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Journal de preuves</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-4">
          <div>
            <p class="text-sm font-medium text-slate-800">{{ data.productLabel }}</p>
            <p class="mt-0.5 text-xs text-slate-500">
              Ce qui prouve la vente : chaque étape, reconstituée depuis les enregistrements eux-mêmes.
            </p>
          </div>

          @if (isLoading()) {
            <div class="flex justify-center py-12">
              <tas-spinner size="10" class="text-primary"></tas-spinner>
            </div>
          } @else if (loadError()) {
            <tas-alert type="error"><p class="text-sm">{{ loadError() }}</p></tas-alert>
          } @else if (events().length === 0) {
            <p class="py-6 text-center text-sm text-slate-500">Aucune étape enregistrée.</p>
          } @else {
            <ol class="relative ml-2 border-l border-slate-200">
              @for (event of events(); track $index) {
                <li class="mb-5 ml-4">
                  <span class="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-primary"></span>
                  <p class="text-xs text-slate-500 tabular-nums">{{ event.at | date: 'dd/MM/yyyy HH:mm' }}</p>
                  <p class="text-sm font-medium text-slate-800">{{ event.label || event.kind }}</p>
                  @if (event.detail) {
                    <p class="mt-0.5 text-xs text-slate-600">{{ event.detail }}</p>
                  }
                </li>
              }
            </ol>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-button type="button" (click)="close()">Fermer</button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class SubscriptionEvidenceDrawer implements OnInit {
  private readonly _dialogRef = inject<DialogRef<void>>(DialogRef);
  private readonly _api = inject(IntegrationApiService);

  public readonly data = inject<SubscriptionEvidenceDrawerData>(DIALOG_DATA);

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly events = signal<EvidenceEventDto[]>([]);

  public ngOnInit(): void {
    this._api
      .getInsuranceSubscriptionEvidence(this.data.holdingId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.loadError.set(afterSaleErrorMessage(err, "Le journal de preuves n'a pas pu être lu."));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((events) => {
        // Ordre chronologique : une preuve se lit de la remise de la fiche à l'émission.
        this.events.set([...events].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')));
        this.isLoading.set(false);
      });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
