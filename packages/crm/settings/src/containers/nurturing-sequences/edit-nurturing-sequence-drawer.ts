import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { applyEach, form, FormField, FormRoot, maxLength, pattern, required, submit, validate } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { EmailTemplatesApiService, NurturingSequenceDto, NurturingSequencesApiService } from '@sankore/crm-api';
import { nurturingDelay, nurturingDelayDays } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';

class StepRow {
  public delayDays!: string;
  public templateKey!: string;

  public static instantiate(delayDays = '0', templateKey = ''): StepRow {
    const row = new StepRow();
    row.delayDays = delayDays;
    row.templateKey = templateKey;
    return row;
  }
}

class SequenceFormModel {
  public name!: string;
  public description!: string;
  public steps!: StepRow[];

  public static fromSequence(sequence: NurturingSequenceDto | null): SequenceFormModel {
    const model = new SequenceFormModel();
    model.name = sequence?.name ?? '';
    model.description = sequence?.description ?? '';
    model.steps = sequence?.steps?.length
      ? sequence.steps.map((s) => StepRow.instantiate(String(nurturingDelayDays(s.delayFromPrevious)), s.emailTemplateKey ?? ''))
      : [StepRow.instantiate()];
    return model;
  }
}

interface TemplateOption {
  label: string;
  value: string;
}

/** Ce que le serveur renvoie d'une ligne de `GET email-templates`, que le contrat ne décrit pas. */
interface EmailTemplateRow {
  templateKey?: string;
  subject?: string;
  isSystem?: boolean;
}

@Component({
  selector: 'edit-nurturing-sequence-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button, TasIcon, TasSpinner,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">{{ data ? 'Modifier la séquence' : 'Nouvelle séquence' }}</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          @if (enrolled > 0) {
            <div class="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <tas-icon iconName="feather:info" class="mt-0.5 shrink-0 text-blue-500" style="font-size:14px"></tas-icon>
              <p class="text-xs text-blue-700">
                {{ enrolled }} lead(s) suivent cette séquence. Ils gardent leur position : un lead qui a reçu deux e-mails
                recevra ensuite le troisième de la nouvelle liste.
              </p>
            </div>
          }

          <tas-form-field>
            <tas-label>Nom <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Ex. Relance des prospects après 3 mois" [formField]="formSchema.name" />
            @if (formSchema.name().touched() && formSchema.name().invalid()) {
              <tas-error>{{ formSchema.name().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Description</tas-label>
            <input tasInput type="text" placeholder="À quels prospects elle s'adresse" [formField]="formSchema.description" />
            @if (formSchema.description().touched() && formSchema.description().invalid()) {
              <tas-error>{{ formSchema.description().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <div>
            <p class="text-sm font-semibold text-slate-800">E-mails envoyés</p>
            <p class="mt-0.5 text-xs text-slate-500">
              L'objet et le contenu viennent du modèle d'e-mail, en français au moins. {{ variablesHint }}
            </p>
          </div>

          @if (isLoadingTemplates()) {
            <div class="flex justify-center py-6"><tas-spinner size="6" class="text-primary"></tas-spinner></div>
          } @else {
            @if (noTemplate()) {
              <div class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <tas-icon iconName="feather:alert-triangle" class="mt-0.5 shrink-0 text-amber-500" style="font-size:14px"></tas-icon>
                <div class="text-xs text-amber-800">
                  <p>Aucun modèle d'e-mail utilisable. Créez d'abord le modèle de chaque envoi.</p>
                  <button tas-text-button type="button" class="mt-1" (click)="goToTemplates()">Ouvrir les modèles d'e-mail</button>
                </div>
              </div>
            }

            @for (step of formSchema.steps; track $index; let i = $index, first = $first, last = $last) {
              <div class="rounded-lg border border-slate-200 p-3">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <p class="text-xs font-semibold text-slate-600">E-mail {{ i + 1 }}</p>
                  <div class="flex items-center gap-1">
                    <button tas-button iconButton type="button" [attr.aria-label]="'Monter l\\'e-mail ' + (i + 1)" [disabled]="first" (click)="move(i, -1)">
                      <tas-icon iconName="feather:arrow-up" style="font-size:14px"></tas-icon>
                    </button>
                    <button tas-button iconButton type="button" [attr.aria-label]="'Descendre l\\'e-mail ' + (i + 1)" [disabled]="last" (click)="move(i, 1)">
                      <tas-icon iconName="feather:arrow-down" style="font-size:14px"></tas-icon>
                    </button>
                    <button tas-button iconButton type="button" [attr.aria-label]="'Retirer l\\'e-mail ' + (i + 1)" [disabled]="model().steps.length === 1" (click)="remove(i)">
                      <tas-icon iconName="feather:trash-2" style="font-size:14px"></tas-icon>
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
                  <tas-form-field>
                    <tas-label>Modèle d'e-mail <span class="text-functional-error">*</span></tas-label>
                    <tas-select [options]="templateOptions()" placeholder="Choisissez un modèle" [formField]="step.templateKey"></tas-select>
                    @if (step.templateKey().touched() && step.templateKey().invalid()) {
                      <tas-error>{{ step.templateKey().errors()[0].message }}</tas-error>
                    }
                  </tas-form-field>
                  <tas-form-field>
                    <tas-label>Délai (jours)</tas-label>
                    <input tasInput type="text" inputmode="numeric" [formField]="step.delayDays" />
                    @if (step.delayDays().touched() && step.delayDays().invalid()) {
                      <tas-error>{{ step.delayDays().errors()[0].message }}</tas-error>
                    } @else {
                      <tas-hint>{{ first ? 'après l\\'inscription' : 'après le précédent' }}</tas-hint>
                    }
                  </tas-form-field>
                </div>
              </div>
            }

            <div>
              <button tas-outlined-button type="button" (click)="add()">
                <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
                Ajouter un e-mail
              </button>
            </div>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                  [disabled]="formSchema().invalid() || formSchema().submitting() || isLoadingTemplates()"
                  [isLoading]="formSchema().submitting()">{{ data ? 'Enregistrer' : 'Créer' }}</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class EditNurturingSequenceDrawer implements OnInit {
  public readonly data: NurturingSequenceDto | null = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(NurturingSequencesApiService);
  private readonly _templatesApi = inject(EmailTemplatesApiService);
  private readonly _router = inject(Router);
  private readonly _snackbar = inject(SnackbarService);

  public readonly enrolled = this.data?.activeEnrollments ?? 0;
  public readonly variablesHint = 'Le modèle peut utiliser {{ first_name }} (prénom) et {{ lead_name }} (nom complet).';

  public readonly isLoadingTemplates = signal(true);
  private readonly _templates = signal<TemplateOption[]>([]);

  /** Une étape peut nommer un modèle désactivé depuis : il reste affiché, le serveur le refusera. */
  public readonly templateOptions = computed<TemplateOption[]>(() => {
    const known = this._templates();
    const missing = [...new Set(this.model().steps.map((s) => s.templateKey))]
      .filter((key) => key && !known.some((o) => o.value === key))
      .map((key) => ({ label: `${key} (indisponible)`, value: key }));
    return [...known, ...missing];
  });
  public readonly noTemplate = computed(() => !this.isLoadingTemplates() && this._templates().length === 0);

  public readonly model = signal(SequenceFormModel.fromSequence(this.data));
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom est obligatoire' });
    maxLength(schema.name, 200, { message: '200 caractères au plus' });
    maxLength(schema.description, 1000, { message: '1000 caractères au plus' });
    applyEach(schema.steps, (step) => {
      required(step.templateKey, { message: 'Choisissez un modèle' });
      pattern(step.delayDays, /^\d{1,3}$/, { message: 'Un nombre de jours' });
      validate(step.delayDays, ({ value }) =>
        Number(value()) > 365 ? { kind: 'range', message: '365 jours au plus' } : null);
    });
  });

  public ngOnInit(): void {
    // Français seulement : c'est la langue sur laquelle l'envoi se replie. Les modèles système
    // (mot de passe, accueil client…) n'ont rien à faire dans une relance commerciale.
    this._templatesApi.apiV1EmailTemplatesGet(undefined, 'fr', true).pipe(
      map((rows) => (rows as unknown as EmailTemplateRow[] | null) ?? []),
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger les modèles d’e-mail.');
        this.isLoadingTemplates.set(false);
        return EMPTY;
      }),
    ).subscribe((rows) => {
      const byKey = new Map<string, TemplateOption>();
      for (const row of rows) {
        if (row.isSystem || !row.templateKey || byKey.has(row.templateKey)) continue;
        byKey.set(row.templateKey, { label: row.subject ? `${row.subject} — ${row.templateKey}` : row.templateKey, value: row.templateKey });
      }
      this._templates.set([...byKey.values()]);
      this.isLoadingTemplates.set(false);
    });
  }

  public add(): void {
    this.formSchema.steps().value.update((steps) => [...steps, StepRow.instantiate('7')]);
  }

  public remove(index: number): void {
    this.formSchema.steps().value.update((steps) => steps.filter((_, i) => i !== index));
  }

  public move(index: number, by: number): void {
    this.formSchema.steps().value.update((steps) => {
      const next = [...steps];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;
      const payload = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        steps: value.steps.map((step, order) => ({
          order,
          delayFromPrevious: nurturingDelay(Number(step.delayDays)),
          emailTemplateKey: step.templateKey,
        })),
      };
      const request = this.data
        ? this._api.updateNurturingSequence(this.data.id!, payload)
        : this._api.createNurturingSequence(payload);
      const saved = await firstValueFrom(
        request.pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Erreur', this._message(err));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (saved) this._dialogRef.close(true);
    });
  }

  public goToTemplates(): void {
    this._dialogRef.close(false);
    void this._router.navigate(['/settings/email-templates']);
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _message(err: HttpErrorResponse): string {
    if (err.error?.detail === 'NURTURING_TEMPLATE_NOT_FOUND') {
      return 'Un modèle choisi n’existe plus, ou n’a pas de version française active.';
    }
    const errors = err.error?.errors as Record<string, string[]> | undefined;
    return (errors && Object.values(errors)[0]?.[0]) || 'Impossible d’enregistrer la séquence.';
  }
}
