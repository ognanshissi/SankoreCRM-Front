import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { FormField, form, required, submit, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';

/**
 * Les trois actes qui portent un texte. L'accusé de réception n'en est pas : il ne
 * demande rien à l'agent, donc il se déclenche depuis la liste et pas depuis un drawer.
 */
export type ComplaintAction = 'escalate' | 'resolve' | 'close';

export interface ComplaintActionDrawerData {
  complaintId: string;
  reference: string;
  subject: string;
  action: ComplaintAction;
}

class ComplaintActionFormModel {
  public text!: string;
  public wasUpheld!: boolean;

  public static instantiate(): ComplaintActionFormModel {
    const m = new ComplaintActionFormModel();
    m.text = '';
    // Par défaut NON fondée, délibérément : cocher « fondée » est une reconnaissance par
    // l'institution, et elle doit être un geste et non un défaut qu'on oublie de retirer.
    m.wasUpheld = false;
    return m;
  }
}

/**
 * Escalader, répondre ou clôturer une réclamation.
 *
 * **Un drawer pour les trois**, comme le serveur n'a qu'une commande pour les quatre
 * actes : ils ne diffèrent que par le texte qu'ils portent et par l'issue. Trois
 * drawers seraient trois endroits où oublier que la réponse est obligatoire.
 *
 * Deux choses que l'écran dit parce que le serveur les impose :
 *
 * - une RÉPONSE est obligatoire même pour une réclamation jugée non fondée
 *   (« nous avons examiné et rejeté » sans motif est exactement ce que le mécanisme
 *   existe pour empêcher) ;
 * - une CLÔTURE n'est pas une réponse. Le rapport les compte séparément, parce que
 *   compter un retrait comme traité surévaluerait le mécanisme.
 */
@Component({
  // Pas de `selector` : ce drawer s'ouvre par `SideDrawerService.open()` et n'est jamais
  // posé comme balise dans un gabarit. Un sélecteur serait une métadonnée morte — et
  // celle que la règle de lint du dépôt refuse.
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasAlert,
    Button,
    TasCheckbox,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">{{ title() }}</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-4">
          <div>
            <p class="font-mono text-xs text-slate-500">{{ data.reference }}</p>
            <p class="mt-1 text-sm text-slate-800">{{ data.subject }}</p>
          </div>

          @if (data.action === 'escalate') {
            <tas-alert type="info">
              <p class="text-xs">
                L'escalade ne clôt rien : l'institution doit toujours une réponse au client
                et le délai continue de courir pendant l'instruction.
              </p>
            </tas-alert>
          }

          @if (data.action === 'close') {
            <tas-alert type="info">
              <p class="text-xs">
                Une clôture n'est pas une réponse : elle sert au retrait du client ou à une
                demande hors périmètre, et le rapport la compte à part.
              </p>
            </tas-alert>
          }

          <tas-form-field>
            <tas-label>{{ fieldLabel() }} <span class="text-functional-error">*</span></tas-label>
            @if (data.action === 'escalate') {
              <input tasInput type="text" [formField]="formSchema.text" />
            } @else {
              <textarea tasInput rows="6" [formField]="formSchema.text"></textarea>
            }
            <tas-hint>{{ fieldHint() }}</tas-hint>
            @if (formSchema.text().touched() && formSchema.text().invalid()) {
              <tas-error>{{ formSchema.text().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          @if (data.action === 'resolve') {
            <tas-checkbox [formField]="formSchema.wasUpheld">
              La réclamation est fondée
            </tas-checkbox>
            <p class="-mt-2 text-xs text-slate-500">
              « Combien en avons-nous reconnues » est la question sur laquelle le mécanisme
              est jugé : elle est comptée séparément du statut.
            </p>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-button type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="isSaving()"
          (click)="handleSubmit()"
        >
          {{ submitLabel() }}
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ComplaintActionDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _integration = inject(IntegrationFacadeService);

  public readonly data = inject<ComplaintActionDrawerData>(DIALOG_DATA);

  public readonly isSaving = signal(false);

  public readonly model = signal(ComplaintActionFormModel.instantiate());

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.text, { message: 'Ce champ est obligatoire' });
    validate(schema.text, ({ value }) => {
      const text = (value() ?? '').trim();
      if (!text) return null;

      // Vingt caractères sur une réponse ou un motif, comme la description d'un
      // sinistre : le serveur refuse le vide, et « non » tout seul est la réponse que
      // ce mécanisme existe pour empêcher.
      if (this.data.action === 'escalate') return null;

      return text.length >= 20
        ? null
        : { kind: 'tooShort', message: 'Motivez en 20 caractères au moins' };
    });
  });

  public readonly title = computed(() => {
    switch (this.data.action) {
      case 'escalate':
        return 'Escalader la réclamation';
      case 'resolve':
        return 'Répondre à la réclamation';
      default:
        return 'Clôturer sans réponse';
    }
  });

  public readonly fieldLabel = computed(() => {
    switch (this.data.action) {
      case 'escalate':
        return 'Transmise à';
      case 'resolve':
        return 'Réponse au client';
      default:
        return 'Motif de la clôture';
    }
  });

  public readonly fieldHint = computed(() => {
    switch (this.data.action) {
      case 'escalate':
        return "L'assureur, ou la Direction Nationale des Assurances.";
      case 'resolve':
        return 'Obligatoire même si la réclamation est jugée non fondée : c’est le texte qu’un superviseur demande à voir.';
      default:
        return 'Par exemple : le client a retiré sa réclamation après explication au guichet.';
    }
  });

  public readonly submitLabel = computed(() => {
    switch (this.data.action) {
      case 'escalate':
        return 'Escalader';
      case 'resolve':
        return 'Envoyer la réponse';
      default:
        return 'Clôturer';
    }
  });

  public handleSubmit(): void {
    submit(this.formSchema, async () => {
      const value = this.model();
      const text = value.text.trim();

      this.isSaving.set(true);

      try {
        switch (this.data.action) {
          case 'escalate':
            await firstValueFrom(
              this._integration.escalateComplaint(this.data.complaintId, { escalatedTo: text }),
            );
            this._snackbar.success(
              'Réclamation escaladée',
              'La réponse au client reste due, et son délai continue de courir.',
            );
            break;

          case 'resolve':
            await firstValueFrom(
              this._integration.resolveComplaint(this.data.complaintId, {
                resolution: text,
                wasUpheld: value.wasUpheld,
              }),
            );
            this._snackbar.success(
              'Réponse enregistrée',
              value.wasUpheld
                ? 'Réclamation reconnue fondée.'
                : 'Réclamation jugée non fondée, avec son motif.',
            );
            break;

          default:
            await firstValueFrom(
              this._integration.closeComplaint(this.data.complaintId, { reason: text }),
            );
            this._snackbar.success(
              'Réclamation clôturée',
              "Elle n'est pas comptée comme répondue dans le rapport.",
            );
            break;
        }

        this._dialogRef.close(true);
      } catch (error) {
        this._snackbar.error(
          'Action impossible',
          integrationErrorMessage(error as HttpErrorResponse, "L'action n'a pas pu être enregistrée."),
        );
      } finally {
        this.isSaving.set(false);
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
