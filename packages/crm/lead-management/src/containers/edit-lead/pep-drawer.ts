import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import {
  apply,
  applyEach,
  form,
  FormField,
  FormRoot,
  submit,
  validate,
} from '@angular/forms/signals';
import { catchError, firstValueFrom, forkJoin, map, Observable, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TasTag } from '@talisoft/ui/tag';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { LeadsApiService } from '@sankore/crm-api';
import {
  HouseholdMemberView,
  PEP_LINK_OPTIONS,
  PepFieldset,
  PepFormModel,
  PepStatus,
  pepFormToStatus,
  pepSchema,
  pepToDto,
} from '@sankore/crm/common';

/** Messages français des erreurs des endpoints PPE du lead. */
function pepErrorMessage(error: HttpErrorResponse): string {
  const body = error.error as
    | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
    | undefined;

  switch (body?.code) {
    case 'PEP_FUNCTION_REQUIRED':
      return 'La fonction est obligatoire pour une personne politiquement exposée.';
    case 'PEP_READ_FORBIDDEN':
      return "Vous n'avez pas le droit de consulter ni de modifier le détail PPE.";
    case 'LEAD_CONVERTED':
      return 'Ce lead est converti : son statut PPE se modifie depuis la fiche client.';
  }
  if (error.status === 403) {
    return "Vous n'avez pas le droit de modifier le statut PPE de cette personne.";
  }
  if (error.status === 404) {
    return "Cette personne n'est plus rattachée au foyer du lead.";
  }
  const firstValidation = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
  return (
    firstValidation ?? body?.detail ?? body?.title ?? "Impossible d'enregistrer le statut PPE."
  );
}

export interface PepDrawerData {
  leadId: string;
  /** `null` pour le principal du lead, sinon le membre du foyer visé. */
  member: HouseholdMemberView | null;
  /** Nom affiché de la personne, pour les libellés et les `aria-label`. */
  subjectLabel: string;
  /** `customers:pep_read` : sans ce droit, le détail n'est ni affiché ni modifiable. */
  canReadDetails: boolean;
  /** Lead converti, ou droit d'écriture absent. */
  readOnly: boolean;
  initialPep: PepStatus;
}

export interface PepDrawerResult {
  /** Statut tel qu'il vient d'être enregistré, pour la proposition au foyer. */
  pep: PepStatus;
  isPrincipal: boolean;
}

class PepDrawerFormModel {
  public pep!: PepFormModel;

  public static fromStatus(status: PepStatus): PepDrawerFormModel {
    const m = new PepDrawerFormModel();
    m.pep = PepFormModel.fromStatus(status);
    return m;
  }
}

/**
 * Saisie du statut PPE d'une personne du lead — le principal ou un membre du
 * foyer (BNF-F-04).
 *
 * Deux endpoints distincts portent exactement la même charge
 * (`PUT /leads/{id}/pep` et `PUT /leads/{id}/household/members/{memberId}/pep`,
 * tous deux en `SetPepStatusRequest`) : seul l'appel change, d'où un seul drawer.
 *
 * Sans `customers:pep_read`, le drawer s'ouvre en consultation. L'API ne renvoie
 * pas la fonction exercée dans ce cas : enregistrer depuis ce formulaire
 * effacerait côté serveur une fonction qu'on n'a jamais lue. Le badge
 * d'exposition, lui, reste visible — c'est ce que demande BNF-F-04.
 */
@Component({
  selector: 'lead-pep-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasTag,
    Button,
    PepFieldset,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:flag" style="font-size:18px"></tas-icon>
          <span>Statut PPE — {{ data.subjectLabel }}</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (submitError(); as message) {
          <div class="mb-4 p-3 rounded-lg border border-functional-error/40 bg-functional-error/5">
            <p class="text-sm text-functional-error">{{ message }}</p>
          </div>
        }

        @if (isConsultation()) {
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <span class="text-sm text-slate-600">Exposition déclarée :</span>
              @if (data.initialPep.isPep) {
                <tas-tag severity="warning">Exposition PPE</tas-tag>
              } @else {
                <tas-tag severity="neutral">Non exposé</tas-tag>
              }
            </div>
            <p class="flex items-start gap-2 text-sm text-slate-500">
              <tas-icon iconName="feather:lock" style="font-size:13px"></tas-icon>
              <span>{{ consultationMessage() }}</span>
            </p>
          </div>
        } @else {
          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <pep-fieldset
              [field]="formSchema.pep"
              [subjectLabel]="data.subjectLabel"
              [canReadDetails]="true"
            ></pep-fieldset>
          </form>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">
            {{ isConsultation() ? 'Fermer' : 'Annuler' }}
          </button>
          @if (!isConsultation()) {
            <button
              tas-raised-button
              color="primary"
              type="button"
              (click)="handleSubmit()"
              [disabled]="formSchema().invalid() || formSchema().submitting()"
              [isLoading]="formSchema().submitting()"
            >
              Enregistrer
            </button>
          }
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class PepDrawer {
  public readonly data: PepDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<PepDrawerResult | undefined>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly submitError = signal<string | null>(null);

  public readonly isConsultation = computed(
    () => this.data.readOnly || !this.data.canReadDetails,
  );

  public readonly consultationMessage = computed(() =>
    !this.data.canReadDetails
      ? "Le détail de l'exposition PPE ne vous est pas accessible. Seule l'exposition elle-même est signalée."
      : 'Ce dossier est en lecture seule : le statut PPE ne peut plus être modifié ici.',
  );

  public model = signal(PepDrawerFormModel.fromStatus(this.data.initialPep));

  public formSchema = form(this.model, (schema) => {
    apply(schema.pep, pepSchema);
  });

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const status = pepFormToStatus(field().value().pep);
      const body = { pep: pepToDto(status) };
      const member = this.data.member;

      const request$ = member
        ? this._leadsApi.setLeadHouseholdMemberPepStatus(this.data.leadId, member.memberId, body)
        : this._leadsApi.setLeadPrincipalPepStatus(this.data.leadId, body);

      // `204 No Content` : le corps vaut `null`, qui ne distingue pas le succès
      // de l'échec. On projette donc sur un marqueur explicite plutôt que de
      // conclure sur `undefined` — et on évite `EMPTY`, qui ferait rejeter
      // `firstValueFrom` au lieu de retourner.
      const outcome = await firstValueFrom(
        request$.pipe(
          map(() => 'ok' as const),
          catchError((error: HttpErrorResponse) => {
            const message = pepErrorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Erreur', message);
            return of('ko' as const);
          }),
        ),
      );

      if (outcome === 'ko') return;

      this._snackbar.success(
        'Statut PPE enregistré',
        status.isPep
          ? `${this.data.subjectLabel} est déclaré politiquement exposé.`
          : `${this.data.subjectLabel} n'est plus déclaré politiquement exposé.`,
      );
      this._dialogRef.close({ pep: status, isPrincipal: member === null });
    });
  }

  public close(): void {
    this._dialogRef.close(undefined);
  }
}

// ——— Proposition d'application de l'exposition au foyer ———

export interface PepPropagationDrawerData {
  leadId: string;
  /** Statut du principal, dont la fonction et le pays sont repris pour le foyer. */
  principalPep: PepStatus;
  principalLabel: string;
  /** Membres actifs du foyer — conjoint et enfants. */
  members: HouseholdMemberView[];
}

class PepPropagationRow {
  public memberId!: string;
  public label!: string;
  public typeLabel!: string;
  public alreadyExposed!: boolean;
  public selected!: boolean;
  public link!: string;
}

class PepPropagationFormModel {
  public rows!: PepPropagationRow[];

  public static fromMembers(members: HouseholdMemberView[]): PepPropagationFormModel {
    const m = new PepPropagationFormModel();
    m.rows = members.map((member) => {
      const row = new PepPropagationRow();
      row.memberId = member.memberId;
      row.label = member.displayName;
      row.typeLabel = member.typeLabel;
      row.alreadyExposed = member.isPepExposed;
      // Pré-cochés, sauf ceux qui portent déjà une exposition : réécrire par
      // défaut un statut saisi personne par personne écraserait un travail que
      // l'agent a fait exprès.
      row.selected = !member.isPepExposed;
      row.link = member.pep.link || 'Family';
      return row;
    });
    return m;
  }
}

/**
 * Proposition d'appliquer « Famille » au conjoint et aux enfants après qu'un
 * principal a été déclaré PPE (BNF-F-04).
 *
 * Tout est modifiable : l'agent décoche qui il veut et change le lien ligne par
 * ligne. Les écritures passent par `setLeadHouseholdMemberPepStatus`, un appel
 * par personne — il n'existe pas d'endpoint de masse au contrat. La fonction, le
 * pays et la date de fin sont ceux du principal : c'est son mandat qui expose le
 * foyer, et l'API refuse une exposition sans fonction.
 */
@Component({
  selector: 'lead-pep-propagation-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasTag,
    TasCheckbox,
    TasSelect,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    Button,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:users" style="font-size:18px"></tas-icon>
          <span>Appliquer l'exposition PPE au foyer</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (submitError(); as message) {
          <div class="mb-4 p-3 rounded-lg border border-functional-error/40 bg-functional-error/5">
            <p class="text-sm text-functional-error">{{ message }}</p>
          </div>
        }

        <div class="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50">
          <p class="text-sm text-slate-700">
            {{ data.principalLabel }} est déclaré politiquement exposé.
          </p>
          <p class="text-xs text-slate-500 mt-1">
            Le lien « Famille » est proposé pour chaque membre du foyer, avec la fonction et
            le pays du principal. Décochez ou changez le lien de qui vous voulez.
          </p>
        </div>

        <form [formRoot]="formSchema" class="flex flex-col gap-3">
          @for (row of formSchema.rows; track row().value().memberId) {
            <div class="rounded-lg border border-slate-200 p-3 flex flex-col gap-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <tas-checkbox [formField]="row.selected">
                    <span class="text-sm font-medium text-slate-800">
                      {{ row().value().label }}
                    </span>
                  </tas-checkbox>
                  <p class="text-xs text-slate-500 mt-1">{{ row().value().typeLabel }}</p>
                </div>
                @if (row().value().alreadyExposed) {
                  <tas-tag severity="warning">Déjà exposé</tas-tag>
                }
              </div>

              @if (row.selected().value()) {
                <tas-form-field>
                  <tas-label>Lien <span class="text-functional-error">*</span></tas-label>
                  <tas-select
                    [options]="linkOptions"
                    placeholder="Lien avec la personne exposée"
                    [formField]="row.link"
                  ></tas-select>
                  @if (row.link().touched() && row.link().invalid()) {
                    <tas-error>{{ row.link().errors()[0].message }}</tas-error>
                  }
                  @if (row().value().alreadyExposed) {
                    <tas-hint>Le statut déjà saisi pour cette personne sera remplacé.</tas-hint>
                  }
                </tas-form-field>
              }
            </div>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">
            Ne pas appliquer
          </button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            (click)="handleSubmit()"
            [disabled]="
              formSchema().invalid() || formSchema().submitting() || selectedCount() === 0
            "
            [isLoading]="formSchema().submitting()"
          >
            Appliquer ({{ selectedCount() }})
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class PepPropagationDrawer {
  public readonly data: PepPropagationDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly linkOptions = PEP_LINK_OPTIONS;
  public readonly submitError = signal<string | null>(null);

  public model = signal(PepPropagationFormModel.fromMembers(this.data.members));

  public formSchema = form(this.model, (schema) => {
    applyEach(schema.rows, (row) => {
      validate(row.link, (ctx) => {
        const value = ctx.valueOf(row);
        if (value.selected && !value.link) {
          return { kind: 'pepLinkRequired', message: 'Le lien est obligatoire' };
        }
        return null;
      });
    });
  });

  public readonly selectedCount = computed(
    () => this.formSchema().value().rows.filter((r) => r.selected).length,
  );

  public handleSubmit(): void {
    this.submitError.set(null);
    submit(this.formSchema, async (field) => {
      const base = this.data.principalPep;
      const selected = field().value().rows.filter((r) => r.selected);
      if (selected.length === 0) {
        this._dialogRef.close(false);
        return;
      }

      const calls: Observable<unknown>[] = selected.map((row) =>
        this._leadsApi.setLeadHouseholdMemberPepStatus(this.data.leadId, row.memberId, {
          pep: pepToDto({
            isPep: true,
            function: base.function,
            countryCode: base.countryCode,
            functionEndDate: base.functionEndDate,
            link: row.link,
            overrideReason: null,
          }),
        }),
      );

      const outcome = await firstValueFrom(
        forkJoin(calls).pipe(
          map(() => 'ok' as const),
          catchError((error: HttpErrorResponse) => {
            const message = pepErrorMessage(error);
            this.submitError.set(message);
            this._snackbar.error(
              'Erreur',
              `${message} Une partie des membres a pu être enregistrée : vérifiez le foyer.`,
            );
            return of('ko' as const);
          }),
        ),
      );

      // Dans les deux cas on referme en demandant un rechargement : un échec
      // partiel est possible, et l'écran doit montrer ce que le serveur a
      // réellement retenu, pas ce qui a été envoyé.
      if (outcome === 'ok') {
        this._snackbar.success(
          'Exposition appliquée',
          `${selected.length} membre(s) du foyer sont désormais déclarés exposés.`,
        );
      }
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}

export default PepDrawer;
