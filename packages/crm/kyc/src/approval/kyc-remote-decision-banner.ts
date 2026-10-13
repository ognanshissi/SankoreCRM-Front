import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { KycFileDto, ProductsApiService } from '@sankore/crm-api';
import { kycDocumentKindLabel, kycRoutingReasonLabel } from '../data-access/kyc-referential';

/**
 * Bandeau de tête d'un dossier collecté à distance (KRM-F-08).
 *
 * **Pourquoi un bandeau séparé et non trois lignes dans l'écran de décision.** Un validateur qui
 * ouvre un dossier à distance regarde quelque chose de différent d'un dossier de guichet : aucun
 * employé n'a vu la pièce, et le motif pour lequel la machine n'a pas tranché est l'information qui
 * oriente toute sa lecture. Mise au milieu des autres cartes, elle se lit après le score — c'est-à-
 * dire trop tard.
 *
 * **Il ne s'affiche pas du tout pour un dossier de guichet** (`channel !== RemoteSelfService`) :
 * un bandeau permanent disant « canal agence » serait du bruit sur la quasi-totalité des dossiers.
 *
 * **Le motif est traduit, jamais affiché en code.** Le serveur renvoie `SCORE_BELOW_THRESHOLD` ;
 * `kycRoutingReasonLabel` en fait une phrase, et un code qu'elle ne connaît pas devient une
 * consigne générique au lieu d'un identifiant technique sous les yeux d'un chef d'agence.
 */
@Component({
  selector: 'kyc-remote-decision-banner',
  imports: [DatePipe, TasCard, TasIcon, TasTag],
  template: `
    @if (isRemote()) {
      <tas-card class="block">
        <div class="p-4 flex flex-col gap-3">
          <div class="flex items-start gap-3">
            <tas-icon
              iconName="feather:smartphone"
              class="text-primary shrink-0 mt-0.5"
              style="font-size:16px"
            ></tas-icon>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <p class="text-sm font-semibold text-slate-800">Dossier déposé à distance</p>
                <tas-tag severity="info">À distance</tas-tag>
                @if (isAutomatic()) {
                  <tas-tag severity="success">Validé automatiquement</tas-tag>
                }
              </div>
              <p class="text-xs text-slate-500 mt-0.5">
                Le client a photographié ses pièces depuis son téléphone. Aucun employé ne les a
                vues.
              </p>
            </div>
          </div>

          <!-- Produit et motif de routage : les deux faits qui orientent la lecture. -->
          <dl class="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-xs text-slate-400">Produit souscrit</dt>
              <dd class="text-slate-800">{{ productName() ?? 'Non renseigné' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Motif de routage</dt>
              <dd class="text-slate-800">
                @if (isAutomatic()) {
                  Toutes les conditions de la politique produit étaient réunies.
                } @else {
                  {{ routingReason() }}
                }
              </dd>
            </div>
          </dl>

          <!-- Reprises de photo excessives : un signal sur la capture, pas sur le client. -->
          @if (excessiveRetakes().length > 0) {
            <div class="flex gap-3 p-3 rounded-lg bg-orange-50 border border-orange-200">
              <tas-icon
                iconName="feather:camera-off"
                class="text-orange-700 shrink-0 mt-0.5"
                style="font-size:14px"
              ></tas-icon>
              <div class="text-sm text-slate-700">
                <p class="font-medium">Reprises de photo nombreuses</p>
                <p class="text-xs text-slate-600 mt-0.5">
                  Le client a dépassé le nombre de reprises prévu pour
                  {{ excessiveRetakes().join(', ') }}. Le dépôt a été accepté malgré tout —
                  regardez ces images de plus près.
                </p>
              </div>
            </div>
          }

          <!-- Preuve du consentement biométrique : une date et une version, pas une case cochée. -->
          <p class="text-xs text-slate-500">
            @if (consentGivenAt(); as given) {
              Consentement au traitement des données biométriques recueilli le
              <span class="font-medium text-slate-700">{{ given | date: 'dd/MM/yyyy à HH:mm' }}</span>
              (texte {{ consentVersion() ?? 'non versionné' }}).
            } @else {
              <span class="text-functional-error">
                Aucun consentement enregistré sur ce dossier : à signaler à la conformité avant de
                valider.
              </span>
            }
          </p>
        </div>
      </tas-card>
    }
  `,
})
export class KycRemoteDecisionBanner implements OnInit {
  private readonly _products = inject(ProductsApiService);

  public readonly file = input.required<KycFileDto | null>();

  public readonly isRemote = computed(() => this.file()?.channel === 'RemoteSelfService');
  public readonly isAutomatic = computed(() => this.file()?.validationRoute === 'Automatic');

  public readonly routingReason = computed(() => kycRoutingReasonLabel(this.file()?.routingReason));
  public readonly consentGivenAt = computed(() => this.file()?.consentGivenAt ?? null);
  public readonly consentVersion = computed(() => this.file()?.consentTextVersion ?? null);

  /** Les natures de pièce, en français : le serveur renvoie des noms d'enum. */
  public readonly excessiveRetakes = computed(() =>
    (this.file()?.excessiveQualityRetries ?? []).map(kycDocumentKindLabel),
  );

  public productName = signal<string | null>(null);

  ngOnInit(): void {
    // Le DTO porte l'identifiant de la ligne produit, pas son nom : c'est une référence opaque
    // vers le catalogue M12, et le dossier KYC ne duplique pas un libellé que l'administrateur
    // peut renommer. Chargé à part, et une absence n'est pas une erreur — un dossier de guichet
    // n'a pas de produit du tout.
    const lineId = this.file()?.productLineId;
    if (!lineId || !this.isRemote()) return;

    this._products
      .getProduct(lineId)
      .pipe(catchError(() => EMPTY))
      .subscribe((product) => this.productName.set(product?.name ?? null));
  }
}
