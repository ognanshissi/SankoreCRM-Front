import { OpportunityDto } from '@sankore/crm-api';
import { closeDateLabel, closeDateWarning, daysUntil, differsFromLead, OPEN_STAGES, weightedAmount } from './opportunity.model';

const today = new Date(2026, 9, 20, 10, 0, 0);

function opp(partial: Partial<OpportunityDto>): OpportunityDto {
  return { id: 'o1', stage: 'Prospecting', probability: 0.1, ...partial } as OpportunityDto;
}

describe('opportunity view model', () => {
  it('announces the probabilities the server fixes for each stage', () => {
    expect(OPEN_STAGES.map((s) => s.probability)).toEqual([10, 20, 40, 60, 80]);
  });

  it('weights an amount by its probability', () => {
    expect(weightedAmount(opp({ estimatedAmount: { amount: 5_000_000, currency: 'XOF' } }))).toBe(500_000);
    expect(weightedAmount(opp({}))).toBe(0);
  });

  it('says tomorrow and flags a close too early for the stage', () => {
    const tomorrow = '2026-10-21T12:00:00Z';
    expect(daysUntil(tomorrow, today)).toBe(1);
    expect(closeDateLabel(tomorrow, today)).toMatch(/^Demain, 21 oct\.? 2026$/);
    expect(closeDateWarning(opp({ expectedCloseDate: tomorrow }), today)).toBe('Trop tôt pour un projet en prospection.');
    expect(closeDateWarning(opp({ stage: 'Negotiation', expectedCloseDate: tomorrow }), today)).toBeNull();
    expect(closeDateWarning(opp({ expectedCloseDate: '2026-10-01T12:00:00Z' }), today)).toContain('dépassée');
    expect(closeDateWarning(opp({ stage: 'ClosedWon', expectedCloseDate: '2026-10-01T12:00:00Z' }), today)).toBeNull();
    // Une échéance (crédit de campagne) : jamais « trop tôt », et dépassée = relance urgente.
    expect(closeDateWarning(opp({ criticalCloseDate: true, expectedCloseDate: tomorrow }), today)).toBeNull();
    expect(closeDateWarning(opp({ criticalCloseDate: true, expectedCloseDate: '2026-10-01T12:00:00Z' }), today)).toContain('Échéance dépassée');
  });

  it('asks about two different requests until somebody answered', () => {
    const daloa = opp({ estimatedAmount: { amount: 5_000_000, currency: 'XOF' } });
    expect(differsFromLead(daloa, 2_800_000)).toBe(true);
    expect(differsFromLead(daloa, 5_000_000)).toBe(false);
    expect(differsFromLead(daloa, null)).toBe(false);
    expect(differsFromLead({ ...daloa, separateNeedConfirmedAt: '2026-10-20T09:00:00Z' }, 2_800_000)).toBe(false);
    expect(differsFromLead({ ...daloa, stage: 'ClosedLost' } as OpportunityDto, 2_800_000)).toBe(false);
  });
});
