import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, switchMap } from 'rxjs';
import { KycFileDto } from '@sankore/crm-api';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { KycCaps } from '../data-access/kyc.types';
import { KycCapGauge } from '../ui/kyc-cap-gauge';
import { KycStubNotice } from '../ui/kyc-stub-notice';

/**
 * Où l'encart est affiché. Le contexte ne change pas les chiffres, seulement ce qu'on en dit :
 * un guichetier a besoin de savoir **quel** plafond bloque son opération, un agent de crédit de
 * savoir que le crédit est fermé.
 */
export type KycCapsContext = 'customer-file' | 'teller' | 'credit';

/**
 * Plafonds du KYC simplifié (KYC-F-09).
 *
 * Encart réutilisable : fiche client, écran de guichet, instruction de crédit. Il ne s'affiche que
 * si le dossier du client est en KYC simplifié — c'est le seul cas où des plafonds s'appliquent.
 *
 * **Aucun montant n'est écrit ici.** Les deux plafonds du cahier (250 000 et 500 000 FCFA) sont des
 * paramètres métier : ils arrivent par `KycFacadeService.getCaps()`, aujourd'hui bouchonné faute de
 * KYC-B-06. Les figer dans le front rendrait tout changement de politique dépendant d'une livraison.
 */
@Component({
  selector: 'kyc-caps-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-caps-panel.html',
  imports: [TasCard, TasIcon, Button, TasSpinner, KycCapGauge, KycStubNotice],
})
export class KycCapsPanel {
  private readonly _facade = inject(KycFacadeService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly customerId = input.required<string>();
  public readonly context = input<KycCapsContext>('customer-file');

  /**
   * Demande de passage au KYC complet.
   *
   * L'enrôlement n'appartient pas à ce module : l'encart se contente de signaler l'intention.
   * **Contrat attendu du parent** — ouvrir le parcours d'enrôlement sur le client
   * `customerId()`, en mode complément : ne redemander que les éléments absents du dossier
   * simplifié (pièce justificative de domicile, justificatif de revenus, selfie si manquant), et
   * ne jamais repartir d'un formulaire vide. L'identifiant du dossier est disponible via
   * `kycFileId()` pour que le parent n'ait pas à le recharger.
   */
  public readonly upgradeRequested = output<void>();

  public isLoading = signal(true);
  /** Panne de chargement, distincte de « pas de dossier » et de « pas en simplifié ». */
  public loadError = signal<string | null>(null);
  public file = signal<KycFileDto | null>(null);
  public caps = signal<KycCaps | null>(null);

  public readonly kycFileId = computed(() => this.file()?.id ?? null);
  public readonly isSimplified = computed(() => this.file()?.status === 'Simplified');
  /** Rien à montrer : pas de dossier ouvert, ou dossier qui n'est pas en KYC simplifié. */
  public readonly isHidden = computed(
    () => !this.isLoading() && !this.loadError() && !this.isSimplified(),
  );

  /**
   * Plafonds déjà atteints, nommés. Le guichet a besoin du **nom** du plafond bloquant : « opération
   * refusée » sans préciser lequel oblige l'agent à deviner, et à rappeler le support.
   */
  public readonly reachedCaps = computed<string[]>(() => {
    const caps = this.caps();
    if (!caps) return [];
    const reached: string[] = [];
    if (caps.balanceCap > 0 && caps.balance >= caps.balanceCap) {
      reached.push('le plafond de solde');
    }
    if (caps.monthlyFlowCap > 0 && caps.monthlyFlow >= caps.monthlyFlowCap) {
      reached.push('le plafond de flux mensuel');
    }
    return reached;
  });

  public readonly blockingMessage = computed(() => {
    const reached = this.reachedCaps();
    if (reached.length === 0) return null;
    return `Opération impossible : ${reached.join(' et ')} est atteint. Le passage au KYC complet lève la limite.`;
  });

  /**
   * Rechargement à chaque changement de client : l'encart est monté une fois dans une fiche qui,
   * elle, change de client sans être détruite.
   */
  private readonly _reload = effect(() => this._load(this.customerId()));

  public requestUpgrade(): void {
    this.upgradeRequested.emit();
  }

  private _load(customerId: string): void {
    if (!customerId) return;

    this.isLoading.set(true);
    this.loadError.set(null);
    this.file.set(null);
    this.caps.set(null);

    this._facade
      .getFileByCustomer(customerId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          // 404 = aucun dossier KYC ouvert. Ce n'est pas une panne : l'encart disparaît, sans
          // message d'erreur, parce qu'aucun plafond ne s'applique à un client sans dossier.
          if (error.status !== 404) {
            this.loadError.set(
              "Les plafonds du client n'ont pas pu être vérifiés. Ne concluez pas qu'ils sont libres.",
            );
          }
          this.isLoading.set(false);
          return EMPTY;
        }),
        switchMap((file) => {
          this.file.set(file);
          // Les plafonds ne concernent que le KYC simplifié : pas d'appel inutile autrement.
          if (file.status !== 'Simplified') {
            this.isLoading.set(false);
            return EMPTY;
          }
          return this._facade.getCaps(customerId).pipe(
            catchError(() => {
              this.loadError.set(
                "Les plafonds n'ont pas pu être chargés. Ne concluez pas qu'ils sont libres.",
              );
              this.isLoading.set(false);
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((caps) => {
        this.caps.set(caps);
        this.isLoading.set(false);
      });
  }
}
