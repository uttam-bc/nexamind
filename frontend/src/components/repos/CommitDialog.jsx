import React, { useState } from 'react';
import { GitBranch, GitCommit } from 'lucide-react';
import { Btn, Dialog, Field, inputClass } from './ui';

/**
 * Asks for the commit message and where the commit goes: the current branch, or a new branch
 * (required when the branch is protected), optionally followed by a pull request.
 */
export default function CommitDialog({ title = 'Commit changes', branch, protectedBranch, defaultMessage, userName, onCommit, onClose, extra }) {
  const [message, setMessage] = useState(defaultMessage || '');
  const [details, setDetails] = useState('');
  const [target, setTarget] = useState(protectedBranch ? 'new' : 'direct');
  const [newBranch, setNewBranch] = useState(`${(userName || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'user'}-patch-${Math.floor(Math.random() * 900 + 100)}`);
  const [openPr, setOpenPr] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const full = details.trim() ? `${message.trim()}\n\n${details.trim()}` : message.trim();
      await onCommit({ message: full, newBranch: target === 'new' ? newBranch.trim() : null, openPr: target === 'new' && openPr });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" busy={busy} disabled={!message.trim() || (target === 'new' && !newBranch.trim())} onClick={submit}>
            <GitCommit className="w-4 h-4" /> Commit
          </Btn>
        </>
      }
    >
      <div className="space-y-4">
        {extra}
        <Field label="Commit message">
          <input className={inputClass} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={300} autoFocus />
        </Field>
        <Field label="Extended description (optional)">
          <textarea className={inputClass} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="sr-only">Where to commit</legend>
          <label className={`flex items-start gap-2 text-sm ${protectedBranch ? 'opacity-60' : ''}`}>
            <input type="radio" name="target" className="mt-1" disabled={protectedBranch} checked={target === 'direct'} onChange={() => setTarget('direct')} />
            <span>
              Commit directly to <code className="bg-slate-100 px-1 rounded">{branch}</code>
              {protectedBranch && <span className="block text-xs text-amber-700">This branch is protected: changes go through a pull request.</span>}
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="target" className="mt-1" checked={target === 'new'} onChange={() => setTarget('new')} />
            <span className="flex-1">Create a new branch for this commit</span>
          </label>
          {target === 'new' && (
            <div className="pl-6 space-y-2">
              <div className="relative">
                <GitBranch className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
                <input aria-label="New branch name" className={`${inputClass} pl-8 font-mono`} value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} /> Open a pull request next
              </label>
            </div>
          )}
        </fieldset>
        {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3" role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
