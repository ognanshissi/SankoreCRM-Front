import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import {
  isBlockingFlag,
  kycConfidenceMeta,
  kycFlagMeta,
  KycFlagSeverity,
} from '../data-access/kyc-referential';
import { KycVerificationDetail } from '../data-access/kyc.types';
import { KycScoreGauge } from '../ui/kyc-score-gauge';

/** Ordre d'affichage des flags : ce qui bloque d'abord, l'information en dernier. */
const FLAG_GROUPS: { severity: KycFlagSeverity; title: string; hint: string }[] = [
  {
    severity: 'blocking',
    title: 'Bloquant',
    hint: 'À corriger avant de pouvoir soumettre le dossier.',
  },
  { severity: 'warning', title: 'À vérifier', hint: 'Le dossier peut être soumis en l’état.' },
  { severity: 'info', title: 'Information', hint: 'Aucune action attendue.' },
];

/**
 * Score de confiance du dossier (KYC-F-04) : niveau, score sur 100, détail par composante, flags, et
 * la décision de soumission qui en découle.
 *
 * Deux usages : en tête du récapitulatif d'enrôlement, et dans l'onglet « Score de confiance » de la
 * fiche détaillée (KYC-F-08). D'où l'entrée `kycFileId` plutôt qu'un détail déjà chargé — le bloc
 * reste responsable de son propre rechargement.
 *
 * **L'hôte doit appeler `refresh()`** après une correction de champ ou une nouvelle photo : le
 * serveur re-note le dossier à cette occasion (`POST /kyc-files/{id}/corrections`), et sans cet
 * appel l'écran continuerait d'afficher le score d'avant la correction.
 *
 * Le détail par composante est délibérément en HTML ordinaire et non en `tas-table` : quatre valeurs
 * fixes décrivant un même objet ne sont pas une collection d'entités.
 */
@Component({
  selector: 'kyc-score-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kyc-score-panel.html',
  imports: [Button, TasCard, TasIcon, TasSpinner, TasTag, KycScoreGauge],
})
export class KycScorePanel {
  private readonly _facade = inject(KycFacadeService);

  public readonly kycFileId = input.required<string>();

  /**
   * Charge technique brute : réservée aux profils autorisés (`customers:reveal_sensitive`). L'hôte
   * lie cette entrée à la permission, le bloc ne la teste pas lui-même pour rester réutilisable.
   */
  public readonly canSeeRawDetail = input<boolean>(false);

  /**
   * Le bloc est réutilisé par l'enrôlement **et** par la fiche détaillée. Seul le premier a une
   * action à proposer : sur la fiche, le bouton ne menait à rien — son gestionnaire se contentait
   * d'un message disant d'aller ailleurs, ce qui est un bouton mort déguisé. L'action est donc
   * désormais explicitement demandée par l'hôte.
   */
  public readonly showSubmitAction = input<boolean>(false);

  public readonly submitRequested = output<void>();

  public readonly isLoading = signal(true);
  public readonly hasFailed = signal(false);
  public readonly detail = signal<KycVerificationDetail | null>(null);
  public readonly showRaw = signal(false);

  /** Jeton de rechargement : `refresh()` le fait avancer, l'effet relit le détail. */
  private readonly _reloadToken = signal(0);

  public readonly confidence = computed(() => kycConfidenceMeta(this.detail()?.level));

  /** Flags regroupés par gravité, groupes vides retirés. */
  public readonly flagGroups = computed(() => {
    const codes = this.detail()?.flagCodes ?? [];
    const decorated = codes.map((code) => ({ code, meta: kycFlagMeta(code) }));
    return FLAG_GROUPS.map((group) => ({
      ...group,
      flags: decorated.filter((flag) => flag.meta.severity === group.severity),
    })).filter((group) => group.flags.length > 0);
  });

  /**
   * Actions à mener quand la soumission est refusée. Le libellé d'un flag bloquant **est** l'action :
   * « La pièce d'identité est expirée » se lit comme ce qu'il faut corriger.
   */
  public readonly blockingActions = computed(() =>
    (this.detail()?.flagCodes ?? []).filter(isBlockingFlag).map((code) => kycFlagMeta(code).label),
  );

  public readonly canSubmit = computed(() => this.confidence().canSubmit);
  public readonly warnOnSubmit = computed(() => this.confidence().canSubmit && this.confidence().warnOnSubmit);

  public readonly rawJson = computed(() => {
    const payload = this.detail()?.rawPayload;
    return payload ? JSON.stringify(payload, null, 2) : '';
  });

  constructor() {
    effect(() => {
      const kycFileId = this.kycFileId();
      this._reloadToken();

      this.isLoading.set(true);
      this.hasFailed.set(false);

      this._facade
        .getVerificationDetail(kycFileId)
        .pipe(
          catchError(() => {
            // Pas de snackbar ici : le bloc est imbriqué dans un écran qui a déjà ses propres
            // messages, et un toast par bloc rendrait l'écran illisible. L'état d'erreur est rendu.
            this.hasFailed.set(true);
            this.isLoading.set(false);
            return EMPTY;
          }),
        )
        .subscribe((detail) => {
          this.detail.set(detail);
          this.isLoading.set(false);
        });
    });
  }

  /**
   * Recharge le score. À appeler par l'hôte après une correction de champ ou une nouvelle photo :
   * c'est le critère « le score est recalculé après correction » de KYC-F-04.
   */
  public refresh(): void {
    this._reloadToken.update((token) => token + 1);
  }

  public toggleRaw(): void {
    this.showRaw.update((shown) => !shown);
  }


  public handleSubmit(): void {
    if (!this.canSubmit()) return;
    this.submitRequested.emit();
  }
}
