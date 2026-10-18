import { HttpContextToken } from '@angular/common/http';

/**
 * Jeton à poser tel quel, sans rafraîchissement ni nouvel essai. Sert à la déconnexion, qui vide
 * la session locale AVANT d'appeler le serveur (une API injoignable ne doit pas garder
 * l'opérateur connecté) et n'a donc plus de jeton à lire au moment de l'envoi.
 */
export const ADMIN_EXPLICIT_TOKEN = new HttpContextToken<string | null>(() => null);
