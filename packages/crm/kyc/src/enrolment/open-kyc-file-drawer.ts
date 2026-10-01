import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, of, Subject, switchMap, tap } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { ClientSearchItemDto } from '@sankore/crm-api';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { TasTitle } from '@talisoft/ui/title';

/** Nombre minimal de caractères avant de lancer une recherche serveur. */
const MIN_SEARCH_LENGTH = 2;

/**
 * Statut KYC **de la fiche client** (vocabulaire M01), à ne pas confondre avec le statut du
 * dossier KYC du référentiel de ce module : « Validé » ici veut dire que la fiche est en règle,
 * pas que le dossier est au niveau « KYC complet ».
 *
 * Ces libellés sont dupliqués de `@sankore/crm/customers` à dessein : la lib clients importe déjà
 * le module KYC (onglet KYC de la fiche), et l'import inverse créerait un cycle entre les deux.
 */
const CUSTOMER_KYC_STATUS: Record<string, { label: string; severity: Severity }> = {
  NotStarted: { label: 'Non démarré', severity: 'neutral' },
  Pending: { label: 'En attente', severity: 'warning' },
  Validated: { label: 'Validé', severity: 'success' },
  Rejected: { label: 'Rejeté', severity: 'error' },
  Expired: { label: 'Expiré', severity: 'error' },
};

const CUSTOMER_TYPES: Record<string, string> = {
  Individual: 'Particulier',
  Legal: 'Personne morale',
};

/** Ligne de résultat, dérivée une fois à la réponse plutôt que recalculée par le template. */
interface CandidateRow {
  id: string;
  displayName: string;
  subtitle: string;
  kycLabel: string;
  kycSeverity: Severity;
}

/**
 * Choix du client à enrôler, pour le bouton « Ouvrir un dossier KYC » du tableau de bord.
 *
 * Le drawer ne crée rien : il **ne fait que retourner l'identifiant du client retenu**, et c'est
 * l'écran d'enrôlement qui ouvre le dossier. C'est voulu — `POST /kyc-files` est idempotent et
 * l'enrôlement l'appelle déjà à chaque entrée, donc créer ici doublerait l'appel et laisserait un
 * dossier ouvert derrière un agent qui aurait simplement fermé le drawer.
 *
 * Un client qui a déjà un dossier n'est pas masqué des résultats : l'enrôlement reprendra le
 * dossier existant. Son statut KYC est affiché pour que le choix soit éclairé.
 */
@Component({
  selector: 'kyc-open-file-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasFormField,
    TasLabel,
    TasHint,
    TasInput,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Ouvrir un dossier KYC</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-4">
          <p class="text-sm text-slate-500">
            Choisissez le client à enrôler. Le dossier est créé s'il n'en a pas
            encore, et repris là où il s'était arrêté sinon.
          </p>

          <tas-form-field>
            <tas-label>Rechercher un client</tas-label>
            <input
              tasInput
              type="text"
              placeholder="Nom, raison sociale…"
              aria-label="Rechercher un client à enrôler"
              [ngModel]="searchTerm()"
              (ngModelChange)="onSearchTermChange($event)"
            />
            <tas-hint
              >Tapez au moins deux caractères pour lancer la
              recherche.</tas-hint
            >
          </tas-form-field>

          @if (isSearching()) {
            <div class="flex justify-center py-6">
              <tas-spinner size="6" class="text-primary"></tas-spinner>
            </div>
          } @else if (results().length > 0) {
            <ul
              class="divide-y divide-slate-100 rounded-lg border border-slate-200"
            >
              @for (candidate of results(); track candidate.id) {
                <li>
                  <button
                    type="button"
                    class="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
                    (click)="selectCandidate(candidate)">
                    <span class="min-w-0">
                      <span class="block text-sm font-medium text-slate-700 truncate">
                        {{ candidate.displayName }}
                      </span>
                      <span class="block text-xs text-slate-500 truncate">
                        {{ candidate.subtitle }}
                      </span>
                    </span>
                    <span class="flex items-center gap-2 shrink-0">
                      <tas-tag [severity]="candidate.kycSeverity">{{
                        candidate.kycLabel
                      }}</tas-tag>
                      <tas-icon
                        iconName="feather:chevron-right"
                        class="text-slate-400"
                        style="font-size:14px"
                      ></tas-icon>
                    </span>
                  </button>
                </li>
              }
            </ul>
          } @else if (hasSearched()) {
            <p class="text-sm text-slate-500">
              Aucun client ne correspond à cette recherche. Vérifiez
              l'orthographe, ou créez la fiche client avant de l'enrôler.
            </p>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button
          tas-outlined-button
          color="primary"
          type="button"
          (click)="close()"
        >
          Annuler
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class KycOpenFileDrawer {
  private readonly _dialogRef = inject(DialogRef<string>);
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly searchTerm = signal('');
  public readonly results = signal<CandidateRow[]>([]);
  public readonly isSearching = signal(false);
  public readonly hasSearched = signal(false);

  private readonly _search$ = new Subject<string>();

  constructor() {
    // Barre de recherche : signaux + ngModel debouncés à 300 ms, comme partout ailleurs dans le
    // repo. Aucun champ à valider, aucune soumission — le clic sur un résultat EST la décision.
    this._search$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        tap((term) => {
          const isLongEnough = term.trim().length >= MIN_SEARCH_LENGTH;
          this.isSearching.set(isLongEnough);
          if (!isLongEnough) {
            this.results.set([]);
            this.hasSearched.set(false);
          }
        }),
        switchMap((term) => {
          if (term.trim().length < MIN_SEARCH_LENGTH) return of(null);
          return this._facade.searchCustomers(term.trim()).pipe(
            catchError(() => {
              this._snackbar.error(
                'Erreur',
                'La recherche de clients a échoué.',
              );
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((items) => {
        this.isSearching.set(false);
        if (!items) return;
        this.hasSearched.set(true);
        this.results.set(items.map((item) => this._toRow(item)));
      });
  }

  public onSearchTermChange(term: string): void {
    this.searchTerm.set(term);
    this._search$.next(term);
  }

  public selectCandidate(candidate: CandidateRow): void {
    this._dialogRef.close(candidate.id);
  }

  public close(): void {
    this._dialogRef.close(undefined);
  }

  private _toRow(item: ClientSearchItemDto): CandidateRow {
    const kyc = CUSTOMER_KYC_STATUS[item.kycStatus ?? ''] ?? {
      // Un statut inconnu est rendu tel quel plutôt qu'avalé : il se voit et se corrige.
      label: item.kycStatus || 'Statut inconnu',
      severity: 'neutral' as Severity,
    };
    return {
      id: item.id ?? '',
      displayName: item.displayName || '—',
      subtitle: [
        item.clientNumber,
        CUSTOMER_TYPES[item.clientType ?? ''] ?? item.clientType,
      ]
        .filter(Boolean)
        .join(' · '),
      kycLabel: kyc.label,
      kycSeverity: kyc.severity,
    };
  }
}
