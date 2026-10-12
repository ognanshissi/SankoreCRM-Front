import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import {
  DecideKycApprovalRequestDecisionEnum,
  DecideKycApprovalRequestLevelEnum,
} from '@sankore/crm-api';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { KYC_COMPLEMENT_REASONS, kycApprovalLevelLabel } from '../data-access/kyc-referential';

export type KycDecisionAction = 'approve' | 'complement' | 'reject';

export interface KycApprovalDecisionDrawerData {
  kycFileId: string;
  /** Le niveau en attente au moment du clic : c'est lui, et lui seul, que le serveur accepte. */
  level: DecideKycApprovalRequestLevelEnum;
  action: KycDecisionAction;
  /** Vrai si ce niveau est le dernier : une approbation valide alors le dossier. */
  isFinalLevel: boolean;
}

class DecisionFormModel {
  public reason!: string;
  public comment!: string;

  public static instantiate(): DecisionFormModel {
    const m = new DecisionFormModel();
    m.reason = '';
    m.comment = '';
    return m;
  }
}

const DECISION_BY_ACTION: Record<KycDecisionAction, DecideKycApprovalRequestDecisionEnum> = {
  approve: DecideKycApprovalRequestDecisionEnum.Approved,
  complement: DecideKycApprovalRequestDecisionEnum.ComplementRequired,
  reject: DecideKycApprovalRequestDecisionEnum.Rejected,
};

const TITLES: Record<KycDecisionAction, string> = {
  approve: 'Approuver ce niveau',
  complement: 'Demander un complément',
  reject: 'Rejeter le dossier',
};

/**
 * Décision sur le niveau en attente du circuit (`POST /kyc-files/{id}/approval/decisions`).
 *
 * Le niveau envoyé est celui que le circuit attend, pas un niveau déduit des rôles de
 * l'utilisateur : le serveur n'exige que `kyc:approve` et le bon ordre. L'ancienne déduction par
 * libellé de rôle (« manager », « conformité »…) masquait les actions à des valideurs légitimes
 * dont le rôle ne contenait aucun de ces mots.
 *
 * Les quatre yeux restent du ressort du serveur : aucun DTO ne dit qui a soumis le dossier, un 403
 * est donc expliqué plutôt qu'anticipé.
 */
@Component({
  selector: 'kyc-approval-decision-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    Button,
    TasError,
    TasFormField,
    TasHint,
    TasLabel,
    TasInput,
    TasSelect,
    TasTitle,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>{{ title }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <p class="text-sm text-slate-600 mb-4">
          Vous décidez au niveau <span class="font-medium text-slate-800">{{ levelLabel }}</span>.
          @if (data.action === 'approve') {
            {{ data.isFinalLevel ? 'C’est le dernier niveau : votre approbation valide le dossier KYC du client.' : 'Le dossier passera au niveau suivant du circuit.' }}
          } @else {
            Cette décision ferme le circuit et elle est définitive.
          }
        </p>

        <form [formRoot]="formSchema" class="flex flex-col gap-4">
          @if (data.action === 'complement') {
            <tas-form-field>
              <tas-label>Point à compléter <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="complementReasons"
                placeholder="Choisissez le point à corriger"
                [formField]="formSchema.reason"
              ></tas-select>
              @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
                <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }

          <tas-form-field>
            <tas-label>
              Commentaire
              @if (data.action !== 'approve') { <span class="text-functional-error">*</span> }
            </tas-label>
            <textarea tasInput rows="3" [formField]="formSchema.comment"
              [placeholder]="data.action === 'approve' ? 'Facultatif' : 'Expliquez votre décision à l’agent'"></textarea>
            <tas-hint>Ce commentaire est lu par l'agent qui reprend le dossier.</tas-hint>
            @if (formSchema.comment().touched() && formSchema.comment().invalid()) {
              <tas-error>{{ formSchema.comment().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center gap-3 w-full">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            [color]="data.action === 'approve' ? 'primary' : 'warn'"
            type="button"
            (click)="handleSubmit()"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
          >
            {{ title }}
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class KycApprovalDecisionDrawer {
  public readonly data = inject<KycApprovalDecisionDrawerData>(DIALOG_DATA);
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly complementReasons = KYC_COMPLEMENT_REASONS;
  public readonly title = TITLES[this.data.action];
  public readonly levelLabel = kycApprovalLevelLabel(this.data.level);

  public model = signal(DecisionFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    // Commentaire obligatoire pour un refus ou un complément : l'agent doit savoir quoi corriger.
    validate(schema.comment, (ctx) =>
      this.data.action !== 'approve' && !(ctx.value() ?? '').trim()
        ? { kind: 'required', message: 'Un commentaire est obligatoire pour cette décision' }
        : null,
    );
    validate(schema.reason, (ctx) =>
      this.data.action === 'complement' && !(ctx.value() ?? '').trim()
        ? { kind: 'required', message: 'Indiquez le point à compléter' }
        : null,
    );
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      // L'API n'a qu'un champ `comment` : le point choisi y est préfixé pour un complément.
      const reasonLabel = KYC_COMPLEMENT_REASONS.find((r) => r.value === value.reason)?.label ?? value.reason;
      const comment =
        this.data.action === 'complement'
          ? `${reasonLabel} — ${value.comment.trim()}`
          : value.comment.trim() || null;

      const ok = await firstValueFrom(
        this._facade
          .decide(this.data.kycFileId, this.data.level, DECISION_BY_ACTION[this.data.action], comment)
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Décision refusée', this._errorMessage(error));
              return of(null);
            }),
          ),
      );
      if (!ok) return;

      this._snackbar.success('Décision enregistrée', `Niveau ${this.levelLabel} : ${this.title.toLowerCase()}.`);
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const code = error.error?.detail ?? error.error?.title ?? '';
    if (String(code).includes('KYC_SELF_APPROVAL_FORBIDDEN')) {
      return 'Vous avez soumis ou validé à la main ce dossier : un autre valideur doit signer.';
    }
    switch (error.status) {
      case 409:
        return "Ce niveau a déjà été décidé, ou ce n'est plus à lui de décider. Rechargez pour voir l'état réel.";
      case 403:
        return "Vous ne pouvez pas décider sur ce dossier. Un agent ne valide jamais un dossier qu'il a lui-même soumis.";
      default:
        return code || "La décision n'a pas pu être enregistrée.";
    }
  }
}
