// src/pages/StudentCalendar.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  listStudentCalendarAssignments,
  buildDateMap,
  todayJstKey,
  formatJstLongDate,
  formatJstTimeOnly,
  toJstDateKey,
  offsetDateKey,
  filterByDateWindow,
} from '../lib/calendarApi';
import { listMyClassesAsStudent } from '../lib/lmsApi';
import CalendarMonth from '../components/CalendarMonth';
import CalendarAgenda from '../components/CalendarAgenda';

const WEEK_START_KEY = 'smiley_week_starts_on';

export default function StudentCalendar() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [classFilter, setClassFilter] = useState('all');
  const [view, setView] = useState('month');
  const [weekStartsOn, setWeekStartsOn] = useState(() => {
    const v = localStorage.getItem(WEEK_START_KEY);
    return v === '0' ? 0 : 1;
  });
  const [selectedDay, setSelectedDay] = useState(null);
  const [agendaRange, setAgendaRange] = useState('upcoming');

  const today = todayJstKey();
  const [yy, mm] = today.split('-').map(Number);
  const [year, setYear] = useState(yy);
  const [month, setMonth] = useState(mm - 1);

  useEffect(() => {
    localStorage.setItem(WEEK_START_KEY, String(weekStartsOn));
  }, [weekStartsOn]);

  useEffect(() => {
    (async () => {
      try {
        const [a, c] = await Promise.all([
          listStudentCalendarAssignments(),
          listMyClassesAsStudent(),
        ]);
        setAssignments(a);
        setClasses(c);
      } catch (err) {
        console.error(err);
        toast.error('Could not load calendar.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (classFilter === 'all') return assignments;
    return assignments.filter((a) => a.class_id === classFilter);
  }, [assignments, classFilter]);

  const dateMap = useMemo(() => buildDateMap(filtered), [filtered]);

  const handlePrevMonth = () => {
    if (month === 0) {
      setYear(year - 1);
      setMonth(11);
    } else {
      setMonth(month - 1);
    }
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    if (month === 11) {
      setYear(year + 1);
      setMonth(0);
    } else {
      setMonth(month + 1);
    }
    setSelectedDay(null);
  };

  const handleToday = () => {
    const [ty, tm] = today.split('-').map(Number);
    setYear(ty);
    setMonth(tm - 1);
    setSelectedDay(today);
  };

  const selectedDayAssignments = selectedDay
    ? filtered.filter((a) => toJstDateKey(a.due_at) === selectedDay)
    : [];

  const agendaAssignments = useMemo(() => {
    if (agendaRange === 'upcoming') {
      return filterByDateWindow(filtered, today, offsetDateKey(today, 30));
    }
    return filterByDateWindow(filtered, offsetDateKey(today, -30), today);
  }, [filtered, agendaRange, today]);

  const linkBuilder = (a) => `/student/assignments/${a.id}`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <Link
              to="/student"
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              ← My courses
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              My calendar
            </h1>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">View:</label>
            <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setView('month')}
                className={
                  'px-3 py-1 text-sm ' +
                  (view === 'month'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50')
                }
              >
                Month
              </button>
              <button
                type="button"
                onClick={() => setView('agenda')}
                className={
                  'px-3 py-1 text-sm border-l border-gray-300 ' +
                  (view === 'agenda'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50')
                }
              >
                Agenda
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600">Class:</label>
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-md px-2 py-1"
            >
              <option value="all">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {view === 'month' && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Week starts:</label>
              <select
                value={weekStartsOn}
                onChange={(e) => setWeekStartsOn(parseInt(e.target.value, 10))}
                className="text-sm border border-gray-300 rounded-md px-2 py-1"
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>
            </div>
          )}

          {view === 'agenda' && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Range:</label>
              <select
                value={agendaRange}
                onChange={(e) => setAgendaRange(e.target.value)}
                className="text-sm border border-gray-300 rounded-md px-2 py-1"
              >
                <option value="upcoming">Next 30 days</option>
                <option value="past">Past 30 days</option>
              </select>
            </div>
          )}
        </div>

        {view === 'month' && (
          <>
            <CalendarMonth
              year={year}
              month={month}
              weekStartsOn={weekStartsOn}
              dateMap={dateMap}
              todayKey={today}
              onPrevMonth={handlePrevMonth}
              onNextMonth={handleNextMonth}
              onToday={handleToday}
              onDayClick={(k) => setSelectedDay(k === selectedDay ? null : k)}
              selectedDay={selectedDay}
            />
            {selectedDay && (
              <div className="bg-white rounded-lg shadow mt-4 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-gray-900">
                    {formatJstLongDate(selectedDay)}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setSelectedDay(null)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
                {selectedDayAssignments.length === 0 ? (
                  <p className="text-sm text-gray-500">No assignments due.</p>
                ) : (
                  <ul className="space-y-2">
                    {selectedDayAssignments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded"
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: a.class?.color || '#94a3b8',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => navigate(linkBuilder(a))}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="text-sm font-medium text-indigo-600 hover:text-indigo-500 truncate">
                            {a.title}
                          </div>
                          <div className="text-xs text-gray-500">
                            {a.class?.name || ''} · Due{' '}
                            {formatJstTimeOnly(a.due_at)}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {view === 'agenda' && (
          <CalendarAgenda
            assignments={agendaAssignments}
            linkBuilder={linkBuilder}
            emptyText={
              agendaRange === 'upcoming'
                ? 'Nothing due in the next 30 days.'
                : 'Nothing was due in the past 30 days.'
            }
          />
        )}
      </div>
    </div>
  );
}