// src/pages/ForumView.jsx
import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Editor from 'react-simple-wysiwyg';
import DOMPurify from 'dompurify';
import {
  getForumById,
  listThreadsForForum,
  createThread,
  getProfilesByIds,
} from '../lib/forumApi';
import { formatJst } from '../lib/assignmentsApi';

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

export default function ForumView({ mode }) {
  const { id: classId, forumId } = useParams();
  const isTeacher = mode === 'teacher';
  const navigate = useNavigate();

  const [forum, setForum] = useState(null);
  const [threads, setThreads] = useState([]);
  const [authors, setAuthors] = useState({});
  const [loading, setLoading] = useState(true);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);

  const classHomePath = isTeacher ? `/classes/${classId}` : '/student';
  const forumListPath = isTeacher
    ? `/classes/${classId}/forums`
    : `/student/classes/${classId}/forums`;
  const threadPath = (threadId) =>
    isTeacher
      ? `/classes/${classId}/forums/${forumId}/threads/${threadId}`
      : `/student/classes/${classId}/forums/${forumId}/threads/${threadId}`;

  const load = async () => {
    setLoading(true);
    try {
      const [f, t] = await Promise.all([
        getForumById(forumId),
        listThreadsForForum(forumId),
      ]);
      setForum(f);
      setThreads(t);
      const ids = t.map((x) => x.author_id);
      const map = await getProfilesByIds(ids);
      setAuthors(map);
    } catch (err) {
      console.error(err);
      toast.error('Could not load forum.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forumId]);

  const canStartThread = !!forum && (isTeacher || forum.allow_student_threads);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      toast.error('Please enter a title.');
      return;
    }
    const safeBody = DOMPurify.sanitize(newBody || '');
    if (!safeBody.trim() || safeBody === '<br>') {
      toast.error('Please write something in the body.');
      return;
    }
    setCreating(true);
    try {
      const created = await createThread({
        forumId,
        title: newTitle,
        body: safeBody,
      });
      toast.success('Thread posted.');
      setNewTitle('');
      setNewBody('');
      setShowCreate(false);
      navigate(threadPath(created.id));
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not post thread.');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!forum) {
    return (
      <div className="min-h-screen p-8 text-center">
        <p className="text-gray-600">Forum not found, or you cannot view it.</p>
        <Link to={classHomePath} className="text-indigo-600 underline mt-4 inline-block">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6">
          <Link
            to={forumListPath}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← All forums
          </Link>
          <div className="mt-1 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{forum.title}</h1>
              {forum.description && (
                <p className="text-sm text-gray-600 mt-1">{forum.description}</p>
              )}
            </div>
            {canStartThread && (
              <button
                type="button"
                onClick={() => setShowCreate((v) => !v)}
                style={neutralBtn}
              >
                {showCreate ? 'Cancel' : '+ New thread'}
              </button>
            )}
          </div>
        </div>

        {showCreate && canStartThread && (
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-lg shadow p-4 mb-6 space-y-3"
          >
            <div>
              <label
                htmlFor="thread-title"
                className="block text-xs font-medium text-gray-700 mb-1"
              >
                Title
              </label>
              <input
                id="thread-title"
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="What is this thread about?"
                autoComplete="off"
                disabled={creating}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Body
              </label>
              <div className="border border-gray-300 rounded-md bg-white">
                <Editor
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                />
              </div>
            </div>
            <div>
              <button
                type="submit"
                disabled={creating || !newTitle.trim()}
                style={neutralBtn}
              >
                {creating ? 'Posting…' : 'Post thread'}
              </button>
            </div>
          </form>
        )}

        {threads.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No threads yet.
            {canStartThread ? ' Use “+ New thread” to start one.' : ''}
          </div>
        ) : (
          <ul className="bg-white rounded-lg shadow divide-y divide-gray-100">
            {threads.map((t) => {
              const author = authors[t.author_id];
              return (
                <li key={t.id} className="p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={threadPath(t.id)}
                        className="text-base font-semibold text-indigo-600 hover:text-indigo-500"
                      >
                        {t.title}
                      </Link>
                      <div className="text-xs text-gray-500 mt-1">
                        {author?.display_name || 'Unknown'}
                        {' · '}
                        {formatJst(t.created_at)}
                        {t.is_pinned ? ' · pinned' : ''}
                        {t.is_locked ? ' · locked' : ''}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}