import React, { useEffect, useState } from 'react';
import { getStoredAvatar } from '../lib/avatarStorage';

const presenceColors = {
  online: 'bg-emerald-500',
  away: 'bg-amber-500',
  busy: 'bg-rose-500',
  offline: 'bg-slate-400',
};

const sizeClasses = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-16 w-16 text-xl',
  '2xl': 'h-24 w-24 text-3xl',
};

export default function UserAvatar({
  user,
  size = 'md',
  presence = null,
  showPresence = false,
  className = '',
  customAvatar = null,
}) {
  const [localAvatar, setLocalAvatar] = useState(() => customAvatar || getStoredAvatar(user?.id));
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (customAvatar !== undefined && customAvatar !== null) {
      setLocalAvatar(customAvatar);
      setImageFailed(false);
      return;
    }
    const update = () => {
      setLocalAvatar(getStoredAvatar(user?.id));
      setImageFailed(false);
    };
    update();
    const handleAvatarUpdated = (e) => {
      if (e.detail?.userId === user?.id) {
        setLocalAvatar(e.detail.avatarUrl);
        setImageFailed(false);
      }
    };
    window.addEventListener('nexamind:avatar-updated', handleAvatarUpdated);
    return () => window.removeEventListener('nexamind:avatar-updated', handleAvatarUpdated);
  }, [user?.id, customAvatar]);

  const avatarSrc = !imageFailed ? (localAvatar || user?.avatar_url || null) : null;
  const initial = (user?.name || user?.username || 'U').trim().slice(0, 1).toUpperCase();

  const dimension = sizeClasses[size] || sizeClasses.md;

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden select-none font-semibold ${dimension} ${className}`}>
      {avatarSrc ? (
        <img
          src={avatarSrc}
          alt={user?.name || 'User avatar'}
          onError={() => setImageFailed(true)}
          className="h-full w-full object-cover rounded-full"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-indigo-100 text-indigo-700 font-bold border border-indigo-200/60 rounded-full">
          {initial}
        </span>
      )}
      {showPresence && presence && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
            presenceColors[presence] || presenceColors.online
          }`}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
