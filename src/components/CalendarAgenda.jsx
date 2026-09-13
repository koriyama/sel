// src/components/CalendarAgenda.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import {
  toJstDateKey,
  formatJstTimeOnly,
  formatJstLongDate,
  todayJstKey,
} from '../lib/calendarApi';

export default function CalendarAgenda({
  assignments,
  linkBuilder,
  emptyText = 'No assignments in this range.',
}) {
  const todayKey = todayJstKey();
  const groups = {};
  for (const a of assignments || []) {
    const key = toJstDateKey(a.due_at);
    if (!key) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(a);
  }
  const keys = Object.keys(groups).sort();
  for (const key of keys) {
    groups[key].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  }

  if (keys.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-gray-500 text-sm">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {keys.map((key) => {
        const isPast = key < todayKey;
        return (
          <div key={key}>
            <div
              className={
                'text-sm font-semibold mb-2 ' +
                (isPast ? 'text-gray-400' : 'text-gray-700')
              }
            >
              {key === todayKey ? 'Today' : formatJstLongDate(key)}
            </div>
            <ul className="space-y-2">
              {groups[key].map((a) => {
                const href = linkBuilder ? linkBuilder(a) : null;
                const content = (
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: a.class?.color || '#94a3b8' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {a.title}
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.class?.name || ''} · Due{' '}
                        {formatJstTimeOnly(a.due_at)}
                        {a.status === 'draft' && (
                          <span className="ml-2 text-yellow-600">(draft)</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
                return (
                  <li
                    key={a.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-100 p-3 hover:bg-gray-50"
                  >
                    {href ? <Link to={href}>{content}</Link> : content}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}