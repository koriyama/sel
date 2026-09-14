// src/components/IdentityBanner.jsx
//
// Small reusable banner that shows who is signed in and what role the
// database thinks they have. It exists because during development it is
// easy to lose track of which account the browser is currently using.
// Later, this should be moved into App.jsx so it appears on every page.
import React, { useEffect, useState } from 'react';
import { getMyIdentity } from '../lib/forumApi';

export default function IdentityBanner({ className = '' }) {
  const [me, setMe] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyIdentity()
      .then((identity) => {
        if (!cancelled) setMe(identity);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || !me) return null;

  return (
    <div className={`text-xs text-gray-500 ${className}`}>
      Signed in as{' '}
      <span className="font-medium">
        {me.display_name || me.email || '(unknown)'}
      </span>
      {me.role ? ` — role: ${me.role}` : ' — role: unknown'}
    </div>
  );
}