// src/pages/StudentLogin.jsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';

const StudentLogin = () => {
  const [institutionalId, setInstitutionalId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [trialLoading, setTrialLoading] = useState(false);
  const { loginStudent } = useAuth();
  const navigate = useNavigate();

  const trialMode = import.meta.env.VITE_TRIAL_MODE === '1';
  const trialStudentId = import.meta.env.VITE_TRIAL_STUDENT_ID || '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginStudent(institutionalId.trim(), password);
      navigate('/student');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleTrialLogin = async () => {
    setError('');
    setTrialLoading(true);
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-student-manager`;
      // Include the public anon key as a Bearer token so Supabase's
      // Edge Function gatekeeper lets the request through.
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          action: 'trial_login',
          institutional_id: trialStudentId,
          origin: window.location.origin,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.action_link) {
        throw new Error(body?.error || 'Trial login failed');
      }
      window.location.href = body.action_link;
    } catch (err) {
      setError(err.message || 'Trial login failed');
      setTrialLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Student Login
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Use the institutional ID your teacher gave you.
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <input
                type="text"
                required
                autoComplete="username"
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Institutional ID"
                value={institutionalId}
                onChange={(e) => setInstitutionalId(e.target.value)}
              />
            </div>
            <div>
              <input
                type="password"
                required
                autoComplete="current-password"
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <div className="text-red-600 text-sm">{error}</div>}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Logging in...' : 'Log in'}
            </button>
          </div>

          <div className="text-center text-sm text-gray-500">
            Forgot your password? Ask your teacher to reset it for you.
          </div>

          {trialMode && trialStudentId && (
            <div className="border-t border-dashed border-gray-300 pt-4">
              <p className="text-xs text-gray-400 text-center mb-2">
                Trial mode only
              </p>
              <button
                type="button"
                onClick={handleTrialLogin}
                disabled={trialLoading}
                className="w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                {trialLoading ? 'Opening…' : `🔑 Quick login as ${trialStudentId}`}
              </button>
            </div>
          )}

          <div className="text-center text-sm border-t border-gray-200 pt-4">
            <span className="text-gray-400">Are you a teacher? </span>
            <Link
              to="/login"
              className="font-bold text-indigo-700 underline hover:text-indigo-900"
            >
              Go to Teacher login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StudentLogin;