import { LeadReportAgent } from '@sankore/crm-api';
import { MIN_ASSIGNED_FOR_RANKING, rankAgents } from './agent-ranking';

const agent = (name: string, over: Partial<LeadReportAgent> = {}): LeadReportAgent => ({
  agentId: name,
  name,
  assigned: 10,
  converted: 2,
  conversionRate: 20,
  slaComplianceRate: 80,
  avgFirstContactMinutes: 60,
  openLeads: 3,
  ...over,
});

describe('rankAgents', () => {
  it('ranks by conversions, highest first', () => {
    const { ranked } = rankAgents([agent('A', { converted: 1 }), agent('B', { converted: 5 })], 'converted');
    expect(ranked.map((r) => [r.agent.name, r.rank])).toEqual([['B', 1], ['A', 2]]);
  });

  it('gives ex aequo the same rank and skips the next one', () => {
    const { ranked } = rankAgents(
      [agent('A', { converted: 5 }), agent('B', { converted: 5 }), agent('C', { converted: 1 })],
      'converted',
    );
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('ranks the first-contact delay the other way round: shorter is better', () => {
    const { ranked } = rankAgents(
      [agent('Lent', { avgFirstContactMinutes: 300 }), agent('Rapide', { avgFirstContactMinutes: 20 })],
      'firstContact',
    );
    expect(ranked[0].agent.name).toBe('Rapide');
  });

  it('keeps an agent below the volume threshold out of the ranking, however good the rate', () => {
    const lucky = agent('Deux sur deux', { assigned: MIN_ASSIGNED_FOR_RANKING - 1, conversionRate: 100 });
    const { ranked, unranked } = rankAgents([lucky, agent('Régulier', { conversionRate: 40 })], 'conversionRate');
    expect(ranked.map((r) => r.agent.name)).toEqual(['Régulier']);
    expect(unranked.map((r) => r.agent.name)).toEqual(['Deux sur deux']);
  });

  it('puts an agent with no value for the criterion out of the ranking rather than last', () => {
    const { ranked, unranked } = rankAgents([agent('A'), agent('Sans contact', { avgFirstContactMinutes: null })], 'firstContact');
    expect(ranked.map((r) => r.agent.name)).toEqual(['A']);
    expect(unranked.map((r) => r.agent.name)).toEqual(['Sans contact']);
  });

  it('builds the global score from its four weighted components', () => {
    const { ranked } = rankAgents(
      [
        agent('Meilleur', { conversionRate: 50, slaComplianceRate: 100, avgFirstContactMinutes: 10, assigned: 20 }),
        agent('Moins bon', { conversionRate: 10, slaComplianceRate: 50, avgFirstContactMinutes: 100, assigned: 10 }),
      ],
      'score',
    );
    // 50×0,4 + 100×0,3 + 100×0,2 + 100×0,1 = 80 ; 10×0,4 + 50×0,3 + 0×0,2 + 50×0,1 = 24.
    expect(ranked.map((r) => [r.agent.name, r.value])).toEqual([['Meilleur', 80], ['Moins bon', 24]]);
    expect(ranked[1].breakdown).toEqual({ conversionRate: 10, sla: 50, firstContact: 0, volume: 50 });
  });
});
