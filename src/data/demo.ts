import type { DashboardData, Game, League, PlayerAppearance, Side } from '../types';

export const DEMO_NOW = new Date('2026-09-13T19:42:00Z');

const games: Game[] = [
  { id: 'bal-buf', awayTeam: 'BAL', homeTeam: 'BUF', awayScore: 17, homeScore: 24, status: 'live', detail: 'Q3 · 8:42', kickoff: '2026-09-13T17:00:00Z', broadcast: 'CBS' },
  { id: 'cin-cle', awayTeam: 'CIN', homeTeam: 'CLE', awayScore: 21, homeScore: 10, status: 'live', detail: 'Q3 · 6:18', kickoff: '2026-09-13T17:00:00Z', broadcast: 'CBS' },
  { id: 'atl-tb', awayTeam: 'ATL', homeTeam: 'TB', awayScore: 14, homeScore: 17, status: 'live', detail: 'Q3 · 11:06', kickoff: '2026-09-13T17:00:00Z', broadcast: 'FOX' },
  { id: 'kc-lac', awayTeam: 'KC', homeTeam: 'LAC', status: 'upcoming', detail: 'Scheduled', kickoff: '2026-09-13T20:25:00Z', broadcast: 'CBS' },
  { id: 'det-sf', awayTeam: 'DET', homeTeam: 'SF', status: 'upcoming', detail: 'Sunday Night Football', kickoff: '2026-09-14T00:20:00Z', broadcast: 'NBC' },
  { id: 'nyj-mia', awayTeam: 'NYJ', homeTeam: 'MIA', status: 'upcoming', detail: 'Monday Night Football', kickoff: '2026-09-15T00:15:00Z', broadcast: 'ESPN' },
  { id: 'dal-phi', awayTeam: 'DAL', homeTeam: 'PHI', awayScore: 20, homeScore: 27, status: 'final', detail: 'Final', kickoff: '2026-09-11T00:15:00Z', broadcast: 'Prime Video' },
];

type Athlete = { id: string; name: string; pos: string; team: string; pts: number; proj: number; stats: string[]; injury?: string };
const athletes: Record<string, Athlete> = {
  allen: { id: '3918298', name: 'Josh Allen', pos: 'QB', team: 'BUF', pts: 24.6, proj: 23.8, stats: ['248|PASS YDS', '2|PASS TD', '36|RUSH YDS'] },
  lamar: { id: '3916387', name: 'Lamar Jackson', pos: 'QB', team: 'BAL', pts: 21.4, proj: 24.1, stats: ['216|PASS YDS', '1|PASS TD', '68|RUSH YDS'] },
  burrow: { id: '3915511', name: 'Joe Burrow', pos: 'QB', team: 'CIN', pts: 19.8, proj: 21.5, stats: ['245|PASS YDS', '2|PASS TD', '0|INT'] },
  baker: { id: '3052587', name: 'Baker Mayfield', pos: 'QB', team: 'TB', pts: 16.2, proj: 18.2, stats: ['205|PASS YDS', '2|PASS TD', '1|INT'] },
  mahomes: { id: '3139477', name: 'Patrick Mahomes', pos: 'QB', team: 'KC', pts: 0, proj: 22.1, stats: [] },
  hurts: { id: '4040715', name: 'Jalen Hurts', pos: 'QB', team: 'PHI', pts: 25.2, proj: 22.3, stats: ['230|PASS YDS', '2|TOTAL TD', '60|RUSH YDS'] },
  cook: { id: '4379399', name: 'James Cook', pos: 'RB', team: 'BUF', pts: 16.2, proj: 15.4, stats: ['82|RUSH YDS', '1|TD', '2|REC'] },
  henry: { id: '3043078', name: 'Derrick Henry', pos: 'RB', team: 'BAL', pts: 14.8, proj: 16.9, stats: ['88|RUSH YDS', '1|TD', '0|REC'] },
  bijan: { id: '4430807', name: 'Bijan Robinson', pos: 'RB', team: 'ATL', pts: 18.7, proj: 20.4, stats: ['67|RUSH YDS', '1|TD', '4|REC'] },
  brown: { id: '4361259', name: 'Chase Brown', pos: 'RB', team: 'CIN', pts: 11.6, proj: 15.1, stats: ['56|RUSH YDS', '0|TD', '4|REC'] },
  cmc: { id: '3117251', name: 'Christian McCaffrey', pos: 'RB', team: 'SF', pts: 0, proj: 21.6, stats: [] },
  gibbs: { id: '4429795', name: 'Jahmyr Gibbs', pos: 'RB', team: 'DET', pts: 0, proj: 19.8, stats: [] },
  hall: { id: '4427366', name: 'Breece Hall', pos: 'RB', team: 'NYJ', pts: 0, proj: 16.3, stats: [] },
  achane: { id: '4429160', name: "De'Von Achane", pos: 'RB', team: 'MIA', pts: 0, proj: 18.2, stats: [] },
  barkley: { id: '3929630', name: 'Saquon Barkley', pos: 'RB', team: 'PHI', pts: 22.8, proj: 19.4, stats: ['118|RUSH YDS', '1|TD', '3|REC'] },
  chase: { id: '4362628', name: "Ja'Marr Chase", pos: 'WR', team: 'CIN', pts: 23.8, proj: 21.2, stats: ['8|REC', '98|REC YDS', '1|TD'] },
  flowers: { id: '4429615', name: 'Zay Flowers', pos: 'WR', team: 'BAL', pts: 12.4, proj: 13.8, stats: ['5|REC', '74|REC YDS', '0|TD'] },
  london: { id: '4426502', name: 'Drake London', pos: 'WR', team: 'ATL', pts: 15.1, proj: 16.8, stats: ['6|REC', '91|REC YDS', '0|TD'] },
  evans: { id: '16737', name: 'Mike Evans', pos: 'WR', team: 'TB', pts: 17.3, proj: 15.9, stats: ['5|REC', '63|REC YDS', '1|TD'] },
  higgins: { id: '4239993', name: 'Tee Higgins', pos: 'WR', team: 'CIN', pts: 10.2, proj: 14.2, stats: ['4|REC', '62|REC YDS', '0|TD'] },
  amon: { id: '4374302', name: 'Amon-Ra St. Brown', pos: 'WR', team: 'DET', pts: 0, proj: 18.8, stats: [] },
  lamb: { id: '4241389', name: 'CeeDee Lamb', pos: 'WR', team: 'DAL', pts: 18.4, proj: 19.1, stats: ['8|REC', '104|REC YDS', '0|TD'] },
  wilson: { id: '4569618', name: 'Garrett Wilson', pos: 'WR', team: 'NYJ', pts: 0, proj: 16.5, stats: [] },
  waddle: { id: '4372016', name: 'Jaylen Waddle', pos: 'WR', team: 'MIA', pts: 0, proj: 13.4, stats: [] },
  ladd: { id: '4685472', name: 'Ladd McConkey', pos: 'WR', team: 'LAC', pts: 0, proj: 15.6, stats: [], injury: 'QUESTIONABLE' },
  kittle: { id: '3040151', name: 'George Kittle', pos: 'TE', team: 'SF', pts: 0, proj: 13.8, stats: [] },
  kelce: { id: '15847', name: 'Travis Kelce', pos: 'TE', team: 'KC', pts: 0, proj: 11.5, stats: [] },
  andrews: { id: '3116365', name: 'Mark Andrews', pos: 'TE', team: 'BAL', pts: 9.6, proj: 10.8, stats: ['3|REC', '66|REC YDS', '0|TD'] },
  laporta: { id: '4430027', name: 'Sam LaPorta', pos: 'TE', team: 'DET', pts: 0, proj: 11.2, stats: [] },
  bass: { id: '3917232', name: 'Tyler Bass', pos: 'K', team: 'BUF', pts: 6, proj: 8.2, stats: ['1|FG', '3|XP'] },
  mcpherson: { id: '4360234', name: 'Evan McPherson', pos: 'K', team: 'CIN', pts: 3, proj: 8.0, stats: ['0|FG', '3|XP'] },
  butker: { id: '3055899', name: 'Harrison Butker', pos: 'K', team: 'KC', pts: 0, proj: 8.5, stats: [] },
  elliott: { id: '3050478', name: 'Jake Elliott', pos: 'K', team: 'PHI', pts: 9, proj: 8.0, stats: ['2|FG', '3|XP'] },
  buf: { id: '-2', name: 'Bills D/ST', pos: 'D/ST', team: 'BUF', pts: 5, proj: 6.8, stats: ['2|SACK', '1|INT', '17|PTS ALW'] },
  cin: { id: '-4', name: 'Bengals D/ST', pos: 'D/ST', team: 'CIN', pts: 8, proj: 6.2, stats: ['3|SACK', '1|INT', '10|PTS ALW'] },
  sf: { id: '-25', name: '49ers D/ST', pos: 'D/ST', team: 'SF', pts: 0, proj: 6.5, stats: [] },
  phi: { id: '-21', name: 'Eagles D/ST', pos: 'D/ST', team: 'PHI', pts: 7, proj: 7.1, stats: ['3|SACK', '1|INT', '20|PTS ALW'] },
};
const rosters = [
  { league: 'sunday', side: 'you', keys: ['allen', 'bijan', 'gibbs', 'chase', 'london', 'kittle', 'wilson', 'bass', 'buf'] },
  { league: 'sunday', side: 'opponent', keys: ['lamar', 'henry', 'cmc', 'evans', 'amon', 'andrews', 'higgins', 'butker', 'sf'] },
  { league: 'office', side: 'you', keys: ['burrow', 'cook', 'barkley', 'flowers', 'lamb', 'kelce', 'ladd', 'mcpherson', 'cin'] },
  { league: 'office', side: 'opponent', keys: ['allen', 'bijan', 'brown', 'chase', 'waddle', 'laporta', 'hall', 'elliott', 'phi'] },
  { league: 'dynasty', side: 'you', keys: ['hurts', 'achane', 'cmc', 'amon', 'evans', 'laporta', 'flowers', 'butker', 'phi'] },
  { league: 'dynasty', side: 'opponent', keys: ['baker', 'henry', 'gibbs', 'london', 'wilson', 'kittle', 'lamb', 'bass', 'buf'] },
] satisfies { league: string; side: Side; keys: string[] }[];

const players: PlayerAppearance[] = rosters.flatMap(roster => roster.keys.map((key, i) => {
  const athlete = athletes[key];
  const game = games.find(item => item.homeTeam === athlete.team || item.awayTeam === athlete.team);
  const halfPpr = roster.league === 'office';
  const receptions = Number(athlete.stats.find(s => s.endsWith('|REC'))?.split('|')[0] ?? 0);
  return {
    id: `${roster.league}-${roster.side}-${athlete.id}`,
    playerId: athlete.id, name: athlete.name, position: athlete.pos, nflTeam: athlete.team,
    leagueId: roster.league, side: roster.side, slot: i === 6 ? 'FLEX' : athlete.pos,
    gameId: game?.id ?? null,
    points: athlete.pts - (halfPpr ? receptions * 0.5 : 0),
    projected: Math.round((athlete.proj - (halfPpr && ['WR', 'TE', 'RB'].includes(athlete.pos) ? 2 : 0)) * 10) / 10,
    stats: athlete.stats.map(stat => { const [value, label] = stat.split('|'); return { value, label }; }),
    injuryStatus: athlete.injury,
    headshot: athlete.pos === 'D/ST' ? undefined : `https://a.espncdn.com/i/headshots/nfl/players/full/${athlete.id}.png`,
  };
}));
const definitions = [
  { id: 'sunday', name: 'Sunday Diehards', scoring: 'PPR', teamName: 'Sunday Scaries', opponentName: 'Fourth & Delulu' },
  { id: 'office', name: 'The Office League', scoring: 'Half PPR', teamName: 'Out of Office', opponentName: 'The Spreadsheet' },
  { id: 'dynasty', name: 'Dynasty After Dark', scoring: 'PPR · Dynasty', teamName: 'The Long Game', opponentName: 'Rebuild Szn' },
];
const leagues: League[] = definitions.map(def => {
  const sum = (side: Side, prop: 'points' | 'projected') => players.filter(p => p.leagueId === def.id && p.side === side).reduce((n, p) => n + (p[prop] ?? 0), 0);
  return { ...def, teamId: 1, score: sum('you', 'points'), opponentScore: sum('opponent', 'points'), projected: sum('you', 'projected'), opponentProjected: sum('opponent', 'projected'), matchupStatus: 'live' };
});
export const demoData: DashboardData = {
  source: 'demo', season: 2026, week: 1, fetchedAt: DEMO_NOW.toISOString(),
  leagues, games, players, warnings: [],
};
