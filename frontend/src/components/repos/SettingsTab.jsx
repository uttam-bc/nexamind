import React, { useEffect, useState } from 'react';
import { Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { api } from '../../api';
import { confirmDialog, notify } from '../../context/ToastContext';
import { Badge, Btn, Dialog, Field, inputClass, Panel } from './ui';

const ROLES = [
  ['read', 'Read', 'View, clone, open issues and comment'],
  ['reviewer', 'Reviewer', 'Read, plus approve or request changes'],
  ['write', 'Write', 'Push, edit files, branches, open and merge pull requests'],
  ['maintainer', 'Maintainer', 'Write, plus releases and tags'],
  ['admin', 'Admin', 'Everything, including settings and access'],
];

function Section({ title, icon: Icon, children, description }) {
  return (
    <Panel className="p-4 space-y-3">
      <div>
        <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">{Icon && <Icon className="w-4 h-4" />}{title}</h3>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </div>
      {children}
    </Panel>
  );
}

export default function SettingsTab({ wsId, repo, personal, members, branches, onSaved, onDeleted }) {
  const [form, setForm] = useState({ name: repo.name, description: repo.description || '', visibility: repo.visibility, member_role: repo.member_role, default_branch: repo.default_branch });
  const [people, setPeople] = useState([]);
  const [rules, setRules] = useState([]);
  const [newPerson, setNewPerson] = useState({ user_id: '', role: 'write' });
  const [newRule, setNewRule] = useState({ branch: repo.default_branch, approvals: 1 });
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.repoCollaborators(wsId, repo.id).then(setPeople).catch(() => {});
    api.branchRules(wsId, repo.id).then(setRules).catch(() => {});
  };
  useEffect(load, [wsId, repo.id]);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.updateRepo(wsId, repo.id, form);
      notify('Settings saved', 'success');
      onSaved(updated);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const act = async (fn, message) => {
    try {
      await fn();
      if (message) notify(message, 'success');
      load();
      onSaved();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  const inList = new Set(people.map((p) => p.user.id));

  return (
    <div className="space-y-4 max-w-3xl">
      <Section title="General">
        <Field label="Name" hint="Renaming changes the clone URL."><input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description"><input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-3 gap-3">
          {!personal && (<>
          <Field label="Visibility">
            <select className={inputClass} value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              <option value="workspace">Workspace</option>
              <option value="private">Private</option>
            </select>
          </Field>
          <Field label="Workspace members get">
            <select className={inputClass} value={form.member_role} disabled={form.visibility === 'private'} onChange={(e) => setForm({ ...form, member_role: e.target.value })}>
              <option value="write">Write</option>
              <option value="read">Read</option>
            </select>
          </Field>
          </>)}
          <Field label="Default branch">
            <select className={inputClass} value={form.default_branch} onChange={(e) => setForm({ ...form, default_branch: e.target.value })}>
              {(branches.length ? branches : [{ name: repo.default_branch }]).map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end"><Btn variant="primary" busy={busy} onClick={save}>Save</Btn></div>
      </Section>

      {!personal && <Section title="People with access" icon={Users} description="Workspace owners and admins always have admin access. Collaborators must be members of this workspace.">
        <ul className="divide-y divide-slate-100">
          {people.map((p) => (
            <li key={p.user.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-semibold text-slate-800 flex-1 min-w-[8rem]">{p.user.name}</span>
              {p.source === 'owner' ? <Badge tone="indigo">owner</Badge> : (
                <>
                  <select aria-label={`Role of ${p.user.name}`} className={`${inputClass} w-auto py-1`} value={p.role} onChange={(e) => act(() => api.setCollaborator(wsId, repo.id, p.user.id, e.target.value), 'Access updated')}>
                    {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                  <Btn size="sm" variant="ghost" aria-label={`Remove ${p.user.name}`} onClick={() => act(() => api.removeCollaborator(wsId, repo.id, p.user.id), 'Access removed')}>
                    <Trash2 className="w-4 h-4 text-rose-600" />
                  </Btn>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 items-end">
          <Field label="Add a member">
            <select className={inputClass} value={newPerson.user_id} onChange={(e) => setNewPerson({ ...newPerson, user_id: e.target.value })}>
              <option value="">Choose…</option>
              {members.filter((m) => !inList.has(m.user_id)).map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Role">
            <select className={inputClass} value={newPerson.role} onChange={(e) => setNewPerson({ ...newPerson, role: e.target.value })}>
              {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
          <Btn disabled={!newPerson.user_id} onClick={() => act(() => api.setCollaborator(wsId, repo.id, newPerson.user_id, newPerson.role), 'Access granted').then(() => setNewPerson({ user_id: '', role: 'write' }))}>
            <UserPlus className="w-4 h-4" />Add
          </Btn>
        </div>
        <ul className="text-xs text-slate-500 space-y-0.5">{ROLES.map(([id, label, hint]) => <li key={id}><strong>{label}</strong>: {hint}</li>)}</ul>
      </Section>}

      <Section title="Protected branches" icon={Shield} description="No direct pushes or web edits: changes arrive through pull requests with the required approvals.">
        <ul className="divide-y divide-slate-100">
          {rules.length === 0 && <li className="text-sm text-slate-500 py-1">No protected branches.</li>}
          {rules.map((r) => (
            <li key={r.branch} className="flex items-center gap-2 py-2 text-sm">
              <code className="font-mono font-semibold">{r.branch}</code>
              <span className="text-slate-500">{r.required_approvals} approval{r.required_approvals === 1 ? '' : 's'} required</span>
              <Btn size="sm" variant="ghost" className="ml-auto" onClick={() => act(() => api.deleteBranchRule(wsId, repo.id, r.branch), 'Protection removed')}>Remove</Btn>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 items-end">
          <Field label="Branch"><input className={`${inputClass} font-mono`} value={newRule.branch} onChange={(e) => setNewRule({ ...newRule, branch: e.target.value })} /></Field>
          <Field label="Approvals"><input type="number" min={0} max={10} className={`${inputClass} w-24`} value={newRule.approvals} onChange={(e) => setNewRule({ ...newRule, approvals: Number(e.target.value) })} /></Field>
          <Btn disabled={!newRule.branch.trim()} onClick={() => act(() => api.setBranchRule(wsId, repo.id, newRule.branch.trim(), newRule.approvals), 'Branch protected')}>Protect</Btn>
        </div>
      </Section>

      <Section title="Danger zone">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <p className="text-sm text-slate-600">Delete this repository, its history, issues and pull requests.</p>
          <Btn variant="danger" onClick={() => setDeleting(true)}><Trash2 className="w-4 h-4" />Delete repository</Btn>
        </div>
      </Section>
      {deleting && (
        <Dialog title="Delete repository" onClose={() => setDeleting(false)} footer={<>
          <Btn onClick={() => setDeleting(false)}>Cancel</Btn>
          <Btn variant="danger" disabled={confirmName !== repo.name} onClick={async () => {
            if (!(await confirmDialog(`This permanently deletes ${repo.name} for everyone.`, { title: 'Are you sure?', confirmLabel: 'Delete' }))) return;
            try {
              await api.deleteRepo(wsId, repo.id, confirmName);
              notify(`Deleted ${repo.name}`, 'success');
              onDeleted();
            } catch (err) {
              notify(err.message, 'error');
            }
          }}>Delete</Btn>
        </>}>
          <Field label={`Type ${repo.name} to confirm`}><input className={inputClass} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoFocus /></Field>
        </Dialog>
      )}
    </div>
  );
}
