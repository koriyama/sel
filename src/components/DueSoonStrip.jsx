// src/components/DueSoonStrip.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import {
  toJstDateKey,
  todayJstKey,
  offsetDateKey,
  formatJstTimeOnly,
} from '../lib/calendarApi';

function formatDayLabel(key, todayKey, tomorrowKey) {
  if (key === todayKey) return 'Today';
  if (key === tomorrowKey) return 'Tomorrow';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
}

export default function DueSoonStrip({
  assignments = [],
  daysAhead = 7,
  linkBuilder,
  emptyText = 'Nothing due in the next 7 days.',
  title = 'Due soon',
}) {
  const todayKey = todayJstKey();
  const tomorrowKey = offsetDateKey(todayKey, 1);
  const endKey = offsetDateKey(todayKey, daysAhead);

  const upcoming = (assignments || [])
    .filter((a) => {
      const k = toJstDateKey(a.due_at);
      return k && k >= todayKey && k <= endKey;
    })
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at));

  return (
    <section className="bg-white rounded-lg shadow p-4">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        {title}
      </h2>
      {upcoming.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {upcoming.slice(0, 8).map((a) => {
            const key = toJstDateKey(a.due_at);
            const href = linkBuilder ? linkBuilder(a) : null;
            const row = (
              <>
                <span
                  className="inline-block w-2 h-2 rounded-full mr-2 flex-shrink-0"
                  style={{ backgroundColor: a.class?.color || '#94a3b8' }}
                />
                <span className="flex-1 min-w-0 truncate">
                  <span className="font-medium text-gray-900">{a.title}</span>
                  {a.class?.name && (
                    <span className="text-gray-500"> · {a.class.name}</span>
                  )}
                </span>
                <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
                  {formatDayLabel(key, todayKey, tomorrowKey)}{' '}
                  {formatJstTimeOnly(a.due_at)}
                </span>
              </>
            );
            return (
              <li key={a.id} className="text-sm">
                {href ? (
                  <Link
                    to={href}
                    className="flex items-center gap-1 hover:bg-gray-50 rounded px-1 py-1 -mx-1"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-center gap-1 px-1 py-1 -mx-1">
                    {row}
                  </div>
                )}
              </li>
            );
          })}
          {upcoming.length > 8 && (
            <li className="text-xs text-gray-400 pt-1">
              + {upcoming.length - 8} more
            </li>
          )}
        </ul>
      )}
    </section>
  );
}