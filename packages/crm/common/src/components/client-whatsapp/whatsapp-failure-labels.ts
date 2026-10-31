/** Pourquoi un message WhatsApp n'est pas parti ou n'a pas été délivré — lead comme client. */
export const WHATSAPP_FAILURE_LABELS: Record<string, string> = {
  MESSAGING_RECIPIENT_INVALID: 'Ce numéro ne reçoit pas de messages WhatsApp.',
  MESSAGING_TEST_RECIPIENT: 'Mode test : seuls les numéros des utilisateurs de l’institution reçoivent des messages.',
  MESSAGING_TEMPLATE_REJECTED: 'Meta a refusé le template.',
  MESSAGING_OUTSIDE_WINDOW: 'Hors de la fenêtre de 24 h : seul un template peut être envoyé.',
  MESSAGING_QUOTA_EXCEEDED: 'Limite d’envoi atteinte, réessayez plus tard.',
  MESSAGING_NOT_DELIVERED: 'Meta n’a pas délivré le message.',
  MESSAGING_CHANNEL_INACTIVE: 'Le numéro WhatsApp de l’institution est désactivé.',
  INTEGRATION_AUTHENTICATION_REFUSED: '360dialog refuse la clé API du numéro.',
  INTEGRATION_CREDENTIAL_MISSING: 'La clé API du numéro n’est pas configurée.',
  INTEGRATION_UNAVAILABLE: '360dialog est indisponible.',
  INTEGRATION_TIMEOUT: '360dialog n’a pas répondu à temps.',
  WHATSAPP_SEND_UNCERTAIN: 'Envoi incertain : vérifiez avant de renvoyer.',
  WHATSAPP_SEND_FAILED: 'L’envoi a échoué.',
};
