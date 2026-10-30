import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, of } from 'rxjs';
import { AuthApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { PERMISSIONS, TEST_MODE_REFRESH_PERMISSIONS } from '../../models/permissions';
import { AuthenticationService } from '../../services';
import { PermissionsService } from '../../services/permissions.service';

const ERRORS: Record<string, string> = {
  TEST_MODE_FORBIDDEN: 'Le mode test est réservé aux administrateurs.',
  TEST_MODE_IMPERSONATING: 'Le mode test n’est pas disponible pendant une usurpation.',
  TEST_MODE_UNAVAILABLE: 'Le mode test n’a pas pu être préparé. Réessayez dans un instant.',
  TEST_MODE_SESSION_INVALID: 'Votre session a expiré : reconnectez-vous.',
};

/**
 * La bascule entre la production et le « Mode test » (bac à sable à la Stripe) : même compte, une
 * copie d'essai des données et du paramétrage. Après la bascule l'application repart de l'accueil,
 * parce que ce qui était affiché — et ce que les écrans gardent en mémoire — appartient à l'autre mode.
 */
@Injectable({ providedIn: 'root' })
export class TestModeSwitcher {
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _canUse = inject(PermissionsService).can(PERMISSIONS.TENANT_TEST_MODE);

  public readonly on = this._auth.testMode;
  /** Qui a le droit d'entrer en mode test — ou y est déjà —, hors usurpation. */
  public readonly available = computed(() => (this.on() || this._canUse()) && !this._auth.impersonation());

  public readonly switching = signal(false);

  public switch(test: boolean): void {
    if (this.switching()) return;
    this.switching.set(true);
    this._auth
      .switchTestMode(test)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.switching.set(false);
          const code = typeof err.error?.detail === 'string' ? err.error.detail : '';
          this._snackbar.error('Bascule impossible', ERRORS[code] ?? 'Le mode n’a pas pu être changé.');
          return EMPTY;
        }),
      )
      .subscribe(() => window.location.assign('/'));
  }
}

/** L'interrupteur de l'en-tête, pour qui a le droit d'entrer en mode test — ou y est déjà. */
@Component({
  selector: 'common-test-mode-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    @if (visible()) {
      <button
        type="button"
        role="switch"
        [attr.aria-checked]="on()"
        [disabled]="switcher.switching()"
        class="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 sm:flex"
        [class]="on() ? 'border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100' : 'border-slate-200 text-slate-600 hover:border-slate-300'"
        [title]="on() ? 'Revenir aux données de production' : 'Essayer sur une copie des données et du paramétrage'"
        (click)="switcher.switch(!on())"
      >
        @if (switcher.switching()) {
          <tas-icon iconName="feather:loader" class="animate-spin" style="font-size:13px"></tas-icon>
        }
        Mode test
        <span class="relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors" [class]="on() ? 'bg-orange-500' : 'bg-slate-300'" aria-hidden="true">
          <span class="absolute top-0.5 size-3 rounded-full bg-white shadow transition-all" [class]="on() ? 'left-3.5' : 'left-0.5'"></span>
        </span>
      </button>
    }
  `,
})
export class TestModeToggle {
  public readonly switcher = inject(TestModeSwitcher);
  public readonly on = this.switcher.on;
  public readonly visible = this.switcher.available;
}

class RefreshFormModel {
  public wipeData = false;
}

/**
 * « Repartir de la production » : le mode test reprend la configuration de production (produits,
 * workflows, gabarits, sources, webhooks), en tâche de fond, et peut d'abord être vidé de ses
 * données d'essai. Les clés et secrets restent ceux du mode test ; l'utilisateur est prévenu par la cloche.
 */
@Component({
  selector: 'common-test-mode-refresh-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCheckbox, TasIcon],
  template: `
    <form [formRoot]="formSchema" class="block w-[480px] max-w-[calc(100vw-32px)] rounded-2xl bg-white p-6 shadow-2xl">
      <div class="mb-3 flex items-start justify-between gap-4">
        <h2 class="text-lg font-semibold text-slate-900">Repartir de la production</h2>
        <button type="button" class="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Fermer" (click)="close()">
          <tas-icon iconName="feather:x" style="font-size:18px"></tas-icon>
        </button>
      </div>
      <p class="text-sm text-slate-600">
        Le mode test reprend la configuration de production : produits, workflows, gabarits de projet, sources de
        leads et webhooks. Ce qui porte le même nom ou le même code est remplacé ; ce qui n’existe qu’ici est gardé.
        Les clés et les secrets restent ceux du mode test, et les webhooks repris arrivent désactivés.
      </p>
      <tas-checkbox class="mt-4 block" [formField]="formSchema.wipeData">
        <span class="text-sm text-slate-700">Vider aussi les données d’essai (leads, clients, projets, tâches…)</span>
      </tas-checkbox>
      <p class="mt-3 text-xs text-slate-500">Cela prend quelques instants : vous serez prévenu par la cloche.</p>
      <div class="mt-6 flex justify-end gap-2">
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="primary" type="button"
                [disabled]="formSchema().submitting()" [isLoading]="formSchema().submitting()" (click)="start()">
          Repartir de la production
        </button>
      </div>
    </form>
  `,
})
export class TestModeRefreshDialog {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _api = inject(AuthApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly model = signal(new RefreshFormModel());
  public readonly formSchema = form(this.model);

  public start(): void {
    submit(this.formSchema, async () => {
      const ok = await firstValueFrom(
        this._api.refreshTestMode({ wipeData: this.model().wipeData }).pipe(
          map(() => true),
          catchError(() => of(false)),
        ),
      );
      if (!ok) {
        this._snackbar.error('Non lancé', 'Le rafraîchissement du mode test n’a pas pu être lancé.');
        return;
      }
      this._snackbar.success('Rafraîchissement lancé', 'Vous serez prévenu par la cloche quand il sera terminé.');
      this._dialogRef.close();
    });
  }

  public close(): void {
    this._dialogRef.close();
  }
}

/** Le bandeau orange, permanent, tant que la session est en mode test. */
@Component({
  selector: 'common-test-mode-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    @if (on()) {
      <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-orange-500 px-4 py-2 text-sm text-white" role="status">
        <tas-icon iconName="feather:tool" style="font-size:15px"></tas-icon>
        <span>
          <strong>Mode test</strong> — données et paramétrage d’essai, séparés de la production. Les messages ne partent
          qu’aux utilisateurs de l’institution ; l’équipe et l’institution se modifient en production.
        </span>
        @if (canRefresh()) {
          <button type="button" class="rounded-full px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/60 hover:bg-orange-600"
                  (click)="refresh()">
            Repartir de la production
          </button>
        }
        <button type="button" class="rounded-full bg-white px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-60"
                [disabled]="switcher.switching()" (click)="switcher.switch(false)">
          Quitter le mode test
        </button>
      </div>
    }
  `,
})
export class TestModeBanner {
  private readonly _dialog = inject(Dialog);

  public readonly switcher = inject(TestModeSwitcher);
  public readonly on = inject(AuthenticationService).testMode;
  public readonly canRefresh = inject(PermissionsService).canAll(...TEST_MODE_REFRESH_PERMISSIONS);

  public constructor() {
    // L'onglet du navigateur le dit aussi : deux onglets, l'un en test, l'autre en production, ne
    // doivent pas se confondre dans la barre des onglets.
    const original = document.title;
    effect(() => (document.title = this.on() ? `[Test] ${original}` : original));
    inject(DestroyRef).onDestroy(() => (document.title = original));
  }

  public refresh(): void {
    this._dialog.open(TestModeRefreshDialog);
  }
}
