import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import {
  DuplicateMatchResult,
  DuplicateMatchResultStatusEnum,
} from '@sankore/crm-api';

/**
 * Le refus de création prononcé par le serveur, tel qu'il doit être lu par l'agent.
 *
 * Les deux textes viennent de la réponse du serveur et ne sont pas composés ici : le bandeau
 * n'a pas à savoir qu'un lead converti se raconte autrement qu'un lead encore ouvert.
 */
export interface DuplicateRefusal {
  title: string;
  message: string;
}

/**
 * Les correspondances de lead déjà existantes, et — quand il y en a eu un — le refus qui les a
 * fait apparaître.
 *
 * <b>Deux états, et c'est la différence entre un avertissement et un refus.</b> Pendant la
 * saisie, le bandeau est ambre et prévient : un lead ressemblant existe, à l'agent de voir.
 * Après un refus serveur il est rouge et constate : le lead n'a pas été créé, et la raison est
 * celle que le serveur a donnée. Les confondre laissait l'agent cliquer « Créer » plusieurs
 * fois sur un formulaire qui ne pouvait pas aboutir.
 */
@Component({
  selector: 'duplicate-warning-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasIcon],
  template: `
    @if (duplicates().length > 0) {
      @if (refusal(); as refused) {
        <div
          class="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm"
          role="alert"
        >
          <tas-icon
            iconName="feather:x-octagon"
            class="text-red-600 shrink-0 mt-0.5"
          ></tas-icon>
          <div class="flex-1">
            <p class="font-medium text-red-800">{{ refused.title }}</p>
            <p class="text-red-700 mt-1">{{ refused.message }}</p>
            <p class="text-red-700 mt-1">
              {{ duplicates()[0].fullName }} — {{ duplicates()[0].phoneNumber }}
            </p>
            @if (duplicates().length > 1) {
              <p class="text-red-600 mt-1">
                + {{ duplicates().length - 1 }} autre(s) correspondance(s)
              </p>
            }

            <!--
              Les deux issues du refus. Sans elles le bandeau constate sans rien proposer, et la
              seule sortie est d'abandonner la saisie : c'est le motif déjà en place sur
              l'assistant de conversion, dont le libellé « créer quand même » est repris tel quel.
            -->
            <div class="flex flex-wrap items-center gap-3 mt-3">
              @if (isConverted()) {
                <button
                  tas-raised-button
                  color="primary"
                  type="button"
                  class="text-xs"
                  [disabled]="busy()"
                  [isLoading]="busy()"
                  (click)="retainCustomerOf.emit(duplicates()[0])"
                >
                  C'est ce client
                </button>
              }
              <button
                tas-outlined-button
                color="primary"
                type="button"
                class="text-xs"
                [disabled]="busy()"
                (click)="createAnyway.emit()"
              >
                Ce n'est pas la même personne, créer quand même
              </button>
              <button
                type="button"
                class="text-red-800 underline font-medium cursor-pointer text-xs"
                (click)="viewDuplicate.emit(duplicates()[0].leadId!)"
              >
                Voir le lead existant
              </button>
            </div>
          </div>
        </div>
      } @else {
        <div class="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <tas-icon iconName="feather:alert-triangle" class="text-amber-600 shrink-0 mt-0.5"></tas-icon>
          <div class="flex-1">
            <p class="font-medium text-amber-800">Doublon potentiel détecté</p>
            <p class="text-amber-700 mt-1">
              {{ duplicates()[0].fullName }} — {{ duplicates()[0].phoneNumber }}
            </p>
            <button
              type="button"
              class="text-amber-800 underline font-medium mt-1 cursor-pointer"
              (click)="viewDuplicate.emit(duplicates()[0].leadId!)"
            >
              Voir le lead existant
            </button>
            @if (duplicates().length > 1) {
              <p class="text-amber-600 mt-1">
                + {{ duplicates().length - 1 }} autre(s) correspondance(s)
              </p>
            }
          </div>
        </div>
      }
    }
  `,
})
export class DuplicateWarningBanner {
  public duplicates = input<DuplicateMatchResult[]>([]);

  /**
   * Null tant que rien n'a été refusé — c'est l'état de la détection en cours de saisie, et le
   * seul que connaissent les écrans qui ne postent pas encore.
   */
  public refusal = input<DuplicateRefusal | null>(null);

  /** Une écriture est en cours : les deux issues du refus ne doivent pas être relancées. */
  public busy = input(false);

  public viewDuplicate = output<string>();

  /**
   * « C'est ce client » — proposé uniquement quand le lead en doublon est converti, donc qu'il
   * existe une fiche client derrière. Sur un lead encore ouvert il n'y a rien à retenir, et le
   * bouton enverrait l'agent vers une fiche qui n'existe pas.
   */
  public retainCustomerOf = output<DuplicateMatchResult>();

  /** « Ce n'est pas la même personne » : à l'hôte de reposter en passant outre la détection. */
  public createAnyway = output<void>();

  protected readonly isConverted = computed(
    () => this.duplicates()[0]?.status === DuplicateMatchResultStatusEnum.Converted,
  );
}
