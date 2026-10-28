import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, KeyRound, RotateCcw, Trash2, Upload, UserCog } from 'lucide-react';
import { api } from '../api';
import { confirmDialog, notify } from '../context/ToastContext';
import UserAvatar from './UserAvatar';
import { getStoredAvatar, processAvatarFile, removeStoredAvatar, setStoredAvatar } from '../lib/avatarStorage';

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
  'w-full bg-white border border-slate-300 focus:border-indigo-600 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 transition-colors focus:outline-none';

// Profile, avatar, password and account deletion.
export default function AccountSettings({ user, onUserUpdated, onTokenChanged, onAccountDeleted }) {
  const [profile, setProfile] = useState({ name: user?.name || '', username: user?.username || '' });
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [nameChanged, setNameChanged] = useState(false);

  // Avatar state
  const [avatarPreview, setAvatarPreview] = useState(() => getStoredAvatar(user?.id) || user?.avatar_url || null);
  const [avatarError, setAvatarError] = useState('');
  const [processingAvatar, setProcessingAvatar] = useState(false);
  const fileInputRef = useRef(null);

  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setProfile({ name: user?.name || '', username: user?.username || '' });
    setNameChanged(false);
    setAvatarPreview(getStoredAvatar(user?.id) || user?.avatar_url || null);
  }, [user?.id, user?.name, user?.username, user?.avatar_url]);

  const handleNameChange = (e) => {
    const next = e.target.value;
    setProfile((prev) => ({ ...prev, name: next }));
    setNameChanged(next.trim() !== (user?.name || '').trim());
    if (profileError) setProfileError('');
  };

  const handleCancelName = () => {
    setProfile({ name: user?.name || '', username: user?.username || '' });
    setNameChanged(false);
    setProfileError('');
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileError('');
    const trimmed = profile.name.trim();
    if (!trimmed) {
      setProfileError('Your name cannot be empty or only spaces.');
      return;
    }
    if (trimmed.length > 255) {
      setProfileError('Your name cannot exceed 255 characters.');
      return;
    }

    setSavingProfile(true);
    try {
      const updated = await api.updateMe({
        name: trimmed,
        username: profile.username.trim() || undefined,
      });
      // Merge with custom avatar if set locally
      const storedAvatar = getStoredAvatar(user?.id);
      const mergedUser = {
        ...updated,
        avatar_url: storedAvatar || updated.avatar_url,
      };
      onUserUpdated?.(mergedUser);
      setNameChanged(false);
      notify('Profile name saved successfully.', 'success');
    } catch (err) {
      setProfileError(err.message || 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError('');
    setProcessingAvatar(true);

    try {
      const dataUrl = await processAvatarFile(file, 256);
      setAvatarPreview(dataUrl);
      setStoredAvatar(user?.id, dataUrl);

      // Notify parent app of avatar update
      onUserUpdated?.({
        ...user,
        avatar_url: dataUrl,
      });
      notify('Profile photo updated and saved.', 'success');
    } catch (err) {
      setAvatarError(err.message || 'Could not process the selected image.');
    } finally {
      setProcessingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveAvatar = async () => {
    const ok = await confirmDialog('Remove your custom profile photo and revert to initials?', {
      title: 'Remove photo?',
      confirmLabel: 'Remove photo',
    });
    if (!ok) return;

    removeStoredAvatar(user?.id);
    setAvatarPreview(null);
    onUserUpdated?.({
      ...user,
      avatar_url: null,
    });
    notify('Profile photo removed.', 'info');
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
      {/* Profile & Avatar Section */}
      <section aria-labelledby="account-profile-heading" className="space-y-6">
        <h3 id="account-profile-heading" className="font-extrabold text-lg text-slate-900 flex items-center gap-2">
          <UserCog className="w-5 h-5 text-indigo-600" aria-hidden="true" />
          Profile & Account
        </h3>

        {/* Profile Picture Card */}
        <div className="bg-slate-50/80 border border-slate-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center sm:items-start gap-5">
          <div className="relative group">
            <UserAvatar user={user} customAvatar={avatarPreview} size="2xl" className="ring-4 ring-white shadow-md" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={processingAvatar}
              className="absolute inset-0 bg-slate-900/40 rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
              title="Upload new photo"
            >
              <Camera className="w-6 h-6" />
            </button>
          </div>

          <div className="flex-1 space-y-2 text-center sm:text-left">
            <div>
              <h4 className="text-sm font-bold text-slate-900">Profile Photo</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload a JPEG, PNG, WebP or GIF (max 5MB). Automatically cropped and optimized.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarFileSelected}
            />

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={processingAvatar}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-60"
              >
                <Upload className="w-3.5 h-3.5" />
                {processingAvatar ? 'Processing…' : 'Upload photo'}
              </button>

              {avatarPreview && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  disabled={processingAvatar}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  Remove
                </button>
              )}
            </div>

            <FieldError id="account-avatar-error" message={avatarError} />
          </div>
        </div>

        {/* Display Name and Username Form */}
        <form onSubmit={saveProfile} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="account-name" className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>Full Name / Display Name</span>
              <span className="text-[11px] font-normal text-slate-400">{profile.name.length}/255</span>
            </label>
            <input
              id="account-name"
              className={inputClass}
              autoComplete="name"
              maxLength={255}
              value={profile.name}
              onChange={handleNameChange}
              placeholder="Your name"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="account-username" className="text-xs font-bold text-slate-700">Username</label>
            <input
              id="account-username"
              className={`${inputClass} tabular-nums`}
              autoComplete="username"
              maxLength={50}
              value={profile.username}
              onChange={(e) => setProfile({ ...profile, username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
              placeholder="@username"
            />
          </div>

          <p className="text-xs text-slate-500">
            Email address: <strong className="text-slate-700">{user?.email}</strong>
          </p>

          <FieldError id="account-profile-error" message={profileError} />

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={savingProfile || (!nameChanged && profile.username === (user?.username || ''))}
              className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
            >
              <Check className="w-4 h-4" />
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>

            {nameChanged && (
              <button
                type="button"
                onClick={handleCancelName}
                disabled={savingProfile}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      {/* Password Management */}
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
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
          >
            {savingPassword ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      {/* Account Deletion */}
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
              placeholder="Your current password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
            />
          </div>
          <FieldError id="account-delete-error" message={deleteError} />
          <button
            type="submit"
            disabled={deleting}
            className="bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors shadow-sm"
          >
            {deleting ? 'Deleting account…' : 'Delete my account'}
          </button>
        </form>
      </section>
    </div>
  );
}
