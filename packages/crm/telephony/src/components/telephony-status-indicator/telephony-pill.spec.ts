import { describe, expect, it } from 'vitest';
import { TEL_UNKNOWN_LABEL } from '../../data-access/telephony-referential';
import { TelephonyPillInput, telephonyIndicatorPill } from './telephony-pill';

/**
 * La pastille de TEL-F-11 a quatre états et leur ORDRE est le sujet : plusieurs peuvent
 * être vrais en même temps, et celui qu'on affiche décide de ce que l'agent va tenter.
 */
function input(overrides: Partial<TelephonyPillInput> = {}): TelephonyPillInput {
  return {
    telephonyEnabled: true,
    linkStatus: 'Active',
    realtimeState: 'Connected',
    realtimeAttempted: true,
    canViewCalls: true,
    ...overrides,
  };
}

describe('telephonyIndicatorPill', () => {
  it("n'affiche RIEN sans téléphonie active dans l'établissement", () => {
    // C'est la majorité des établissements : une pastille grise permanente chez eux
    // serait du bruit sur chaque écran.
    expect(telephonyIndicatorPill(input({ telephonyEnabled: false }))).toBeNull();
  });

  it('annonce la téléphonie active quand tout va bien', () => {
    expect(telephonyIndicatorPill(input())?.label).toBe('Téléphonie active');
  });

  it('fait passer un problème de poste devant une perte de temps réel', () => {
    // La cause avant la conséquence : « rechargez la page » ne répare pas un poste non
    // rattaché, et enverrait l'agent recharger indéfiniment.
    const pill = telephonyIndicatorPill(
      input({ linkStatus: 'NotLinked', realtimeState: 'Disconnected' }),
    );

    expect(pill?.label).toBe('Téléphone non lié');
    expect(pill?.hint).toContain('pas appeler');
  });

  it('dit qu’un lien cassé laisse encore appeler', () => {
    expect(telephonyIndicatorPill(input({ linkStatus: 'Broken' }))?.hint).toContain(
      'encore appeler',
    );
  });

  it('ne parle de perte de temps réel qu’après une tentative de connexion', () => {
    const atBoot = input({ realtimeState: 'Disconnected', realtimeAttempted: false });

    expect(telephonyIndicatorPill(atBoot)?.label).toBe('Téléphonie active');

    const afterAttempt = input({ realtimeState: 'Disconnected', realtimeAttempted: true });

    expect(telephonyIndicatorPill(afterAttempt)?.label).toBe('Connexion temps réel perdue');
  });

  it('se taît sur le temps réel pour qui ne peut pas voir les appels', () => {
    const pill = telephonyIndicatorPill(
      input({ realtimeState: 'Disconnected', canViewCalls: false }),
    );

    expect(pill?.label).toBe('Téléphonie active');
  });

  it('reste lisible sur un code de rattachement inconnu', () => {
    const pill = telephonyIndicatorPill(input({ linkStatus: 'SomethingNew' }));

    expect(pill?.label).toBe(TEL_UNKNOWN_LABEL);
    expect(pill?.tone).toBe('neutral');
  });
});
