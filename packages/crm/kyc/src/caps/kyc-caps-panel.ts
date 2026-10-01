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
import { KycCaps, KYC_USAGE_UNAVAILABLE_LABELS } from '../data-access/kyc.types';
import { KycCapGauge } from '../ui/kyc-cap-gauge';

/**
 * Où l'encart est affiché. Le contexte ne change pas les chiffres, seulement ce qu'on en dit :
 * un guichetier a besoin de savoir **quel** plafond bloque son opération, un agent de crédit de
 * savoir que le crédit est fermé.
 */
export type KycCapsContext = 'customer-file' | 'teller' | 'credit';

/**
 * Plafonds du KYC simplifié (KYC-F-09), branchés sur KYC-B-06.
 *
 * Encart réutilisable : fiche client, écran de guichet, instruction de crédit.
 *
 * **Aucun montant n'est écrit ici** — plafonds, devise, largeur de fenêtre et seuil d'alerte
 * viennent de `KycFacadeService.getCaps()`, donc des paramètres du tenant.
 *
 * Deux choses ont changé en branchant le serveur, et aucune n'est cosmétique :
 *
 * 1. **C'est le serveur qui dit qui est plafonné** (`isCapped`), plus le front. L'encart testait
 *    `status === 'Simplified'`, ce qui laissait un dossier **expiré** sans plafonds à l'écran alors
 *    que le serveur, lui, lui applique ceux du KYC simplifié — le guichet voyait « aucune limite »
 *    sur un client limité.
 * 2. **La consommation n'est pas mesurable** : aucun module ne tient de compte ni de transaction, le
 *    serveur répond `null` avec un motif. L'encart le dit et, au guichet, refuse de conclure. Le
 *    bouchon affichait 212 000 / 250 000 comme un fait, c'est-à-dire la marge restante inventée.
 */
@Component({
  selector: 'kyc-caps-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-caps-panel.html',
  imports: [TasCard, TasIcon, Button, TasSpinner, KycCapGauge],
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
  /** Panne de chargement, distincte de « pas de dossier » et de « pas de plafonds ». */
  public loadError = signal<string | null>(null);
  public file = signal<KycFileDto | null>(null);
  public caps = signal<KycCaps | null>(null);

  public readonly kycFileId = computed(() => this.file()?.id ?? null);

  /** Le serveur tranche : un dossier expiré est plafonné, un KYC complet à jour ne l'est pas. */
  public readonly isCapped = computed(() => this.caps()?.isCapped === true);

  /**
   * Dossier expiré : plafonné, mais le remède est la revue périodique, pas un passage au KYC
   * complet — il l'est déjà. Proposer « Passer au KYC complet » enverrait l'agent refaire un
   * enrôlement qui ne lèvera rien.
   */
  public readonly isExpired = computed(() => this.file()?.status === 'Expired');

  /** Rien à montrer : pas de dossier, ou client sans plafond. */
  public readonly isHidden = computed(
    () => !this.isLoading() && !this.loadError() && !this.isCapped(),
  );

  /** La consommation est-elle réellement mesurée ? Un `null` n'est pas un zéro. */
  public readonly usageMeasured = computed(() => {
    const caps = this.caps();
    return !!caps && caps.balance !== null && caps.flow !== null;
  });

  /** Pourquoi la consommation manque, dit à l'agent. Le code vient du serveur. */
  public readonly usageUnavailableMessage = computed(() => {
    const caps = this.caps();
    if (!caps || this.usageMeasured()) return null;
    const reason = caps.usageUnavailableReason;
    return (
      (reason ? KYC_USAGE_UNAVAILABLE_LABELS[reason] : null) ??
      "La consommation des plafonds n'est pas disponible."
    );
  });

  /**
   * La fenêtre est **glissante** et paramétrable par tenant. Le libellé le dit : « ce mois-ci »
   * était faux pour tout tenant qui l'avait changée, et faux le 1er du mois pour les autres.
   */
  public readonly flowLabel = computed(() => {
    const days = this.caps()?.flowWindowDays;
    return days ? `Flux sur ${days} jours glissants` : 'Flux sur la fenêtre glissante';
  });

  /**
   * Plafonds déjà atteints, nommés. Le guichet a besoin du **nom** du plafond bloquant : « opération
   * refusée » sans préciser lequel oblige l'agent à deviner, et à rappeler le support. Calculé sur
   * des valeurs mesurées uniquement — un plafond ne peut pas être « atteint » faute de mesure.
   */
  public readonly reachedCaps = computed<string[]>(() => {
    const caps = this.caps();
    if (!caps) return [];
    const reached: string[] = [];
    if (caps.balance !== null && (caps.balanceCap ?? 0) > 0 && caps.balance >= caps.balanceCap!) {
      reached.push('le plafond de solde');
    }
    if (caps.flow !== null && (caps.flowCap ?? 0) > 0 && caps.flow >= caps.flowCap!) {
      reached.push('le plafond de flux');
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
          // Les plafonds sont demandés dès qu'un dossier existe : c'est `isCapped` qui décide de
          // l'affichage, pas le statut lu ici. Un dossier expiré est plafonné sans être « Simplified ».
          return this._facade.getCaps(customerId).pipe(
            catchError((error: HttpErrorResponse) => {
              // 404 : le dossier n'accorde rien (rejeté, suspendu) ou sort du périmètre d'agence.
              // Pas de plafonds à montrer, et surtout pas d'alarme à lever.
              if (error.status !== 404) {
                this.loadError.set(
                  "Les plafonds n'ont pas pu être chargés. Ne concluez pas qu'ils sont libres.",
                );
              }
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
