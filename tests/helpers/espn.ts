export const SWID = '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}';
export const fixtureLeague = (id = 123) => ({
  id, seasonId: 2026, scoringPeriodId: 1,
  settings: { name: 'Fixture League', scheduleSettings: { matchupPeriods: { '1': [1] } } },
  status: { latestScoringPeriod: 1, currentMatchupPeriod: 1 },
  teams: [{ id: 1, name: 'Owned', owners: [SWID], roster: { entries: [] } }],
  schedule: [{ matchupPeriodId: 1, home: { teamId: 1, totalPoints: 0 } }],
});
