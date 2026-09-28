import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { PermissionsService } from '@sankore/crm/common';
import {
  ClientsApiService,
  RevealSensitiveFieldRequestFieldEnum,
} from '@sankore/crm-api';
import { catchError, EMPTY } from 'rxjs';

/** Délai au bout duquel la valeur révélée est remasquée (US-M01-FE-04). */
const REMASK_DELAY_MS = 30_000;

/**
 * Affiche un champ sensible masqué et, si l'utilisateur a `customers:reveal_sensitive`,
 * permet de le révéler ponctuellement.
 *
 * La révélation est un appel serveur tracé (`POST /clients/{id}/reveal`) : elle n'est donc
 * jamais déclenchée au chargement, seulement sur action explicite. La valeur est remasquée
 * au bout de 30 secondes et à la destruction du composant — quitter la fiche suffit, ce qui
 * évite qu'une valeur reste lisible sur un poste partagé.
 */
@Component({
  selector: 'sensitive-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, TasSpinner],
  template: `
    <span class="inline-flex items-center gap-1.5">
      <span class="text-sm font-medium text-slate-800" [class.tabular-nums]="revealed()">
        {{ revealed() ?? maskedValue() ?? '—' }}
      </span>

      @if (canReveal() && maskedValue()) {
        @if (isRevealing()) {
          <tas-spinner size="3" class="text-primary"></tas-spinner>
        } @else {
          <button
            type="button"
            class="text-slate-400 hover:text-primary transition-colors"
            [attr.aria-label]="revealed() ? 'Masquer ' + fieldLabel() : 'Afficher ' + fieldLabel()"
            [title]="revealed() ? 'Masquer' : 'Afficher pendant 30 secondes'"
            (click)="toggle()"
          >
            <tas-icon
              [iconName]="revealed() ? 'feather:eye-off' : 'feather:eye'"
              style="font-size:13px"
            ></tas-icon>
          </button>
        }
      }
    </span>
  `,
})
export class SensitiveField implements OnDestroy {
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _permissions = inject(PermissionsService);

  public readonly canReveal = this._permissions.can('customers:reveal_sensitive');

  public readonly clientId = input.required<string>();
  public readonly field = input.required<RevealSensitiveFieldRequestFieldEnum>();
  /** Valeur masquée telle que la renvoie le DTO (`identityDocumentNumberMasked`, …). */
  public readonly maskedValue = input<string | null | undefined>(null);
  /** Nom du champ, utilisé pour l'étiquette accessible du bouton. */
  public readonly fieldLabel = input<string>('la valeur');
  /** Point de contact concerné, pour les champs `Phone`, `Email` et `PostalAddress`. */
  public readonly contactPointId = input<string | null | undefined>(null);

  public readonly revealed = signal<string | null>(null);
  public readonly isRevealing = signal(false);

  private _remaskTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this._destroyRef.onDestroy(() => this._clearTimer());
  }

  public ngOnDestroy(): void {
    this._clearTimer();
  }

  public toggle(): void {
    if (this.revealed()) {
      this._mask();
      return;
    }
    this._reveal();
  }

  private _reveal(): void {
    this.isRevealing.set(true);
    this._clientsApi
      .revealSensitiveField(this.clientId(), {
        field: this.field(),
        contactPointId: this.contactPointId() || null,
      })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', "Impossible d'afficher cette valeur.");
          this.isRevealing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.revealed.set(result?.value ?? null);
        this.isRevealing.set(false);
        this._clearTimer();
        this._remaskTimer = setTimeout(() => this._mask(), REMASK_DELAY_MS);
      });
  }

  private _mask(): void {
    this.revealed.set(null);
    this._clearTimer();
  }

  private _clearTimer(): void {
    if (this._remaskTimer) {
      clearTimeout(this._remaskTimer);
      this._remaskTimer = null;
    }
  }
}
