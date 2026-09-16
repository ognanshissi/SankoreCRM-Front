import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, filter, firstValueFrom } from 'rxjs';
import { NgClass } from '@angular/common';
import { Dialog } from '@angular/cdk/dialog';
import { TasTitle } from '@talisoft/ui/title';
import { TasCard, TasCardHeader } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { AgenciesApiService, AgencyDto, AgencyType } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { DeleteAgencyDialog } from './delete-agency-dialog';
import { BreadcrumbService } from '@sankore/crm/common';

class EditAgencyFormModel {
  public name!: string;
  public description!: string;
  public agencyType!: AgencyType;
  public addressStreet!: string;
  public addressCity!: string;
  public addressZipCode!: string;
  public addressCountry!: string;

  public static fromAgency(agency: AgencyDto): EditAgencyFormModel {
    const m = new EditAgencyFormModel();
    m.name = agency.name ?? '';
    m.description = agency.description ?? '';
    m.agencyType = (Number(agency.agencyType) as AgencyType) ?? AgencyType.NUMBER_3;
    m.addressStreet = agency.addressStreet ?? '';
    m.addressCity = agency.addressCity ?? '';
    m.addressZipCode = agency.addressZipCode ?? '';
    m.addressCountry = agency.addressCountry ?? '';
    return m;
  }
}

class MoveAgencyFormModel {
  public newParentAgencyId!: string;

  public static instantiate(): MoveAgencyFormModel {
    const m = new MoveAgencyFormModel();
    m.newParentAgencyId = '';
    return m;
  }
}

const AGENCY_TYPE_OPTIONS = [
  { label: 'HeadQuarter', value: AgencyType.NUMBER_0 },
  { label: 'Région', value: AgencyType.NUMBER_1 },
  { label: 'Zone', value: AgencyType.NUMBER_2 },
  { label: 'Agence', value: AgencyType.NUMBER_3 },
];

@Component({
  selector: 'edit-agency',
  templateUrl: './edit-agency.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    NgClass,
    TasTitle,
    TasCard,
    TasCardHeader,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
    TasSpinner,
    FormRoot,
    FormField,
  ],
})
export class EditAgencyPage {
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _dialog = inject(Dialog);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();

  public readonly agencyTypeOptions = AGENCY_TYPE_OPTIONS;

  public isLoading = signal(true);
  public isPromoting = signal(false);
  public isMoving = signal(false);
  public isDeleting = signal(false);

  public agency = signal<AgencyDto | null>(null);
  public availableParents = signal<{ label: string; value: string }[]>([]);

  public updateModel = signal(new EditAgencyFormModel());
  public updateFormSchema = form(this.updateModel, (schema) => {
    required(schema.name, { message: "Le nom de l'agence est obligatoire" });
  });

  public moveModel = signal(MoveAgencyFormModel.instantiate());
  public moveFormSchema = form(this.moveModel, (_schema) => {});

  public isHQ = computed(
    () =>
      this.agency()?.isHeadQuarterAgency === true ||
      !this.agency()?.parentAgencyId,
  );

  constructor() {
    effect(() => {
      this.loadAgency(this.id());
    });
  }

  public handleUpdate(): void {
    submit(this.updateFormSchema, async (field) => {
      const value = field()?.value();
      await firstValueFrom(
        this._agenciesApiService
          .updateAgency(this.id(), {
            name: value.name,
            description: value.description || null,
            agencyType: value.agencyType,
            addressStreet: value.addressStreet || null,
            addressCity: value.addressCity || null,
            addressZipCode: value.addressZipCode || null,
            addressCountry: value.addressCountry || null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                "Impossible de mettre à jour l'agence, réessayez plus tard.",
              );
              return EMPTY;
            }),
          ),
      );
      this._snackbarService.success('Succès', 'Agence mise à jour avec succès');
      // this.agency.update((a) => (a ? { ...a, ...field()?.value() } : a));
    });
  }

  public promoteToParent(): void {
    this._confirmDialogService.confirm({
      title: 'Promouvoir en agence principale',
      message:
        "Cette action retirera le parent de l'agence et la placera au niveau racine. Continuer ?",
      closable: true,
      acceptButtonProps: { label: 'Promouvoir', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isPromoting.set(true);
        this._agenciesApiService
          .moveAgency(this.id(), { newParentAgencyId: null })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                "Impossible de promouvoir l'agence.",
              );
              this.isPromoting.set(false);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success(
              'Succès',
              'Agence promue au niveau racine.',
            );
            this.agency.update((a) =>
              a ? { ...a, parentAgencyId: null, isHeadQuarterAgency: true } : a,
            );
            this.isPromoting.set(false);
          });
      },
    });
  }

  public handleMove(): void {
    submit(this.moveFormSchema, async (field) => {
      const { newParentAgencyId } = field()?.value() ?? {};
      if (!newParentAgencyId) return;

      await firstValueFrom(
        this._agenciesApiService
          .moveAgency(this.id(), { newParentAgencyId })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                "Impossible de déplacer l'agence, réessayez plus tard.",
              );
              return EMPTY;
            }),
          ),
      );

      const parent = this.availableParents().find(
        (p) => p.value === newParentAgencyId,
      );
      this._snackbarService.success(
        'Succès',
        `Agence déplacée vers "${parent?.label ?? 'nouvelle agence parente'}".`,
      );
      this.agency.update((a) =>
        a ? { ...a, parentAgencyId: newParentAgencyId } : a,
      );
    });
  }

  public openDeleteDialog(): void {
    const ref = this._dialog.open<boolean>(DeleteAgencyDialog, {
      width: '480px',
      data: { agencyName: this.agency()?.name ?? '' },
    });

    ref.closed.pipe(filter(Boolean)).subscribe(() => {
      this.isDeleting.set(true);
      this._agenciesApiService
        .deleteAgency(this.id())
        .pipe(
          catchError(() => {
            this._snackbarService.error('Erreur', "Impossible de supprimer l'agence.");
            this.isDeleting.set(false);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this._snackbarService.success('Succès', 'Agence supprimée avec succès.');
          this._router.navigate(['/settings/agencies']);
        });
    });
  }

  private loadAgency(id: string): void {
    this.isLoading.set(true);
    this._agenciesApiService.getAgency(id).subscribe({
      next: (agency) => {
        this.agency.set(agency);
        this.updateModel.set(EditAgencyFormModel.fromAgency(agency));
        this.isLoading.set(false);
        this._loadAvailableParents(id);
        this._breadcrumbService.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: 'Agences', link: ['/settings/agencies'] },
          { label: agency.name ?? 'Agence' },
        ]);
      },
      error: () => {
        this._snackbarService.error(
          'Erreur',
          "Impossible de charger l'agence.",
        );
        this.isLoading.set(false);
      },
    });
  }

  private _loadAvailableParents(excludeId: string): void {
    this._agenciesApiService.listAgencies(false, 1, 0).subscribe({
      next: (result) => {
        const options = (result.items ?? [])
          .filter((a) => a.id !== excludeId)
          .map((a) => ({ label: a.name ?? '', value: a.id ?? '' }));
        this.availableParents.set(options);
      },
    });
  }
}

export default EditAgencyPage;
