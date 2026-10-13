/**
 * Les codes du service biométrique traduits en consignes (KRM-F-04/F-05).
 *
 * Le serveur renvoie des codes et des causes dans le vocabulaire du service ; le client,
 * lui, a besoin d'une seule phrase qui lui dit quoi refaire. La traduction est ici et non
 * dans le composant parce que les mêmes causes apparaissent sur trois écrans — pièce,
 * verso, selfie — et qu'une formulation par écran finirait par dire trois choses
 * différentes du même défaut.
 *
 * **Un code inconnu produit une consigne générique, jamais le code lui-même.** Le service
 * peut en renvoyer d'autres que ceux listés : afficher « IMAGE_QUALITY_TOO_LOW » à un
 * client est pire que de ne rien dire d'utile.
 */
const QUALITY_CAUSE_LABELS: Record<string, string> = {
  // Codes documentés du service.
  IMAGE_QUALITY_TOO_LOW: 'La photo est trop floue ou trop sombre. Reprenez-la.',
  DOCUMENT_UNREADABLE:
    "Le document n'est pas lisible. Posez-le à plat, bien éclairé, et remplissez le cadre.",
  MRZ_CHECKSUM_FAILED:
    "La bande de caractères en bas du document n'a pas pu être lue. Reprenez la photo en évitant les reflets.",
  NO_FACE_DETECTED:
    "Aucun visage n'a été détecté. Cadrez votre visage de face, sans lunettes de soleil ni chapeau.",
  MULTIPLE_FACES_DETECTED:
    'Plusieurs visages apparaissent sur la photo. Reprenez-la seul, devant un fond neutre.',

  // Causes de détail, telles que le service les nomme dans son champ libre.
  blur: 'La photo est floue : tenez l’appareil immobile.',
  blurry: 'La photo est floue : tenez l’appareil immobile.',
  glare: 'Un reflet masque une partie du document. Inclinez-le ou éloignez la lumière.',
  reflection: 'Un reflet masque une partie du document. Inclinez-le ou éloignez la lumière.',
  underexposed: "La photo est trop sombre. Rapprochez-vous d'une source de lumière.",
  dark: "La photo est trop sombre. Rapprochez-vous d'une source de lumière.",
  overexposed: 'La photo est surexposée. Éloignez-vous de la lumière directe.',
  cropped: 'Le document est coupé. Cadrez-le entièrement dans le repère.',
  truncated: 'Le document est coupé. Cadrez-le entièrement dans le repère.',
  low_resolution: 'La photo est trop petite. Rapprochez-vous du document.',
};

const GENERIC_CAUSE =
  'Cette photo ne peut pas être exploitée. Reprenez-la à plat, bien éclairée et sans reflet.';

export function kycQualityCauseLabel(cause: string | null | undefined): string {
  if (!cause) return GENERIC_CAUSE;

  // Le service mélange les casses et les séparateurs selon le champ : « IMAGE_QUALITY_TOO_LOW »
  // dans le code, « blur, glare » dans le détail.
  const normalized = cause.trim().toLowerCase().replace(/[\s-]+/g, '_');

  return (
    QUALITY_CAUSE_LABELS[cause.trim()]
    ?? QUALITY_CAUSE_LABELS[normalized]
    ?? QUALITY_CAUSE_LABELS[normalized.toUpperCase()]
    ?? GENERIC_CAUSE
  );
}
