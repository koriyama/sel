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
import DueSoonStrip from '../components/DueSoonStrip';

const StudentDashboard = () => {
  const { displayName, institutionalId, logout, user } = useAuth();
  const [classes, setClasses] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [progress, setProgress] = useState({});
  const [calendarAssignments, setCalendarAssignments] = useState([]);
  const [rollingGrades, setRollingGrades] = useState({});
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

        // Rolling grade per class, in parallel.
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
                    </div>
                    {c.description && (
                      <p className="text-sm text-gray-600 mt-1">
                        {c.description}
                      </p>
                    )}
                    {g && g.rolling_grade != null && (
                      <p className="text-sm text-gray-700 mt-2">
                        <span className="text-gray-500">Current grade:</span>{' '}
                        <span className="font-semibold">
                          {g.rolling_grade}%
                        </span>
                        <span className="text-xs text-gray-400 ml-2">
                          ({g.total_earned_points} / {g.total_possible_points} pts)
                        </span>
                      </p>
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