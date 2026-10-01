import { Component, computed, inject, input, output, signal, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  DecideKycApprovalRequestDecisionEnum,
  DecideKycApprovalRequestLevelEnum,
  KycApprovalCircuitDto,
  KycFileDto,
} from '@sankore/crm-api';
import { AuthenticationService, PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  KYC_COMPLEMENT_REASONS,
  kycApprovalDecisionMeta,
  kycApprovalLevelLabel,
  kycVigilanceMeta,
} from '../data-access/kyc-referential';
import { KycStatusBadge } from '../ui/kyc-status-badge';

type PendingAction = 'approve' | 'complement' | 'reject' | null;

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

/**
 * Écran de décision du circuit de validation (KYC-F-05).
 *
 * Le bloc de score se projette par `ng-content` : l'écran a besoin de l'identité, de la pièce, du
 * selfie, du score et des flags **sur une seule vue**, mais ces morceaux appartiennent à d'autres
 * dossiers du module. La projection évite d'y créer une dépendance en dur.
 *
 * **Ce que le contrat permet de savoir, et ce qu'il ne permet pas.** Décider demande deux choses
 * distinctes, et l'écran les traite séparément :
 *
 * 1. **Le droit** — `kyc:approve`, du catalogue `PERMISSIONS`. C'est la seule des deux conditions
 *    qui soit une vraie donnée : elle vient du rôle de l'utilisateur tel que le backend le définit.
 * 2. **Le tour** — le prochain niveau attendu du circuit doit être le sien. Là, le contrat ne donne
 *    aucune correspondance entre les rôles du tenant et les trois niveaux : `myLevel()` la **déduit
 *    des libellés de rôles**, ce qui reste une heuristique.
 *
 * Les deux réunies ne forment qu'un filtre d'affichage, jamais un contrôle. Le serveur reste
 * l'autorité : un 403 et un 409 sont remontés en clair. Et comme aucun DTO ne porte l'auteur de la
 * soumission, « un agent ne valide jamais son propre dossier » **ne peut pas** être vérifié côté
 * front : seul le serveur le sait.
 */
@Component({
  selector: 'kyc-approval-decision',
  templateUrl: './kyc-approval-decision.html',
  imports: [
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TimeagoPipe,
    KycStatusBadge,
    FormRoot,
    FormField,
  ],
})
export class KycApprovalDecision implements OnInit {
  private readonly _facade = inject(KycFacadeService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);

  public readonly kycFileId = input.required<string>();

  /** Émis après toute décision enregistrée, pour que l'hôte recharge ce qu'il affiche. */
  public readonly decided = output<void>();

  public readonly complementReasons = KYC_COMPLEMENT_REASONS;
  public readonly levelLabel = kycApprovalLevelLabel;
  public readonly decisionMeta = kycApprovalDecisionMeta;

  public isLoading = signal(true);
  public loadError = signal('');
  public file = signal<KycFileDto | null>(null);
  public circuit = signal<KycApprovalCircuitDto | null>(null);

  public pendingAction = signal<PendingAction>(null);
  public isDeciding = signal(false);

  public model = signal(DecisionFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    // Le commentaire n'est obligatoire que pour un refus ou une demande de complément : le cahier
    // l'exige pour ces deux-là, et l'imposer à une approbation ralentirait le cas le plus courant.
    validate(schema.comment, (ctx) => {
      const action = this.pendingAction();
      if (action !== 'complement' && action !== 'reject') return null;
      return (ctx.value() ?? '').trim()
        ? null
        : { kind: 'required', message: 'Un commentaire est obligatoire pour cette décision' };
    });

    validate(schema.reason, (ctx) => {
      if (this.pendingAction() !== 'complement') return null;
      return (ctx.value() ?? '').trim()
        ? null
        : { kind: 'required', message: 'Indiquez le point à compléter' };
    });
  });

  public readonly steps = computed(() => this.circuit()?.steps ?? []);

  public readonly nextLevel = computed(() => this.circuit()?.nextLevel ?? null);

  public readonly vigilance = computed(() => kycVigilanceMeta(this.circuit()?.vigilanceLevel));

  /**
   * Étape responsable conformité : visible pour les dossiers à vigilance renforcée. Elle peut déjà
   * figurer dans `steps` quand le circuit est ouvert ; sinon on l'annonce comme attendue.
   */
  public readonly showComplianceStep = computed(
    () =>
      this.vigilance().requiresCompliance ||
      this.steps().some((s) => s.level === 'ComplianceOfficer'),
  );

  /**
   * Niveau auquel l'utilisateur connecté peut décider, déduit de ses rôles. Heuristique assumée : le
   * contrat ne donne aucune correspondance entre les rôles du tenant et les trois niveaux du circuit.
   */
  public readonly myLevel = computed<DecideKycApprovalRequestLevelEnum | null>(() => {
    const roles = (this._auth.connectedUser()?.roles ?? []).map((r) => r.toLowerCase());
    if (roles.some((r) => r.includes('compliance') || r.includes('conformit'))) {
      return DecideKycApprovalRequestLevelEnum.ComplianceOfficer;
    }
    if (roles.some((r) => r.includes('manager') || r.includes('chef') || r.includes('agence'))) {
      return DecideKycApprovalRequestLevelEnum.BranchManager;
    }
    if (roles.length > 0) return DecideKycApprovalRequestLevelEnum.Agent;
    return null;
  });

  /**
   * Droit de se prononcer dans le circuit. Indépendant du niveau : `kyc:approve` dit que
   * l'utilisateur décide, `myLevel()` dit à quelle étape. Avant que ce code n'existe au catalogue,
   * la seule barrière était l'heuristique sur les libellés de rôles — un rôle nommé « Chef
   * d'agence » suffisait donc à afficher les boutons, droit de décision ou non.
   */
  public readonly canApprove = this._permissions.can('kyc:approve');

  /**
   * Les actions ne s'affichent que si l'utilisateur a le droit de décider **et** que le prochain
   * niveau attendu est le sien.
   */
  public readonly canDecide = computed(() => {
    if (!this.canApprove()) return false;
    const circuit = this.circuit();
    if (!circuit) return false;
    const next = circuit.nextLevel;
    return !!next && next === this.myLevel();
  });

  public readonly awaitedValidator = computed(() => {
    const next = this.nextLevel();
    return next ? kycApprovalLevelLabel(next) : null;
  });

  ngOnInit(): void {
    this._load();
  }

  public startAction(action: Exclude<PendingAction, null>): void {
    this.pendingAction.set(action);
    this.model.set(DecisionFormModel.instantiate());
    this.formSchema().reset();
  }

  public cancelAction(): void {
    this.pendingAction.set(null);
    this.model.set(DecisionFormModel.instantiate());
    this.formSchema().reset();
  }

  public confirmAndDecide(): void {
    const action = this.pendingAction();
    if (!action) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const decision = DECISION_BY_ACTION[action];
      const label = ACTION_LABELS[action];

      // Confirmation avant toute décision définitive : une approbation au dernier niveau valide le
      // dossier, un refus ou un complément ferment le circuit depuis n'importe quel niveau.
      //
      // Attendre la boîte de dialogue dans une promesse est sûr ici : `ConfirmDialogService` ouvre
      // avec `disableClose: true`, donc seuls la croix et les deux boutons la ferment, et les trois
      // émettent. Si cette option changeait, un clic sur le fond laisserait la promesse pendante et
      // le formulaire bloqué en soumission.
      const confirmed = await new Promise<boolean>((resolve) => {
        this._confirmDialog.confirm({
          title: label.confirmTitle,
          message: label.confirmMessage,
          closable: true,
          acceptButtonProps: { label: label.confirmAccept, theme: action === 'approve' ? 'primary' : 'warn' },
          rejectButtonProps: { label: 'Annuler' },
          accept: () => resolve(true),
          reject: () => resolve(false),
        });
      });
      if (!confirmed) return;

      const level = this.myLevel();
      if (!level) {
        this._snackbar.error(
          'Décision impossible',
          "Votre rôle ne correspond à aucun niveau du circuit : seul le serveur peut trancher, rechargez la page.",
        );
        return;
      }

      // Le commentaire porte le point choisi quand c'est un complément : l'API n'a qu'un champ
      // `comment`, pas de liste de motifs.
      const reasonLabel =
        action === 'complement'
          ? (KYC_COMPLEMENT_REASONS.find((r) => r.value === value.reason)?.label ?? value.reason)
          : '';
      const comment =
        action === 'complement'
          ? `${reasonLabel} — ${value.comment.trim()}`
          : value.comment.trim() || null;

      this.isDeciding.set(true);
      const result = await firstValueFrom(
        this._facade.decide(this.kycFileId(), level, decision, comment).pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Décision refusée', this._decisionError(error));
            this.isDeciding.set(false);
            return of(null);
          }),
        ),
      );

      this.isDeciding.set(false);
      if (!result) return;

      this._snackbar.success('Décision enregistrée', label.success);
      this.pendingAction.set(null);
      this.decided.emit();
      this._load();
    });
  }

  public reload(): void {
    this._load();
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set('');

    forkJoin({
      file: this._facade.getFile(this.kycFileId()),
      circuit: this._facade.getApprovalCircuit(this.kycFileId()),
    })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            error.status === 404
              ? "Ce dossier KYC est introuvable : il a peut-être été clôturé."
              : "Le circuit de validation n'a pas pu être lu.",
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ file, circuit }) => {
        this.file.set(file);
        this.circuit.set(circuit);
        this.isLoading.set(false);
      });
  }

  private _decisionError(error: HttpErrorResponse): string {
    switch (error.status) {
      case 409:
        // Le contrat : seul le prochain niveau en attente peut décider. Un 409 signifie donc que
        // l'état a changé entre l'affichage et le clic.
        return "Ce dossier a déjà été décidé entre-temps, ou ce n'est plus à ce niveau de décider. Rechargez pour voir l'état réel.";
      case 403:
        return "Vous ne pouvez pas décider sur ce dossier. Un agent ne valide jamais un dossier qu'il a lui-même soumis.";
      case 400:
        return error.error?.detail ?? 'La décision a été refusée par le serveur.';
      default:
        return error.error?.detail ?? "La décision n'a pas pu être enregistrée.";
    }
  }
}

const DECISION_BY_ACTION: Record<
  Exclude<PendingAction, null>,
  DecideKycApprovalRequestDecisionEnum
> = {
  approve: DecideKycApprovalRequestDecisionEnum.Approved,
  complement: DecideKycApprovalRequestDecisionEnum.ComplementRequired,
  reject: DecideKycApprovalRequestDecisionEnum.Rejected,
};

const ACTION_LABELS: Record<
  Exclude<PendingAction, null>,
  { confirmTitle: string; confirmMessage: string; confirmAccept: string; success: string }
> = {
  approve: {
    confirmTitle: 'Approuver ce dossier',
    confirmMessage:
      "Votre approbation est définitive. Au dernier niveau du circuit, elle valide le dossier KYC du client.",
    confirmAccept: 'Approuver',
    success: 'Le dossier passe au niveau suivant du circuit.',
  },
  complement: {
    confirmTitle: 'Demander un complément',
    confirmMessage:
      "Le circuit sera fermé et le dossier renvoyé à l'agent pour correction. Cette décision est définitive.",
    confirmAccept: 'Demander le complément',
    success: "L'agent est informé des points à compléter.",
  },
  reject: {
    confirmTitle: 'Rejeter ce dossier',
    confirmMessage:
      'Le rejet ferme le circuit depuis ce niveau. Cette décision est définitive.',
    confirmAccept: 'Rejeter',
    success: 'Le dossier est rejeté.',
  },
};
