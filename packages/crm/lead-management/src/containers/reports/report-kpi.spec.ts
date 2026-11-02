import { pointsDelta, relativeDelta } from './report-kpi';

const f = (n: number) => String(n);

describe('relativeDelta', () => {
  it('gives the change as a percentage of the previous period', () => {
    expect(relativeDelta(15, 12, 'up', f)).toEqual({ text: '+25 %', direction: 'up', tone: 'good', previous: '12' });
  });

  it('reads a shorter delay as an improvement', () => {
    expect(relativeDelta(30, 60, 'down', f)).toMatchObject({ text: '−50 %', direction: 'down', tone: 'good' });
    expect(relativeDelta(90, 60, 'down', f)).toMatchObject({ direction: 'up', tone: 'bad' });
  });

  it('gives a plain difference when the previous period had none', () => {
    expect(relativeDelta(5, 0, 'up', f)).toMatchObject({ text: '+5', direction: 'up' });
  });

  it('shows no change as « = », neither good nor bad', () => {
    expect(relativeDelta(12, 12, 'up', f)).toMatchObject({ text: '=', direction: 'flat', tone: 'neutral' });
  });

  it('has nothing to compare when either side is missing', () => {
    expect(relativeDelta(null, 3, 'up', f)).toBeNull();
    expect(relativeDelta(3, undefined, 'up', f)).toBeNull();
  });
});

describe('pointsDelta', () => {
  it('compares two rates in points, not in percent', () => {
    expect(pointsDelta(50, 40, 'up', f)).toMatchObject({ text: '+10 pts', direction: 'up', tone: 'good' });
    expect(pointsDelta(37.5, 40, 'up', f)).toMatchObject({ text: '−2,5 pts', direction: 'down', tone: 'bad' });
  });
});
