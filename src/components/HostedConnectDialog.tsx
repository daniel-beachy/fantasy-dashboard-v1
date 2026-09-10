import { useEffect, useState } from 'react';
import { ArrowRight, Check, Copy, KeyRound, LoaderCircle, LogOut, Plus, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api';
import type { LeagueSelection, SessionStatus } from '../types';
import { Modal } from './Modal';

export function HostedConnectDialog({ onClose, onConnected, onDisconnect, onSignOut, onDelete, onSessionChange, initialSession, companionError }: {
  onClose: () => void;
  onConnected: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onDelete: () => Promise<void>;
  onSessionChange: (status: SessionStatus) => void;
  initialSession: SessionStatus | null;
  companionError: string;
}) {
  const [session, setSession] = useState(initialSession);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState('');
  const [newKey, setNewKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [leagueId, setLeagueId] = useState('');
  const [leagues, setLeagues] = useState<LeagueSelection[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { setSession(initialSession); }, [initialSession]);
  useEffect(() => {
    let active = true;
    api.session().then(status => {
      if (!active) return;
      setSession(status);
      onSessionChange(status);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to check your private dashboard session.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!session?.authenticated) { setLeagues([]); return; }
    let active = true;
    const controller = new AbortController();
    api.leagues(controller.signal).then(result => { if (active) setLeagues(result.leagues); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load your leagues.'); });
    return () => { active = false; controller.abort(); };
  }, [session?.authenticated]);

  function clearSecrets() { setRecoveryInput(''); setNewKey(''); setSwid(''); setEspnS2(''); }
  function close() {
    if (busy) return;
    if (newKey && !savedKey) { setError('Save your recovery key and acknowledge it before leaving. It cannot be shown again.'); return; }
    clearSecrets();
    onClose();
  }
  async function refreshStatus() {
    const status = await api.session();
    setSession(status);
    onSessionChange(status);
    return status;
  }
  async function act(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update your private dashboard. Please try again.'); }
    finally { setBusy(false); }
  }
  async function updateLeague(id: string, teamId?: number) {
    await api.addLeague(id, teamId);
    setLeagueId('');
    setLeagues((await api.leagues()).leagues);
  }
  async function leave(action: () => Promise<void>) {
    clearSecrets();
    await action();
    onClose();
  }

  return <Modal titleId="hosted-connect-title" onClose={close}>
    <div className="modal-emblem"><ShieldCheck size={28} /></div>
    <div className="eyebrow">YOUR LEAGUES. YOUR PRIVATE SPACE.</div>
    <h2 id="hosted-connect-title">Your private gameday.</h2>
    <p className="modal-intro">All your ESPN leagues, at home or on the go. One recovery key unlocks your dashboard on any device.</p>
    <div className="privacy-note"><ShieldCheck size={20} /><span>Your ESPN session credentials are encrypted in your private Cloudflare vault. They travel only to this app’s Cloudflare backend and ESPN—not just your machine. Your recovery key protects private access. We never ask for your ESPN password.</span></div>

    {newKey ? <section className="vault-recovery" aria-labelledby="save-key-title">
      <h3 id="save-key-title"><KeyRound size={18} /> Save your recovery key now</h3>
      <p className="small muted">This is the only time we show it. Store it in your password manager. Anyone with this key can access your private dashboard and manage its ESPN connection. If you lose it, we cannot recover your dashboard.</p>
      <label htmlFor="new-recovery-key">Your recovery key</label>
      <input id="new-recovery-key" className="recovery-key" value={newKey} readOnly autoComplete="off" spellCheck={false} />
      <button className="button secondary full-width" aria-label={copied ? 'Copied recovery key' : 'Copy recovery key'} onClick={() => void act(async () => {
        try { await navigator.clipboard.writeText(newKey); setCopied(true); }
        catch { throw new Error('Clipboard access was denied. Select the recovery key above and copy it to a safe place.'); }
      })} disabled={busy}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied recovery key' : 'Copy recovery key'}</button>
      <p className="fine-print">Keep this key private. Do not put it in a URL or share screenshots. Clear your clipboard after saving it.</p>
      <label className="vault-check"><input type="checkbox" checked={savedKey} onChange={event => setSavedKey(event.target.checked)} />I saved my recovery key in a safe place.</label>
      <button className="button primary full-width" disabled={!savedKey || busy} onClick={() => void act(async () => {
        if (!session?.vaultAuthenticated) await refreshStatus();
        setNewKey(''); setSavedKey(false); setCopied(false);
      })}>Continue to ESPN <ArrowRight size={16} /></button>
    </section> : deleting ? <section className="vault-delete" aria-labelledby="delete-vault-title">
      <h3 id="delete-vault-title"><Trash2 size={18} /> Delete this private dashboard?</h3>
      <p className="small muted">This permanently deletes your vault, saved ESPN credentials and league selections, and signs out every device. Your recovery key will stop working. This cannot be undone. Your ESPN account and leagues at ESPN are not deleted.</p>
      <label className="vault-check"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} disabled={busy} />I understand this permanently deletes my dashboard and saved ESPN connection.</label>
      <button className="button secondary danger-button full-width" disabled={busy || !confirmDelete} onClick={() => void act(() => leave(onDelete))}><Trash2 size={16} />Permanently delete dashboard</button>
      <button className="button secondary full-width" disabled={busy} onClick={() => { setDeleting(false); setConfirmDelete(false); setError(''); }}>Keep my dashboard</button>
    </section> : !session ? <>
      <p className="inline-warning">{companionError || 'Checking your private dashboard session…'}</p>
      <button className="button primary full-width" disabled={busy} onClick={() => void act(refreshStatus)}>{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}Retry connection</button>
    </> : !session.vaultAuthenticated ? <div className="vault-entry">
      <button className="button primary full-width" disabled={busy} onClick={() => void act(async () => {
        setRecoveryInput('');
        const result = await api.createVault();
        setNewKey(result.recoveryKey); setSavedKey(false); setCopied(false);
        await refreshStatus();
      })}>{busy ? <LoaderCircle size={17} className="spin" /> : <Plus size={17} />}Create private dashboard</button>
      <p className="fine-print">No email or ESPN password needed. We use a secure, HttpOnly session cookie to remember this browser.</p>
      <div className="divider-label">ALREADY HAVE A PRIVATE DASHBOARD?</div>
      <button className="button secondary full-width" aria-expanded={signingIn} disabled={busy} onClick={() => { setSigningIn(!signingIn); setRecoveryInput(''); setError(''); }}><KeyRound size={17} />Sign in with recovery key</button>
      {signingIn && <form className="cookie-form" onSubmit={event => {
        event.preventDefault();
        void act(async () => {
          try { await api.loginVault(recoveryInput.trim()); }
          finally { setRecoveryInput(''); }
          await refreshStatus();
          setSigningIn(false);
        });
      }}>
        <label htmlFor="recovery-key">Recovery key<input id="recovery-key" type="password" autoComplete="off" spellCheck={false} value={recoveryInput} required disabled={busy} onChange={event => setRecoveryInput(event.target.value)} placeholder="hq_…" /></label>
        <p className="small muted">Use the key you saved when creating your dashboard—not your ESPN password.</p>
        <button className="button primary full-width" disabled={busy}><KeyRound size={16} />Unlock private dashboard</button>
      </form>}
    </div> : <>
      <div className="vault-status"><ShieldCheck size={16} /><span>Private dashboard unlocked</span></div>
      {session.authenticated ? <>
        <div className="connected-heading"><span className="status-dot" /> {leagues.length ? 'ESPN session connected' : 'ESPN cookies saved'}</div>
        {session.discoveryWarning && <p className="inline-warning">{session.discoveryWarning}</p>}
        <p className="small muted">Choose your owned teams below. Missing a league? Add its numeric ID from the ESPN league URL.</p>
        <div className="connected-leagues">
          {leagues.map(league => <div key={league.id} className="connected-league">
            <strong>{league.name}</strong>
            <label className="sr-only" htmlFor={`cloud-team-${league.id}`}>Your team in {league.name}</label>
            <select id={`cloud-team-${league.id}`} value={league.teamId ?? ''} disabled={busy} onChange={event => void act(() => updateLeague(league.id, Number(event.target.value)))}>
              <option value="" disabled>Select your team</option>
              {league.teams.filter(team => team.owned).map(team => <option value={team.id} key={team.id}>{team.name}</option>)}
            </select>
          </div>)}
        </div>
        <form className="add-league-form" onSubmit={event => { event.preventDefault(); void act(() => updateLeague(leagueId.trim())); }}>
          <label htmlFor="cloud-league-id">ESPN league ID</label>
          <div className="input-button"><input id="cloud-league-id" inputMode="numeric" pattern="[0-9]+" required placeholder="e.g. 12345678" value={leagueId} disabled={busy} onChange={event => setLeagueId(event.target.value)} />
            <button className="button secondary" disabled={busy}><Plus size={16} />Add league</button></div>
        </form>
        <button className="button primary full-width" disabled={busy || !leagues.some(league => league.teamId !== undefined)} onClick={() => void act(() => leave(onConnected))}>Open my gameday <ArrowRight size={17} /></button>
        <button className="button secondary full-width disconnect-button" disabled={busy} onClick={() => void act(async () => {
          clearSecrets(); await onDisconnect();
        })}><LogOut size={16} />Disconnect ESPN</button>
        <p className="fine-print">Disconnect clears saved ESPN credentials and leagues, but keeps this private dashboard and recovery key.</p>
      </> : <form className="cookie-form" onSubmit={event => {
        event.preventDefault();
        void act(async () => {
          try { await api.connect(swid.trim(), espnS2.trim()); }
          finally { setSwid(''); setEspnS2(''); }
          await refreshStatus();
        });
      }}>
        <h3><KeyRound size={18} /> Connect with your ESPN cookies</h3>
        <p className="small muted">In your own signed-in ESPN browser, open Developer Tools → Application → Cookies → fantasy.espn.com. Copy your SWID and espn_s2 values. These grant access to your ESPN session; never share them. Hosted mode does not open an ESPN login browser.</p>
        <label htmlFor="cloud-swid">SWID<input id="cloud-swid" type="password" autoComplete="off" spellCheck={false} value={swid} disabled={busy} onChange={event => setSwid(event.target.value)} required placeholder="{your-account-id}" /></label>
        <label htmlFor="cloud-s2">espn_s2<input id="cloud-s2" type="password" autoComplete="off" spellCheck={false} value={espnS2} disabled={busy} onChange={event => setEspnS2(event.target.value)} required placeholder="Your ESPN session cookie" /></label>
        <button className="button primary full-width" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <ShieldCheck size={16} />}Connect securely</button>
      </form>}
      <div className="vault-account">
        <h3>Your private dashboard</h3>
        <p className="small muted">Sign out of this browser without removing your saved ESPN connection. Use your recovery key to return.</p>
        <button className="button secondary full-width" disabled={busy} onClick={() => void act(() => leave(onSignOut))}><LogOut size={16} />Sign out this browser</button>
        <button className="button secondary danger-button full-width" disabled={busy} onClick={() => { clearSecrets(); setDeleting(true); setConfirmDelete(false); setError(''); }}><Trash2 size={16} />Delete private dashboard</button>
      </div>
    </>}
    {error && <div className="error-message" role="alert"><TriangleAlert size={18} /><span>{error}</span></div>}
    {busy && <p className="fine-print" role="status">Updating your private dashboard…</p>}
    <div className="modal-footer">Independent fan project. Not affiliated with or endorsed by ESPN or the NFL.</div>
  </Modal>;
}
