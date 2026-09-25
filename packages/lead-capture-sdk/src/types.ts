/**
 * FE-13 / FE-14 — Contrat de configuration du SDK `forms.js`.
 *
 * Toute la configuration est portee par les attributs `data-*` de la balise
 * <script>, generee cote CRM (`SnippetResult.html`). Aucun appel reseau n'est
 * necessaire pour demarrer : le SDK doit rester utilisable meme si le CRM est
 * momentanement indisponible.
 */

export type CaptchaProvider = 'None' | 'Turnstile' | 'HCaptcha' | 'RecaptchaV3';

export interface SdkConfig {
  /** Cle publique de la source (`data-sankore-key`). */
  publicKey: string;
  /** Origine de l'API d'ingestion, deduite du `src` du script si absente. */
  endpoint: string;
  /** Selecteur CSS du formulaire a ecouter. */
  formSelector: string;
  /** Attribut `name` de la case de consentement. */
  consentField: string;
  /** Version du texte de consentement affiche au visiteur. */
  consentVersion: string;
  /** Noms de champs a transmettre ; vide = tout le formulaire. */
  fieldNames: string[];
  /** Piege a robots (champ cache). */
  honeypot: boolean;
  /** Delai minimal de saisie, en secondes. */
  minFillSeconds: number;
  captchaProvider: CaptchaProvider;
  captchaSiteKey: string;
  /** `false` : le formulaire conserve son comportement d'origine. */
  preventDefaultSubmit: boolean;
  successMessage: string;
  redirectUrl: string;
  /** FE-15 — `true` : le SDK rend le formulaire defini dans le CRM. */
  render: boolean;
}

/** Parametres UTM retenus a la premiere page de la visite. */
export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

export interface IngestPayload {
  /** Champs bruts du formulaire, tels que saisis. */
  fields: Record<string, string>;
  utm: UtmParams;
  page: string;
  referrer: string;
  consentGiven: boolean;
  consentVersion: string;
  captchaToken?: string;
  submittedAt: string;
}

export type SendOutcome =
  | { kind: 'accepted' }
  | { kind: 'invalid'; message: string }
  | { kind: 'failed' };
