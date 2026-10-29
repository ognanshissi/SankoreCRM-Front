import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { WebhookEventTypeDto, WebhooksApiService, WebhookSubscriptionDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';
import { webhookErrorMessage } from './webhook-labels';

export interface WebhookDrawerData {
  /** Absent : création. */
  subscription?: WebhookSubscriptionDto | null;
}

class WebhookFormModel {
  public name!: string;
  public url!: string;
  public description!: string;
  public events!: string[];

  public static instantiate(s?: WebhookSubscriptionDto | null): WebhookFormModel {
    const m = new WebhookFormModel();
    m.name = s?.name ?? '';
    m.url = s?.url ?? 'https://';
    m.description = s?.description ?? '';
    m.events = [...(s?.events ?? [])];
    return m;
  }
}

interface EventFamily {
  name: string;
  events: WebhookEventTypeDto[];
}

/**
 * Création et modification d’un webhook sortant. À la création, le serveur renvoie le secret de
 * signature UNE seule fois : le tiroir bascule alors sur un écran qui l’affiche et ne se ferme
 * qu’à la demande, pour qu’on ne le perde pas d’un clic à côté.
 */
@Component({
  selector: 'webhook-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot, FormField, Button, TasError, TasFormField, TasHint, TasLabel, TasIcon, TasInput, TasSpinner, TasTitle,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>{{ createdSecret() ? 'Secret de signature' : isEdit ? 'Modifier le webhook' : 'Nouveau webhook' }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (createdSecret(); as secret) {
          <div class="flex flex-col gap-4">
            <div class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
              Copiez ce secret maintenant et remettez-le à votre partenaire : il ne sera plus jamais affiché.
              S’il est perdu, il faudra en générer un nouveau.
            </div>
            <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <code class="min-w-0 flex-1 break-all font-mono text-sm text-slate-800">{{ secret }}</code>
              <button tas-outlined-button type="button" (click)="copy(secret)">
                <tas-icon iconName="feather:copy" style="font-size:12px"></tas-icon>
                Copier
              </button>
            </div>
            <p class="text-xs text-slate-500">
              Chaque envoi porte l’en-tête <code class="font-mono">X-Sankore-Signature</code> : un HMAC-SHA256 du corps,
              calculé avec ce secret. La documentation des webhooks explique comment le vérifier.
            </p>
          </div>
        } @else if (isLoading()) {
          <div class="flex justify-center py-12"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
        } @else {
          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <!-- En tête et non sous la liste des événements : en bas, le refus du serveur tombait
                 sous 25 cases à cocher et passait inaperçu après « Créer le webhook ». -->
            @if (serverError()) {
              <p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{{ serverError() }}</p>
            }

            <tas-form-field>
              <tas-label>Nom <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" placeholder="ex. Outil marketing" [formField]="formSchema.name" />
              @if (formSchema.name().touched() && formSchema.name().invalid()) {
                <tas-error>{{ formSchema.name().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>Adresse de réception <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="url" placeholder="https://partenaire.example.com/webhooks/sankore" [formField]="formSchema.url" />
              <tas-hint>HTTPS uniquement, port 443 ou 8443. Les adresses du réseau interne sont refusées.</tas-hint>
              @if (formSchema.url().touched() && formSchema.url().invalid()) {
                <tas-error>{{ formSchema.url().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>Description</tas-label>
              <input tasInput type="text" placeholder="À quoi sert ce webhook, qui le maintient" [formField]="formSchema.description" />
            </tas-form-field>

            <div class="flex flex-col gap-3">
              <div class="flex items-baseline justify-between">
                <span class="text-sm font-medium text-slate-700">Événements envoyés <span class="text-functional-error">*</span></span>
                <span class="text-xs text-slate-400 tabular-nums">{{ model().events.length }} sélectionné(s)</span>
              </div>
              <p class="-mt-2 text-xs text-slate-500">
                Aucune donnée personnelle n’est transmise : identifiants, statuts, montants et dates seulement.
              </p>

              @for (family of families(); track family.name) {
                <div class="rounded-lg border border-slate-200">
                  <div class="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <span class="text-sm font-semibold text-slate-700">{{ family.name }}</span>
                    <button tas-text-button color="primary" type="button" class="text-xs" (click)="toggleFamily(family)">
                      {{ allChecked(family) ? 'Tout décocher' : 'Tout cocher' }}
                    </button>
                  </div>
                  <div class="flex flex-col divide-y divide-slate-100">
                    @for (e of family.events; track e.code) {
                      <label class="flex items-start gap-3 px-3 py-2" [class.opacity-50]="!e.available">
                        <input
                          type="checkbox"
                          class="mt-0.5 h-4 w-4 accent-primary"
                          [checked]="model().events.includes(e.code!)"
                          [disabled]="!e.available"
                          (change)="toggle(e.code!, $any($event.target).checked)" />
                        <span class="min-w-0">
                          <span class="block text-sm text-slate-800">{{ e.label }} <code class="ml-1 font-mono text-xs text-slate-400">{{ e.code }}</code></span>
                          <span class="block text-xs text-slate-500">{{ e.description }}</span>
                        </span>
                      </label>
                    }
                  </div>
                </div>
              }

              @if (submitted() && formSchema.events().invalid()) {
                <p class="text-xs text-functional-error">{{ formSchema.events().errors()[0].message }}</p>
              }
            </div>

          </form>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex w-full justify-end gap-2">
          @if (createdSecret()) {
            <button tas-raised-button color="primary" type="button" (click)="close(createdId())">J’ai copié le secret</button>
          } @else {
            <button tas-outlined-button type="button" (click)="close(null)">Annuler</button>
            <button tas-raised-button color="primary" type="button"
                    [disabled]="formSchema().submitting() || isLoading()"
                    [isLoading]="formSchema().submitting()"
                    (click)="save()">
              {{ isEdit ? 'Enregistrer' : 'Créer le webhook' }}
            </button>
          }
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class WebhookDrawer implements OnInit {
  private readonly _data: WebhookDrawerData = inject(DIALOG_DATA, { optional: true }) ?? {};
  private readonly _dialogRef = inject(DialogRef<string | null>);
  private readonly _api = inject(WebhooksApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly isEdit = !!this._data.subscription?.id;

  public readonly isLoading = signal(true);
  public readonly eventTypes = signal<WebhookEventTypeDto[]>([]);
  public readonly submitted = signal(false);
  public readonly serverError = signal<string | null>(null);
  public readonly createdSecret = signal<string | null>(null);
  public readonly createdId = signal<string | null>(null);

  public readonly families = computed<EventFamily[]>(() => {
    const byFamily = new Map<string, WebhookEventTypeDto[]>();
    for (const e of this.eventTypes()) {
      const name = e.family ?? 'Autres';
      byFamily.set(name, [...(byFamily.get(name) ?? []), e]);
    }
    return [...byFamily].map(([name, events]) => ({ name, events }));
  });

  public model = signal(WebhookFormModel.instantiate(this._data.subscription));

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom est obligatoire' });
    required(schema.url, { message: 'L’adresse est obligatoire' });
    validate(schema.url, (ctx) =>
      /^https:\/\/[^\s/]+/i.test(ctx.value().trim())
        ? null
        : { kind: 'pattern', message: 'Une adresse HTTPS complète, par exemple https://partenaire.example.com/webhooks' });
    validate(schema.events, (ctx) =>
      ctx.value().length > 0 ? null : { kind: 'required', message: 'Choisissez au moins un événement' });
  });

  ngOnInit(): void {
    this._api.listWebhookEventTypes().pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger la liste des événements.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((types) => {
      this.eventTypes.set(types ?? []);
      this.isLoading.set(false);
    });
  }

  public toggle(code: string, checked: boolean): void {
    this.model.update((m) => ({
      ...m,
      events: checked ? [...m.events.filter((e) => e !== code), code] : m.events.filter((e) => e !== code),
    }));
  }

  public allChecked(family: EventFamily): boolean {
    return family.events.filter((e) => e.available).every((e) => this.model().events.includes(e.code!));
  }

  public toggleFamily(family: EventFamily): void {
    const codes = family.events.filter((e) => e.available).map((e) => e.code!);
    const check = !this.allChecked(family);
    this.model.update((m) => ({
      ...m,
      events: check ? [...new Set([...m.events, ...codes])] : m.events.filter((e) => !codes.includes(e)),
    }));
  }

  public save(): void {
    this.submitted.set(true);
    this.serverError.set(null);

    submit(this.formSchema, async () => {
      const m = this.model();
      const request = {
        name: m.name.trim(),
        url: m.url.trim(),
        description: m.description.trim() || null,
        // Dans l’ordre du catalogue, quel que soit l’ordre des clics : la fiche se relit mieux.
        events: this.eventTypes().map((e) => e.code!).filter((c) => m.events.includes(c)),
      };

      const fail = (err: HttpErrorResponse) => {
        this.serverError.set(webhookErrorMessage(err, 'Le webhook n’a pas pu être enregistré.'));
        return EMPTY;
      };

      if (this.isEdit) {
        const saved = await firstValueFrom(
          this._api.updateWebhookSubscription(this._data.subscription!.id!, request).pipe(catchError(fail)),
          { defaultValue: null },
        );
        if (!saved) return;
        this._snackbar.success('Enregistré', 'Le webhook a été mis à jour.');
        this.close(saved.id ?? null);
        return;
      }

      const created = await firstValueFrom(
        this._api.createWebhookSubscription(request).pipe(catchError(fail)),
        { defaultValue: null },
      );
      if (!created) return;
      this.createdId.set(created.subscription?.id ?? null);
      this.createdSecret.set(created.secret ?? null);
      this._snackbar.success('Webhook créé', 'Copiez le secret de signature avant de fermer.');
    });
  }

  public copy(value: string): void {
    navigator.clipboard.writeText(value).then(() =>
      this._snackbar.success('Copié', 'Le secret a été copié dans le presse-papiers.'));
  }

  public close(id: string | null): void {
    this._dialogRef.close(id);
  }
}
