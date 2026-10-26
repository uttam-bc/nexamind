import React, { useEffect, useState } from 'react';
import { KeyRound, Trash2, UserCog } from 'lucide-react';
import { api } from '../api';
import { confirmDialog, notify } from '../context/ToastContext';

const PASSWORD_RULE = 'At least 8 characters, with letters and numbers.';

function validPassword(value) {
  return value.length >= 8 && /[a-zA-Z]/.test(value) && /\d/.test(value);
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs font-semibold text-rose-700">
      {message}
    </p>
  );
}

const inputClass =
  'w-full bg-white border border-slate-300 focus:border-indigo-600 rounded-xl px-3.5 py-2.5 text-sm text-slate-900';

// Profile, password and account deletion (NX-BUG-018).
export default function AccountSettings({ user, onUserUpdated, onTokenChanged, onAccountDeleted }) {
  const [profile, setProfile] = useState({ name: user?.name || '', username: user?.username || '' });
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setProfile({ name: user?.name || '', username: user?.username || '' });
  }, [user?.id, user?.name, user?.username]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    if (!profile.name.trim()) {
      setProfileError('Your name cannot be empty.');
      return;
    }
    setSavingProfile(true);
    try {
      const updated = await api.updateMe({ name: profile.name.trim(), username: profile.username.trim() || undefined });
      onUserUpdated?.(updated);
      notify('Profile saved.', 'success');
    } catch (err) {
      setProfileError(err.message || 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPasswordError('');
    if (!passwords.current) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (!validPassword(passwords.next)) {
      setPasswordError(`New password: ${PASSWORD_RULE}`);
      return;
    }
    setSavingPassword(true);
    try {
      const res = await api.changePassword(passwords.current, passwords.next);
      onTokenChanged?.(res.access_token);
      setPasswords({ current: '', next: '' });
      notify('Password changed. Other devices have been signed out.', 'success');
    } catch (err) {
      setPasswordError(err.message || 'Could not change the password.');
    } finally {
      setSavingPassword(false);
    }
  };

  const deleteAccount = async (e) => {
    e.preventDefault();
    setDeleteError('');
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    const ok = await confirmDialog(
      'Your personal workspace and login are deleted. Messages and documents you shared with teams stay, shown as "Deleted user". This cannot be undone.',
      { title: 'Delete your account?', confirmLabel: 'Delete account' }
    );
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteAccount(deletePassword);
      onAccountDeleted?.();
    } catch (err) {
      setDeleteError(err.message || 'Could not delete the account.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <section aria-labelledby="account-profile-heading" className="space-y-4">
        <h3 id="account-profile-heading" className="font-extrabold text-lg text-slate-900 flex items-center gap-2">
          <UserCog className="w-5 h-5 text-indigo-600" aria-hidden="true" />
          Profile
        </h3>
        <form onSubmit={saveProfile} className="space-y-3" noValidate>
          <div className="space-y-1">
            <label htmlFor="account-name" className="text-xs font-bold text-slate-700">Name</label>
            <input
              id="account-name"
              className={inputClass}
              autoComplete="name"
              maxLength={255}
              value={profile.name}
              onChange={(e) => setProfile({ ...profile, name: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="account-username" className="text-xs font-bold text-slate-700">Username</label>
            <input
              id="account-username"
              className={`${inputClass} tabular-nums`}
              autoComplete="username"
              maxLength={50}
              value={profile.username}
              onChange={(e) => setProfile({ ...profile, username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
            />
          </div>
          <p className="text-xs text-slate-600">Email: {user?.email}</p>
          <FieldError id="account-profile-error" message={profileError} />
          <button
            type="submit"
            disabled={savingProfile}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl"
          >
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
      </section>

      <section aria-labelledby="account-password-heading" className="space-y-4 border-t border-slate-200 pt-6">
        <h3 id="account-password-heading" className="font-extrabold text-lg text-slate-900 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-indigo-600" aria-hidden="true" />
          Change password
        </h3>
        <p className="text-xs text-slate-600">
          Signed up with Google and never set a password? Sign out and use "Forgot password?" to create one.
        </p>
        <form onSubmit={changePassword} className="space-y-3" noValidate>
          <div className="space-y-1">
            <label htmlFor="account-current-password" className="text-xs font-bold text-slate-700">Current password</label>
            <input
              id="account-current-password"
              type="password"
              autoComplete="current-password"
              className={inputClass}
              value={passwords.current}
              onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="account-new-password" className="text-xs font-bold text-slate-700">New password</label>
            <input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              aria-describedby="account-new-password-hint"
              className={inputClass}
              value={passwords.next}
              onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
            />
            <p id="account-new-password-hint" className="text-xs text-slate-600">{PASSWORD_RULE}</p>
          </div>
          <FieldError id="account-password-error" message={passwordError} />
          <button
            type="submit"
            disabled={savingPassword}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl"
          >
            {savingPassword ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section aria-labelledby="account-delete-heading" className="space-y-4 border-t border-rose-200 pt-6">
        <h3 id="account-delete-heading" className="font-extrabold text-lg text-rose-800 flex items-center gap-2">
          <Trash2 className="w-5 h-5" aria-hidden="true" />
          Delete account
        </h3>
        <p className="text-sm text-slate-700">
          If you own a team workspace with other members, make someone else an owner first (Members tab).
        </p>
        <form onSubmit={deleteAccount} className="space-y-3" noValidate>
          <div className="space-y-1">
            <label htmlFor="account-delete-password" className="text-xs font-bold text-slate-700">Password</label>
            <input
              id="account-delete-password"
              type="password"
              autoComplete="current-password"
              className={inputClass}
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </div>
          <FieldError id="account-delete-error" message={deleteError} />
          <button
            type="submit"
            disabled={deleting}
            className="bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl"
          >
            {deleting ? 'Deleting…' : 'Delete my account'}
          </button>
        </form>
      </section>
    </div>
  );
}
