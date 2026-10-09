import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import {
  FormField,
  FormRoot,
  form,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasFileUploader } from '@talisoft/ui/file-uploader';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import {
  CLAIM_DOCUMENT_ACCEPT,
  CLAIM_DOCUMENT_MAX_SIZE_MB,
  CLAIM_NATURES,
} from '../data-access/integration-referential';
import { PendingIntegrationEndpoints } from '../data-access/pending-endpoints';

export interface DeclareClaimDrawerData {
  policyId: string;
  productName: string;
}

/** Une pièce retenue, avant envoi. */
interface PendingDocument {
  id: string;
  file: File;
  sizeLabel: string;
}

class DeclareClaimFormModel {
  public occurredOn!: string;
  public nature!: string;
  public description!: string;

  public static instantiate(): DeclareClaimFormModel {
    const m = new DeclareClaimFormModel();
    m.occurredOn = '';
    m.nature = '';
    m.description = '';
    return m;
  }
}

/**
 * Déclaration d'un sinistre — ASS-17.
 *
 * **Aucun endpoint de sinistre n'est déclaré dans le swagger** : le lot back ASS-09
 * n'est pas livré. L'envoi passe donc par `PendingIntegrationEndpoints.declareClaim()`,
 * qui répond `null`, et le drawer **n'annonce jamais un succès sur ce `null`** — c'est
 * exactement le travers que les conventions du dépôt interdisent (« un 200 ne prouve pas
 * que le serveur a tout enregistré »). La saisie, les contrôles de format et de poids et
 * la liste des pièces fonctionnent pour de vrai et resteront tels quels.
 *
 * À l'arrivée de l'endpoint : mettre à jour `swaggers/sankore-crm-api-swagger.json`,
 * lancer `npm run openapi-generator`, nommer la méthode dans `IntegrationFacadeService`,
 * puis remplacer l'appel ci-dessous et retirer le bandeau.
 */
@Component({
  selector: 'declare-claim-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasAlert,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasFileUploader,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Déclarer un sinistre</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div>
            <p class="text-sm font-medium text-slate-800">{{ data.productName }}</p>
            <p class="text-xs text-slate-500 mt-0.5">
              La déclaration est transmise à l'assureur, qui vous dira s'il lui manque une
              pièce.
            </p>
          </div>

          @if (isPending) {
            <tas-alert type="info">
              <p class="text-sm font-medium">La transmission attend une livraison serveur</p>
              <p class="text-xs mt-1">
                Vous pouvez préparer la déclaration et vérifier les pièces, mais elle ne
                partira pas encore à l'assureur. Déclarez le sinistre par votre canal
                habituel en attendant.
              </p>
            </tas-alert>
          }

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>
                Date du sinistre <span class="text-functional-error">*</span>
              </tas-label>
              <input tasInput type="date" [formField]="formSchema.occurredOn" />
              @if (formSchema.occurredOn().touched() && formSchema.occurredOn().invalid()) {
                <tas-error>{{ formSchema.occurredOn().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>Nature <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="natureOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Choisissez la nature du sinistre"
                [formField]="formSchema.nature"
              ></tas-select>
              @if (formSchema.nature().touched() && formSchema.nature().invalid()) {
                <tas-error>{{ formSchema.nature().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>
                Description <span class="text-functional-error">*</span>
              </tas-label>
              <textarea
                tasInput
                rows="4"
                placeholder="Ce qui s'est passé, en quelques phrases."
                [formField]="formSchema.description"
              ></textarea>
              <tas-hint>
                N'inscrivez ici que ce qui est nécessaire au traitement du dossier.
              </tas-hint>
              @if (formSchema.description().touched() && formSchema.description().invalid()) {
                <tas-error>{{ formSchema.description().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </form>

          <!--
            Pièces justificatives. La zone de dépôt du kit porte le glisser-déposer, le
            filtre d'extensions et le plafond de poids, mais ne retient qu'un fichier : on
            la vide après chaque ajout pour construire la liste. Les limites sont annoncées
            AVANT l'erreur, pas seulement après un refus.
          -->
          <div class="flex flex-col gap-3">
            <div>
              <p class="text-sm font-medium text-slate-800">Pièces justificatives</p>
              <p class="text-xs text-slate-500 mt-0.5">
                Formats acceptés : PDF, JPG et PNG. {{ maxSizeMb }} Mo au plus par pièce.
              </p>
            </div>

            <tas-file-uploader
              [accept]="accept"
              [maxSizeMb]="maxSizeMb"
              [value]="nextFile()"
              (valueChange)="onFilePicked($event)"
            ></tas-file-uploader>

            @if (documents().length > 0) {
              <ul class="divide-y divide-slate-100 rounded-lg border border-slate-200">
                @for (doc of documents(); track doc.id) {
                  <li class="flex items-center gap-3 p-3">
                    <tas-icon
                      iconName="feather:file"
                      class="shrink-0 text-slate-400"
                      style="font-size:15px"
                    ></tas-icon>
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-sm text-slate-800">{{ doc.file.name }}</p>
                      <p class="text-xs text-slate-500 tabular-nums">{{ doc.sizeLabel }}</p>
                    </div>
                    <button
                      tas-button
                      iconButton
                      type="button"
                      color="warn"
                      title="Retirer cette pièce"
                      (click)="removeDocument(doc.id)"
                    >
                      <tas-icon iconName="feather:x" style="font-size:14px"></tas-icon>
                    </button>
                  </li>
                }
              </ul>
            } @else {
              <p class="text-xs text-slate-500">
                Aucune pièce ajoutée. Vous pouvez déclarer sans pièce et les fournir plus
                tard, si l'assureur en demande.
              </p>
            }
          </div>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">
          Annuler
        </button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          Déclarer le sinistre
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class DeclareClaimDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _snackbar = inject(SnackbarService);

  /** `PendingIntegrationEndpoints` n'est pas un service Angular : il s'instancie. */
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly data = inject<DeclareClaimDrawerData>(DIALOG_DATA);

  public readonly isPending = PendingIntegrationEndpoints.isPending;
  public readonly accept = CLAIM_DOCUMENT_ACCEPT;
  public readonly maxSizeMb = CLAIM_DOCUMENT_MAX_SIZE_MB;
  public readonly natureOptions = CLAIM_NATURES.map((n) => ({ ...n }));

  public readonly documents = signal<PendingDocument[]>([]);
  public readonly nextFile = signal<File | null>(null);

  public readonly model = signal(DeclareClaimFormModel.instantiate());

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.occurredOn, { message: 'La date du sinistre est obligatoire' });
    validate(schema.occurredOn, ({ value }) => {
      const raw = value();
      if (!raw) return null;
      // Comparaison sur la chaîne `yyyy-MM-dd` du champ : passer par `Date` ramènerait
      // le décalage UTC qui fait basculer « aujourd'hui » à la veille.
      const today = new Date().toISOString().slice(0, 10);
      return raw <= today
        ? null
        : { kind: 'future', message: 'La date ne peut pas être dans le futur' };
    });
    required(schema.nature, { message: 'La nature du sinistre est obligatoire' });
    required(schema.description, { message: 'La description est obligatoire' });
    validate(schema.description, ({ value }) => {
      const text = (value() ?? '').trim();
      return text.length >= 20
        ? null
        : { kind: 'tooShort', message: 'Décrivez le sinistre en 20 caractères au moins' };
    });
  });

  public readonly documentCount = computed(() => this.documents().length);

  public onFilePicked(file: File | null): void {
    if (!file) {
      this.nextFile.set(null);
      return;
    }

    const alreadyAdded = this.documents().some(
      (d) => d.file.name === file.name && d.file.size === file.size,
    );
    if (alreadyAdded) {
      this._snackbar.info('Pièce déjà ajoutée', `« ${file.name} » est déjà dans la liste.`);
    } else {
      this.documents.update((list) => [
        ...list,
        { id: `${file.name}-${file.size}-${Date.now()}`, file, sizeLabel: formatSize(file.size) },
      ]);
    }

    // La zone de dépôt est vidée pour accueillir la pièce suivante : sans ça elle
    // afficherait indéfiniment la dernière, comme si une seule était retenue.
    this.nextFile.set(null);
  }

  public removeDocument(id: string): void {
    this.documents.update((list) => list.filter((d) => d.id !== id));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async () => {
      const created = await firstValueFrom(this._pending.declareClaim());

      // `declareClaim()` répond `null` tant que l'endpoint n'est pas livré. Annoncer
      // « Sinistre déclaré » ici ferait croire à l'agent que l'assureur est au courant.
      if (!created) {
        this._snackbar.info(
          'Déclaration non transmise',
          "L'envoi à l'assureur attend une livraison serveur. Déclarez le sinistre par votre canal habituel.",
        );
        return;
      }

      this._snackbar.success(
        'Sinistre déclaré',
        'La déclaration est partie à l’assureur. Son avancement se suit dans la fiche du client.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}

function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} Ko` : `${(kb / 1024).toFixed(1)} Mo`;
}
