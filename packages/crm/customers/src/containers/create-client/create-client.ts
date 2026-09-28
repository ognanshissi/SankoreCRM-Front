import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { clientTypeLabel } from '../../models/client-labels';
import { buildPrefill } from './create-client.utils';
import { CreateIndividualClient } from './create-individual-client';
import { CreateLegalClient } from './create-legal-client';

type ClientTypeChoice = 'Individual' | 'Legal';

/**
 * Point d'entrée de la création d'un client : on fait d'abord choisir le type,
 * puis on monte l'assistant correspondant.
 *
 * La confirmation de sortie est câblée ici et dans chaque assistant plutôt que
 * dans un `CanDeactivate` : les routes du module sont figées par le socle, donc
 * aucun garde ne peut être ajouté sur `/customers/nouveau`.
 */
@Component({
  selector: 'create-client',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasCard,
    TasIcon,
    Button,
    CreateIndividualClient,
    CreateLegalClient,
  ],
  host: {
    '(window:beforeunload)': 'handleBeforeUnload($event)',
  },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-lg font-semibold text-slate-800">Nouveau client</p>
          <p class="text-xs text-slate-400">
            @if (clientType()) {
              {{ clientTypeLabel(clientType()) }} — suivez les étapes de
              l'assistant.
            } @else {
              Choisissez le type de client pour démarrer l'assistant.
            }
          </p>
        </div>

        @if (clientType()) {
          <button
            tas-outlined-button
            color="primary"
            type="button"
            (click)="requestTypeChange()"
          >
            Changer de type
          </button>
        }
      </div>

      @if (!canCreate()) {
        <tas-card class="block">
          <div class="p-6 text-sm text-slate-500">
            Vous n'avez pas le droit de créer un client.
          </div>
        </tas-card>
      } @else if (!clientType()) {
        <div class="grid grid-cols-2 gap-4">
          <tas-card class="block">
            <button
              type="button"
              class="flex w-full cursor-pointer flex-col items-start gap-2 p-5 text-left"
              (click)="choose('Individual')"
            >
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                <tas-icon iconName="feather:user" style="font-size:16px"></tas-icon>
              </span>
              <span class="text-sm font-semibold text-slate-800">
                Personne physique
              </span>
              <span class="text-xs text-slate-400">
                Identité, pièce déclarée, coordonnées, situation professionnelle
                et familiale.
              </span>
            </button>
          </tas-card>

          <tas-card class="block">
            <button
              type="button"
              class="flex w-full cursor-pointer flex-col items-start gap-2 p-5 text-left"
              (click)="choose('Legal')"
            >
              <span
                class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"
              >
                <tas-icon
                  iconName="feather:briefcase"
                  style="font-size:16px"
                ></tas-icon>
              </span>
              <span class="text-sm font-semibold text-slate-800">
                Personne morale
              </span>
              <span class="text-xs text-slate-400">
                Identification, siège et contacts, représentant légal,
                bénéficiaires effectifs.
              </span>
            </button>
          </tas-card>
        </div>
      } @else if (clientType() === 'Individual') {
        <create-individual-client [prefill]="prefill()"></create-individual-client>
      } @else {
        <create-legal-client [prefill]="prefill()"></create-legal-client>
      }
    </div>
  `,
})
export class CreateClientPage implements OnInit {
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _route = inject(ActivatedRoute);

  /**
   * La liste des clients envoie sa recherche infructueuse dans `q` + `critere` :
   * l'assistant reprend la saisie au lieu de la faire retaper.
   */
  private readonly _queryParams = toSignal(this._route.queryParamMap, {
    initialValue: this._route.snapshot.queryParamMap,
  });
  public readonly prefill = computed(() =>
    buildPrefill(this._queryParams().get('q'), this._queryParams().get('critere')),
  );

  public readonly canCreate = this._permissions.can('customers:create');
  public readonly clientTypeLabel = clientTypeLabel;

  public clientType = signal<ClientTypeChoice | null>(null);

  private readonly _individualWizard = viewChild(CreateIndividualClient);
  private readonly _legalWizard = viewChild(CreateLegalClient);

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Clients', link: ['/customers'] },
      { label: 'Nouveau client' },
    ]);
  }

  public choose(type: ClientTypeChoice): void {
    this.clientType.set(type);
  }

  public requestTypeChange(): void {
    if (!this._isDirty()) {
      this.clientType.set(null);
      return;
    }

    this._confirmDialogService.confirm({
      title: 'Changer de type de client ?',
      message:
        'Les informations déjà saisies seront perdues. Voulez-vous continuer ?',
      closable: true,
      showCancelButton: true,
      icon: 'feather:alert-triangle',
      acceptButtonProps: { label: 'Changer de type', theme: 'warn' },
      rejectButtonProps: { label: 'Continuer la saisie', theme: 'primary' },
      accept: () => this.clientType.set(null),
    });
  }

  /**
   * Appelé par la garde `canDeactivate` de la route : couvre la navigation interne
   * (retour navigateur, clic dans le menu), que `beforeunload` ne voit pas — il ne se
   * déclenche qu'à la fermeture de l'onglet ou au rechargement de la page.
   *
   * Toutes les sorties du dialogue émettent `accept` ou `reject`, croix comprise, et le
   * CDK est ouvert avec `disableClose` : la promesse est donc toujours résolue. Si ce
   * n'était pas le cas, une promesse pendante bloquerait la navigation définitivement.
   */
  public canLeave(): boolean | Promise<boolean> {
    if (!this._isDirty()) return true;

    return new Promise<boolean>((resolve) => {
      this._confirmDialogService.confirm({
        title: 'Quitter la création ?',
        message:
          'Les informations déjà saisies seront perdues. Le client ne sera pas créé.',
        closable: true,
        showCancelButton: true,
        icon: 'feather:alert-triangle',
        acceptButtonProps: { label: 'Quitter sans créer', theme: 'warn' },
        rejectButtonProps: { label: 'Continuer la saisie', theme: 'primary' },
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
  }

  /** Dernier filet : le navigateur demande confirmation avant de perdre la saisie. */
  public handleBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this._isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private _isDirty(): boolean {
    return (
      this._individualWizard()?.isDirty() ??
      this._legalWizard()?.isDirty() ??
      false
    );
  }
}

export default CreateClientPage;
