// src/pages/StudentDashboard.jsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { listMyClassesAsStudent } from '../lib/lmsApi';
import { listAssignmentsForStudent, formatJst } from '../lib/assignmentsApi';
import { getMyAssignmentProgress } from '../lib/studentSubmissionApi';
import { getStudentRollingGradeForClass } from '../lib/gradebookApi';
import { listStudentCalendarAssignments } from '../lib/calendarApi';
import {
  listRecordsForStudent,
  getClassAttendanceSettings,
} from '../lib/attendanceApi';
import DueSoonStrip from '../components/DueSoonStrip';

function fmtPts(n) {
  if (n == null) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function attendanceColor(pct) {
  if (pct == null) return 'text-gray-400';
  if (pct >= 80) return 'text-green-700';
  if (pct >= 60) return 'text-gray-700';
  if (pct >= 40) return 'text-amber-700';
  return 'text-red-700';
}

function statusDisplay(status) {
  switch (status) {
    case 'present': return { text: 'Present', cls: 'text-green-700' };
    case 'late':    return { text: 'Late',    cls: 'text-amber-700' };
    case 'absent':  return { text: 'Absent',  cls: 'text-red-700' };
    case 'excused': return { text: 'Excused', cls: 'text-blue-700' };
    default:        return { text: 'Unmarked', cls: 'text-gray-400' };
  }
}

const StudentDashboard = () => {
  const { displayName, institutionalId, logout, user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [progress, setProgress] = useState({});
  const [calendarAssignments, setCalendarAssignments] = useState([]);
  const [rollingGrades, setRollingGrades] = useState({});
  const [attendanceByClass, setAttendanceByClass] = useState({});
  const [expandedAttendance, setExpandedAttendance] = useState({});
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, a, cal] = await Promise.all([
          listMyClassesAsStudent(),
          listAssignmentsForStudent(),
          listStudentCalendarAssignments(),
        ]);
        if (cancelled) return;
        setClasses(c);
        setAssignments(a);
        setCalendarAssignments(cal);

        const ids = a.map((x) => x.id);
        const prog = await getMyAssignmentProgress(ids);
        if (!cancelled) setProgress(prog);

        const gradeEntries = await Promise.all(
          c.map(async (cls) => {
            try {
              const g = await getStudentRollingGradeForClass(cls.id);
              return [cls.id, g];
            } catch (err) {
              console.error('Rolling grade failed for class', cls.id, err);
              return [cls.id, null];
            }
          })
        );
        if (!cancelled) {
          const map = {};
          for (const [cid, g] of gradeEntries) {
            if (g && g.rolling_grade != null) map[cid] = g;
          }
          setRollingGrades(map);
        }

        const attendanceEntries = await Promise.all(
          c.map(async (cls) => {
            try {
              const [recs, settings] = await Promise.all([
                listRecordsForStudent(cls.id, user.id),
                getClassAttendanceSettings(cls.id),
              ]);
              return [cls.id, { ...recs, settings }];
            } catch (err) {
              console.error('Attendance failed for class', cls.id, err);
              return [cls.id, null];
            }
          })
        );
        if (!cancelled) {
          const map = {};
          for (const [cid, att] of attendanceEntries) {
            if (att) map[cid] = att;
          }
          setAttendanceByClass(map);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) toast.error('Could not load your dashboard.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleLogout = async () => {
    await logout();
    navigate('/student-login', { replace: true });
  };

  const toggleAttendance = (classId) => {
    setExpandedAttendance((prev) => ({
      ...prev,
      [classId]: !prev[classId],
    }));
  };

  const now = new Date();

  const renderProgressBadge = (assignment) => {
    const p = progress[assignment.id] || {
      totalLessonItems: 0,
      completedItems: 0,
      startedItems: 0,
    };
    if (p.totalLessonItems === 0) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
          Read only
        </span>
      );
    }
    if (p.completedItems === p.totalLessonItems) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800">
          ✅ All done
        </span>
      );
    }
    if (p.startedItems > 0) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
          {p.completedItems} of {p.totalLessonItems} done
        </span>
      );
    }
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
        Not started
      </span>
    );
  };

  const computeAttendance = (att) => {
    if (!att || !att.sessions || att.sessions.length === 0) return null;
    const perSession = Number(att.settings?.attendance_points_per_session ?? 1);
    const recordsBySession = {};
    for (const r of att.records || []) recordsBySession[r.session_id] = r;
    let earned = 0;
    let max = 0;
    let marked = 0;
    for (const s of att.sessions) {
      const rec = recordsBySession[s.id];
      if (rec) {
        earned += Number(rec.points_awarded);
        max += perSession;
        marked += 1;
      }
    }
    if (marked === 0) return null;
    return {
      earned,
      max,
      marked,
      total: att.sessions.length,
      pct: max > 0 ? (earned / max) * 100 : null,
    };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900">My courses</h1>
            <p className="text-sm text-gray-500">
              Signed in as {displayName}
              {institutionalId ? ` (${institutionalId})` : ''}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/student/calendar"
              className="text-sm text-gray-700 hover:text-gray-900 border border-gray-300 rounded-md px-3 py-1.5"
            >
              📅 Calendar
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-8">
        <DueSoonStrip
          assignments={calendarAssignments}
          linkBuilder={(a) => `/student/assignments/${a.id}`}
          emptyText="Nothing due in the next 7 days. Nice work!"
        />

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            My classes
          </h2>
          {loading ? (
            <p className="text-gray-500">Loading…</p>
          ) : classes.length === 0 ? (
            <div className="bg-white p-6 rounded-lg shadow text-gray-600">
              You are not yet enrolled in any class. Please ask your teacher.
            </div>
          ) : (
            <ul className="space-y-3">
              {classes.map((c) => {
                const g = rollingGrades[c.id];
                const att = attendanceByClass[c.id];
                const attTotals = computeAttendance(att);
                const isExpanded = !!expandedAttendance[c.id];
                return (
                  <li key={c.id} className="bg-white p-4 rounded-lg shadow">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: c.color || '#94a3b8' }}
                      />
                      <h3 className="text-base font-semibold text-gray-900">
                        {c.name}
                      </h3>
                      <Link
                        to={`/student/classes/${c.id}/forums`}
                        className="ml-auto text-xs text-indigo-600 hover:text-indigo-500"
                      >
                        Forums →
                      </Link>
                    </div>
                    {c.description && (
                      <p className="text-sm text-gray-600 mt-1">
                        {c.description}
                      </p>
                    )}

                    {g && g.final_percent != null && (
                      <div className="mt-2">
                        <p className="text-sm text-gray-700 flex items-center gap-2 flex-wrap">
                          <span className="text-gray-500">Current grade:</span>
                          <span className="font-semibold">
                            {g.final_percent}%
                          </span>
                          {g.final_letter && (
                            <span className="font-semibold text-indigo-700">
                              ({g.final_letter})
                            </span>
                          )}
                          {g.pass_fail === 'pass' && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-100 text-green-800 font-medium">
                              PASS
                            </span>
                          )}
                          {g.pass_fail === 'fail' && (
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 font-medium">
                              FAIL
                            </span>
                          )}
                          <span className="text-xs text-gray-400">
                            ({g.total_earned_points} / {g.total_possible_points} pts)
                          </span>
                        </p>
                        {g.override_percent != null && g.rolling_grade != null && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            Adjusted by your teacher from {g.rolling_grade}%.
                          </p>
                        )}
                        {g.override_comment && (
                          <div className="mt-1.5 text-xs text-blue-900 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
                            <span className="font-semibold">Teacher note:</span>{' '}
                            {g.override_comment}
                          </div>
                        )}
                      </div>
                    )}

                    {attTotals && (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => toggleAttendance(c.id)}
                          className="w-full flex items-center gap-2 text-sm text-left -mx-1 px-1 py-0.5 rounded hover:bg-gray-50"
                        >
                          <span className="text-gray-500">Attendance:</span>
                          <span
                            className={
                              'font-semibold ' + attendanceColor(attTotals.pct)
                            }
                          >
                            {Math.round(attTotals.pct)}%
                          </span>
                          <span className="text-xs text-gray-400">
                            ({fmtPts(attTotals.earned)} / {fmtPts(attTotals.max)} pts ·{' '}
                            {attTotals.marked}/{attTotals.total} sessions)
                          </span>
                          <span className="ml-auto text-[10px] text-gray-400">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </button>

                        {isExpanded && (
                          <ul className="mt-2 pt-2 border-t border-gray-100 divide-y divide-gray-100">
                            {att.sessions.map((s) => {
                              const rec = (att.records || []).find(
                                (r) => r.session_id === s.id
                              );
                              const status = statusDisplay(rec ? rec.status : null);
                              return (
                                <li
                                  key={s.id}
                                  className="py-1.5 flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="min-w-0">
                                    <span className="font-medium text-gray-700">
                                      {s.session_date}
                                    </span>
                                    {s.session_time && (
                                      <span className="text-gray-500 ml-2">
                                        {s.session_time}
                                      </span>
                                    )}
                                    {s.label && (
                                      <span className="text-gray-500 ml-2">
                                        · {s.label}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    <span className={status.cls}>
                                      {status.text}
                                    </span>
                                    {rec && (
                                      <span className="text-gray-400">
                                        {fmtPts(rec.points_awarded)} pt
                                        {Number(rec.points_awarded) === 1 ? '' : 's'}
                                      </span>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-gray-400 mt-2">
                      {c.start_date ? `Starts ${c.start_date}` : ''}
                      {c.start_date && c.end_date ? ' · ' : ''}
                      {c.end_date ? `Ends ${c.end_date}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Assignments
          </h2>
          {loading ? (
            <p className="text-gray-500">Loading…</p>
          ) : assignments.length === 0 ? (
            <div className="bg-white p-6 rounded-lg shadow text-gray-600">
              No assignments yet. Check back later.
            </div>
          ) : (
            <ul className="space-y-3">
              {assignments.map((a) => {
                const due = a.due_at ? new Date(a.due_at) : null;
                const isPast = due && due < now;
                return (
                  <li key={a.id} className="bg-white p-4 rounded-lg shadow">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <Link
                          to={`/student/assignments/${a.id}`}
                          className="text-base font-semibold text-indigo-600 hover:text-indigo-500"
                        >
                          {a.title}
                        </Link>
                        <p className="text-xs text-gray-500 mt-1">
                          {a.class?.name || ''}
                        </p>
                        <p
                          className={`text-xs mt-1 ${
                            isPast ? 'text-red-600' : 'text-gray-500'
                          }`}
                        >
                          {due ? `Due ${formatJst(a.due_at)}` : 'No due date'}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        {renderProgressBadge(a)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
};

export default StudentDashboard;