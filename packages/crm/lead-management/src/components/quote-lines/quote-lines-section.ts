import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { OpportunitiesApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { quoteContext } from './quote-context';
import { QuoteLinesEditor } from './quote-lines-editor';
import { draftFromDto, draftToRequest, emptyLine, QuoteDraft, quoteErrorMessage } from './quote-lines.models';

/**
 * « Produits et prix » dans un tiroir de création de projet (devis en lignes, lot 4). Facultatif :
 * l'agent l'ouvre s'il chiffre l'offre dès la création. Avec des lignes, le tiroir n'envoie ni
 * produit ni montant tapés — le produit est celui de la première ligne, le montant le total HT —
 * et enregistre les lignes juste après la création (`saveAfterCreation`).
 */
@Component({
  selector: 'quote-lines-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon, QuoteLinesEditor],
  template: `
    <section class="flex flex-col gap-3 rounded-xl border border-slate-200 p-4" aria-labelledby="quote-lines-title">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="quote-lines-title" class="text-sm font-semibold text-slate-800">Produits et prix</h3>
          <p class="text-xs text-slate-500">Facultatif : plusieurs produits, avec quantité, prix et remise.</p>
        </div>
        @if (!open()) {
          <button tas-outlined-button color="primary" type="button" (click)="start()">
            <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon> Chiffrer avec des produits
          </button>
        } @else if (!hasLines()) {
          <button tas-text-button color="primary" type="button" (click)="open.set(false)">Ne pas chiffrer</button>
        }
      </div>
      @if (open()) {
        <quote-lines-editor [(draft)]="draft" [catalogue]="ctx.catalogue()" [rules]="ctx.rules()"></quote-lines-editor>
      }
    </section>
  `,
})
export class QuoteLinesSection {
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _snackbar = inject(SnackbarService);
  public readonly ctx = quoteContext();
  private readonly _editor = viewChild(QuoteLinesEditor);

  public readonly open = signal(false);
  public draft = signal<QuoteDraft>(draftFromDto(null));

  public readonly hasLines = computed(() => this.open() && this.draft().lines.length > 0);
  /** Le nom du produit de la première ligne : le produit du projet à créer. */
  public readonly firstProductName = computed(() => {
    const id = this.draft().lines[0]?.productId;
    return this.ctx.catalogue().find((p) => p.id === id)?.name ?? '';
  });
  public readonly invalid = computed(() => this.hasLines() && (this._editor()?.formSchema()?.invalid() ?? true));

  public start(): void {
    // Le brouillon reçoit sa première ligne directement : l'éditeur n'est pas encore affiché ici.
    this.draft.update((d) => (d.lines.length ? d : { ...d, lines: [emptyLine()] }));
    this.open.set(true);
  }

  /** Enregistre les lignes du projet tout juste créé. Faux, avec un message, si elles n'ont pas pu l'être. */
  public saveAfterCreation(projectId: string): Promise<boolean> {
    if (!this.hasLines()) return Promise.resolve(true);
    return firstValueFrom(
      this._api.setProjectQuote(projectId, draftToRequest(this.draft())).pipe(
        map(() => true),
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Projet créé sans ses lignes',
            `${quoteErrorMessage(err.error?.error)} Ajoutez-les depuis la page du projet.`,
          );
          return of(false);
        }),
      ),
    );
  }
}
