// src/pages/TeacherClasses.jsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { listMyClassesAsTeacher, createClass, deleteClass } from '../lib/lmsApi';
import { useAuth } from '../context/AuthContext';

const emptyForm = {
  name: '',
  description: '',
  start_date: '',
  end_date: '',
};

const TeacherClasses = () => {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listMyClassesAsTeacher();
      setClasses(rows);
    } catch (err) {
      console.error(err);
      toast.error('Could not load classes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Please enter a class name.');
      return;
    }
    setSaving(true);
    try {
      await createClass({
        name: form.name,
        description: form.description,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      });
      toast.success('Class created.');
      setForm(emptyForm);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not create class.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete class "${name}"? This will also remove enrollments.`)) {
      return;
    }
    try {
      await deleteClass(id);
      toast.success('Class deleted.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not delete class.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-gray-900">My classes</h1>
          <div className="flex items-center gap-4">
            {user?.email && (
              <span className="text-sm text-gray-500 hidden sm:inline">
                {user.email}
              </span>
            )}
            <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-500">
              ← Lesson Builder
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Logout
            </button>
          </div>
        </div>

        {/* ---- Classes list first ---- */}
        <section className="bg-white rounded-lg shadow mb-8">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-lg font-semibold text-gray-900">
              Classes ({classes.length})
            </h2>
          </div>
          {loading ? (
            <p className="p-6 text-gray-500">Loading…</p>
          ) : classes.length === 0 ? (
            <p className="p-6 text-gray-500">No classes yet. Create one below.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {classes.map((c) => (
                <li key={c.id} className="p-6 flex items-start justify-between">
                  <div>
                    <Link
                      to={`/classes/${c.id}`}
                      className="text-base font-semibold text-indigo-600 hover:text-indigo-500"
                    >
                      {c.name}
                    </Link>
                    {c.description && (
                      <p className="text-sm text-gray-600 mt-1">{c.description}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {c.start_date ? `Starts ${c.start_date}` : ''}
                      {c.start_date && c.end_date ? ' · ' : ''}
                      {c.end_date ? `Ends ${c.end_date}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id, c.name)}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Create form below ---- */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Create a class</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="e.g. Academic Writing II"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Description (optional)
              </label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Start date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">End date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create class'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
};

export default TeacherClasses;