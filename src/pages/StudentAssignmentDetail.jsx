// src/pages/StudentAssignmentDetail.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  getAssignmentById,
  listAssignmentItems,
  formatJst,
} from '../lib/assignmentsApi';
import { getMyItemStatusMap } from '../lib/studentSubmissionApi';

export default function StudentAssignmentDetail() {
  const { assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [items, setItems] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const a = await getAssignmentById(assignmentId);
      setAssignment(a);
      if (a) {
        const [its, map] = await Promise.all([
          listAssignmentItems(assignmentId),
          getMyItemStatusMap(assignmentId),
        ]);
        setItems(its);
        setStatusMap(map);
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not load assignment.');
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Refresh when the student returns to this tab (e.g. after
  // completing a lesson in a new tab).
  useEffect(() => {
    const onFocus = () => {
      load();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="min-h-screen p-8 text-center">
        <p className="text-gray-600">
          Assignment not found, or not yet published.
        </p>
        <Link
          to="/student"
          className="text-indigo-600 underline mt-4 inline-block"
        >
          Back to my courses
        </Link>
      </div>
    );
  }

  const now = new Date();
  const startAt = assignment.start_at ? new Date(assignment.start_at) : null;
  const dueAt = assignment.due_at ? new Date(assignment.due_at) : null;
  const notYetOpen = startAt && startAt > now;
  const isPastDue = dueAt && dueAt < now;
  const allowRetakes = assignment.allow_retakes === true;

  const handleOpenItem = (item) => {
    if (!item.lesson || !item.lesson.share_slug) {
      toast.error('Lesson not available.');
      return;
    }
    const url = `/lesson/${item.lesson.share_slug}?assignment=${assignment.id}&item=${item.id}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const renderItemBadge = (item) => {
    if (item.type === 'text') return null;
    const st = statusMap[item.id];
    if (!st) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          Not started
        </span>
      );
    }
    if (st.status === 'completed') {
      const score = st.max_auto_score > 0 ? ` · ${st.score}%` : '';
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
          ✅ Completed{score}
        </span>
      );
    }
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
        In progress
      </span>
    );
  };

  const renderItemButton = (item) => {
    const st = statusMap[item.id];
    const completed = st && st.status === 'completed';

    if (completed && !allowRetakes) {
      return (
        <span className="flex-shrink-0 py-2 px-4 bg-gray-100 text-gray-600 text-sm font-medium rounded-md">
          ✅ Completed
        </span>
      );
    }

    const label = completed
      ? 'Try again'
      : st
      ? 'Continue lesson'
      : 'Start lesson';

    return (
      <button
        type="button"
        onClick={() => handleOpenItem(item)}
        className="flex-shrink-0 py-2 px-4 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700"
      >
        {label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <Link
          to="/student"
          className="text-sm text-indigo-600 hover:text-indigo-500"
        >
          ← Back to my courses
        </Link>

        <div className="bg-white rounded-lg shadow p-6 mt-4">
          <h1 className="text-2xl font-bold text-gray-900">
            {assignment.title}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            {assignment.class?.name || ''}
          </p>

          <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {startAt && (
              <div>
                <dt className="text-gray-500">Opens</dt>
                <dd className="text-gray-900">
                  {formatJst(assignment.start_at)}
                </dd>
              </div>
            )}
            {dueAt && (
              <div>
                <dt className="text-gray-500">Due</dt>
                <dd
                  className={
                    isPastDue ? 'text-red-600 font-medium' : 'text-gray-900'
                  }
                >
                  {formatJst(assignment.due_at)}
                </dd>
              </div>
            )}
          </dl>

          {assignment.instructions && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Instructions
              </h2>
              <p className="text-gray-800 whitespace-pre-wrap">
                {assignment.instructions}
              </p>
            </div>
          )}
        </div>

        <div className="mt-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Items ({items.length})
          </h2>

          {notYetOpen ? (
            <div className="bg-white rounded-lg shadow p-6 text-gray-600">
              This assignment opens on {formatJst(assignment.start_at)}.
            </div>
          ) : items.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-gray-600">
              There are no items in this assignment yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item, idx) => {
                const isLesson = item.type === 'lesson';
                return (
                  <li
                    key={item.id}
                    className="bg-white rounded-lg shadow p-4"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-gray-400">
                            {idx + 1}.
                          </span>
                          <span className="text-base font-semibold text-gray-900">
                            {item.title}
                          </span>
                          {renderItemBadge(item)}
                        </div>

                        {item.type === 'text' && item.body && (
                          <div
                            className="prose prose-sm max-w-none text-gray-700 mt-2"
                            dangerouslySetInnerHTML={{ __html: item.body }}
                          />
                        )}

                        {isLesson && item.lesson && (
                          <p className="text-xs text-gray-500 mt-1">
                            Lesson · {item.lesson.level || 'B1'}
                          </p>
                        )}
                      </div>

                      {isLesson && renderItemButton(item)}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}