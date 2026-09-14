// src/components/AppLayout.jsx
//
// Wraps every authenticated page. Renders the identity banner at the top
// of the viewport, then the page itself via <Outlet />. This is the correct
// long-term home for the identity banner — putting it on individual pages
// caused it to be missing on some and duplicated on others.
import React from 'react';
import { Outlet } from 'react-router-dom';
import IdentityBanner from './IdentityBanner';

export default function AppLayout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-1.5">
        <div className="max-w-6xl mx-auto">
          <IdentityBanner />
        </div>
      </div>
      <Outlet />
    </div>
  );
}