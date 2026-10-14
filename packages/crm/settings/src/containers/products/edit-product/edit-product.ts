import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  LOCALE_ID,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  form,
  FormField,
  FormRoot,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { ProductDto, ProductsApiService } from '@sankore/crm-api';
import {
  BreadcrumbService,
  PermissionsService,
  productCategoryLabel,
} from '@sankore/crm/common';
import { ProductParametersEditor } from '../product-parameters-editor';
import { QualificationTemplatesPanel } from '../qualification-templates-panel';
import { BeneficiaryPolicyEditor } from '../beneficiary-policy-editor';
import { KycRemotePolicyEditor } from '../kyc-remote-policy-editor';

const NAME_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 1000;

/**
 * L'icône qui représente la catégorie dans le médaillon d'identité.
 *
 * Indexée sur les neuf valeurs du contrat : en ajouter une au serveur sans l'ajouter ici donne un
 * médaillon vide, ce que le repli couvre — mais le `Record` partiel est délibéré, parce qu'un
 * `Record<ProductDtoCategoryEnum, string>` obligerait à inventer une icône le jour où une
 * catégorie arrive, et une icône mal choisie est pire qu'une icône générique.
 */
const CATEGORY_ICONS: Record<string, string> = {
  Loan: 'feather:trending-up',
  Savings: 'feather:pie-chart',
  Insurance: 'feather:shield',
  HealthInsurance: 'feather:heart',
  ForecastInsurance: 'feather:umbrella',
  Tontine: 'feather:users',
  GroupCredit: 'feather:user-plus',
  Agriculture: 'feather:sun',
  CurrentAccount: 'feather:credit-card',
};

/**
 * Les six volets de l'écran, dans l'ordre d'affichage.
 *
 * Un tableau plutôt qu'une union écrite à la main, pour que la barre d'onglets, la lecture du
 * query param et le repli partent de la même liste : un septième volet s'ajoute en un endroit.
 */
const PRODUCT_TABS = [
  'identite',
  'parametres',
  'beneficiaires',
  'questionnaires',
  'kyc',
  'danger',
] as const;

export type ProductTab = (typeof PRODUCT_TABS)[number];

/**
 * Le nom du volet tel qu'il est écrit dans l'onglet. Sert à l'alerte inter-onglets, qui doit
 * nommer le volet à corriger avec les mots que le lecteur voit dans la barre — « identite » dans
 * un message renverrait à un identifiant d'URL plutôt qu'à un onglet.
 */
/** L'icône de l'onglet. Même rôle que dans `compliance-settings` : repérer un volet sans lire. */
const PRODUCT_TAB_ICONS: Record<ProductTab, string> = {
  identite: 'feather:tag',
  parametres: 'feather:sliders',
  beneficiaires: 'feather:users',
  questionnaires: 'feather:clipboard',
  kyc: 'feather:smartphone',
  danger: 'feather:alert-triangle',
};

const PRODUCT_TAB_LABELS: Record<ProductTab, string> = {
  identite: 'Identité',
  parametres: 'Paramètres',
  beneficiaires: 'Politique bénéficiaires et foyer',
  questionnaires: 'Questionnaires de qualification',
  kyc: 'KYC à distance',
  danger: 'Zone de danger',
};

/**
 * Le formulaire du produit lui-même : nom et description.
 *
 * **Les champs CBS n'y sont PAS**, bien que `UpdateProductRequest` les accepte. Le lien vers le
 * Core Banking a son propre endpoint (`POST products/{id}/link-cbs`) et son propre geste dans
 * l'écran ; porter les deux écritures dans le même formulaire ferait qu'un enregistrement du nom
 * réécrirait un lien que quelqu'un vient de poser depuis l'autre section, et inversement.
 */
class ProductFormModel {
  public name!: string;
  public description!: string;

  public static fromDto(dto: ProductDto | null): ProductFormModel {
    const m = new ProductFormModel();
    m.name = dto?.name ?? '';
    m.description = dto?.description ?? '';
    return m;
  }
}

/** Le lien CBS, dans son propre formulaire pour la raison ci-dessus. */
class CbsFormModel {
  public platform!: string;
  public productId!: string;

  public static fromDto(dto: ProductDto | null): CbsFormModel {
    const m = new CbsFormModel();
    m.platform = dto?.businessPlatformName ?? '';
    m.productId = dto?.businessProductId ?? '';
    return m;
  }
}

/**
 * Détail d'une ligne de produit du catalogue.
 *
 * **Reprend la structure de l'écran de profil utilisateur** (`account-profile`) : même chrome de
 * section (`rounded-2xl`, ombre légère, filet `slate-100`), mêmes titres `text-xl font-bold
 * text-primary`, mêmes faits en lecture seule rendus par `<dl>`, mêmes champs verrouillés rendus
 * comme des champs avec un cadenas, et même barre d'enregistrement en pied de page. La page avait
 * accumulé quatre chromes différentes — carte à `p-4`, titre libre, cartes des sous-éditeurs — et
 * trois boutons d'enregistrement sans qu'aucun ne dise ce qu'il enregistrait.
 *
 * **Six volets, et pas six routes enfants.** Les deux premiers partagent un seul formulaire et un
 * seul `PUT`, donc une route par volet perdrait la saisie en cours à chaque changement d'onglet.
 * Les volets sont rendus `[hidden]` et non détruits, pour la même raison : un nom saisi dans
 * « Identité » doit survivre à un aller-retour par « KYC à distance ». C'est le motif de
 * `compliance-settings`, repris tel quel — rôles ARIA, lien profond `?onglet=`, et une pastille
 * par onglet pour que la saisie en attente reste visible depuis n'importe quel volet.
 *
 * **La contrepartie du volet masqué est qu'une erreur de validation peut être hors champ**, et
 * c'est ce que `blockingOtherTab` couvre : sans elle, « Enregistrer » depuis « Paramètres » ne
 * ferait rien et rien à l'écran n'en donnerait la raison.
 *
 * **Trois enregistrements distincts, et c'est voulu.** Le produit (la barre de pied de page), le
 * lien CBS et les deux politiques écrivent chacun par leur endpoint, avec leur permission et leur
 * validation. Un bouton unique lancerait quatre PUT dont l'un peut échouer, sans moyen de dire
 * lequel a été retenu. Ce que l'écran corrige, c'est qu'on ne savait pas quel bouton couvrait
 * quoi : la barre nomme ce qu'elle enregistre, et chaque politique garde le sien dans son volet.
 */
@Component({
  selector: 'edit-product',
  imports: [
    RouterLink,
    Button,
    TasIcon,
    TasTag,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSpinner,
    FormRoot,
    FormField,
    ProductParametersEditor,
    QualificationTemplatesPanel,
    BeneficiaryPolicyEditor,
    KycRemotePolicyEditor,
  ],
  templateUrl: './edit-product.html',
})
export class EditProductPage {
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _breadcrumb = inject(BreadcrumbService);

  /**
   * La locale de l'application, et non « fr-FR » en dur : la période d'effet est construite dans
   * un `computed` plutôt que par le pipe `date`, et c'est le seul endroit de l'écran qui formate
   * une date sans passer par Angular — autant qu'il lise la même locale que lui.
   */
  private readonly _locale = inject(LOCALE_ID);

  public readonly canUpdate = this._permissions.can('product:update');
  public readonly canDelete = this._permissions.can('product:delete');

  public readonly id = input.required<string>();

  /**
   * Volet courant, adressable par `?onglet=`. `withComponentInputBinding()` est actif dans
   * `app.config.ts`, les query params se lient donc aux entrées. Un `linkedSignal` plutôt qu'un
   * `signal` : il suit l'URL quand elle change (lien profond, retour arrière) tout en restant
   * inscriptible au clic sur un onglet.
   *
   * Le repli couvre deux cas, pas un : un nom de volet inconnu, et « danger » demandé par
   * quelqu'un qui n'a pas le droit de supprimer — son volet n'est pas rendu, et l'honorer
   * ouvrirait l'écran sur une page blanche.
   */
  public readonly onglet = input<string | undefined>(undefined);

  public readonly activeTab = linkedSignal<ProductTab>(() => {
    const asked = this.onglet() as ProductTab | undefined;

    if (!asked || !PRODUCT_TABS.includes(asked)) return 'identite';
    if (asked === 'danger' && !this.canDelete()) return 'identite';

    return asked;
  });

  public readonly tabs = PRODUCT_TABS;

  public readonly descriptionMaxLength = DESCRIPTION_MAX_LENGTH;

  public isLoading = signal(true);
  public loadFailed = signal(false);
  public isDeleting = signal(false);
  public product = signal<ProductDto | null>(null);

  /**
   * Les paramètres sont édités par un composant tiers qui émet son JSON : ils restent en signal
   * plutôt que dans le modèle de formulaire, et c'est pour cela que `hasUnsavedChanges` les
   * compare séparément.
   */
  public editedParametersJson = signal('');

  // ── Le produit ───────────────────────────────────────────────────────────

  public model = signal(ProductFormModel.fromDto(null));

  public formSchema = form(this.model, (schema) => {
    // Un produit sans nom s'affiche par son code dans toutes les listes, ce qui est lisible par
    // un administrateur et opaque pour un agent. Obligatoire, donc — le contrat l'accepte nul,
    // mais c'est une tolérance pour les lignes créées avant cet écran.
    required(schema.name, { message: 'Le nom commercial est obligatoire' });
    maxLength(schema.name, NAME_MAX_LENGTH, {
      message: `${NAME_MAX_LENGTH} caractères au maximum`,
    });
    maxLength(schema.description, DESCRIPTION_MAX_LENGTH, {
      message: `${DESCRIPTION_MAX_LENGTH} caractères au maximum`,
    });
  });

  // ── Le lien Core Banking ─────────────────────────────────────────────────

  public cbsModel = signal(CbsFormModel.fromDto(null));

  public cbsForm = form(this.cbsModel, (schema) => {
    // Les deux ou aucun : un lien à moitié posé est refusé par le serveur, et le dire ici évite
    // un 400 sur un formulaire de deux champs.
    required(schema.platform, { message: 'La plateforme est obligatoire' });
    required(schema.productId, { message: "L'identifiant produit est obligatoire" });
  });

  /** Ce que le SERVEUR a enregistré, et non ce qui est dans le formulaire. */
  public readonly linkedPlatform = computed(() => this.product()?.businessPlatformName ?? '');
  public readonly linkedProductId = computed(() => this.product()?.businessProductId ?? '');

  public readonly cbsLinked = computed(
    () => !!this.linkedPlatform() && !!this.linkedProductId(),
  );

  // ── Ce que l'écran déduit ────────────────────────────────────────────────

  public readonly categoryIcon = computed(
    () => CATEGORY_ICONS[this.product()?.category ?? ''] ?? 'feather:box',
  );

  /**
   * Le sous-titre des paramètres. Une phrase complète plutôt qu'un libellé interpolé : avec une
   * catégorie absente, `productCategoryLabel` renvoie « — » et « propres à la catégorie — »
   * n'est pas une phrase.
   */
  public readonly parametersSubtitle = computed(() => {
    const category = this.product()?.category;

    return category
      ? `Les barèmes et plafonds propres à la catégorie ${productCategoryLabel(category).toLocaleLowerCase(this._locale)}.`
      : 'Les barèmes et plafonds de ce produit.';
  });

  /**
   * La période d'effet en une phrase.
   *
   * L'écran précédent découpait la chaîne ISO (`| slice:0:10`) et joignait les deux bornes par une
   * flèche. Le découpage casse dès que le serveur renvoie un offset, et la flèche demande au
   * lecteur de deviner le sens ; « du … au … » le dit.
   */
  public readonly effectivePeriod = computed(() => {
    const from = this._asDate(this.product()?.effectiveFrom);
    const to = this._asDate(this.product()?.effectiveTo);

    if (!from && !to) return 'Sans limite de date';
    if (from && !to) return `Depuis le ${this._format(from)}`;
    if (!from && to) return `Jusqu'au ${this._format(to!)}`;
    return `Du ${this._format(from!)} au ${this._format(to!)}`;
  });

  // ── L'état par volet ─────────────────────────────────────────────────────
  //
  // Deux volets seulement portent la saisie du produit : « Identité » (nom, description) et
  // « Paramètres » (le JSON). Les quatre autres écrivent par leur propre bouton ou n'écrivent
  // rien, et n'ont donc ni pastille ni part dans la barre de pied de page.

  public readonly identiteTabInvalid = computed(
    () => this.formSchema.name().invalid() || this.formSchema.description().invalid(),
  );

  public readonly identiteTabChanged = computed(() => {
    const dto = this.product();
    if (!dto) return false;

    const value = this.model();

    return value.name.trim() !== (dto.name ?? '').trim()
      || value.description.trim() !== (dto.description ?? '').trim();
  });

  public readonly parametresTabChanged = computed(() => {
    const dto = this.product();
    if (!dto) return false;

    return this.editedParametersJson().trim() !== (dto.parametersJson ?? '').trim();
  });

  /**
   * Y a-t-il quelque chose à enregistrer. Lu par la barre de pied de page pour désactiver
   * « Annuler » et pour dire franchement qu'une saisie est en attente — un bouton toujours actif
   * ne dit rien, et c'est ce qui faisait oublier d'enregistrer.
   *
   * Composé des deux pastilles plutôt que recalculé : une seconde arithmétique finirait par dire
   * « rien à enregistrer » alors qu'un onglet affiche « Modifié ».
   */
  public readonly hasUnsavedChanges = computed(
    () => this.identiteTabChanged() || this.parametresTabChanged(),
  );

  /**
   * Le volet qui bloque l'enregistrement sans être celui qu'on regarde.
   *
   * Les volets masqués le sont par `[hidden]` et non détruits, donc leur validation continue de
   * courir : un nom effacé rend « Enregistrer » inopérant depuis « Paramètres », et sans ce
   * message l'administrateur voit un bouton actif qui ne fait rien. Un seul volet peut être
   * invalide aujourd'hui — « Paramètres » n'a pas de validation propre — mais la forme est celle
   * de `compliance-settings`, qui en a deux.
   */
  public readonly blockingOtherTab = computed<ProductTab | null>(() =>
    this.activeTab() !== 'identite' && this.identiteTabInvalid() ? 'identite' : null,
  );

  public tabLabel(tab: ProductTab): string {
    return PRODUCT_TAB_LABELS[tab];
  }

  public tabIcon(tab: ProductTab): string {
    return PRODUCT_TAB_ICONS[tab];
  }

  public categoryMeta(cat: string | null | undefined): { label: string; severity: Severity } {
    const label = productCategoryLabel(cat);

    // Le libellé vient du référentiel partagé : une version antérieure ne connaissait que trois
    // catégories et affichait le code brut (« HealthInsurance ») pour les autres.
    switch (cat) {
      case 'Loan':
        return { label, severity: 'info' };
      case 'Savings':
      case 'CurrentAccount':
        return { label, severity: 'success' };
      case 'Tontine':
      case 'GroupCredit':
        return { label, severity: 'warning' };
      default:
        return { label, severity: 'neutral' };
    }
  }

  constructor() {
    effect(() => this._load(this.id()));
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const ok = await firstValueFrom(
        this._productsApi
          .updateProduct(this.id(), {
            name: value.name.trim() || null,
            description: value.description.trim() || null,
            parametersJson: this.editedParametersJson().trim() || null,
            // businessPlatformName / businessProductId volontairement absents : ils ont leur
            // propre geste, et les envoyer ici écraserait un lien posé depuis l'autre section.
          })
          .pipe(
            map(() => true),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Enregistrement impossible', this._errorMessage(error));
              return of(false);
            }),
          ),
      );

      if (!ok) return;

      this._snackbar.success('Produit enregistré', 'Les modifications sont en ligne.');

      // Relu plutôt que supposé : le serveur normalise le nom et peut refuser une partie des
      // paramètres, et un 204 ne dit pas ce qu'il a retenu.
      this._load(this.id());
    });
  }

  public cancel(): void {
    const dto = this.product();

    this.model.set(ProductFormModel.fromDto(dto));
    this.editedParametersJson.set(dto?.parametersJson ?? '');
    this.formSchema().reset();
  }

  public linkToCbs(): void {
    submit(this.cbsForm, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const ok = await firstValueFrom(
        this._productsApi
          .linkProductToCbs(this.id(), {
            businessPlatformName: value.platform.trim(),
            businessProductId: value.productId.trim(),
          })
          .pipe(
            map(() => true),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Liaison impossible', this._errorMessage(error));
              return of(false);
            }),
          ),
      );

      if (!ok) return;

      this._snackbar.success(
        'Produit lié',
        `${value.platform.trim()} — ${value.productId.trim()}`,
      );

      // Relu : la section affiche ce que le serveur a enregistré, pas ce qui a été tapé.
      this._load(this.id());
    });
  }

  public reloadProduct(): void {
    this._load(this.id());
  }

  /**
   * Le volet est reflété dans l'URL : un lien depuis un dossier KYC ou depuis la liste des
   * questionnaires doit pouvoir ouvrir directement le bon volet. `replaceUrl` pour qu'un
   * va-et-vient entre onglets n'empile pas d'entrées dans l'historique du navigateur, et
   * `queryParamsHandling: 'merge'` pour ne pas effacer les paramètres d'un autre écran.
   */
  public selectTab(tab: ProductTab): void {
    if (this.activeTab() === tab) return;

    this.activeTab.set(tab);

    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { onglet: tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public confirmDelete(): void {
    const label = this.product()?.name ?? this.product()?.code ?? 'ce produit';

    this._confirmDialog.confirm({
      title: 'Supprimer le produit',
      message: `Supprimer « ${label} » ? Cette action est irréversible.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isDeleting.set(true);

        this._productsApi
          .deleteProduct(this.id())
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Suppression impossible', this._errorMessage(error));
              this.isDeleting.set(false);
              return of(null);
            }),
          )
          .subscribe((result) => {
            if (result === null) return;

            this._snackbar.success('Produit supprimé', `« ${label} » n'est plus au catalogue.`);
            this._router.navigate(['/settings/products']);
          });
      },
    });
  }

  // ── Chargement ───────────────────────────────────────────────────────────

  private _load(productId: string): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);

    this._productsApi.getProduct(productId).subscribe({
      next: (dto) => {
        this.product.set(dto);
        this.model.set(ProductFormModel.fromDto(dto));
        this.cbsModel.set(CbsFormModel.fromDto(dto));
        this.editedParametersJson.set(dto.parametersJson ?? '');

        // Les deux formulaires repartent propres : sans cela, un champ touché avant un
        // rechargement resterait marqué en erreur sur une valeur qui vient du serveur.
        this.formSchema().reset();
        this.cbsForm().reset();

        this.isLoading.set(false);

        this._breadcrumb.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: 'Produits', link: ['/settings/products'] },
          { label: dto.name ?? dto.code ?? 'Produit' },
        ]);
      },
      error: () => {
        this.loadFailed.set(true);
        this.isLoading.set(false);
      },
    });
  }

  private _asDate(value: string | null | undefined): Date | null {
    if (!value) return null;

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** `d MMM yyyy`, construit ici plutôt que par `| date` : la valeur sort d'un `computed`. */
  private _format(date: Date): string {
    return date.toLocaleDateString(this._locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    // Les messages de validation du serveur nomment le champ en cause : les remonter tels quels
    // vaut mieux qu'un message générique, qui cache exactement ce qui fait gagner une heure.
    const detail = error.error?.detail ?? error.error?.title ?? error.error?.error;
    if (typeof detail === 'string' && detail.length > 0) return detail;

    const errors = error.error?.errors;
    if (errors && typeof errors === 'object') {
      const first = Object.values(errors).flat()[0];
      if (typeof first === 'string') return first;
    }

    return error.status === 403
      ? "Vous n'avez pas le droit de modifier ce produit."
      : "L'opération n'a pas pu être effectuée.";
  }
}

export default EditProductPage;
