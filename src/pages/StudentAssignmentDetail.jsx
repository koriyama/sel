// src/pages/StudentAssignmentDetail.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  getAssignmentById,
  listAssignmentItems,
  formatJst,
  getAttachmentSignedUrl,
  formatFileSize,
  isAudioAttachment,
} from '../lib/assignmentsApi';
import { getMyItemStatusMap } from '../lib/studentSubmissionApi';
import { getReviewSummariesForItems } from '../lib/reviewGradesApi';

function FileAttachment({ item }) {
  const [downloading, setDownloading] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioError, setAudioError] = useState(null);

  const hasFile = Boolean(item.file_path);
  const isAudio = hasFile && isAudioAttachment(item.file_name || '');

  useEffect(() => {
    if (!isAudio) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const url = await getAttachmentSignedUrl(item.file_path, {
          download: false,
        });
        if (!cancelled) setAudioUrl(url);
      } catch (err) {
        if (!cancelled) {
          setAudioError(err.message || 'Could not load audio.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAudio, item.file_path]);

  const handleDownload = async () => {
    if (!hasFile) return;
    setDownloading(true);
    try {
      const url = await getAttachmentSignedUrl(item.file_path, {
        fileName: item.file_name,
      });
      const a = document.createElement('a');
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      console.error(err);
      toast.error(
        err.message ||
          'Could not create a download link. Please refresh the page and try again.'
      );
    } finally {
      setDownloading(false);
    }
  };

  if (!hasFile) {
    return (
      <p className="text-xs text-gray-500 mt-2">
        File not available.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-3 text-xs flex-wrap">
        <span className="font-medium text-gray-700 truncate max-w-xs">
          {item.file_name}
        </span>
        {item.file_size != null && (
          <span className="text-gray-400">
            {formatFileSize(item.file_size)}
          </span>
        )}
      </div>

      {isAudio && (
        <div>
          {audioUrl ? (
            <audio controls src={audioUrl} className="w-full max-w-md">
              Your browser does not support the audio element.
            </audio>
          ) : audioError ? (
            <p className="text-xs text-red-600">{audioError}</p>
          ) : (
            <p className="text-xs text-gray-500">Loading audio…</p>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
        >
          {downloading ? 'Preparing…' : 'Download'}
        </button>
      </div>
    </div>
  );
}

function LinkAttachment({ item }) {
  const url = item.url || '';
  const description = item.body || '';

  if (!url) {
    return (
      <p className="text-xs text-gray-500 mt-2">
        Link not available.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-gray-500 break-all">{url}</p>
      {description && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap">
          {description}
        </p>
      )}
      <div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
        >
          Open link ↗
        </a>
      </div>
    </div>
  );
}

export default function StudentAssignmentDetail() {
  const { assignmentId } = useParams();
  const [assignment, setAssignment] = useState(null);
  const [items, setItems] = useState([]);
  const [statusMap, setStatusMap] = useState({});
  const [reviewSummaries, setReviewSummaries] = useState({});
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

        try {
          const summaries = await getReviewSummariesForItems({
            items: its,
            statusMap: map,
          });
          setReviewSummaries(summaries);
        } catch (err) {
          console.error('Could not load review summaries:', err);
          setReviewSummaries({});
        }
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
    if (item.type !== 'lesson') return null;
    const st = statusMap[item.id];
    if (!st) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          Not started
        </span>
      );
    }
    if (st.status === 'completed') {
      const summary = reviewSummaries[item.id];
      const pct =
        summary && summary.overall_pct != null
          ? Math.round(summary.overall_pct)
          : st.score != null
            ? Math.round(st.score)
            : null;
      const pending = summary && summary.review_pending > 0;
      const scoreText = pct != null ? ` · ${pct}%` : '';
      const pendingText = pending ? ' (pending review)' : '';
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
          ✅ Completed{scoreText}{pendingText}
        </span>
      );
    }
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
        In progress
      </span>
    );
  };

  // Right-side action. Renders nothing when the lesson is completed and
  // retakes are not allowed — the pill next to the title already shows
  // "Completed · NN%", so a second "Completed" label would be redundant.
  const renderItemButton = (item) => {
    const st = statusMap[item.id];
    const completed = st && st.status === 'completed';

    if (completed && !allowRetakes) {
      return null;
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

  const renderFeedback = (item) => {
    if (item.type !== 'lesson') return null;
    const summary = reviewSummaries[item.id];
    if (!summary || !summary.comments || summary.comments.length === 0) return null;
    return (
      <div className="mt-3 text-sm bg-blue-50 border border-blue-200 rounded-md px-3 py-2 space-y-1">
        <div className="text-xs font-semibold text-blue-900 uppercase tracking-wide">
          Teacher feedback
        </div>
        {summary.comments.map((c, i) => (
          <div key={i} className="text-blue-900 whitespace-pre-wrap">
            {c.comment}
          </div>
        ))}
      </div>
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
                const isText = item.type === 'text';
                const isFile = item.type === 'file';
                const isLink = item.type === 'link';
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

                        {isText && item.body && (
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

                        {isFile && <FileAttachment item={item} />}
                        {isLink && <LinkAttachment item={item} />}
                        {renderFeedback(item)}
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