// src/components/CalendarMonth.jsx
import React from 'react';
import { buildMonthGrid } from '../lib/calendarApi';

const DOW_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DOW_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarMonth({
  year,
  month,
  weekStartsOn,
  dateMap,
  todayKey,
  onPrevMonth,
  onNextMonth,
  onToday,
  onDayClick,
  selectedDay,
}) {
  const days = buildMonthGrid(year, month, weekStartsOn);
  const monthLabel = new Date(Date.UTC(year, month, 1)).toLocaleDateString(
    'en-GB',
    { month: 'long', year: 'numeric' }
  );
  const dow = weekStartsOn === 1 ? DOW_MON : DOW_SUN;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrevMonth}
            className="px-2 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            aria-label="Previous month"
          >
            ←
          </button>
          <h2 className="text-lg font-semibold text-gray-900 min-w-[10rem] text-center">
            {monthLabel}
          </h2>
          <button
            type="button"
            onClick={onNextMonth}
            className="px-2 py-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
            aria-label="Next month"
          >
            →
          </button>
        </div>
        <button
          type="button"
          onClick={onToday}
          className="text-sm text-indigo-600 hover:text-indigo-500"
        >
          Today
        </button>
      </div>

      <div className="grid grid-cols-7 text-xs text-gray-500 border-b border-gray-100">
        {dow.map((d) => (
          <div key={d} className="py-2 text-center font-medium">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((key) => {
          const parts = key.split('-');
          const m = parseInt(parts[1], 10);
          const inMonth = m === month + 1;
          const isToday = key === todayKey;
          const isSelected = key === selectedDay;
          const items = dateMap[key] || [];
          const dayNumber = parseInt(parts[2], 10);
          const isPast = key < todayKey;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick(key)}
              className={
                'relative min-h-[80px] p-1.5 border-b border-r border-gray-100 text-left transition ' +
                (isSelected
                  ? 'bg-indigo-50'
                  : isToday
                  ? 'bg-indigo-50/50'
                  : 'hover:bg-gray-50')
              }
            >
              <div
                className={
                  'text-xs font-medium mb-1 ' +
                  (isToday
                    ? 'text-indigo-600 font-bold'
                    : !inMonth
                    ? 'text-gray-300'
                    : isPast
                    ? 'text-gray-400'
                    : 'text-gray-700')
                }
              >
                {dayNumber}
              </div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-1 text-[10px] leading-tight"
                    title={a.title}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: a.class?.color || '#94a3b8' }}
                    />
                    <span className="truncate text-gray-700">{a.title}</span>
                  </div>
                ))}
                {items.length > 3 && (
                  <div className="text-[10px] text-gray-400 pl-2.5">
                    +{items.length - 3} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}