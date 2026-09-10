import { ArrowDownRight, ArrowUpRight, ChevronRight, Shield, Star, TriangleAlert } from 'lucide-react';
import type { Game, League, PlayerAppearance } from '../types';
import { formatPoints, kickoffLabel } from '../lib/dashboard';
import { Modal } from './Modal';

export function PlayerPortrait({ player, large = false }: { player: PlayerAppearance; large?: boolean }) {
  return <div className={`player-portrait ${large ? 'portrait-large' : ''}`}>
    <span className="portrait-initials">{player.position === 'D/ST' ? <Shield size={32} /> : player.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>
    {player.headshot && <img src={player.headshot} alt="" loading="lazy" style={{ opacity: 0 }} onLoad={event => { event.currentTarget.style.opacity = '1'; }} onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </div>;
}

export function PlayerCard({ player, league, game, watched, onWatch, onDetails }: {
  player: PlayerAppearance; league?: League; game?: Game; watched: boolean; onWatch: () => void; onDetails: () => void;
}) {
  const mine = player.side === 'you';
  const progress = player.projected && player.points !== null ? Math.min(100, Math.max(0, player.points / player.projected * 100)) : 0;
  return <article className={`player-card ${mine ? 'player-mine' : 'player-opponent'}`} data-testid="player-card">
    <div className="player-card-top">
      <span className={`ownership ${mine ? 'for' : 'against'}`}>{mine ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{mine ? 'YOUR STARTER' : 'OPPONENT'}</span>
      <span className="card-slot">{player.slot}</span>
      <button className={`watch-button ${watched ? 'watched' : ''}`} aria-label={`${watched ? 'Unwatch' : 'Watch'} ${player.name}`} aria-pressed={watched} onClick={onWatch}><Star size={16} fill={watched ? 'currentColor' : 'none'} /></button>
    </div>
    <div className="player-identity">
      <PlayerPortrait player={player} />
      <div className="player-title">
        <button className="player-name" onClick={onDetails} aria-label={`View ${player.name} details`}>{player.name}</button>
        <div className="player-meta"><strong>{player.nflTeam}</strong><span>·</span>{player.position}{player.injuryStatus && !['ACTIVE', 'NORMAL'].includes(player.injuryStatus) && <span className="injury-tag" title={player.injuryStatus}><TriangleAlert size={11} />{player.injuryStatus === 'QUESTIONABLE' ? 'Q' : player.injuryStatus}</span>}</div>
      </div>
      <div className="player-score"><strong>{formatPoints(player.points)}</strong><span>FPTS</span></div>
    </div>
    <div className="card-game"><span className={game?.status === 'live' ? 'live-text' : ''}>{game?.status === 'live' && <span className="status-dot" />}{game ? kickoffLabel(game) : 'Bye / no scheduled game'}</span><span>{game ? `${game.awayTeam} @ ${game.homeTeam}` : player.nflTeam}</span></div>
    <div className="player-stats">
      {player.stats.length ? player.stats.slice(0, 3).map(stat => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>) : <div className="pending-stats"><span>{game?.status === 'upcoming' ? 'The next chapter starts at kickoff.' : 'Detailed stats not yet available.'}</span></div>}
    </div>
    <div className="projection"><div className="projection-track"><span style={{ width: `${progress}%` }} /></div><span>PROJ <strong>{formatPoints(player.projected)}</strong></span></div>
    <button className="card-league" onClick={onDetails}><span><i className={`league-dot league-${league?.id ?? 'default'}`} />{league?.name ?? 'League unavailable'}</span><ChevronRight size={14} /></button>
  </article>;
}

export function PlayerDetails({ player, appearances, leagues, game, onClose }: {
  player: PlayerAppearance; appearances: PlayerAppearance[]; leagues: League[]; game?: Game; onClose: () => void;
}) {
  return <Modal titleId="player-detail-title" onClose={onClose}>
    <div className="detail-hero"><PlayerPortrait player={player} large /><div><div className="eyebrow">{player.nflTeam} · {player.position}</div><h2 id="player-detail-title">{player.name}</h2><p className="muted">{game ? `${game.awayTeam} @ ${game.homeTeam} · ${kickoffLabel(game)}` : 'Bye / no scheduled game'}</p></div></div>
    {player.injuryStatus && !['ACTIVE', 'NORMAL'].includes(player.injuryStatus) && <div className="inline-warning">ESPN injury status: {player.injuryStatus.toLowerCase()}</div>}
    <h3>One player. All your stakes.</h3>
    <p className="muted small">Fantasy points use each league's scoring rules. The same performance can earn different totals.</p>
    <div className="detail-appearances">
      {appearances.map(item => <div key={item.id}><div><span className={item.side === 'you' ? 'for' : 'against'}>{item.side === 'you' ? 'YOUR STARTER' : 'OPPONENT'}</span><strong>{leagues.find(l => l.id === item.leagueId)?.name ?? item.leagueId}</strong></div><b>{formatPoints(item.points)} <small>pts</small></b></div>)}
    </div>
    <h3>On-field production</h3>
    <div className="detail-stats">{player.stats.length ? player.stats.map(stat => <div key={stat.label}><strong>{stat.value}</strong><span>{stat.label}</span></div>) : <p className="muted small">Stats will appear when ESPN reports them.</p>}</div>
    <p className="fine-print">Star this player to follow every appearance in your watchlist.</p>
  </Modal>;
}
