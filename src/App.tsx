import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Eye, Home, LayoutGrid, LoaderCircle, LogOut, Moon, Plus, Radio, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Star, Sun, Target, Trophy, TriangleAlert, X, Zap } from 'lucide-react';
import { demoData, DEMO_NOW } from './data/demo';
import { filterPlayers, groupPlayers, kickoffLabel, rootingGuide } from './lib/dashboard';
import { api } from './lib/api';
import type { DashboardData, PlayerAppearance, SessionStatus, Side } from './types';
import { ConnectDialog } from './components/ConnectDialog';
import { HostedConnectDialog } from './components/HostedConnectDialog';
import { MatchupCard } from './components/MatchupCard';
import { PlayerCard, PlayerDetails } from './components/PlayerCard';

type View = 'players' | 'matchups' | 'rooting';
const savedWatchlist = (): string[] => {
  try { const value: unknown = JSON.parse(localStorage.getItem('sunday-hq-watchlist') ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
};

function BrandMark() {
  return <svg viewBox="0 0 40 40" width="36" height="36" fill="none" aria-hidden="true"><rect width="40" height="40" rx="11" fill="var(--cp-accent)" /><path d="M10 29C9 16 17 9 30 10C31 23 23 31 10 29Z" stroke="var(--cp-accent-fg)" strokeWidth="2.2" /><path d="m14 26 12-12m-9 3 6 6m-9-3 6 6m0-12 6 6" stroke="var(--cp-accent-fg)" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

function FieldArt() {
  return <div className="field-art" aria-hidden="true">
    <svg viewBox="0 0 330 160" fill="none">
      <g stroke="var(--cp-border)" strokeWidth="1"><path d="M0 20H330M0 140H330M30 0V160M90 0V160M150 0V160M210 0V160M270 0V160M330 0V160" />
        {[60, 120, 180, 240, 300].map(x => <path key={x} d={`M${x} 36v7m0 15v7m0 15v7m0 15v7m0 15v7`} />)}</g>
      <g stroke="var(--cp-accent)" strokeWidth="2.5" strokeLinecap="round"><path d="M84 120V72Q84 46 110 46H250m-10-9 11 9-11 9" strokeDasharray="5 6" /><path d="m165 100 12 12m0-12-12 12M213 91l12 12m0-12-12 12M122 105l12 12m0-12-12 12" /><circle cx="84" cy="123" r="8" /><circle cx="270" cy="46" r="9" /></g>
      <text x="176" y="143" fill="var(--cp-text-soft)" fontSize="10" fontFamily="Consolas, monospace" letterSpacing="3">EYES ON EVERY PLAY.</text>
    </svg>
  </div>;
}

export default function App() {
  const [data, setData] = useState<DashboardData | null>(demoData);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [companionError, setCompanionError] = useState('');
  const [connectOpen, setConnectOpen] = useState(false);
  const [view, setView] = useState<View>('players');
  const [side, setSide] = useState<Side | 'all'>('all');
  const [leagueIds, setLeagueIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('all');
  const [gameId, setGameId] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState(savedWatchlist);
  const [onlyWatchlist, setOnlyWatchlist] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerAppearance | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [theme, setTheme] = useState(() => {
    const param = new URLSearchParams(location.search).get('clawpilotTheme');
    if (param === 'dark' || param === 'light') return param;
    try { return localStorage.getItem('sunday-hq-theme') ?? document.documentElement.getAttribute('data-theme') ?? 'light'; }
    catch { return document.documentElement.getAttribute('data-theme') ?? 'light'; }
  });
  const inFlight = useRef<Promise<void> | null>(null);
  const dashboardController = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const isDemo = data?.source === 'demo' && !session?.authenticated;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('sunday-hq-theme', theme); } catch { setToast('Theme changed for this visit; browser storage is unavailable.'); }
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const loadDashboard = useCallback((force = false): Promise<void> => {
    if (inFlight.current && !force) return inFlight.current;
    if (force) {
      generation.current++;
      dashboardController.current?.abort();
    }
    const controller = new AbortController();
    dashboardController.current = controller;
    const version = generation.current;
    setRefreshing(true);
    const pending = (async () => {
      try {
        const result = await api.dashboard(controller.signal);
        if (version === generation.current) { setData(result); setError(''); setClock(Date.now()); }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (version === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to refresh ESPN data.');
        throw cause;
      } finally {
        if (version === generation.current) { inFlight.current = null; setRefreshing(false); }
      }
    })();
    inFlight.current = pending;
    return pending;
  }, []);
  useEffect(() => {
    if (!api.canConnect) return;
    let active = true;
    api.session().then(async status => {
      if (!active) return;
      setSession(status);
      if (status.authenticated) { setData(null); await loadDashboard(); }
    }).catch(cause => {
      if (active) setCompanionError(cause instanceof Error ? cause.message : 'Local companion unavailable.');
    });
    return () => { active = false; };
  }, [loadDashboard]);
  useEffect(() => {
    if (!session?.authenticated || !autoRefresh) return;
    const refresh = () => { if (!document.hidden) void loadDashboard().catch(() => { /* loadDashboard surfaces the error in the dashboard banner. */ }); };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [session?.authenticated, autoRefresh, loadDashboard]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName) && !document.querySelector('dialog[open]')) {
        event.preventDefault(); setView('players'); searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  function clearFilters() {
    setSide('all'); setLeagueIds([]); setQuery(''); setPosition('all'); setGameId(null); setOnlyWatchlist(false); setExpanded([]);
  }
  function selectLeague(id: string) {
    setLeagueIds([id]); setView('players'); setGameId(null); setExpanded([]);
  }
  function toggleWatch(playerId: string) {
    const next = watchlist.includes(playerId) ? watchlist.filter(id => id !== playerId) : [...watchlist, playerId];
    setWatchlist(next);
    try { localStorage.setItem('sunday-hq-watchlist', JSON.stringify(next)); }
    catch { setToast('Watchlist updated for this visit; browser storage is unavailable.'); }
  }
  async function refresh() {
    if (isDemo) { setToast('Demo snapshot restored. Connect ESPN for live scores.'); return; }
    await loadDashboard().catch(() => { /* Error is displayed next to the last successful snapshot. */ });
  }
  async function connected() {
    const status = await api.session();
    setSession(status);
    if (!status.authenticated) {
      resetDashboard();
      throw new Error('Connect your ESPN session before opening your gameday.');
    }
    setData(previous => previous?.source === 'espn' ? previous : null);
    clearFilters();
    await loadDashboard(true);
  }
  async function disconnect() {
    generation.current++;
    dashboardController.current?.abort();
    inFlight.current = null;
    setRefreshing(false);
    try {
      await api.logout();
      resetDashboard();
      setSession(previous => previous ? { ...previous, authenticated: false, loginPending: false } : null);
      setSession(await api.session());
      setToast('ESPN disconnected. Session credentials have been cleared.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to disconnect from ESPN.');
      throw cause;
    }
  }
  function resetDashboard() {
    generation.current++;
    dashboardController.current?.abort();
    inFlight.current = null;
    setRefreshing(false);
    setData(demoData); setSelectedPlayer(null); setError(''); clearFilters();
  }
  function hostedSessionChanged(status: SessionStatus) {
    setSession(status);
    setCompanionError('');
    if (!status.authenticated) resetDashboard();
    else {
      setData(previous => previous?.source === 'espn' ? previous : null);
      if (!session?.authenticated) void loadDashboard(true).catch(() => { /* The dashboard banner reports sync errors. */ });
    }
  }
  async function leaveVault(remove = false) {
    generation.current++;
    dashboardController.current?.abort();
    inFlight.current = null;
    setRefreshing(false);
    await (remove ? api.deleteVault() : api.logoutVault());
    resetDashboard();
    setSession({ mode: 'cloud', vaultAuthenticated: false, authenticated: false, loginPending: false, csrfToken: '' });
    setSession(await api.session());
    setToast(remove ? 'Private dashboard deleted. All devices have been signed out.' : 'Signed out of this browser. Your saved ESPN connection stays in your private dashboard.');
  }
  const players = data?.players ?? [];
  const leagues = data?.leagues ?? [];
  const games = data?.games ?? [];
  const scopedPlayers = useMemo(() => players.filter(p => !leagueIds.length || leagueIds.includes(p.leagueId)), [players, leagueIds]);
  const filtered = useMemo(() => filterPlayers(players, { side, leagueIds, query, position, onlyWatchlist, watchlist, gameId }), [players, side, leagueIds, query, position, onlyWatchlist, watchlist, gameId]);
  const groups = useMemo(() => groupPlayers(filtered, games, isDemo ? DEMO_NOW : new Date(clock)), [filtered, games, isDemo, clock]);
  const roots = useMemo(() => rootingGuide(scopedPlayers), [scopedPlayers]);
  const conflicts = roots.filter(item => item.kind === 'conflicted');
  const livePlayers = new Set(scopedPlayers.filter(p => games.find(g => g.id === p.gameId)?.status === 'live').map(p => p.playerId)).size;
  const leading = leagues.filter(l => (!leagueIds.length || leagueIds.includes(l.id)) && l.score !== null && l.opponentScore !== null && l.score > l.opponentScore).length;
  const activeFilters = Boolean(query || side !== 'all' || position !== 'all' || leagueIds.length || gameId || onlyWatchlist);
  const ageSeconds = data ? Math.max(0, Math.round((clock - Date.parse(data.fetchedAt)) / 1000)) : 0;
  const stale = !isDemo && (Boolean(error) || ageSeconds > 90);
  const refreshLabel = isDemo ? 'Sample snapshot · not live scores' : data ? `${stale ? 'Last successful sync' : 'Synced'} ${ageSeconds < 60 ? `${ageSeconds}s` : `${Math.floor(ageSeconds / 60)}m`} ago` : 'Connecting to ESPN';

  return <>
    <a href="#main-content" className="skip-link">Skip to gameday</a>
    <header className="topbar">
      <a className="brand" href="./" aria-label="Sunday HQ home"><BrandMark /><span>SUNDAY<span className="brand-hq">HQ</span><small>YOUR GAMEDAY. ALL TOGETHER.</small></span></a>
      <div className="topbar-center"><span className="season-label">FANTASY FOOTBALL</span><span className="topbar-separator" />{data?.season ?? new Date().getFullYear()} SEASON</div>
      <div className="topbar-actions">
        <a className="portfolio-button" href="https://daniel-beachy.github.io/"><Home size={14} />Portfolio</a>
        <span className={`mode-badge ${isDemo ? 'demo-badge' : ''}`}>{isDemo ? <Eye size={13} /> : <ShieldCheck size={14} />}{isDemo ? 'Demo mode' : session?.authenticated ? 'ESPN connected' : 'Connecting'}</span>
        <button className="icon-button theme-button" aria-label="Toggle color theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className="button primary connect-top" onClick={() => setConnectOpen(true)}>{session?.authenticated ? 'Manage leagues' : 'Connect ESPN'}<ArrowRight size={16} /></button>
      </div>
    </header>
    <div className="app-layout">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-caption">YOUR COMMAND CENTER</div>
        <nav className="main-nav">
          <button className={view === 'players' && !onlyWatchlist ? 'active' : ''} onClick={() => { setView('players'); setOnlyWatchlist(false); }}><LayoutGrid size={18} />Gameday<span className="nav-live-dot" /></button>
          <button aria-label="Watchlist" className={onlyWatchlist && view === 'players' ? 'active' : ''} onClick={() => { setView('players'); setOnlyWatchlist(!onlyWatchlist); }}><Star size={18} />Watchlist<span className="nav-count" aria-hidden="true">{watchlist.length}</span></button>
          <button aria-label="Matchups" className={view === 'matchups' ? 'active' : ''} onClick={() => setView('matchups')}><Trophy size={18} />Matchups<span className="nav-count" aria-hidden="true">{leagues.length}</span></button>
          <button className={view === 'rooting' ? 'active' : ''} onClick={() => setView('rooting')}><Target size={18} />Rooting guide</button>
        </nav>
        <div className="sidebar-leagues">
          <div className="sidebar-caption">YOUR LEAGUES<button aria-label="Add an ESPN league" className="icon-button" onClick={() => setConnectOpen(true)}><Plus size={15} /></button></div>
          <button aria-label="All leagues" className={`league-nav all-leagues ${!leagueIds.length ? 'selected' : ''}`} onClick={() => { setLeagueIds([]); setView('players'); }}><span className="league-nav-icon"><LayoutGrid size={14} /></span>All leagues<span aria-hidden="true">{leagues.length}</span></button>
          {leagues.map((league, i) => <button key={league.id} className={`league-nav ${leagueIds.includes(league.id) ? 'selected' : ''}`} onClick={() => selectLeague(league.id)}><span className="league-nav-icon">{['SD', 'OL', 'DA'][i] ?? league.name.slice(0, 2).toUpperCase()}</span><span className="league-nav-name">{league.name}<small>{league.scoring}</small></span>{leagueIds.includes(league.id) && <Check size={13} />}</button>)}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><Zap size={20} /><strong>Less switching.<br />More Sunday.</strong><p>Every league. Every rivalry.<br />All the football that matters to you.</p><button onClick={() => setConnectOpen(true)}>{session?.authenticated ? 'Manage your connection' : 'Make it your gameday'}<ArrowRight size={14} /></button></div>
          {session?.authenticated ? <button className="sidebar-help" onClick={() => void disconnect().catch(() => { /* Disconnect errors are shown in the dashboard banner. */ })}><LogOut size={15} />Disconnect ESPN</button> : <button className="sidebar-help" onClick={() => setConnectOpen(true)}><CircleHelp size={15} />How does it work?</button>}
          <div className="sidebar-footnote">BUILT FOR THE MULTI-LEAGUE LIFE.</div>
        </div>
      </aside>
      <main id="main-content" className="main-content">
        <section className="masthead">
          <div className="masthead-text"><div className="eyebrow"><span className="tiny-diamond" />THIS IS YOUR SUNDAY HQ</div><h1>Every player. Every league.<br /><span>One view.</span></h1><p>The ones you need to go off. The ones you need to slow down.<br className="desktop-break" /> Your entire fantasy week, finally in one place.</p></div>
          <FieldArt />
          <div className="week-chip"><CalendarDays size={16} /><span>WEEK <strong>{data?.week ?? '--'}</strong></span><span className="week-chip-season">{data?.season ?? 'NFL'}</span></div>
        </section>
        <div className="overview-strip">
          <div><span className="metric-icon"><Trophy size={18} /></span><div><strong>{leagueIds.length || leagues.length}<small>leagues in play</small></strong><span>{leading} currently leading</span></div></div>
          <div><span className="metric-icon for"><Radio size={19} /></span><div><strong>{livePlayers}<small>players on the field</small></strong><span><span className="status-dot" />{isDemo ? 'In this demo snapshot' : 'Live across your leagues'}</span></div></div>
          <div><span className="metric-icon"><ShieldCheck size={19} /></span><div><strong>{scopedPlayers.filter(p => p.side === 'you').length}<small>starters to root for</small></strong><span>{scopedPlayers.filter(p => p.side === 'opponent').length} to root against</span></div></div>
          <button className="conflict-metric" onClick={() => setView('rooting')}><span className="metric-icon warning"><Zap size={19} /></span><div><strong>{conflicts.length}<small>mixed allegiances</small></strong><span>Own them. Face them.<ChevronRight size={12} /></span></div></button>
        </div>
        <section className="slate-section" aria-label="NFL game slate">
          <div className="section-kicker"><span><Radio size={14} />AROUND THE LEAGUE</span><span>{isDemo ? 'Illustrative matchups · Week 1 demo' : `Week ${data?.week ?? '--'} · Times in your timezone`}</span></div>
          <div className="game-ticker">
            {games.map(game => <button key={game.id} aria-label={`Filter ${game.awayTeam} at ${game.homeTeam}`} aria-describedby={`game-description-${game.id}`} aria-pressed={gameId === game.id} className={`ticker-game ${gameId === game.id ? 'selected' : ''}`} onClick={() => { setGameId(gameId === game.id ? null : game.id); setView('players'); setExpanded([]); }}>
              <span id={`game-description-${game.id}`} className="sr-only">{game.awayTeam} {game.awayScore ?? 'score unavailable'}, {game.homeTeam} {game.homeScore ?? 'score unavailable'}. {kickoffLabel(game)}. {game.broadcast}.</span>
              <div className="ticker-status"><span className={game.status === 'live' ? 'for' : ''}>{game.status === 'live' && <span className="status-dot" />}{kickoffLabel(game)}</span><span>{game.broadcast}</span></div>
              <div className="ticker-team"><span className="team-abbr-icon">{game.awayTeam.slice(0, 1)}</span><strong>{game.awayTeam}</strong><b>{game.awayScore ?? '–'}</b></div>
              <div className="ticker-team"><span className="team-abbr-icon">{game.homeTeam.slice(0, 1)}</span><strong>{game.homeTeam}</strong><b>{game.homeScore ?? '–'}</b></div>
              <div className="ticker-exposure">{scopedPlayers.filter(p => p.gameId === game.id).length} starting spots<ChevronRight size={11} /></div>
            </button>)}
            {!games.length && <p className="muted">The game slate will appear when ESPN's schedule is available.</p>}
          </div>
        </section>
        <div className="dashboard-status"><span className={stale ? 'warning' : 'muted'}>{stale ? <TriangleAlert size={13} /> : <Clock3 size={13} />}{refreshLabel}</span><div>
          <button className={`auto-refresh ${autoRefresh ? 'on' : ''}`} onClick={() => setAutoRefresh(!autoRefresh)} aria-pressed={autoRefresh} aria-label="Toggle automatic refresh"><span className="toggle-track"><i /></span>{isDemo ? 'Auto-refresh when connected' : `Auto-refresh ${autoRefresh ? '30s' : 'paused'}`}</button>
          <button className="refresh-button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={13} className={refreshing ? 'spin' : ''} />{refreshing ? 'Syncing' : 'Refresh'}</button>
        </div></div>
        {error && <div className="error-message" role="alert"><TriangleAlert size={19} /><div><strong>{data?.source === 'espn' ? 'ESPN sync interrupted. Showing the last successful snapshot.' : 'Your ESPN dashboard could not be loaded.'}</strong><p>{error}</p><button className="text-button" onClick={() => setConnectOpen(true)}>Manage ESPN connection <ArrowRight size={13} /></button></div></div>}
        {data?.warnings.map(warning => <div key={warning} className="inline-warning" role="status"><TriangleAlert size={15} />{warning}</div>)}
        <div className={`dashboard-grid ${view !== 'players' ? 'single-view' : ''}`}>
          <section className="players-panel">
            <div className="panel-heading"><div><h2>{view === 'matchups' ? 'Your weekly matchups' : view === 'rooting' ? 'Know who to cheer for.' : onlyWatchlist ? 'Your watchlist' : 'The whole field.'}</h2><p>{view === 'matchups' ? 'Different leagues. Same competitive streak.' : view === 'rooting' ? 'Because fantasy loyalty is complicated.' : onlyWatchlist ? 'Your starred players, in every league they appear.' : 'All your starters. Both sides of the story.'}</p></div><span className="outline-badge">{view === 'players' ? `${filtered.length} starting spots` : `${leagueIds.length || leagues.length} leagues`}</span></div>
            {view === 'players' && <>
              <div className="filter-toolbar">
                <div className="side-tabs" aria-label="Player ownership"><button className={side === 'all' ? 'active' : ''} onClick={() => setSide('all')}>Everyone</button><button className={side === 'you' ? 'active' : ''} onClick={() => setSide('you')}><ArrowUpRight size={14} />My players</button><button className={side === 'opponent' ? 'active' : ''} onClick={() => setSide('opponent')}><ArrowDownRight size={14} />Opponents</button></div>
                <button className={`button filter-button ${filterOpen ? 'selected' : ''}`} aria-expanded={filterOpen} onClick={() => setFilterOpen(!filterOpen)}><SlidersHorizontal size={15} />Filters{(position !== 'all' || leagueIds.length > 0) && <i className="filter-indicator" />}</button>
              </div>
              <div className="search-box"><Search size={17} /><input ref={searchRef} aria-label="Search players" placeholder="Find a player, team, or position" value={query} onChange={event => setQuery(event.target.value)} />{query ? <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button> : <kbd>/</kbd>}</div>
              {filterOpen && <div className="filter-drawer"><label>Position<select value={position} onChange={event => setPosition(event.target.value)}><option value="all">All positions</option>{[...new Set(players.map(p => p.position))].sort().map(pos => <option value={pos} key={pos}>{pos}</option>)}</select></label><fieldset><legend>Leagues</legend>{leagues.map(league => <label key={league.id}><input type="checkbox" checked={!leagueIds.length || leagueIds.includes(league.id)} onChange={() => setLeagueIds(previous => { const selected = previous.length ? previous : leagues.map(l => l.id); const next = selected.includes(league.id) ? selected.filter(id => id !== league.id) : [...selected, league.id]; return next.length === leagues.length ? [] : next.length ? next : [league.id]; })} />{league.name}</label>)}</fieldset></div>}
              {activeFilters && <div className="active-filters"><span>Showing {filtered.length} of {players.length} starting spots{gameId ? ` · ${games.find(g => g.id === gameId)?.awayTeam} @ ${games.find(g => g.id === gameId)?.homeTeam}` : ''}{leagueIds.length === 1 ? ` · ${leagues.find(l => l.id === leagueIds[0])?.name}` : ''}</span><button onClick={clearFilters}>Clear filters<X size={12} /></button></div>}
              {refreshing && !data && <div className="empty-state"><LoaderCircle size={32} className="spin" /><h3>Calling your starting lineup...</h3><p>Fetching your leagues, matchups, and the NFL game slate.</p></div>}
              {!filtered.length && !refreshing && <div className="empty-state"><Search size={30} /><h3>{data ? 'No players in this huddle' : 'Your gameday is waiting'}</h3><p>{data ? 'Try a different search, adjust your filters, or star a player to build your watchlist.' : 'Connect your ESPN account and add a league to see your starting players.'}</p><button className="button secondary" onClick={data ? clearFilters : () => setConnectOpen(true)}>{data ? 'Clear filters' : 'Manage leagues'}<ArrowRight size={15} /></button></div>}
              {groups.map(group => <section className="player-group" key={group.key}>
                <div className="group-heading"><div><span className={`group-marker ${group.key === 'live' ? 'live-marker' : ''}`}>{group.key === 'live' ? <Radio size={16} /> : group.key === 'final' ? <Check size={16} /> : <Clock3 size={16} />}</span><h3>{group.title}</h3><span className="group-count">{group.players.length}</span></div>{group.key === 'live' && <span className="live-label"><span className="status-dot" />{isDemo ? 'DEMO LIVE' : 'LIVE'}</span>}</div>
                <div className="player-card-grid">{(expanded.includes(group.key) || activeFilters ? group.players : group.players.slice(0, group.key === 'live' ? 6 : 4)).map(player => <PlayerCard key={player.id} player={player} league={leagues.find(l => l.id === player.leagueId)} game={games.find(g => g.id === player.gameId)} watched={watchlist.includes(player.playerId)} onWatch={() => toggleWatch(player.playerId)} onDetails={() => setSelectedPlayer(player)} />)}</div>
                {!activeFilters && group.players.length > (group.key === 'live' ? 6 : 4) && <button className="show-more" onClick={() => setExpanded(previous => previous.includes(group.key) ? previous.filter(key => key !== group.key) : [...previous, group.key])}>{expanded.includes(group.key) ? 'Show fewer players' : `Show all ${group.players.length} ${group.key === 'live' ? 'live ' : ''}starting spots`}<ChevronDown size={15} className={expanded.includes(group.key) ? 'rotate' : ''} /></button>}
              </section>)}
            </>}
            {view === 'matchups' && <div className="matchup-full-grid">{leagues.filter(l => !leagueIds.length || leagueIds.includes(l.id)).map(league => <MatchupCard key={league.id} league={league} onSelect={() => selectLeague(league.id)} />)}{!leagues.length && <p className="muted">Connect a league to see its matchup.</p>}</div>}
            {view === 'rooting' && <><div className="rooting-explainer"><Zap size={23} /><div><strong>The rooting math, without the headache.</strong><p>Green means they're in your lineup. Red means they're across the field. Mixed? You're starting and facing them in different leagues. Counts reflect starting appearances, not a weighted win probability.</p></div></div><div className="rooting-full-grid">{roots.map(root => <button className={`rooting-full-card ${root.kind === 'conflicted' ? 'conflicted' : ''}`} key={root.playerId} onClick={() => { setQuery(root.name); setSide('all'); setGameId(null); setPosition('all'); setOnlyWatchlist(false); setView('players'); }}><div className="rooting-full-top"><span className="position-pill">{root.position}</span><span>{root.nflTeam}</span><span className={`root-kind ${root.kind}`}>{root.kind === 'conflicted' ? 'MIXED ALLEGIANCES' : root.kind === 'for' ? 'LET THEM COOK' : 'ROOT AGAINST'}</span></div><h3>{root.name}</h3><div className="rooting-counts"><span className="for"><ArrowUpRight size={16} />{root.forCount} for you</span><span className="against"><ArrowDownRight size={16} />{root.againstCount} against</span><ChevronRight size={16} /></div></button>)}</div></>}
          </section>
          {view === 'players' && <aside className="right-rail" aria-label="Your league outlook">
            <div className="rail-heading"><h2><Trophy size={17} />League pulse</h2><button className="icon-button" aria-label="View all matchups" onClick={() => setView('matchups')}><ArrowRight size={16} /></button></div>
            <div className="league-pulse">{leagues.map(league => <MatchupCard key={league.id} league={league} compact onSelect={() => selectLeague(league.id)} />)}</div>
            <div className="rooting-preview"><div className="rail-heading"><h2><Zap size={17} />It's complicated.</h2><span className="count-pill">{conflicts.length}</span></div><p>You have them. So do your opponents.</p>{conflicts.slice(0, 4).map(root => <button className="rooting-row" key={root.playerId} onClick={() => { setQuery(root.name); setSide('all'); setGameId(null); setPosition('all'); setOnlyWatchlist(false); }}><span className="root-initials">{root.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span><span><strong>{root.name}</strong><small><span className="for">{root.forCount} for</span><span>·</span><span className="against">{root.againstCount} against</span></small></span><ChevronRight size={14} /></button>)}{!conflicts.length && <p className="small muted">No divided loyalties in these leagues. Enjoy the uncomplicated cheers.</p>}<button className="rail-link" onClick={() => setView('rooting')}>See your rooting guide<ArrowRight size={14} /></button></div>
            <div className="gameday-note"><Sparkles size={18} /><span><strong>A star follows the player.</strong><p>Add someone to your watchlist and follow them across every one of your leagues.</p></span></div>
            {isDemo && <div className="demo-note"><Eye size={15} /><p>You're exploring a sample Sunday. Scores, schedules, and rosters are illustrative—not live NFL data.</p></div>}
          </aside>}
        </div>
        <footer className="page-footer"><span><BrandMark />MADE FOR THE MULTI-LEAGUE LIFE.</span><span>{isDemo ? 'Illustrative demo · ' : 'Unofficial ESPN integration · '}Not affiliated with ESPN or the NFL.<a href="https://github.com/daniel-beachy/fantasy-dashboard-v1" target="_blank" rel="noreferrer">Source<ArrowRight size={12} /></a></span></footer>
      </main>
    </div>
    {connectOpen && (api.isCloud
      ? <HostedConnectDialog onClose={() => setConnectOpen(false)} onConnected={connected} onDisconnect={disconnect} onSignOut={() => leaveVault()} onDelete={() => leaveVault(true)} onSessionChange={hostedSessionChanged} initialSession={session} companionError={companionError} />
      : <ConnectDialog onClose={() => setConnectOpen(false)} onConnected={connected} onDisconnect={disconnect} initialSession={session} companionError={companionError} />)}
    {selectedPlayer && <PlayerDetails player={players.find(p => p.id === selectedPlayer.id) ?? selectedPlayer} appearances={players.filter(p => p.playerId === selectedPlayer.playerId)} leagues={leagues} game={games.find(g => g.id === selectedPlayer.gameId)} onClose={() => setSelectedPlayer(null)} />}
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" onClick={() => setToast('')} aria-label="Dismiss notification"><X size={15} /></button></div>}
  </>;
}
