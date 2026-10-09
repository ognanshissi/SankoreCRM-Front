/**
 * Brouillon de souscription, conservé dans le navigateur de l'agent — ASS-15.
 *
 * Le critère d'acceptation demande qu'un parcours interrompu puisse être repris, et
 * precise « sans donnée médicale ». Ce n'est pas un détail de confort : les réponses à
 * un questionnaire de santé sont des données de santé, et `localStorage` n'est ni
 * chiffré, ni effacé à la fermeture de session, ni propre à l'utilisateur sur un poste
 * de guichet partagé. Elles ne sont donc JAMAIS écrites ici.
 *
 * La projection ci-dessous est une **liste blanche** : seuls les champs énumérés dans
 * `SubscriptionDraft` sont écrits. Une liste noire (« tout sauf le questionnaire »)
 * aurait laissé passer, en silence, le premier champ sensible ajouté plus tard au
 * modèle de formulaire.
 *
 * Le consentement et la signature sont exclus pour une autre raison : un brouillon qui
 * les restaure présenterait au client une case déjà cochée qu'il n'a jamais cochée.
 */

/** Les seuls champs d'un parcours qui partent dans le stockage local. */
export interface SubscriptionDraft {
  savedAt: string;
  productId: string | null;
  effectiveFrom: string;
  debitAccountRef: string;
  insuredAmount: string;
  beneficiaries: Array<{
    fullName: string;
    relationship: string;
    sharePercent: string;
    birthDate: string;
  }>;
}

/**
 * Ce que l'écran fournit. Il en passe davantage (questionnaire, consentement,
 * signature) : la projection n'en retient rien.
 */
export interface SubscriptionDraftSource {
  productId: string | null;
  effectiveFrom: string;
  debitAccountRef: string;
  insuredAmount: string;
  beneficiaries: ReadonlyArray<{
    fullName: string;
    relationship: string;
    sharePercent: string;
    birthDate: string;
  }>;
}

const DRAFT_KEY_PREFIX = 'sankore.subscription.draft.';

export function subscriptionDraftKey(customerId: string): string {
  return `${DRAFT_KEY_PREFIX}${customerId}`;
}

/**
 * Chaque accès est protégé : en navigation privée, et sur un navigateur configuré pour
 * refuser le stockage de site, la simple lecture de `localStorage` lève.
 */
export function readSubscriptionDraft(customerId: string): SubscriptionDraft | null {
  try {
    const raw = localStorage.getItem(subscriptionDraftKey(customerId));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SubscriptionDraft> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.savedAt !== 'string') {
      return null;
    }

    // Relu par la même liste blanche que l'écriture : un brouillon écrit par une
    // version antérieure ne doit pas réintroduire un champ qu'on a cessé de garder.
    return {
      savedAt: parsed.savedAt,
      productId: parsed.productId ?? null,
      effectiveFrom: parsed.effectiveFrom ?? '',
      debitAccountRef: parsed.debitAccountRef ?? '',
      insuredAmount: parsed.insuredAmount ?? '',
      beneficiaries: (parsed.beneficiaries ?? []).map((beneficiary) => ({
        fullName: beneficiary?.fullName ?? '',
        relationship: beneficiary?.relationship ?? '',
        sharePercent: beneficiary?.sharePercent ?? '',
        birthDate: beneficiary?.birthDate ?? '',
      })),
    };
  } catch {
    return null;
  }
}

export function writeSubscriptionDraft(
  customerId: string,
  source: SubscriptionDraftSource,
): void {
  const draft: SubscriptionDraft = {
    savedAt: new Date().toISOString(),
    productId: source.productId,
    effectiveFrom: source.effectiveFrom,
    debitAccountRef: source.debitAccountRef,
    insuredAmount: source.insuredAmount,
    beneficiaries: source.beneficiaries.map((beneficiary) => ({
      fullName: beneficiary.fullName,
      relationship: beneficiary.relationship,
      sharePercent: beneficiary.sharePercent,
      birthDate: beneficiary.birthDate,
    })),
  };

  try {
    localStorage.setItem(subscriptionDraftKey(customerId), JSON.stringify(draft));
  } catch {
    // Un brouillon non enregistré n'empêche pas de souscrire : on n'interrompt pas
    // l'agent au guichet pour ça.
  }
}

export function clearSubscriptionDraft(customerId: string): void {
  try {
    localStorage.removeItem(subscriptionDraftKey(customerId));
  } catch {
    // Même raison.
  }
}

/** « 12/03 à 14:30 », tel que la proposition de reprise l'annonce. */
export function formatDraftSavedAt(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return savedAt;

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} à ${hours}:${minutes}`;
}
