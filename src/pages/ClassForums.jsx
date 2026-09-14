// src/pages/ClassForums.jsx
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { getClassById } from '../lib/lmsApi';
import {
  listForumsForClass,
  createForum,
  updateForum,
  setForumPinned,
} from '../lib/forumApi';

const neutralBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 16px',
  backgroundColor: '#e5e7eb',
  color: '#000000',
  fontSize: '14px',
  fontWeight: '500',
  borderRadius: '6px',
  border: '1px solid #9ca3af',
  textDecoration: 'none',
};

const linkBtn = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  color: '#4f46e5',
  cursor: 'pointer',
  fontSize: '12px',
  textDecoration: 'underline',
};

const linkBtnDisabled = {
  ...linkBtn,
  color: '#9ca3af',
  cursor: 'not-allowed',
  textDecoration: 'none',
};

export default function ClassForums({ mode }) {
  const { id: classId } = useParams();
  const isTeacher = mode === 'teacher';

  const [cls, setCls] = useState(null);
  const [forums, setForums] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [allowStudentThreads, setAllowStudentThreads] = useState(false);
  const [replyToEmail, setReplyToEmail] = useState(false);
  const [creating, setCreating] = useState(false);

  // Edit form state
  const [editingForumId, setEditingForumId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editAllowStudentThreads, setEditAllowStudentThreads] = useState(false);
  const [editReplyToEmail, setEditReplyToEmail] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  // Reorder state
  const [savingMove, setSavingMove] = useState(false);

  const classHomePath = isTeacher ? `/classes/${classId}` : `/student`;
  const forumPath = (forumId) =>
    isTeacher
      ? `/classes/${classId}/forums/${forumId}`
      : `/student/classes/${classId}/forums/${forumId}`;

  const load = async () => {
    setLoading(true);
    try {
      const [c, f] = await Promise.all([
        getClassById(classId).catch(() => null),
        listForumsForClass(classId),
      ]);
      setCls(c);
      setForums(f);
    } catch (err) {
      console.error(err);
      toast.error('Could not load forums.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error('Please enter a title.');
      return;
    }
    setCreating(true);
    try {
      await createForum({
        classId,
        title: newTitle,
        description: newDesc,
        allowStudentThreads,
        replyToEmail,
      });
      toast.success('Forum created.');
      setNewTitle('');
      setNewDesc('');
      setAllowStudentThreads(false);
      setReplyToEmail(false);
      setShowCreate(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not create forum.');
    } finally {
      setCreating(false);
    }
  };

  const handleTogglePin = async (forumId, pinned) => {
    setForums((prev) =>
      prev.map((f) => (f.id === forumId ? { ...f, is_pinned: pinned } : f))
    );
    try {
      await setForumPinned(forumId, pinned);
      toast.success(pinned ? 'Forum pinned.' : 'Forum unpinned.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not update pin.');
      await load();
    }
  };

  const startEdit = (forum) => {
    setEditingForumId(forum.id);
    setEditTitle(forum.title || '');
    setEditDesc(forum.description || '');
    setEditAllowStudentThreads(!!forum.allow_student_threads);
    setEditReplyToEmail(!!forum.reply_to_email);
    setShowCreate(false);
  };

  const cancelEdit = () => {
    setEditingForumId(null);
    setEditTitle('');
    setEditDesc('');
    setEditAllowStudentThreads(false);
    setEditReplyToEmail(false);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingForumId) return;
    if (!editTitle.trim()) {
      toast.error('Please enter a title.');
      return;
    }
    setSavingEdit(true);
    try {
      await updateForum(editingForumId, {
        title: editTitle.trim(),
        description: editDesc.trim() || null,
        allow_student_threads: !!editAllowStudentThreads,
        reply_to_email: !!editReplyToEmail,
      });
      toast.success('Forum updated.');
      cancelEdit();
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not update forum.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleMove = async (forumId, direction) => {
    if (savingMove) return;
    const idx = forums.findIndex((f) => f.id === forumId);
    if (idx < 0) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= forums.length) return;

    const a = forums[idx];
    const b = forums[targetIdx];

    if (!!a.is_pinned !== !!b.is_pinned) return;

    const posA = typeof a.position === 'number' ? a.position : 0;
    const posB = typeof b.position === 'number' ? b.position : 0;

    setSavingMove(true);
    try {
      if (posA === posB) {
        const groupPinned = !!a.is_pinned;
        const group = forums.filter((f) => !!f.is_pinned === groupPinned);
        const newGroup = [...group];
        const gi = newGroup.findIndex((f) => f.id === a.id);
        const gt = newGroup.findIndex((f) => f.id === b.id);
        if (gi < 0 || gt < 0) throw new Error('Could not find forum to move.');
        const tmp = newGroup[gi];
        newGroup[gi] = newGroup[gt];
        newGroup[gt] = tmp;
        await Promise.all(
          newGroup.map((f, i) => updateForum(f.id, { position: (i + 1) * 10 }))
        );
      } else {
        await Promise.all([
          updateForum(a.id, { position: posB }),
          updateForum(b.id, { position: posA }),
        ]);
      }
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not reorder forums.');
      await load();
    } finally {
      setSavingMove(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6">
          <Link
            to={classHomePath}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← Back
          </Link>
          <div className="mt-1 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Forums</h1>
              {cls?.name && (
                <p className="text-sm text-gray-500">{cls.name}</p>
              )}
            </div>
            {isTeacher && (
              <button
                type="button"
                onClick={() => {
                  setShowCreate((v) => !v);
                  cancelEdit();
                }}
                style={neutralBtn}
              >
                {showCreate ? 'Cancel' : '+ New forum'}
              </button>
            )}
          </div>
        </div>

        {isTeacher && showCreate && (
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-lg shadow p-4 mb-6 space-y-3"
          >
            <div>
              <label
                htmlFor="forum-title"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                Title
              </label>
              <input
                id="forum-title"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Weekly Discussion"
                autoComplete="off"
                disabled={creating}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label
                htmlFor="forum-desc"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                Description (optional)
              </label>
              <textarea
                id="forum-desc"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                disabled={creating}
                placeholder="What is this forum for?"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div className="flex flex-col gap-2 text-sm text-gray-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allowStudentThreads}
                  onChange={(e) => setAllowStudentThreads(e.target.checked)}
                  disabled={creating}
                />
                Allow students to start their own threads
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={replyToEmail}
                  onChange={(e) => setReplyToEmail(e.target.checked)}
                  disabled={creating}
                />
                Email notification for replies (not yet wired — the setting is
                saved for later)
              </label>
            </div>
            <div>
              <button
                type="submit"
                disabled={creating || !newTitle.trim()}
                style={neutralBtn}
              >
                {creating ? 'Creating…' : 'Create forum'}
              </button>
            </div>
          </form>
        )}

        {forums.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            {isTeacher
              ? 'No forums yet. Use “+ New forum” to create one.'
              : 'Your teacher has not set up any forums yet.'}
          </div>
        ) : (
          <ul className="bg-white rounded-lg shadow divide-y divide-gray-100">
            {forums.map((f, idx) => {
              const isEditing = editingForumId === f.id;
              const prev = idx > 0 ? forums[idx - 1] : null;
              const next = idx < forums.length - 1 ? forums[idx + 1] : null;
              const canMoveUp =
                !!prev && !!prev.is_pinned === !!f.is_pinned && !savingMove;
              const canMoveDown =
                !!next && !!next.is_pinned === !!f.is_pinned && !savingMove;

              return (
                <li key={f.id} className="p-4">
                  {isEditing ? (
                    <form onSubmit={handleSaveEdit} className="space-y-3">
                      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        Editing forum
                      </div>
                      <div>
                        <label
                          htmlFor={`edit-forum-title-${f.id}`}
                          className="block text-xs font-medium text-gray-700 mb-1"
                        >
                          Title
                        </label>
                        <input
                          id={`edit-forum-title-${f.id}`}
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          autoComplete="off"
                          disabled={savingEdit}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor={`edit-forum-desc-${f.id}`}
                          className="block text-xs font-medium text-gray-700 mb-1"
                        >
                          Description (optional)
                        </label>
                        <textarea
                          id={`edit-forum-desc-${f.id}`}
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          rows={2}
                          disabled={savingEdit}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div className="flex flex-col gap-2 text-sm text-gray-700">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editAllowStudentThreads}
                            onChange={(e) =>
                              setEditAllowStudentThreads(e.target.checked)
                            }
                            disabled={savingEdit}
                          />
                          Allow students to start their own threads
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={editReplyToEmail}
                            onChange={(e) =>
                              setEditReplyToEmail(e.target.checked)
                            }
                            disabled={savingEdit}
                          />
                          Email notification for replies (not yet wired — the
                          setting is saved for later)
                        </label>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="submit"
                          disabled={savingEdit || !editTitle.trim()}
                          style={neutralBtn}
                        >
                          {savingEdit ? 'Saving…' : 'Save changes'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingEdit}
                          style={linkBtn}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {f.is_pinned && (
                            <span
                              className="text-xs text-amber-800 bg-amber-100 px-2 py-0.5 rounded"
                              title="Pinned to the top"
                            >
                              📌 Pinned
                            </span>
                          )}
                          <Link
                            to={forumPath(f.id)}
                            className="text-base font-semibold text-indigo-600 hover:text-indigo-500"
                          >
                            {f.title}
                          </Link>
                        </div>
                        {f.description && (
                          <p className="text-sm text-gray-600 mt-1">
                            {f.description}
                          </p>
                        )}
                        <div className="text-xs text-gray-400 mt-1 flex gap-3 flex-wrap">
                          {f.allow_student_threads && (
                            <span>Students may start threads</span>
                          )}
                          {f.reply_to_email && (
                            <span>Email on replies (saved, not sent)</span>
                          )}
                        </div>
                      </div>
                      {isTeacher && (
                        <div className="flex items-center gap-3 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(f)}
                            style={linkBtn}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTogglePin(f.id, !f.is_pinned)}
                            style={linkBtn}
                          >
                            {f.is_pinned ? 'Unpin' : 'Pin'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMove(f.id, 'up')}
                            disabled={!canMoveUp}
                            style={canMoveUp ? linkBtn : linkBtnDisabled}
                            title="Move up"
                            aria-label="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMove(f.id, 'down')}
                            disabled={!canMoveDown}
                            style={canMoveDown ? linkBtn : linkBtnDisabled}
                            title="Move down"
                            aria-label="Move down"
                          >
                            ↓
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}