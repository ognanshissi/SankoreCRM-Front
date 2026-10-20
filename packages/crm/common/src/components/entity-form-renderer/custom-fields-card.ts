import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, finalize, Observable } from 'rxjs';
import { EntityFormDto, FormField as EntityFormField, FormsApiService } from '@sankore/crm-api';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EntityFormRenderer } from './entity-form-renderer';
import { explainFormError, formErrorDetail } from './entity-form-errors';
import { WireValue, WireValues } from './entity-form-values';

export type CustomFieldsEntity = 'Lead' | 'Client' | 'Product';



/**
 * Les champs personnalisés d'une fiche — lead, client ou produit — affichés, puis modifiés sur place
 * (formulaires dynamiques, lot 4). Les blocs natifs de la fiche restent ceux de l'écran ; cette carte
 * ne montre que ce que le tenant a ajouté, rangé dans ses sections.
 *
 * <p>Elle ne connaît pas l'endpoint de modification : l'hôte passe `save`, qui envoie le payload
 * (seulement ce qui a changé, `null` pour une valeur effacée) avec ce que son contrat exige à côté
 * — `expectedVersion` d'un client, les champs obligatoires du `PUT` d'un produit. Une fois
 * l'enregistrement réussi, la carte émet `saved` et l'hôte recharge sa fiche : ce qui s'affiche
 * ensuite est ce que le serveur a gardé.</p>
 *
 * <p>Rien ne s'affiche quand le tenant n'a aucun champ personnalisé pour cette entité.</p>
 */
@Component({
  selector: 'custom-fields-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasSpinner, Button, EntityFormRenderer],
  template: `
    @if (form(); as f) {
      @if (hasCustomFields()) {
        <tas-card class="block">
          <div class="p-4">
            <div class="flex items-center justify-between mb-3">
              <p class="text-xs font-semibold text-slate-400">{{ title() }}</p>
              @if (canEdit() && !editing()) {
                <button type="button" class="text-xs text-primary hover:underline flex items-center gap-1" (click)="startEdit()">
                  <tas-icon iconName="feather:edit-2" style="font-size:10px"></tas-icon>
                  Modifier
                </button>
              }
            </div>

            <entity-form-renderer
              [form]="f"
              mode="full"
              scope="custom"
              [values]="rendererValues()"
              [readonly]="!editing()"
              [maskedKeys]="masked()"
              [revealable]="!!revealFn()"
              (reveal)="revealValue($event)"
            ></entity-form-renderer>

            @if (!editing() && archivedValues().length > 0) {
              <div class="mt-4 pt-3 border-t border-slate-100">
                <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Champs archivés</p>
                <div class="grid grid-cols-2 gap-x-6 gap-y-2">
                  @for (a of archivedValues(); track a.key) {
                    <div>
                      <p class="text-xs text-slate-400">{{ a.label }}</p>
                      <p class="text-sm text-slate-600">{{ a.value }}</p>
                    </div>
                  }
                </div>
              </div>
            }

            @if (editing()) {
              <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
                <button tas-outlined-button type="button" (click)="cancel()" [disabled]="saving()">Annuler</button>
                <button tas-raised-button color="primary" type="button" (click)="submit()" [disabled]="saving()" [isLoading]="saving()">
                  Enregistrer
                </button>
              </div>
            }
          </div>
        </tas-card>
      }
    } @else if (loading()) {
      <div class="flex justify-center py-4"><tas-spinner size="5" class="text-primary"></tas-spinner></div>
    }
  `,
})
export class CustomFieldsCard {
  private readonly _formsApi = inject(FormsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly entity = input.required<CustomFieldsEntity>();
  /** `customFields` de la fiche, tel que le serveur l'a renvoyé. */
  public readonly values = input<Record<string, unknown> | null | undefined>(null);
  /** Les valeurs natives que les conditions lisent : `{ prospectType: 'Corporate' }`. */
  public readonly context = input<Record<string, string | null | undefined>>({});
  /** Les champs dont le serveur a retenu la valeur (`maskedCustomFieldKeys` d'un client). */
  public readonly maskedKeys = input<string[] | null | undefined>([]);
  public readonly canEdit = input(false);
  public readonly title = input('Informations complémentaires');
  public readonly save = input<((payload: Record<string, WireValue>) => Observable<unknown>) | null>(null);
  /** Rend la valeur en clair d'un champ masqué — un appel audité au serveur. */
  public readonly revealFn = input<((key: string) => Observable<string>) | null>(null);

  public readonly saved = output<void>();

  private readonly _renderer = viewChild(EntityFormRenderer);

  public readonly form = signal<EntityFormDto | null>(null);
  public readonly loading = signal(true);
  public readonly editing = signal(false);
  public readonly saving = signal(false);
  private readonly _revealed = signal<Record<string, WireValue>>({});
  /** Change à chaque annulation, pour que le moteur reparte des valeurs de la fiche. */
  private readonly _resetToken = signal(0);

  public readonly hasCustomFields = computed(() =>
    (this.form()?.fields ?? []).some((f) => !f.isNative && !f.isArchived && !f.isHidden),
  );

  public readonly masked = computed(() =>
    (this.maskedKeys() ?? []).filter((k) => !(k in this._revealed())),
  );

  public readonly rendererValues = computed<WireValues>(() => {
    this._resetToken();
    return {
      ...((this.values() ?? {}) as WireValues),
      ...(this.context() as WireValues),
      ...this._revealed(),
    };
  });

  public readonly archivedValues = computed(() => {
    const values = this.values() ?? {};
    return (this.form()?.fields ?? [])
      .filter((f) => !f.isNative && f.isArchived && values[f.key ?? ''] != null)
      .map((f) => ({ key: f.key ?? '', label: f.label ?? f.key ?? '', value: plain(f, values[f.key ?? '']) }));
  });

  constructor() {
    effect(() => this._load(this.entity()));
  }

  private _load(entity: CustomFieldsEntity): void {
    this.loading.set(true);
    this._formsApi
      .getEntityForm(entity)
      .pipe(
        // Sans mise en page, la fiche s'affiche sans cette carte plutôt qu'avec une erreur : ses
        // blocs natifs n'en dépendent pas.
        catchError(() => EMPTY),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((form) => this.form.set(form));
  }

  public startEdit(): void {
    this.editing.set(true);
  }

  public cancel(): void {
    this.editing.set(false);
    this._resetToken.update((n) => n + 1);
  }

  public submit(): void {
    const renderer = this._renderer();
    const save = this.save();
    if (!renderer || !save) return;

    if (!renderer.valid()) {
      renderer.markAllAsTouched();
      return;
    }

    const payload = renderer.customFieldsPayload();
    if (Object.keys(payload).length === 0) {
      this.editing.set(false);
      return;
    }

    this.saving.set(true);
    save(payload)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Enregistrement refusé', this._explain(err));
          return EMPTY;
        }),
        finalize(() => this.saving.set(false)),
      )
      .subscribe(() => {
        this.editing.set(false);
        this._snackbar.success('Enregistré', 'Les informations complémentaires sont à jour.');
        this.saved.emit();
      });
  }

  public revealValue(key: string): void {
    const reveal = this.revealFn();
    if (!reveal) return;
    reveal(key)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible d’afficher cette valeur.');
          return EMPTY;
        }),
      )
      .subscribe((value) => this._revealed.update((r) => ({ ...r, [key]: parseRevealed(value) })));
  }

  private _explain(err: HttpErrorResponse): string {
    const detail = formErrorDetail(err);
    return explainFormError(detail, this.form()) ?? (detail || 'Réessayez plus tard.');
  }

}

/**
 * La révélation rend du texte : la valeur elle-même pour un texte, son JSON pour un montant, un
 * nombre ou une liste. Relue ici pour que le moteur l'affiche avec son type ; un texte qui n'est pas
 * du JSON reste tel quel.
 */
function parseRevealed(value: string): WireValue {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed !== 'string' ? (parsed as WireValue) : value;
  } catch {
    return value;
  }
}

/** Une valeur archivée en texte : le moteur ne rend plus ces champs, la fiche les montre quand même. */
function plain(field: EntityFormField, value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => optionLabel(field, String(v))).join(', ');
  if (value && typeof value === 'object' && 'amount' in value) {
    const m = value as { amount: number; currency: string };
    return `${Number(m.amount).toLocaleString('fr-FR')} ${m.currency}`;
  }
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  return optionLabel(field, String(value));
}

function optionLabel(field: EntityFormField, value: string): string {
  return field.options?.find((o) => o.value === value)?.label ?? value;
}
