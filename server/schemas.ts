import { z } from 'zod';

const finite = z.number().finite();
const integer = finite.int();
const optionalNumber = finite.nullish();
export const seasonSchema = integer.min(2019).max(2100);
export const weekSchema = integer.min(1).max(18);
export const leagueIdSchema = z.string().regex(/^[1-9]\d{0,11}$/);
const guid = '[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}';
export const swidSchema = z.string().regex(new RegExp(`^(?:${guid}|\\{${guid}\\})$`))
  .transform(value => `{${value.replace(/[{}]/g, '').toUpperCase()}}`);
export const credentialsSchema = z.object({
  swid: swidSchema,
  espnS2: z.string().min(1).max(8192).regex(/^[A-Za-z0-9%+/_=.!~*-]+$/),
});
export type Credentials = z.infer<typeof credentialsSchema>;
export const fanEntrySchema = z.object({
  gameId: z.union([z.literal(1), z.literal('ffl')]),
  seasonId: integer,
  groups: z.array(z.object({
    groupId: z.union([integer.positive(), leagueIdSchema]),
  })),
});
export const connectSchema = credentialsSchema.extend({
  season: seasonSchema.optional(),
  leagueIds: z.array(leagueIdSchema).max(50).optional(),
}).strict();
export const selectLeagueSchema = z.object({
  leagueId: leagueIdSchema,
  teamId: integer.positive().optional(),
}).strict();

const statSchema = z.object({
  seasonId: integer,
  scoringPeriodId: integer,
  statSourceId: integer,
  statSplitTypeId: integer,
  appliedTotal: optionalNumber,
  proTeamId: integer.optional(),
  stats: z.record(z.string(), finite).optional(),
});
const playerSchema = z.object({
  id: integer,
  fullName: z.string().min(1),
  defaultPositionId: integer,
  proTeamId: integer,
  injuryStatus: z.string().optional(),
  stats: z.array(statSchema).optional(),
});
export const rosterSchema = z.object({
  entries: z.array(z.object({
    lineupSlotId: integer,
    playerPoolEntry: z.object({ player: playerSchema }),
  })),
});
const teamSchema = z.object({
  id: integer,
  name: z.string().optional(),
  location: z.string().optional(),
  nickname: z.string().optional(),
  abbrev: z.string().optional(),
  owners: z.array(z.string()).optional(),
  roster: rosterSchema.nullish(),
});
const matchupSideSchema = z.object({
  teamId: integer,
  totalPoints: optionalNumber,
  totalPointsLive: optionalNumber,
  totalProjectedPointsLive: optionalNumber,
  totalProjectedPoints: optionalNumber,
  pointsByScoringPeriod: z.record(z.string(), finite).optional(),
  rosterForCurrentScoringPeriod: rosterSchema.nullish(),
});
export const leagueSchema = z.object({
  id: integer.positive(),
  seasonId: integer.optional(),
  scoringPeriodId: integer.optional(),
  status: z.object({
    currentMatchupPeriod: integer.optional(),
    latestScoringPeriod: integer.optional(),
    isActive: z.boolean().optional(),
  }).optional(),
  settings: z.object({
    name: z.string().optional(),
    scoringSettings: z.object({
      scoringType: z.string().optional(),
      scoringItems: z.array(z.object({ statId: integer, points: finite })).optional(),
    }).optional(),
    scheduleSettings: z.object({
      matchupPeriods: z.record(z.string(), z.array(integer)).optional(),
    }).optional(),
  }).optional(),
  teams: z.array(teamSchema),
  schedule: z.array(z.object({
    matchupPeriodId: integer,
    winner: z.string().optional(),
    home: matchupSideSchema.nullish(),
    away: matchupSideSchema.nullish(),
  })).optional(),
});
export type EspnLeague = z.infer<typeof leagueSchema>;
export type EspnRoster = z.infer<typeof rosterSchema>;

const statusSchema = z.object({
  type: z.object({
    name: z.string(),
    state: z.enum(['pre', 'in', 'post']),
    completed: z.boolean().optional(),
    detail: z.string().optional(),
    shortDetail: z.string().optional(),
    description: z.string().optional(),
  }),
});
export const scoreboardSchema = z.object({
  season: z.object({ year: integer, type: integer }).optional(),
  week: z.object({ number: integer }).optional(),
  events: z.array(z.object({
    id: z.string(),
    date: z.string().refine(value => Number.isFinite(Date.parse(value))),
    status: statusSchema,
    competitions: z.array(z.object({
      status: statusSchema.optional(),
      competitors: z.array(z.object({
        homeAway: z.enum(['home', 'away']),
        team: z.object({ abbreviation: z.string() }),
        score: z.union([z.string().regex(/^\d+(?:\.\d+)?$/), finite]).optional(),
      })),
      broadcasts: z.array(z.object({ names: z.array(z.string()) })).optional(),
      broadcast: z.string().optional(),
    })).min(1),
  })),
});
