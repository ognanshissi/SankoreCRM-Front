import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  DecideKycApprovalRequestDecisionEnum,
  DecideKycApprovalRequestLevelEnum,
  KycApprovalCircuitDto,
  KycFileDto,
} from '@sankore/crm-api';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  KYC_COMPLEMENT_REASONS,
  KYC_RETAKABLE_DOCUMENTS,
  kycApprovalLevelLabel,
} from '../data-access/kyc-referential';

export type KycDecisionChoice = 'approve' | 'complement' | 'reject';

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

const DECISION_BY_CHOICE: Record<KycDecisionChoice, DecideKycApprovalRequestDecisionEnum> = {
  approve: DecideKycApprovalRequestDecisionEnum.Approved,
  complement: DecideKycApprovalRequestDecisionEnum.ComplementRequired,
  reject: DecideKycApprovalRequestDecisionEnum.Rejected,
};

/**
 * « Votre décision » sur le niveau en attente du circuit, directement dans l'onglet Validation.
 *
 * Le niveau envoyé est celui que le circuit attend (`nextLevel`), jamais un niveau déduit des
 * libellés de rôles : le serveur n'exige que `kyc:approve` et le bon ordre, et la déduction par
 * libellé masquait les actions à des valideurs légitimes. Les quatre yeux restent tranchés côté
 * serveur — un 403 est expliqué, pas anticipé.
 *
 * Sur un dossier déposé à distance, un complément porte la liste des pièces à reprendre : c'est la
 * portée du nouveau lien envoyé au client (KRM-B-10). Le drawer qui précédait cette carte ne
 * l'envoyait pas, et le client refaisait alors tout le parcours.
 */
@Component({
  selector: 'kyc-decision-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, TasIcon, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect],
  template: `
    <section class="rounded-2xl bg-white border border-slate-100 shadow-sm p-6">
      <h2 class="text-xl font-semibold text-primary">Votre décision</h2>

      @if (!nextLevel()) {
        <p class="text-sm text-slate-600 mt-1">Le circuit est clos : plus aucune décision n'est attendue.</p>
      } @else if (!canApprove()) {
        <!-- La raison est dite : sans elle, on cherche un bouton absent en croyant que ce n'est pas son tour. -->
        <p class="text-sm text-slate-600 mt-1">
          Ce dossier attend une décision au niveau {{ levelLabel() }}. Vous n'avez pas le droit de vous
          prononcer dans le circuit de validation : demandez-le à votre administrateur si c'est votre rôle.
        </p>
      } @else {
        <p class="text-sm text-slate-600 mt-1">{{ levelSummary() }}</p>

        <div class="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3" role="radiogroup" aria-label="Décision">
          @for (option of options(); track option.value) {
            <label
              class="rounded-xl border p-4 cursor-pointer transition-colors flex flex-col gap-1"
              [class.border-primary]="choice() === option.value"
              [class.ring-1]="choice() === option.value"
              [class.ring-primary]="choice() === option.value"
              [class.border-slate-200]="choice() !== option.value"
              [class.opacity-50]="option.disabled"
              [class.cursor-not-allowed]="option.disabled"
            >
              <span class="flex items-center gap-2">
                <input
                  type="radio"
                  name="kyc-decision"
                  class="accent-primary w-4 h-4"
                  [value]="option.value"
                  [checked]="choice() === option.value"
                  [disabled]="option.disabled"
                  (change)="choose(option.value)"
                />
                <span class="text-sm font-semibold text-slate-900">{{ option.label }}</span>
              </span>
              <span class="text-xs text-slate-600 pl-6">{{ option.description }}</span>
            </label>
          }
        </div>
        @if (!hasAgentDocument()) {
          <p class="mt-2 text-xs text-amber-700">
            Approuver est impossible tant qu'aucun agent n'a déposé de pièce pour ce client.
          </p>
        }

        <form [formRoot]="formSchema" class="mt-5 flex flex-col gap-4">
          @if (choice() === 'complement') {
            @if (isRemote()) {
              <!--
                Les pièces cochées deviennent la portée du nouveau lien : il ne sera demandé que
                celles-ci. Rien de coché veut dire « tout le parcours à refaire », la lecture qui
                ne peut pas bloquer le client.
              -->
              <fieldset class="flex flex-col gap-2">
                <legend class="text-sm font-medium text-slate-800 mb-1">Pièces à reprendre par le client</legend>
                @for (doc of retakableDocuments; track doc.value) {
                  <label class="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      class="accent-primary w-4 h-4"
                      [checked]="retake().includes(doc.value)"
                      (change)="toggleRetake(doc.value, $any($event.target).checked)"
                    />
                    {{ doc.label }}
                  </label>
                }
                <p class="text-xs text-slate-500">Aucune case cochée : le client refait tout le parcours.</p>
              </fieldset>
            }

            <tas-form-field>
              <tas-label>Point à compléter <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="complementReasons"
                optionLabel="label"
                optionValue="value"
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
              @if (choice() === 'approve') {
                <span class="font-normal text-slate-500">(facultatif)</span>
              } @else {
                <span class="text-functional-error">*</span>
              }
            </tas-label>
            <textarea
              tasInput
              rows="3"
              [formField]="formSchema.comment"
              [placeholder]="choice() === 'approve' ? 'Ex. : pièces conformes, client rencontré en agence.' : 'Expliquez votre décision'"
            ></textarea>
            @if (formSchema.comment().touched() && formSchema.comment().invalid()) {
              <tas-error>{{ formSchema.comment().errors()[0].message }}</tas-error>
            } @else if (choice() !== 'approve') {
              <tas-hint>
                @if (isRemote()) {
                  Lu par vos collègues. Le client reçoit un email listant les pièces à reprendre, sans ce commentaire.
                } @else {
                  Lu par l'agent qui reprend le dossier.
                }
              </tas-hint>
            }
          </tas-form-field>
        </form>

        <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-slate-500">Votre nom et l'heure seront inscrits à l'historique du dossier.</p>
          <button
            type="button"
            class="h-11 px-6 rounded-full text-white text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary inline-flex items-center gap-2"
            [class.bg-primary]="choice() !== 'reject'"
            [class.bg-red-700]="choice() === 'reject'"
            [disabled]="formSchema().invalid() || formSchema().submitting() || (choice() === 'approve' && !hasAgentDocument())"
            (click)="submitDecision()"
          >
            @if (formSchema().submitting()) {
              <tas-icon iconName="feather:loader" class="animate-spin" style="font-size:14px"></tas-icon>
            }
            {{ submitLabel() }}
          </button>
        </div>
      }
    </section>
  `,
})
export class KycDecisionCard {
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly kycFileId = input.required<string>();
  public readonly file = input<KycFileDto | null>(null);
  public readonly circuit = input<KycApprovalCircuitDto | null>(null);
  public readonly canApprove = input(false);
  /** Sans pièce déposée par un agent, rien ne fonde une approbation. */
  public readonly hasAgentDocument = input(true);

  public readonly decided = output<void>();

  public readonly complementReasons = KYC_COMPLEMENT_REASONS;
  public readonly retakableDocuments = KYC_RETAKABLE_DOCUMENTS;

  /** Sans pièce d'agent, « Approuver » est grisé : on ne le laisse pas présélectionné. */
  public readonly choice = linkedSignal<KycDecisionChoice>(() =>
    this.hasAgentDocument() ? 'approve' : 'complement',
  );
  public readonly retake = signal<string[]>([]);

  public readonly nextLevel = computed(() => this.circuit()?.nextLevel ?? null);
  public readonly levelLabel = computed(() => kycApprovalLevelLabel(this.nextLevel()));
  public readonly isRemote = computed(() => this.file()?.channel === 'RemoteSelfService');

  private readonly _position = computed(() => {
    const steps = this.circuit()?.steps ?? [];
    const index = steps.findIndex((s) => s.level === this.nextLevel());
    return { index, after: index >= 0 ? steps[index + 1]?.level ?? null : null };
  });

  /** Le dernier niveau valide le dossier : c'est ce qui rend son approbation définitive. */
  public readonly isFinalLevel = computed(() => this._position().index >= 0 && !this._position().after);

  public readonly levelSummary = computed(() => {
    const { index, after } = this._position();
    const prefix = index >= 0 ? `Niveau ${index + 1} · ${this.levelLabel()}.` : `Niveau ${this.levelLabel()}.`;
    return after
      ? `${prefix} Après vous, le niveau ${kycApprovalLevelLabel(after)} décide à son tour.`
      : `${prefix} C'est le dernier niveau : votre approbation valide le dossier.`;
  });

  public readonly options = computed(() => {
    const after = this._position().after;
    return [
      {
        value: 'approve' as const,
        label: 'Approuver',
        description: after
          ? `Le dossier passe au niveau ${kycApprovalLevelLabel(after)}.`
          : 'Le dossier KYC du client est validé.',
        disabled: !this.hasAgentDocument(),
      },
      {
        value: 'complement' as const,
        label: 'Demander un complément',
        description: this.isRemote()
          ? 'Un nouveau lien est envoyé au client.'
          : 'Le dossier revient en collecte.',
        disabled: false,
      },
      {
        value: 'reject' as const,
        label: 'Rejeter',
        description: 'Le dossier est clos, sans création de client.',
        disabled: false,
      },
    ];
  });

  public readonly submitLabel = computed(() => {
    switch (this.choice()) {
      case 'approve':    return this.isFinalLevel() ? 'Approuver et valider' : 'Approuver et transmettre';
      case 'complement': return 'Demander le complément';
      case 'reject':     return 'Rejeter le dossier';
    }
  });

  public model = signal(DecisionFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    // Obligatoire pour un refus ou un complément : l'agent doit savoir quoi corriger.
    validate(schema.comment, (ctx) =>
      this.choice() !== 'approve' && !(ctx.value() ?? '').trim()
        ? { kind: 'required', message: 'Un commentaire est obligatoire pour cette décision' }
        : null,
    );
    validate(schema.reason, (ctx) =>
      this.choice() === 'complement' && !(ctx.value() ?? '').trim()
        ? { kind: 'required', message: 'Indiquez le point à compléter' }
        : null,
    );
  });

  public choose(choice: KycDecisionChoice): void {
    this.choice.set(choice);
  }

  public toggleRetake(kind: string, checked: boolean): void {
    this.retake.update((current) =>
      checked ? [...new Set([...current, kind])] : current.filter((k) => k !== kind),
    );
  }

  public submitDecision(): void {
    const level = this.nextLevel();
    const choice = this.choice();
    if (!level || !this.canApprove()) return;
    if (choice === 'approve' && !this.hasAgentDocument()) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      // Une approbation intermédiaire ne ferme rien ; les trois autres cas sont définitifs.
      if (choice !== 'approve' || this.isFinalLevel()) {
        const confirmed = await this._confirmDefinitive(choice);
        if (!confirmed) return;
      }

      // L'API n'a qu'un champ `comment` : le point choisi y est préfixé pour un complément.
      const reasonLabel = KYC_COMPLEMENT_REASONS.find((r) => r.value === value.reason)?.label ?? value.reason;
      const comment =
        choice === 'complement' ? `${reasonLabel} — ${value.comment.trim()}` : value.comment.trim() || null;
      const retake = choice === 'complement' && this.isRemote() ? this.retake() : null;

      const ok = await firstValueFrom(
        this._facade
          .decide(this.kycFileId(), level as DecideKycApprovalRequestLevelEnum, DECISION_BY_CHOICE[choice], comment, retake)
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Décision refusée', this._errorMessage(error));
              return of(null);
            }),
          ),
      );
      if (!ok) return;

      this._snackbar.success('Décision enregistrée', `Niveau ${this.levelLabel()} : décision prise en compte.`);
      this.model.set(DecisionFormModel.instantiate());
      this.formSchema().reset();
      this.retake.set([]);
      this.decided.emit();
    });
  }

  private _confirmDefinitive(choice: KycDecisionChoice): Promise<boolean> {
    const copy = {
      approve: { title: 'Valider le dossier ?', message: 'C\'est le dernier niveau : votre approbation valide le dossier KYC du client. Elle est définitive.', accept: 'Approuver et valider' },
      complement: { title: 'Demander un complément ?', message: 'Le circuit sera fermé et le dossier renvoyé en collecte. Cette décision est définitive.', accept: 'Demander le complément' },
      reject: { title: 'Rejeter le dossier ?', message: 'Le rejet ferme le circuit : aucun client ne sera créé. Cette décision est définitive.', accept: 'Rejeter' },
    }[choice];

    return new Promise<boolean>((resolve) => {
      this._confirm.confirm({
        title: copy.title,
        message: copy.message,
        closable: true,
        acceptButtonProps: { label: copy.accept, theme: choice === 'reject' ? 'warn' : 'primary' },
        rejectButtonProps: { label: 'Annuler' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const code = error.error?.error ?? error.error?.detail ?? error.error?.title ?? '';
    if (String(code).includes('KYC_SELF_APPROVAL_FORBIDDEN')) {
      return 'Vous avez soumis ou validé à la main ce dossier : un autre valideur doit signer.';
    }
    switch (error.status) {
      case 409:
        return "Ce niveau a déjà été décidé, ou ce n'est plus à lui de décider. Rechargez pour voir l'état réel.";
      case 403:
        return 'Vous ne pouvez pas décider sur ce dossier. Un agent ne valide jamais un dossier qu\'il a lui-même soumis.';
      default:
        return code || "La décision n'a pas pu être enregistrée.";
    }
  }
}
