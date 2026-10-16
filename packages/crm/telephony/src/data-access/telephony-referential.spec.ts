import { HttpErrorResponse } from '@angular/common/http';
import {
  maskedPhone,
  TEL_CALL_DIRECTION_LABELS,
  TEL_CALL_STATUS_LABELS,
  TEL_MATCH_STATUS_LABELS,
  TEL_RECORDING_STATUS_LABELS,
  TELEPHONY_ENTITY_TYPE_LABELS,
  telCallDirectionLabel,
  telCallStatusLabel,
  telCallStatusSeverity,
  telephonyEntityTypeLabel,
  telephonyErrorMessage,
  telLabel,
  telMatchStatusLabel,
  telRecordingStatusLabel,
} from './telephony-referential';

/**
 * Le référentiel porte trois règles qui ne doivent jamais régresser :
 *
 * 1. Un code inconnu du front s'affiche « Point à vérifier » sans lever et sans bloquer
 *    l'écran — c'est ce qui permet au back d'ajouter un statut de fournisseur sans
 *    livraison front.
 * 2. `maskedPhone` ne laisse JAMAIS filer plus de quatre caractères, quelle que soit
 *    l'entrée. Le reste du module ne détient pas de numéro ; là où il en détient un, c'est
 *    cette fonction qui tient la promesse.
 * 3. Les refus documentés du back sont traduits en phrases qui disent à l'utilisateur quoi
 *    faire ; un code inédit retombe sur la phrase de repli de l'appelant.
 */
describe('Référentiel téléphonie — tables de libellés', () => {
  it('traduit tous les statuts d’appel connus', () => {
    for (const code of Object.keys(TEL_CALL_STATUS_LABELS)) {
      expect(telCallStatusLabel(code)).toBe(
        TEL_CALL_STATUS_LABELS[code as keyof typeof TEL_CALL_STATUS_LABELS],
      );
    }
    expect(telCallStatusLabel('Ringing')).toBe('Sonne');
    expect(telCallStatusLabel('Voicemail')).toBe('Messagerie');
  });

  it('traduit toutes les directions, « Internal » comprise', () => {
    for (const code of Object.keys(TEL_CALL_DIRECTION_LABELS)) {
      expect(telCallDirectionLabel(code)).not.toBe('Point à vérifier');
    }
    expect(telCallDirectionLabel('Internal')).toBe('Appel interne');
    expect(telCallDirectionLabel('Inbound')).toBe('Entrant');
  });

  it('traduit tous les statuts de rattachement', () => {
    for (const code of Object.keys(TEL_MATCH_STATUS_LABELS)) {
      expect(telMatchStatusLabel(code)).not.toBe('Point à vérifier');
    }
    expect(telMatchStatusLabel('Ambiguous')).toBe('Plusieurs fiches possibles');
    expect(telMatchStatusLabel('Unknown')).toBe('Numéro inconnu');
  });

  it('traduit tous les statuts d’enregistrement', () => {
    for (const code of Object.keys(TEL_RECORDING_STATUS_LABELS)) {
      expect(telRecordingStatusLabel(code)).not.toBe('Point à vérifier');
    }
    expect(telRecordingStatusLabel('Purged')).toBe('Supprimé (fin de conservation)');
  });

  it('traduit les deux types d’entité', () => {
    for (const code of Object.keys(TELEPHONY_ENTITY_TYPE_LABELS)) {
      expect(telephonyEntityTypeLabel(code)).not.toBe('Point à vérifier');
    }
    expect(telephonyEntityTypeLabel('Customer')).toBe('Client');
  });
});

describe('Référentiel téléphonie — repli sur code inconnu', () => {
  it('affiche « Point à vérifier » pour un code que le front ne connaît pas', () => {
    expect(telCallStatusLabel('OnHold')).toBe('Point à vérifier');
    expect(telMatchStatusLabel('MergedByRule')).toBe('Point à vérifier');
    expect(telRecordingStatusLabel('Transcoding')).toBe('Point à vérifier');
    expect(telephonyEntityTypeLabel('Supplier')).toBe('Point à vérifier');
  });

  it('ne lève jamais, et distingue l’absence de valeur du code inconnu', () => {
    expect(() => telCallStatusLabel(null)).not.toThrow();
    expect(telCallStatusLabel(null)).toBe('—');
    expect(telCallStatusLabel(undefined)).toBe('—');
    expect(telCallStatusLabel('')).toBe('—');
  });

  it('retombe en gravité neutre, jamais en erreur, sur un code inconnu', () => {
    expect(telCallStatusSeverity('OnHold')).toBe('neutral');
    expect(telCallStatusSeverity(null)).toBe('neutral');
    expect(telCallStatusSeverity('Failed')).toBe('error');
  });

  it('résiste à une table vide et aux clés héritées d’Object', () => {
    expect(telLabel({}, 'Quoi')).toBe('Point à vérifier');
    // `toString` existe sur le prototype : un accès naïf le rendrait comme un libellé.
    expect(telLabel({}, 'toString')).toBe('Point à vérifier');
  });
});

describe('maskedPhone', () => {
  it('ne rend que les quatre derniers caractères', () => {
    expect(maskedPhone('+22507123454321')).toBe('•••• 4321');
    expect(maskedPhone('0102030405')).toBe('•••• 0405');
  });

  it('ne laisse jamais filer plus de quatre caractères du numéro', () => {
    const numbers = [
      '+2250712345678',
      '0000000000000000',
      '12345',
      '  +33 6 12 34 56 78  ',
    ];
    for (const n of numbers) {
      const masked = maskedPhone(n);
      const digits = masked.replace(/[^0-9]/g, '');
      expect(digits.length).toBeLessThanOrEqual(4);
      expect(masked).not.toContain(n.trim());
    }
  });

  it('masque entièrement une entrée trop courte au lieu de l’afficher', () => {
    expect(maskedPhone('12')).toBe('••••');
    expect(maskedPhone('1234')).toBe('••••');
  });

  it('rend « — » sur une valeur absente ou vide', () => {
    expect(maskedPhone(null)).toBe('—');
    expect(maskedPhone(undefined)).toBe('—');
    expect(maskedPhone('')).toBe('—');
    expect(maskedPhone('   ')).toBe('—');
  });
});

describe('telephonyErrorMessage', () => {
  // `error`, et non `code` : c'est le champ que les 44 refus de la famille téléphonie
  // renvoient côté .NET (`new { error = ... }`). Le helper lisait `code`, ce qui faisait
  // tomber chaque refus dans le message de repli — le serveur nommait le problème et
  // l'agent lisait « une erreur est survenue ».
  const withCode = (code: string, status = 422): HttpErrorResponse =>
    new HttpErrorResponse({ status, error: { error: code } });

  it('analyse un corps de refus arrivé en TEXTE, comme sur les routes CSV', () => {
    // Angular ne désérialise `HttpErrorResponse.error` que si la requête attendait du JSON.
    // L'export du journal force `responseType: 'text'`, donc son refus arrive en CHAÎNE — et
    // lire `.error` dessus donnait `undefined`, ce qui faisait tomber CHAQUE refus d'export
    // dans le repli, « période trop large » compris, c'est-à-dire précisément celui qui dit à
    // l'utilisateur quoi faire.
    const asText = new HttpErrorResponse({
      status: 422,
      error: JSON.stringify({ error: 'TELEPHONY_EXPORT_TOO_LARGE' }),
    });

    const message = telephonyErrorMessage(asText, 'repli');

    expect(message).not.toBe('repli');
    expect(message).toContain('Resserrez les dates');
  });

  it('ignore sans bruit un corps de refus qui n’est pas du JSON', () => {
    // Une passerelle qui répond du HTML, un corps tronqué. Un corps illisible ne doit pas
    // faire échouer l'affichage d'un message.
    const garbage = new HttpErrorResponse({ status: 502, error: '<html>Bad Gateway</html>' });

    expect(() => telephonyErrorMessage(garbage, 'repli')).not.toThrow();
    expect(telephonyErrorMessage(garbage, 'repli')).toBe('repli');
  });

  it('traduit les quatre codes que les écrans réclamaient', () => {
    // Les deux agents d'écrans les avaient recopiés localement faute de les trouver ici. Les
    // deux derniers viennent d'autres modules — M13 pour un lead, M01 pour un client — et
    // arrivent par le relais du click-to-call : les traduire ici transforme un « peut-être
    // qu'il n'y a pas de numéro » en un fait, puisque aucun endpoint ne dit quels
    // emplacements sont remplis.
    for (const code of [
      'TELEPHONY_EXPORT_TOO_LARGE',
      'TELEPHONY_CALL_NOT_MISSED',
      'LEAD_PHONE_SLOT_EMPTY',
      'UNKNOWN_SENSITIVE_FIELD',
    ]) {
      expect(telephonyErrorMessage(withCode(code), 'repli')).not.toBe('repli');
    }
  });

  it('lit le code de refus sous le champ `error` ET sous `code`', () => {
    const viaError = new HttpErrorResponse({
      status: 422,
      error: { error: 'TELEPHONY_USER_NOT_LINKED' },
    });

    const viaCode = new HttpErrorResponse({
      status: 422,
      error: { code: 'TELEPHONY_USER_NOT_LINKED' },
    });

    const fallback = 'repli';

    // La forme réelle du backend téléphonie, et la forme d'autres modules que ce helper
    // finira par voir. Les deux doivent donner le même message métier, jamais le repli.
    expect(telephonyErrorMessage(viaError, fallback)).not.toBe(fallback);
    expect(telephonyErrorMessage(viaCode, fallback)).toBe(
      telephonyErrorMessage(viaError, fallback),
    );
  });

  it('traduit les refus documentés en disant quoi faire', () => {
    expect(telephonyErrorMessage(withCode('TELEPHONY_USER_NOT_LINKED'), 'repli')).toContain(
      'Rattachement des postes',
    );
    expect(telephonyErrorMessage(withCode('TELEPHONY_DISABLED'), 'repli')).toContain(
      'désactivée',
    );
    expect(
      telephonyErrorMessage(withCode('TELEPHONY_CALLBACK_DATE_REQUIRED'), 'repli'),
    ).toContain('date de rappel');
    expect(
      telephonyErrorMessage(withCode('TELEPHONY_RECORDING_EXPORT_REASON_REQUIRED'), 'repli'),
    ).toContain('motif');
    expect(
      telephonyErrorMessage(withCode('TELEPHONY_STATS_PERIOD_TOO_LONG'), 'repli'),
    ).toContain('période');
  });

  it('couvre les treize codes du cahier', () => {
    const codes = [
      'TELEPHONY_USER_NOT_LINKED',
      'TELEPHONY_DISABLED',
      'TELEPHONY_CALL_NOT_FOUND',
      'TELEPHONY_ENTITY_NOT_YOURS',
      'TELEPHONY_CALLBACK_DATE_REQUIRED',
      'TELEPHONY_CALL_NOT_ENDED',
      'TELEPHONY_RECORDING_NOT_FOUND',
      'TELEPHONY_RECORDING_NOT_AVAILABLE',
      'TELEPHONY_RECORDING_EXPORT_REASON_REQUIRED',
      'TELEPHONY_USER_LINK_ALREADY_TAKEN',
      'TELEPHONY_CALLER_IS_ALREADY_A_CLIENT',
      'TELEPHONY_CALL_ALREADY_ATTACHED',
      'TELEPHONY_STATS_PERIOD_TOO_LONG',
    ];
    for (const code of codes) {
      expect(telephonyErrorMessage(withCode(code), 'REPLI')).not.toBe('REPLI');
    }
  });

  it('retombe sur la phrase de l’appelant pour un code inédit', () => {
    expect(telephonyErrorMessage(withCode('TELEPHONY_QUELQUE_CHOSE_DE_NEUF'), 'REPLI')).toBe(
      'REPLI',
    );
  });

  it('préfère les erreurs de validation du ProblemDetails au repli', () => {
    const error = new HttpErrorResponse({
      status: 400,
      error: { errors: { reason: ['Le motif est obligatoire.'] } },
    });
    expect(telephonyErrorMessage(error, 'REPLI')).toBe('Le motif est obligatoire.');
  });

  it('dit le refus de droit sur un 403 sans code métier', () => {
    const error = new HttpErrorResponse({ status: 403, error: {} });
    expect(telephonyErrorMessage(error, 'REPLI')).toContain("n'avez pas le droit");
  });
});
