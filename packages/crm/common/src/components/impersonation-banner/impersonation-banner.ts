import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { AuthenticationService } from '../../services';

/**
 * Bandeau permanent pendant une usurpation d'identité. Impossible à fermer : tant qu'il est là,
 * chaque action est faite avec les droits d'un autre, et il faut que ça se voie.
 */
@Component({
  selector: 'common-impersonation-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    @if (state(); as s) {
      <div class="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-2 bg-amber-500 text-amber-950 text-sm" role="status">
        <tas-icon iconName="feather:eye" style="font-size:15px"></tas-icon>
        <span>
          Vous agissez en tant que <strong>{{ s.targetName }}</strong>@if (actor()) { — connecté comme {{ actor() }} }.
          Chaque action est enregistrée à votre nom. Fin automatique à {{ endsAt() }}.
        </span>
        <button type="button" class="px-3 py-1 rounded-full bg-amber-950 text-white text-xs font-semibold hover:bg-amber-900" (click)="leave()">
          Revenir à mon compte
        </button>
      </div>
    }
  `,
})
export class ImpersonationBanner {
  private readonly _auth = inject(AuthenticationService);

  public readonly state = this._auth.impersonation;
  public readonly actor = computed(() => this._auth.connectedUser()?.impersonatorName ?? null);
  public readonly endsAt = computed(() => {
    const at = this.state()?.expiresAt;
    return at ? new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—';
  });

  public leave(): void {
    this._auth.endImpersonation();
  }
}
