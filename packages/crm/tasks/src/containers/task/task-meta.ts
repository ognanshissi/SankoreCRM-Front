/** Ce sur quoi porte une tâche, côté écran. */
export type TaskSubjectType = 'none' | 'lead' | 'client' | 'kyc' | 'project';

/** Les refus du serveur, en clair. Un code inconnu tombe sur le message générique de l'écran. */
export const TASK_ERRORS: Record<string, string> = {
  TASK_NOT_FOUND: 'Cette tâche n’existe plus, ou vous n’y avez pas accès.',
  TASK_CLOSED: 'La tâche est terminée ou annulée : elle ne se modifie plus.',
  TASK_DUE_IN_PAST: 'L’échéance doit être dans le futur.',
  TASK_TITLE_REQUIRED: 'Le titre est obligatoire.',
  TASK_TITLE_TOO_LONG: 'Le titre dépasse 200 caractères.',
  TASK_DESCRIPTION_TOO_LONG: 'La description dépasse 4 000 caractères.',
  TASK_TYPE_UNKNOWN: 'Ce type de tâche n’existe pas : rechargez la page.',
  TASK_TYPE_INACTIVE: 'Ce type de tâche a été désactivé : choisissez-en un autre.',
  TASK_ENTITY_INCOMPLETE: 'Choisissez ce sur quoi porte la tâche.',
  TASK_USER_NOT_FOUND: 'Une des personnes choisies n’existe plus.',
  TASK_TOO_MANY_PARTICIPANTS: '20 personnes associées au plus.',
  TASK_TOO_MANY_CRITERIA: '30 critères au plus.',
  TASK_TOO_MANY_TAGS: '20 étiquettes au plus.',
  TASK_TAG_TOO_LONG: 'Une étiquette fait 50 caractères au plus.',
  TASK_COMMENT_EMPTY: 'Le commentaire est vide.',
  TASK_COMMENT_TOO_LONG: 'Le commentaire dépasse 4 000 caractères.',
  TASK_COMMENT_NOT_YOURS: 'Seul l’auteur d’un commentaire peut le modifier.',
  TASK_ATTACHMENT_TOO_LARGE: 'Le fichier dépasse 10 Mo.',
  TASK_ATTACHMENT_TYPE_NOT_ALLOWED: 'Type de fichier refusé : PDF, image, document Office ou texte seulement.',
  TASK_TOO_MANY_ATTACHMENTS: '30 fichiers au plus par tâche.',
  TASK_ATTACHMENT_NOT_YOURS: 'Seuls la personne qui l’a joint, le porteur ou le créateur de la tâche peuvent retirer ce fichier.',
  TASK_ATTACHMENTS_UNAVAILABLE: 'Le dépôt de fichiers n’est pas configuré sur ce déploiement.',
  LEAD_NOT_FOUND: 'Ce lead n’existe pas, ou vous ne pouvez pas y travailler.',
  CLIENT_NOT_FOUND: 'Ce client n’existe pas, ou il est hors de votre périmètre.',
  KYC_FILE_NOT_FOUND: 'Ce dossier KYC n’existe pas, ou il est hors de votre périmètre.',
  OPPORTUNITY_NOT_FOUND: 'Ce projet n’existe pas, ou il est hors de votre périmètre.',
  ALREADY_ASSIGNED_TO_AGENT: 'La tâche est déjà confiée à cette personne.',
};

export const PRIORITY_LABELS: Record<string, { label: string; tone: string }> = {
  Low: { label: 'Basse', tone: 'bg-slate-100 text-slate-600' },
  Medium: { label: 'Normale', tone: 'bg-sky-50 text-sky-700' },
  High: { label: 'Haute', tone: 'bg-amber-50 text-amber-800' },
  Critical: { label: 'Critique', tone: 'bg-red-50 text-red-700' },
};

export const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  Pending: { label: 'À faire', tone: 'bg-slate-100 text-slate-700' },
  InProgress: { label: 'En cours', tone: 'bg-sky-50 text-sky-700' },
  Completed: { label: 'Terminée', tone: 'bg-emerald-50 text-emerald-700' },
  Cancelled: { label: 'Annulée', tone: 'bg-slate-100 text-slate-500' },
};

/** La fiche d'un sujet de tâche. */
export function subjectRoute(type: string | null | undefined, id: string | null | undefined): string[] | null {
  if (!id) return null;
  switch (type) {
    case 'Lead': return ['/leads', id];
    case 'Client': return ['/customers', id];
    case 'KycFile': return ['/kyc', id];
    case 'Project': return ['/leads/projets', id];
    default: return null;
  }
}

export function fileSize(bytes: number | null | undefined): string {
  const b = bytes ?? 0;
  if (b < 1024) return `${b} o`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} Ko`;
  return `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}
