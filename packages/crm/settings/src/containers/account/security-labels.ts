/**
 * Libellés partagés par l'onglet Sécurité et ses tiroirs. Les codes viennent du serveur en
 * chaînes libres (`platform`, `clientKind`, `outcome`) : un code inconnu s'affiche tel quel plutôt
 * que de disparaître.
 */

const PLATFORM_LABELS: Record<string, string | undefined> = {
  Windows: 'Windows',
  MacOs: 'macOS',
  Linux: 'Linux',
  Android: 'Android',
  Ios: 'iOS',
  ChromeOs: 'ChromeOS',
};

export interface DeviceLike {
  browser?: string | null;
  platform?: string | null;
  clientKind?: string | null;
}

/** « Chrome · Windows », « Application mobile · Android », ou « Appareil inconnu ». */
export function describeDevice(device: DeviceLike): string {
  const platform = device.platform && device.platform !== 'Unknown'
    ? (PLATFORM_LABELS[device.platform] ?? device.platform)
    : null;
  // Sans navigateur reconnu, un client mobile est l'application.
  const client = device.browser
    ?? (device.clientKind === 'Mobile' ? 'Application mobile' : null);
  return [client, platform].filter((v) => !!v).join(' · ') || 'Appareil inconnu';
}

export function deviceIcon(device: DeviceLike): string {
  return device.clientKind === 'Mobile' ? 'feather:smartphone' : 'feather:monitor';
}

const OUTCOME_LABELS: Record<string, string | undefined> = {
  Succeeded: 'Connexion réussie',
  InvalidPassword: 'Échec : mot de passe incorrect',
  AccountLocked: 'Échec : compte verrouillé',
  AccountInactive: 'Échec : compte inactif',
};

export function describeLoginOutcome(outcome: string | null | undefined): { label: string; failed: boolean } {
  const code = outcome || 'Succeeded';
  return { label: OUTCOME_LABELS[code] ?? code, failed: code !== 'Succeeded' };
}

const KYC_KIND_LABELS: Record<string, string | undefined> = {
  IdentityDocumentFront: "Pièce d'identité (recto)",
  IdentityDocumentBack: "Pièce d'identité (verso)",
  Selfie: 'Selfie',
  ProofOfAddress: 'Justificatif de domicile',
};

export function describeKycDocumentKind(kind: string | null | undefined): string {
  return (kind && KYC_KIND_LABELS[kind]) ?? kind ?? 'Pièce';
}
