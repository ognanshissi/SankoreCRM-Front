import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  form,
  FormField,
  FormRoot,
  pattern,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
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
import {
  FatcaDeclarationDto,
  LeadsApiService,
  SubmitFatcaDeclarationRequest,
} from '@sankore/crm-api';
import {
  FATCA_INDICIA_QUESTIONS,
  FatcaIndiciaKey,
  FatcaStatusBadge,
  fatcaDocumentationLabel,
} from '@sankore/crm/common';

export interface FatcaDeclarationDrawerData {
  leadId: string;
  /** Code de sujet attendu par l'API (`Principal`, `Spouse`, `Child`…). */
  subjectType: string;
  subjectId: string;
  /** Nom de la personne déclarée, affiché en titre. */
  subjectLabel: string;
  /** Déclaration active de la personne, ou `null` pour une première saisie. */
  declaration: FatcaDeclarationDto | null;
}

/**
 * Parcours de documentation, construit à partir des libellés du socle plutôt que
 * réécrit : `fatcaDocumentationLabel` est déjà la traduction des codes que l'API
 * renvoie, et deux tables divergeraient au premier ajout de parcours. `None`
 * n'est pas proposé — c'est le code que l'API porte quand aucun indice n'est
 * déclaré, pas un choix d'agent.
 */
const FATCA_DOCUMENTATION_OPTIONS = ['UsPerson', 'NonUsPerson', 'RefusedToDocument'].map(
  (value) => ({ label: fatcaDocumentationLabel(value), value }),
);

/**
 * Réponses aux sept questions, en chaînes : `tas-select` travaille en chaînes, et
 * la chaîne vide est le seul moyen de distinguer « pas encore répondu » de
 * « non » — un booléen rendrait les sept questions répondues « non » d'office,
 * c'est-à-dire exactement l'auto-certification qu'on cherche à faire remplir.
 */
class FatcaIndiciaFormModel {
  public usNationalityOrResidence!: string;
  public bornInTheUnitedStates!: string;
  public usAddressOrPoBox!: string;
  public usPhoneNumber!: string;
  public standingOrderToUsAccount!: string;
  public powerOfAttorneyWithUsAddress!: string;
  public careOfOrPosteRestanteAsSoleAddress!: string;

  public static fromDeclaration(
    declaration: FatcaDeclarationDto | null,
  ): FatcaIndiciaFormModel {
    const model = new FatcaIndiciaFormModel();
    const declared = declaration?.declaredIndicia ?? null;
    for (const question of FATCA_INDICIA_QUESTIONS) {
      // Avec une déclaration existante, les indices absents de `declaredIndicia`
      // ont bien été répondus « non » : la déclaration n'existerait pas sinon.
      model[question.key] = declared ? String(declared.includes(question.key)) : '';
    }
    return model;
  }

  public static isDeclared(model: FatcaIndiciaFormModel, key: FatcaIndiciaKey): boolean {
    return model[key] === 'true';
  }
}

class FatcaDeclarationFormModel {
  public indicia!: FatcaIndiciaFormModel;
  public documentation!: string;
  public usTin!: string;
  public selfCertificationRef!: string;
  public evidenceProvided!: boolean;
  public evidenceRef!: string;
  public refusalReason!: string;
  /** Consentement explicite : signature de l'auto-certification, ou refus assumé. */
  public confirmed!: boolean;

  public static fromDeclaration(
    declaration: FatcaDeclarationDto | null,
  ): FatcaDeclarationFormModel {
    const model = new FatcaDeclarationFormModel();
    model.indicia = FatcaIndiciaFormModel.fromDeclaration(declaration);
    const documentation = declaration?.documentation ?? '';
    model.documentation = documentation === 'None' ? '' : documentation;
    // Le TIN et les références de pièces ne sont pas relus par l'API (seuls
    // `hasUsTin` / `hasEvidence` reviennent) : une nouvelle déclaration remplace
    // la précédente, donc tout est à ressaisir plutôt que faussement prérempli.
    model.usTin = '';
    model.selfCertificationRef = '';
    model.evidenceProvided = false;
    model.evidenceRef = '';
    model.refusalReason = '';
    model.confirmed = false;
    return model;
  }
}

/**
 * Déclaration FATCA d'une personne du foyer : les sept questions d'américanité,
 * le parcours de documentation qui en découle, et la signature de
 * l'auto-certification (BNF-F-05).
 *
 * Deux règles structurent l'écran. D'abord **le statut FATCA n'est jamais calculé
 * ici** : il est déterminé par l'API et relu après l'enregistrement. Le front ne
 * décide que de l'enchaînement — dès qu'un indice est déclaré, le parcours de
 * documentation s'ouvre. Ensuite **rien n'est persisté côté navigateur** : le
 * brouillon vit dans le modèle du formulaire et disparaît avec le drawer.
 */
@Component({
  selector: 'fatca-declaration-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fatca-declaration-drawer.html',
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
    FatcaStatusBadge,
  ],
})
export class FatcaDeclarationDrawer {
  public readonly data: FatcaDeclarationDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly yesNoOptions = [
    { label: 'Oui', value: 'true' },
    { label: 'Non', value: 'false' },
  ];
  public readonly documentationOptions = FATCA_DOCUMENTATION_OPTIONS;

  public readonly submitError = signal<string | null>(null);

  public readonly isUpdate = computed(() => this.data.declaration !== null);

  public model = signal(FatcaDeclarationFormModel.fromDeclaration(this.data.declaration));

  public formSchema = form(this.model, (schema) => {
    for (const question of FATCA_INDICIA_QUESTIONS) {
      required(schema.indicia[question.key], {
        message: 'Répondez par oui ou par non',
      });
    }

    // Le parcours de documentation n'est obligatoire que si au moins un indice
    // est déclaré : un `required` inconditionnel rendrait invalide la
    // déclaration d'une personne qui a répondu « non » sept fois.
    validate(schema.documentation, (ctx) => {
      if (!hasAnyIndicia(ctx.valueOf(schema.indicia)) || ctx.value()) return null;
      return {
        kind: 'fatcaDocumentationRequired',
        message: 'Choisissez le parcours de documentation',
      };
    });

    validate(schema.usTin, (ctx) => {
      if (ctx.valueOf(schema.documentation) !== 'UsPerson' || ctx.value()?.trim()) return null;
      return {
        kind: 'fatcaUsTinRequired',
        message: 'Le numéro fiscal américain est obligatoire pour une personne américaine',
      };
    });
    pattern(schema.usTin, /^[0-9]{9}$/, {
      message: 'Le TIN compte 9 chiffres, sans séparateur',
      when: (ctx) => ctx.valueOf(schema.documentation) === 'UsPerson' && !!ctx.value()?.trim(),
    });

    validate(schema.selfCertificationRef, (ctx) => {
      const documentation = ctx.valueOf(schema.documentation);
      const needed = documentation === 'UsPerson' || documentation === 'NonUsPerson';
      if (!needed || ctx.value()?.trim()) return null;
      return {
        kind: 'fatcaSelfCertificationRefRequired',
        message:
          documentation === 'UsPerson'
            ? 'Indiquez la référence du formulaire W-9'
            : 'Indiquez la référence du formulaire W-8BEN',
      };
    });

    validate(schema.evidenceProvided, (ctx) => {
      if (ctx.valueOf(schema.documentation) !== 'NonUsPerson' || ctx.value()) return null;
      return {
        kind: 'fatcaEvidenceRequired',
        message: 'Le justificatif est obligatoire pour une personne non américaine',
      };
    });

    validate(schema.evidenceRef, (ctx) => {
      if (!ctx.valueOf(schema.evidenceProvided) || ctx.value()?.trim()) return null;
      return {
        kind: 'fatcaEvidenceRefRequired',
        message: 'Indiquez la référence du justificatif archivé',
      };
    });

    validate(schema.refusalReason, (ctx) => {
      if (ctx.valueOf(schema.documentation) !== 'RefusedToDocument' || ctx.value()?.trim()) {
        return null;
      }
      return { kind: 'fatcaRefusalReasonRequired', message: 'Précisez le motif du refus' };
    });

    validate(schema.confirmed, (ctx) => {
      if (ctx.value()) return null;
      return ctx.valueOf(schema.documentation) === 'RefusedToDocument'
        ? {
            kind: 'fatcaRefusalNotAcknowledged',
            message: 'Confirmez que le prospect a été informé des conséquences du refus',
          }
        : {
            kind: 'fatcaSelfCertificationNotSigned',
            message: "L'auto-certification doit être signée pour être enregistrée",
          };
    });
  });

  /**
   * Champs des sept questions résolus une seule fois : `formSchema.indicia[key]`
   * appelé depuis le template renverrait une référence à chaque détection de
   * changements, et `[formField]` se relierait en boucle.
   */
  public readonly indiciaFields = FATCA_INDICIA_QUESTIONS.map((question) => ({
    key: question.key,
    label: question.label,
    field: this.formSchema.indicia[question.key],
  }));

  public readonly answeredCount = computed(
    () => this.indiciaFields.filter((item) => !!item.field().value()).length,
  );

  /**
   * Au moins un indice d'américanité déclaré. C'est bien une règle d'interface —
   * elle ouvre le parcours de documentation — et non le calcul du statut, qui
   * reste à l'API.
   */
  public readonly hasIndicia = computed(() =>
    this.indiciaFields.some((item) => item.field().value() === 'true'),
  );

  public readonly allAnswered = computed(
    () => this.answeredCount() === FATCA_INDICIA_QUESTIONS.length,
  );

  public readonly documentationChoice = computed(() => this.formSchema.documentation().value());
  public readonly isUsPerson = computed(() => this.documentationChoice() === 'UsPerson');
  public readonly isNonUsPerson = computed(() => this.documentationChoice() === 'NonUsPerson');
  public readonly isRefusal = computed(
    () => this.documentationChoice() === 'RefusedToDocument',
  );
  public readonly evidenceProvided = computed(() =>
    this.formSchema.evidenceProvided().value(),
  );

  /** Le parcours de documentation ne s'ouvre qu'une fois les sept questions traitées. */
  public readonly showDocumentation = computed(() => this.allAnswered() && this.hasIndicia());
  public readonly showNoIndiciaNotice = computed(() => this.allAnswered() && !this.hasIndicia());

  public readonly previousStatus = computed(() => this.data.declaration?.status ?? null);
  public readonly previousDocumentation = computed(() =>
    fatcaDocumentationLabel(this.data.declaration?.documentation),
  );

  public readonly signatureLabel = computed(() =>
    this.isRefusal()
      ? 'Le prospect a été informé que son refus de documenter le classe « Récalcitrant ».'
      : "Le prospect signe électroniquement la présente auto-certification et atteste de l'exactitude de ses réponses.",
  );

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const request = this._buildRequest(value);

      const result = await firstValueFrom(
        this._leadsApi.submitLeadFatcaDeclaration(this.data.leadId, request).pipe(
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Erreur', message);
            return EMPTY;
          }),
        ),
      );

      if (result === undefined) return;

      if (request.documentation === 'RefusedToDocument') {
        // `SnackbarService` n'a pas de `warning` : l'avertissement vit dans le
        // bloc ambre du formulaire, le toast se contente d'informer.
        this._snackbar.info(
          'Refus enregistré',
          'La personne sera classée selon le statut déterminé par la conformité.',
        );
      } else {
        this._snackbar.success(
          'Déclaration enregistrée',
          "L'auto-certification FATCA a été signée et transmise.",
        );
      }
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _buildRequest(value: FatcaDeclarationFormModel): SubmitFatcaDeclarationRequest {
    const hasIndicia = hasAnyIndicia(value.indicia);
    const documentation = hasIndicia ? value.documentation : 'None';
    const isRefusal = documentation === 'RefusedToDocument';
    const isUsPerson = documentation === 'UsPerson';
    const isNonUsPerson = documentation === 'NonUsPerson';

    return {
      subjectType: this.data.subjectType,
      subjectId: this.data.subjectId,
      indicia: {
        usNationalityOrResidence: FatcaIndiciaFormModel.isDeclared(
          value.indicia,
          'usNationalityOrResidence',
        ),
        bornInTheUnitedStates: FatcaIndiciaFormModel.isDeclared(
          value.indicia,
          'bornInTheUnitedStates',
        ),
        usAddressOrPoBox: FatcaIndiciaFormModel.isDeclared(value.indicia, 'usAddressOrPoBox'),
        usPhoneNumber: FatcaIndiciaFormModel.isDeclared(value.indicia, 'usPhoneNumber'),
        standingOrderToUsAccount: FatcaIndiciaFormModel.isDeclared(
          value.indicia,
          'standingOrderToUsAccount',
        ),
        powerOfAttorneyWithUsAddress: FatcaIndiciaFormModel.isDeclared(
          value.indicia,
          'powerOfAttorneyWithUsAddress',
        ),
        careOfOrPosteRestanteAsSoleAddress: FatcaIndiciaFormModel.isDeclared(
          value.indicia,
          'careOfOrPosteRestanteAsSoleAddress',
        ),
      },
      documentation,
      usTin: isUsPerson ? value.usTin.trim() : null,
      // La référence de l'auto-certification part aussi quand aucun indice n'est
      // déclaré : `hasSelfCertification` et le manquant
      // `FATCA_SELF_CERTIFICATION_MISSING` se lisent sur la pièce, pas sur le
      // seul horodatage de signature.
      selfCertificationDocRef: isRefusal ? null : value.selfCertificationRef.trim() || null,
      evidenceDocRef: isNonUsPerson && value.evidenceProvided ? value.evidenceRef.trim() || null : null,
      // Le refus n'est pas une auto-certification : il n'est pas signé. Pour tout
      // le reste, l'horodatage est posé à l'enregistrement, jamais à l'ouverture
      // du drawer — sinon il daterait la consultation et non la signature.
      signedAt: isRefusal ? null : new Date().toISOString(),
      refusalReason: isRefusal ? value.refusalReason.trim() : null,
    };
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    if (body?.code === 'FATCA_DISABLED') {
      return "FATCA n'est pas activé pour votre établissement.";
    }
    if (error.status === 403) {
      return "Vous n'avez pas le droit d'enregistrer une déclaration FATCA.";
    }
    if (error.status === 404) {
      return "Ce lead ou cette personne n'existe plus.";
    }

    const firstValidation = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
    return (
      firstValidation ??
      body?.detail ??
      body?.title ??
      "Impossible d'enregistrer la déclaration FATCA."
    );
  }
}

function hasAnyIndicia(indicia: FatcaIndiciaFormModel): boolean {
  return FATCA_INDICIA_QUESTIONS.some((question) =>
    FatcaIndiciaFormModel.isDeclared(indicia, question.key),
  );
}

export default FatcaDeclarationDrawer;
