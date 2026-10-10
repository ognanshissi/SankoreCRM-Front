import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { LeadsApiService } from '@sankore/crm-api';
import { AuthenticationService, CONSENT_PROOF_OPTIONS } from '@sankore/crm/common';

export interface HealthConsentDrawerData {
  leadId: string;
  /** `Principal`, `Spouse`, `Child`… tel que l'API nomme le sujet. */
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  /** Un mineur ne consent pas lui-même : un parent doit être désigné (BNF-F-07). */
  isMinor: boolean;
  /**
   * Parents éligibles (principal, conjoint) pour `givenById`. Vide quand l'API
   * n'a encore donné aucun identifiant de sujet exploitable.
   */
  givenByOptions: { label: string; value: string }[];
}

export interface HealthConsentDrawerResult {
  consentId: string | null;
  subjectId: string;
  /** Mode de preuve retenu (`CheckboxWithSignature`, `SmsReply`, `Document`). */
  proofMode: string;
  proofReference: string | null;
  givenById: string | null;
  givenByLabel: string | null;
  /** Horodatage local du recueil : l'API ne renvoie que `consentId`. */
  recordedAt: string;
  recordedByLabel: string;
}

class HealthConsentFormModel {
  public proofMode!: string;
  public proofReference!: string;
  public givenById!: string;
  public signatureAttested!: boolean;

  public static empty(): HealthConsentFormModel {
    const m = new HealthConsentFormModel();
    m.proofMode = '';
    m.proofReference = '';
    m.givenById = '';
    m.signatureAttested = false;
    return m;
  }
}

/**
 * Recueil du consentement santé d'une personne du foyer (BNF-F-07).
 *
 * Le mode de preuve part sur `RecordHealthConsentRequest.channel`, qui est une
 * chaîne libre au contrat : on y met les codes du socle
 * (`CONSENT_PROOF_OPTIONS`) plutôt qu'un canal technique, parce que c'est bien
 * le mode de preuve que le cahier des charges demande d'afficher ensuite, et que
 * `consentProofLabel` est le seul référentiel partagé qui sache les traduire.
 */
@Component({
  selector: 'health-consent-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './health-consent-drawer.html',
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasCheckbox,
  ],
})
export class HealthConsentDrawer {
  public readonly data: HealthConsentDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<HealthConsentDrawerResult | null>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _auth = inject(AuthenticationService);

  public readonly proofOptions = CONSENT_PROOF_OPTIONS;
  public readonly submitError = signal<string | null>(null);

  public readonly hasGivenByOptions = computed(() => this.data.givenByOptions.length > 0);

  public model = signal(HealthConsentFormModel.empty());

  public formSchema = form(this.model, (schema) => {
    validate(schema.proofMode, (ctx) =>
      ctx.value()
        ? null
        : { kind: 'proofModeRequired', message: 'Le mode de preuve est obligatoire' },
    );

    // Le répondant n'est exigé que pour un mineur : un `required` inconditionnel
    // bloquerait le consentement d'un adulte, qui le donne pour lui-même.
    validate(schema.givenById, (ctx) => {
      if (!this.data.isMinor) return null;
      if (!this.hasGivenByOptions()) return null;
      return ctx.value()
        ? null
        : { kind: 'givenByRequired', message: 'Désignez le parent qui donne le consentement' };
    });

    // « Case cochée avec signature » : la case est précisément la preuve, il faut
    // donc qu'elle soit cochée à l'écran avant d'enregistrer ce mode-là.
    validate(schema.signatureAttested, (ctx) => {
      if (this.model().proofMode !== 'CheckboxWithSignature') return null;
      return ctx.value()
        ? null
        : { kind: 'signatureRequired', message: 'Confirmez la case cochée et signée' };
    });
  });

  public handleSubmit(): void {
    this.submitError.set(null);

    if (this.data.isMinor && !this.hasGivenByOptions()) {
      const message =
        "Aucun parent identifiable : complétez le foyer avant de recueillir le consentement d'un mineur.";
      this.submitError.set(message);
      return;
    }

    submit(this.formSchema, async (field) => {
      const value = field().value();
      const givenById = this.data.isMinor ? value.givenById || null : null;

      const result = await firstValueFrom(
        this._leadsApi
          .recordLeadHealthConsent(this.data.leadId, {
            subjectType: this.data.subjectType,
            subjectId: this.data.subjectId,
            channel: value.proofMode,
            proofReference: value.proofReference.trim() || null,
            givenById,
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const message = this._errorMessage(error);
              this.submitError.set(message);
              this._snackbar.error('Erreur', message);
              return EMPTY;
            }),
          ),
      );

      if (result === undefined) return;

      const user = this._auth.connectedUser();
      this._snackbar.success(
        'Consentement recueilli',
        `Le consentement santé de ${this.data.subjectLabel} est enregistré.`,
      );
      this._dialogRef.close({
        consentId: result.consentId ?? null,
        subjectId: this.data.subjectId,
        proofMode: value.proofMode,
        proofReference: value.proofReference.trim() || null,
        givenById,
        givenByLabel:
          this.data.givenByOptions.find((o) => o.value === givenById)?.label ?? null,
        recordedAt: new Date().toISOString(),
        recordedByLabel: user?.fullName ?? user?.email ?? 'Vous',
      });
    });
  }

  public close(): void {
    this._dialogRef.close(null);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    switch (body?.code) {
      case 'HEALTH_CONSENT_ALREADY_RECORDED':
        return 'Un consentement santé est déjà enregistré pour cette personne.';
      case 'HEALTH_CONSENT_SUBJECT_UNKNOWN':
        return "Cette personne n'est pas reconnue dans le foyer du lead.";
      case 'HEALTH_CONSENT_GIVEN_BY_REQUIRED':
        return 'Le parent qui donne le consentement doit être désigné.';
      default:
        break;
    }

    const fieldErrors = Object.values(body?.errors ?? {}).flat();
    if (fieldErrors.length > 0) return fieldErrors.join(' ');
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    if (error.status === 403) return "Vous n'avez pas le droit d'enregistrer ce consentement.";
    return 'Impossible d’enregistrer le consentement santé.';
  }
}
