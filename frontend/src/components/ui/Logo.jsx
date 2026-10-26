import React from 'react';

// The wordmark is black; dark mode swaps in the white version.
export default function Logo({ className = 'h-7', alt = 'NexaMind' }) {
  return (
    <>
      <img src="/logo.png" alt={alt} width="740" height="176" className={`${className} w-auto object-contain object-left dark:hidden`} />
      <img src="/logo-white.png" alt={alt} width="740" height="176" className={`${className} w-auto object-contain object-left hidden dark:block`} />
    </>
  );
}
