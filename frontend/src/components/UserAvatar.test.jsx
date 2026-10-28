import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import UserAvatar from './UserAvatar';
import { setStoredAvatar, removeStoredAvatar } from '../lib/avatarStorage';

afterEach(() => {
  cleanup();
});

describe('UserAvatar Component', () => {
  it('renders initials when no avatar is provided', () => {
    const user = { id: 'u1', name: 'Alice Smith' };
    render(<UserAvatar user={user} size="md" />);
    expect(screen.getByText('A')).toBeTruthy();
  });

  it('renders img element when user.avatar_url is provided', () => {
    const user = { id: 'u2', name: 'Bob Jones', avatar_url: 'https://example.com/avatar.jpg' };
    render(<UserAvatar user={user} size="md" />);
    const img = screen.getByRole('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://example.com/avatar.jpg');
  });

  it('prioritizes locally stored custom avatar', () => {
    const user = { id: 'u3', name: 'Charlie Ray', avatar_url: 'https://example.com/old.jpg' };
    setStoredAvatar('u3', 'data:image/jpeg;base64,customdata');
    render(<UserAvatar user={user} size="md" />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,customdata');
    removeStoredAvatar('u3');
  });
});
