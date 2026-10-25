import React, { useEffect, useState } from 'react';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog, notify } from '../../context/ToastContext';
import { Btn, Dialog, Field, inputClass } from './ui';
import { timeAgo } from './repoUtils';

function copy(text, what) {
  navigator.clipboard?.writeText(text).then(() => notify(`${what} copied`, 'success'), () => notify('Copy failed: select and copy it instead', 'error'));
}

/** Clone URL, instructions, and the personal access tokens git uses as a password. */
export default function CloneDialog({ repo, onClose }) {
  const [tokens, setTokens] = useState([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listGitTokens().then(setTokens).catch((e) => notify(e.message, 'error'));
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const token = await api.createGitToken({ name, expires_in_days: Number(days) || null });
      setCreated(token);
      setName('');
      load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t) => {
    if (!(await confirmDialog(`Revoke "${t.name}"? Git on machines using it will stop working.`, { title: 'Revoke token', confirmLabel: 'Revoke', variant: 'danger' }))) return;
    await api.revokeGitToken(t.id).catch((e) => notify(e.message, 'error'));
    load();
  };

  return (
    <Dialog title={`Clone ${repo.name}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="HTTPS clone URL">
          <div className="flex gap-2">
            <input readOnly value={repo.clone_url} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.target.select()} aria-label="Clone URL" />
            <Btn onClick={() => copy(repo.clone_url, 'Clone URL')} aria-label="Copy clone URL"><Copy className="w-4 h-4" /></Btn>
          </div>
        </Field>
        <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto">{`git clone ${repo.clone_url}
# user name: anything · password: a personal access token`}</pre>
        <p className="text-sm text-slate-600">
          Git asks for a password the first time: use a personal access token below (your NexaMind password doesn't work for git).
          Tokens act with your access to every repository you can open.
        </p>

        {created && (
          <div className="border border-emerald-300 bg-emerald-50 rounded-lg p-3 space-y-2" role="status">
            <p className="text-sm font-semibold text-emerald-900">Copy your new token now. It won't be shown again.</p>
            <div className="flex gap-2">
              <input readOnly value={created.token} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.target.select()} aria-label="New token" />
              <Btn onClick={() => copy(created.token, 'Token')} aria-label="Copy token"><Copy className="w-4 h-4" /></Btn>
            </div>
          </div>
        )}

        <div className="border-t border-slate-200 pt-4">
          <h3 className="font-semibold text-slate-900 flex items-center gap-1.5 mb-2"><KeyRound className="w-4 h-4" /> Personal access tokens</h3>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[10rem]">
              <Field label="Name"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Work laptop" maxLength={100} /></Field>
            </div>
            <Field label="Expires">
              <select className={inputClass} value={days} onChange={(e) => setDays(e.target.value)}>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={366}>1 year</option>
              </select>
            </Field>
            <Btn variant="primary" onClick={create} busy={busy} disabled={!name.trim()}>Create token</Btn>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {tokens.length === 0 && <li className="text-sm text-slate-500 py-2">No tokens yet.</li>}
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-mono text-xs bg-slate-100 rounded px-1.5 py-0.5">{t.prefix}…</span>
                <span className="flex-1 min-w-0">
                  <span className="font-semibold text-slate-800">{t.name}</span>
                  <span className="block text-xs text-slate-500">
                    {t.last_used_at ? `Used ${timeAgo(t.last_used_at)}` : 'Never used'}
                    {t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ''}
                  </span>
                </span>
                <Btn size="sm" variant="danger" onClick={() => revoke(t)} aria-label={`Revoke ${t.name}`}><Trash2 className="w-4 h-4" /></Btn>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
