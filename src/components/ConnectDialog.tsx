import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, ExternalLink, KeyRound, LoaderCircle, LogOut, Plus, ShieldCheck, Terminal, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import type { LeagueSelection, SessionStatus } from '../types';
import { Modal } from './Modal';

const localCommands = 'git clone https://github.com/daniel-beachy/fantasy-dashboard-v1.git\ncd fantasy-dashboard-v1\nnpm install\nnpm run dev';

export function ConnectDialog({ onClose, onConnected, onDisconnect, initialSession, companionError }: {
  onClose: () => void; onConnected: () => Promise<void>; onDisconnect: () => Promise<void>; initialSession: SessionStatus | null; companionError: string;
}) {
  const [session, setSession] = useState(initialSession);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [leagues, setLeagues] = useState<LeagueSelection[]>([]);
  const [copied, setCopied] = useState(false);
  const localReady = api.isLocal && Boolean(initialSession);

  async function update() {
    const status = await api.session();
    setSession(status);
    if (status.loginError) setError(status.loginError);
    if (status.authenticated) {
      const result = await api.leagues();
      setLeagues(result.leagues);
    }
    return status;
  }
  useEffect(() => {
    if (!session?.loginPending) return;
    let active = true;
    let running = false;
    const timer = window.setInterval(async () => {
      if (running) return;
      running = true;
      try {
        const status = await api.session();
        if (!active) return;
        setSession(status);
        if (status.loginError) setError(status.loginError);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Unable to check ESPN sign-in.'); }
      finally { running = false; }
    }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session?.loginPending]);
  useEffect(() => {
    if (!localReady) return;
    let active = true;
    api.session().then(status => {
      if (!active) return;
      setSession(status);
      if (status.loginError) setError(status.loginError);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load your ESPN session.'); });
    return () => { active = false; };
  }, [localReady]);
  useEffect(() => {
    if (!localReady || !session?.authenticated) return;
    let active = true;
    api.leagues().then(result => { if (active) setLeagues(result.leagues); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load your leagues.'); });
    return () => { active = false; };
  }, [localReady, session?.authenticated]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); await update(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Connection failed. Please try again.'); }
    finally { setBusy(false); }
  }
  return <Modal titleId="connect-title" onClose={onClose}>
    <div className="modal-emblem"><ShieldCheck size={28} /></div>
    <div className="eyebrow">LESS TAB-HOPPING. MORE FOOTBALL.</div>
    <h2 id="connect-title">Your leagues. Connected.</h2>
    <p className="modal-intro">One ESPN account. Every starting lineup. An entirely better Sunday.</p>
    <div className="privacy-note"><ShieldCheck size={20} /><span>Your password stays with ESPN. Your session stays on your machine. Credentials are sent only to ESPN, never to a third-party proxy.</span></div>

    {!localReady ? <>
      <h3><Terminal size={18} /> Bring your leagues home</h3>
      <p className="muted small">This public site is an interactive demo. GitHub Pages cannot run a private ESPN session, so real leagues use the companion app on your computer. Requires Node.js 22+ and Chrome or Edge.</p>
      {api.isLocal && companionError && <p className="inline-warning">{companionError}</p>}
      <div className="code-block">
        <button className="icon-button" aria-label="Copy local setup commands" onClick={async () => {
          try { await navigator.clipboard.writeText(localCommands); setCopied(true); }
          catch { setError('Clipboard access was denied. Select and copy the commands below.'); }
        }}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
        <pre>{localCommands}</pre>
      </div>
      <div className="setup-step"><span>1</span> Run the commands in a terminal.</div>
      <div className="setup-step"><span>2</span> Open <strong>http://127.0.0.1:3000</strong>.</div>
      <div className="setup-step"><span>3</span> Click Connect ESPN and sign in with ESPN.</div>
      <a className="button primary full-width" href="https://github.com/daniel-beachy/fantasy-dashboard-v1#connect-your-espn-account" target="_blank" rel="noreferrer">View setup guide <ExternalLink size={16} /></a>
      <p className="fine-print">No backend hosting account. No subscription. No credential-sharing proxy.</p>
    </> : session?.authenticated ? <>
      <div className="connected-heading"><span className="status-dot" /> ESPN session connected</div>
      {session.discoveryWarning && <p className="inline-warning">{session.discoveryWarning}</p>}
      <p className="small muted">Check your leagues below. Missing one? Add its numeric league ID from the ESPN league URL. Only teams owned by your ESPN account can be selected.</p>
      <div className="connected-leagues">
        {leagues.map(league => <div key={league.id} className="connected-league">
          <strong>{league.name}</strong>
          <label className="sr-only" htmlFor={`team-${league.id}`}>Your team in {league.name}</label>
          <select id={`team-${league.id}`} value={league.teamId ?? ''} disabled={busy} onChange={event => void act(() => api.addLeague(league.id, Number(event.target.value)))}>
            <option value="" disabled>Select your team</option>
            {league.teams.filter(team => team.owned).map(team => <option value={team.id} key={team.id}>{team.name}</option>)}
          </select>
        </div>)}
      </div>
      <form className="add-league-form" onSubmit={event => { event.preventDefault(); void act(async () => { await api.addLeague(leagueId.trim()); setLeagueId(''); }); }}>
        <label htmlFor="league-id">ESPN league ID</label>
        <div className="input-button"><input id="league-id" inputMode="numeric" pattern="[0-9]+" required placeholder="e.g. 12345678" value={leagueId} onChange={event => setLeagueId(event.target.value)} />
          <button className="button secondary" disabled={busy}><Plus size={16} /> Add league</button></div>
      </form>
      <button className="button primary full-width" disabled={busy || !leagues.some(league => league.teamId !== undefined)} onClick={async () => {
        setBusy(true); setError('');
        try { await onConnected(); onClose(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load your dashboard.'); } finally { setBusy(false); }
      }}>Open my gameday <ArrowRight size={17} /></button>
      <button className="button secondary full-width disconnect-button" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await onDisconnect(); onClose(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to disconnect from ESPN.'); }
        finally { setBusy(false); }
      }}><LogOut size={16} />Disconnect ESPN</button>
    </> : <>
      <button className="button primary full-width" disabled={busy || session?.loginPending} onClick={() => void act(api.login)}>
        {session?.loginPending ? <><LoaderCircle size={18} className="spin" /> Waiting for ESPN sign-in...</> : <>Sign in with ESPN <ArrowRight size={18} /></>}
      </button>
      <p className="fine-print">Opens ESPN in a separate browser window. Sign in there, including any verification ESPN requests. This page will update automatically.</p>
      {session?.loginPending && <button className="button secondary full-width" disabled={busy} onClick={() => void act(api.logout)}>Cancel sign-in</button>}
      <div className="divider-label">OR USE YOUR EXISTING SESSION</div>
      <button className="button secondary full-width" aria-expanded={manual} disabled={session?.loginPending} onClick={() => setManual(!manual)}><KeyRound size={17} /> Connect with ESPN cookies</button>
      {manual && <form className="cookie-form" onSubmit={event => { event.preventDefault(); void act(async () => { await api.connect(swid.trim(), espnS2.trim()); setSwid(''); setEspnS2(''); }); }}>
        <p className="small muted">In your signed-in ESPN browser, open Developer Tools → Application → Cookies → fantasy.espn.com. Copy only your own SWID and espn_s2 values. These are sensitive session credentials; never share them.</p>
        <label htmlFor="swid">SWID<input type="password" autoComplete="off" id="swid" value={swid} onChange={event => setSwid(event.target.value)} required placeholder="{your-account-id}" /></label>
        <label htmlFor="s2">espn_s2<input type="password" autoComplete="off" id="s2" value={espnS2} onChange={event => setEspnS2(event.target.value)} required placeholder="Your ESPN session cookie" /></label>
        <button className="button primary full-width" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />} Connect securely</button>
      </form>}
    </>}
    {error && <div className="error-message" role="alert"><TriangleAlert size={18} /><span>{error}</span></div>}
    <div className="modal-footer">Independent fan project. Not affiliated with or endorsed by ESPN or the NFL.</div>
  </Modal>;
}
