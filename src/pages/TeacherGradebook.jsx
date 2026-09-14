// src/pages/TeacherGradebook.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  getClassGradebook,
  getCellDetail,
  saveOverride,
  deleteOverride,
} from '../lib/gradebookApi';
import { getClassById } from '../lib/lmsApi';
import { formatJst } from '../lib/assignmentsApi';
import { supabase } from '../lib/supabaseClient';

function pctCellClass(pct) {
  if (pct == null) return 'text-gray-300';
  if (pct >= 80) return 'text-green-700';
  if (pct >= 60) return 'text-gray-800';
  if (pct >= 40) return 'text-amber-700';
  return 'text-red-700';
}

function fmtPct(pct) {
  if (pct == null) return '—';
  return `${pct}%`;
}

function fmtPoints(n) {
  if (n == null) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function downloadCSV(cls, gradebook) {
  const rows = [];
  const header = ['Student', 'Institutional ID'];
  for (const a of gradebook.assignments) {
    const cat = a.category_name ? `${a.category_name}: ` : '';
    header.push(`${cat}${a.title} (${a.grade_points} pts)`);
  }
  header.push(
    'Rolling grade (%)',
    'Calculated (%)',
    'Letter',
    'Pass/Fail',
    'Override (%)',
    'Override comment',
    'Earned',
    'Possible'
  );
  rows.push(header);

  for (const s of gradebook.students) {
    const row = [s.display_name, s.institutional_id || ''];
    for (const a of gradebook.assignments) {
      const c = s.cells[a.id];
      row.push(c && c.pct != null ? c.pct : '');
    }
    row.push(
      s.final_percent != null ? s.final_percent : '',
      s.rolling_grade != null ? s.rolling_grade : '',
      s.final_letter || '',
      s.pass_fail || '',
      s.override_percent != null ? s.override_percent : '',
      s.override_comment || '',
      s.total_earned_points,
      s.total_possible_points
    );
    rows.push(row);
  }

  const csvContent = rows
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(cls?.name || 'class').replace(/\s+/g, '-').toLowerCase()}-gradebook.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function WarningsBanner({ warnings }) {
  const { id: classId } = useParams();
  if (!warnings || warnings.length === 0) return null;

  const big = warnings.find((w) => w.type === 'weights_not_100');
  const uncat = warnings.find((w) => w.type === 'uncategorised');
  const others = warnings.filter(
    (w) => w.type !== 'weights_not_100' && w.type !== 'uncategorised'
  );

  return (
    <div className="space-y-2 mb-4">
      {big && (
        <div className="p-3 border border-amber-300 bg-amber-50 rounded-md text-sm text-amber-900">
          <strong>Category weights total {big.total}, not 100.</strong> Rolling
          grades still calculate, using {big.total} as the maximum instead of 100.
          Edit your categories in{' '}
          <Link
            to={`/classes/${classId}/grade-setup`}
            className="underline font-medium"
          >
            Grade setup
          </Link>{' '}
          if you'd prefer them to total 100.
        </div>
      )}
      {uncat && (
        <div className="p-3 border border-gray-300 bg-gray-50 rounded-md text-sm text-gray-800">
          <strong>
            {uncat.assignment_titles?.length || 0} assignment
            {uncat.assignment_titles?.length === 1 ? '' : 's'} not in a category.
          </strong>{' '}
          {uncat.assignment_titles && uncat.assignment_titles.length > 0 && (
            <span className="text-gray-600">
              ({uncat.assignment_titles.join(', ')})
            </span>
          )}{' '}
          These are excluded from rolling grades.
        </div>
      )}
      {others.length > 0 && (
        <div className="p-3 border border-gray-200 bg-white rounded-md text-sm text-gray-700">
          <ul className="list-disc list-inside space-y-1">
            {others.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CellDetailPanel({ studentId, assignmentId, studentName, assignmentTitle, onClose }) {
  const [rows, setRows] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getCellDetail(studentId, assignmentId);
        if (!cancelled) setRows(r);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, assignmentId]);

  const isAttendance =
    typeof assignmentId === 'string' && assignmentId.startsWith('attendance:');

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">{studentName}</h3>
            <p className="text-xs text-gray-500">{assignmentTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-4">
          {loading && <p className="text-sm text-gray-500">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {rows && rows.length === 0 && (
            <p className="text-sm text-gray-500">
              {isAttendance
                ? 'No sessions yet for this class.'
                : 'No lesson items in this assignment.'}
            </p>
          )}
          {rows && rows.length > 0 && isAttendance && (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.item_id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {r.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {r.session_date}
                      {r.session_time ? ` · ${r.session_time}` : ''}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <div
                      className={
                        r.status === 'present'
                          ? 'text-green-700 font-medium capitalize'
                          : r.status === 'late'
                          ? 'text-amber-700 font-medium capitalize'
                          : r.status === 'excused'
                          ? 'text-blue-700 font-medium capitalize'
                          : r.status === 'absent'
                          ? 'text-red-700 font-medium capitalize'
                          : 'text-gray-400'
                      }
                    >
                      {r.status}
                    </div>
                    <div className="text-gray-500">
                      {fmtPoints(r.raw_earned)} pts
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {rows && rows.length > 0 && !isAttendance && (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.item_id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {r.title}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {r.status === 'completed'
                          ? `Completed · ${r.raw_earned}/${r.raw_max}`
                          : r.status === 'in_progress'
                          ? 'In progress'
                          : 'Not started'}
                        {r.attempt_number > 1 && ` · attempt ${r.attempt_number}`}
                      </p>
                      {r.review_pending_count > 0 && (
                        <p className="text-xs text-amber-700 mt-0.5">
                          {r.review_pending_count} review item
                          {r.review_pending_count === 1 ? '' : 's'} awaiting your mark
                        </p>
                      )}
                    </div>
                    <div className={`text-sm font-medium ${pctCellClass(r.pct)}`}>
                      {fmtPct(r.pct)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function OverrideModal({ student, classId, onClose, onSaved }) {
  const [percentDraft, setPercentDraft] = useState(
    student.override_percent != null ? String(student.override_percent) : ''
  );
  const [commentDraft, setCommentDraft] = useState(student.override_comment || '');
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    const trimmed = percentDraft.trim();
    if (trimmed === '') {
      toast.error('Enter a percentage, or click Clear to remove the override.');
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast.error('Percentage must be a number between 0 and 100.');
      return;
    }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await saveOverride({
        classId,
        studentId: student.id,
        overridePercent: n,
        comment: commentDraft,
        userId: user?.id,
      });
      toast.success('Override saved.');
      if (onSaved) await onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save override.');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Remove the override for this student?')) return;
    setBusy(true);
    try {
      await deleteOverride({ classId, studentId: student.id });
      toast.success('Override removed.');
      if (onSaved) await onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not remove override.');
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const hasExisting = student.override_percent != null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900">Adjust rolling grade</h3>
            <p className="text-xs text-gray-500">
              {student.display_name}
              {student.institutional_id ? ` (${student.institutional_id})` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-md p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-gray-500">Calculated rolling grade:</span>
              <span className="font-medium">
                {student.rolling_grade != null ? `${student.rolling_grade}%` : '—'}
              </span>
            </div>
            {student.final_letter && (
              <div className="flex items-center justify-between gap-3 mt-1">
                <span className="text-gray-500">Calculated letter:</span>
                <span className="font-medium">{student.final_letter}</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Adjusted percentage
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={percentDraft}
                onChange={(e) => setPercentDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 80"
                className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
                autoFocus
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Replaces the calculated rolling grade for this student. The letter
              and pass/fail follow from this number using the class's bands.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Comment (optional)
            </label>
            <textarea
              rows={3}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="e.g. Excused absences considered."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Shown to the student on their dashboard.
            </p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex items-center justify-between gap-2">
          <div>
            {hasExisting && (
              <button
                type="button"
                onClick={handleClear}
                disabled={busy}
                className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                Clear override
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save adjustment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TeacherGradebook() {
  const { id: classId } = useParams();
  const [cls, setCls] = useState(null);
  const [gradebook, setGradebook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cell, setCell] = useState(null);
  const [overrideFor, setOverrideFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, gb] = await Promise.all([
        getClassById(classId),
        getClassGradebook(classId),
      ]);
      setCls(c);
      setGradebook(gb);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Could not load grade book.');
      toast.error('Could not load grade book.');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen p-8 text-center">
        <p className="text-red-600">{error}</p>
        <Link
          to={`/classes/${classId}`}
          className="text-indigo-600 underline mt-4 inline-block"
        >
          Back to class
        </Link>
      </div>
    );
  }

  const hasAssignments = gradebook.assignments.length > 0;
  const hasStudents = gradebook.students.length > 0;
  const hasBands =
    Array.isArray(gradebook.letter_bands) && gradebook.letter_bands.length > 0;
  const hasThreshold = gradebook.pass_threshold != null;

  const computeAttendanceAverage = (attendanceId) => {
    const cells = gradebook.students
      .map((s) => s.cells[attendanceId])
      .filter((c) => c && c.raw_max > 0);
    if (cells.length === 0) return { earned: null, max: null };
    const sumEarned = cells.reduce((acc, c) => acc + c.raw_earned, 0);
    const sumMax = cells.reduce((acc, c) => acc + c.raw_max, 0);
    return {
      earned: sumEarned / cells.length,
      max: sumMax / cells.length,
    };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[110rem] mx-auto p-6">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              to={`/classes/${classId}`}
              className="text-sm text-indigo-600 hover:text-indigo-500"
            >
              ← Back to {cls?.name || 'class'}
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">Grade book</h1>
            {cls?.name && <p className="text-sm text-gray-600 mt-1">{cls.name}</p>}
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={`/classes/${classId}/grade-setup`}
              className="py-2 px-4 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
            >
              Grade setup
            </Link>
            <button
              type="button"
              onClick={() => downloadCSV(cls, gradebook)}
              disabled={!hasStudents}
              className="py-2 px-4 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>

        <WarningsBanner warnings={gradebook.warnings} />

        {!hasAssignments && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No assignments in this class yet. Create one to populate the grade book.
          </div>
        )}

        {hasAssignments && !hasStudents && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No students enrolled yet. Import students or add them by ID.
          </div>
        )}

        {hasAssignments && hasStudents && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-auto max-h-[75vh]">
              <table className="min-w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th
                      className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left font-semibold text-gray-700 whitespace-nowrap"
                      style={{ minWidth: '14rem' }}
                    >
                      Student
                    </th>
                    {gradebook.assignments.map((a) => (
                      <th
                        key={a.id}
                        className="sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-3 py-2 text-center font-medium text-gray-700 align-bottom"
                        style={{ minWidth: '7rem' }}
                        title={
                          (a.is_attendance
                            ? `Attendance — ${a.attendance_session_count} session(s). Worth ${a.grade_points} grade points. `
                            : '') +
                          (a.category_name ? `Category: ${a.category_name}. ` : '') +
                          (!a.is_attendance && a.status !== 'published'
                            ? `Status: ${a.status}. `
                            : '') +
                          (a.is_attendance
                            ? ''
                            : `Worth ${a.grade_points} grade points. ` +
                              (a.is_due
                                ? 'Counts toward rolling grade.'
                                : 'Not yet due.')) +
                          (a.review_item_count > 0
                            ? ` Contains ${a.review_item_count} review item(s) that the teacher marks by hand.`
                            : '')
                        }
                      >
                        <div className="flex flex-col items-center gap-1">
                          {a.is_attendance && (
                            <span className="text-[10px] font-normal px-1.5 py-0.5 bg-sky-100 text-sky-800 rounded">
                              attendance
                            </span>
                          )}
                          {!a.is_attendance && a.category_name && (
                            <span className="text-[10px] font-normal px-1.5 py-0.5 bg-teal-100 text-teal-800 rounded truncate max-w-[7rem]">
                              {a.category_name}
                            </span>
                          )}
                          {!a.is_attendance && a.status === 'draft' && (
                            <span className="text-[10px] font-normal px-1.5 py-0.5 bg-yellow-100 text-yellow-800 rounded">
                              draft
                            </span>
                          )}
                          {!a.is_attendance && a.status === 'published' && !a.is_due && (
                            <span className="text-[10px] font-normal px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                              not due
                            </span>
                          )}
                          {a.review_item_count > 0 && (
                            <span className="text-[10px] font-normal px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded">
                              review
                            </span>
                          )}
                          <span className="truncate max-w-[7rem]" title={a.title}>
                            {a.title}
                          </span>
                          <span className="text-[10px] font-normal text-gray-500">
                            {a.is_attendance
                              ? `${a.attendance_session_count} sess · ${a.grade_points} pts`
                              : `${a.grade_points} pt${a.grade_points === 1 ? '' : 's'}`}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th
                      className="sticky right-0 top-0 z-30 bg-gray-100 border-b border-l border-gray-200 px-3 py-2 text-center font-semibold text-gray-800"
                      style={{ minWidth: '8rem' }}
                      title="Click a student's cell to adjust the rolling grade for that student."
                    >
                      Rolling grade
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {gradebook.students.map((s, idx) => {
                    const hasOverride = s.override_percent != null;
                    const effective = s.final_percent;
                    const tooltip = hasOverride
                      ? `Adjusted from ${s.rolling_grade != null ? s.rolling_grade + '%' : '—'}`
                      : 'Click to adjust';
                    return (
                      <tr
                        key={s.id}
                        className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
                      >
                        <td
                          className="sticky left-0 z-10 bg-inherit border-b border-r border-gray-100 px-3 py-2 whitespace-nowrap"
                          style={{ minWidth: '14rem' }}
                        >
                          <div className="font-medium text-gray-900 truncate">
                            {s.display_name}
                          </div>
                          {s.institutional_id && (
                            <div className="text-xs text-gray-500">
                              {s.institutional_id}
                            </div>
                          )}
                        </td>
                        {gradebook.assignments.map((a) => {
                          const c = s.cells[a.id];
                          const pct = c ? c.pct : null;
                          const clickable =
                            c && (c.has_any_submission || c.raw_max > 0);

                          if (a.is_attendance) {
                            const hasMarked = c && c.raw_max > 0;
                            return (
                              <td
                                key={a.id}
                                className={
                                  'border-b border-gray-100 px-2 py-2 text-center ' +
                                  (clickable
                                    ? 'cursor-pointer hover:bg-indigo-50'
                                    : '')
                                }
                                onClick={() => {
                                  if (!clickable) return;
                                  setCell({
                                    studentId: s.id,
                                    assignmentId: a.id,
                                    studentName: s.display_name,
                                    assignmentTitle: a.title,
                                  });
                                }}
                              >
                                {hasMarked ? (
                                  <span
                                    className={
                                      'font-medium ' + pctCellClass(pct)
                                    }
                                  >
                                    {fmtPoints(c.raw_earned)} /{' '}
                                    {fmtPoints(c.raw_max)}
                                  </span>
                                ) : (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                            );
                          }

                          return (
                            <td
                              key={a.id}
                              className={
                                'border-b border-gray-100 px-2 py-2 text-center ' +
                                (clickable
                                  ? 'cursor-pointer hover:bg-indigo-50'
                                  : '')
                              }
                              onClick={() => {
                                if (!clickable) return;
                                setCell({
                                  studentId: s.id,
                                  assignmentId: a.id,
                                  studentName: s.display_name,
                                  assignmentTitle: a.title,
                                });
                              }}
                            >
                              <span
                                className={'font-medium ' + pctCellClass(pct)}
                              >
                                {fmtPct(pct)}
                              </span>
                            </td>
                          );
                        })}
                        <td
                          className="sticky right-0 z-10 bg-inherit border-b border-l border-gray-100 px-3 py-2 text-center cursor-pointer hover:bg-indigo-50"
                          onClick={() => setOverrideFor(s)}
                          title={tooltip}
                        >
                          <div className="flex flex-col items-center gap-0.5">
                            {effective != null ? (
                              <>
                                <span
                                  className={
                                    'font-semibold ' +
                                    pctCellClass(effective)
                                  }
                                >
                                  {effective}%
                                  {s.final_letter && (
                                    <span className="ml-1 text-xs">
                                      {s.final_letter}
                                    </span>
                                  )}
                                </span>
                                <div className="flex items-center gap-1">
                                  {s.pass_fail === 'pass' && (
                                    <span className="text-[10px] px-1 py-0.5 rounded bg-green-100 text-green-800">
                                      PASS
                                    </span>
                                  )}
                                  {s.pass_fail === 'fail' && (
                                    <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-800">
                                      FAIL
                                    </span>
                                  )}
                                  {hasOverride && (
                                    <span
                                      className="text-[10px] px-1 py-0.5 rounded bg-purple-100 text-purple-800"
                                      title={
                                        s.override_comment ||
                                        'Adjusted by teacher'
                                      }
                                    >
                                      OVR
                                    </span>
                                  )}
                                </div>
                              </>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-100 font-semibold">
                    <td
                      className="sticky left-0 z-10 bg-gray-100 border-t border-r border-gray-200 px-3 py-2 text-gray-700 whitespace-nowrap"
                      style={{ minWidth: '14rem' }}
                    >
                      Class average
                    </td>
                    {gradebook.assignments.map((a) => {
                      if (a.is_attendance) {
                        const avg = computeAttendanceAverage(a.id);
                        return (
                          <td
                            key={a.id}
                            className="border-t border-gray-200 px-2 py-2 text-center text-gray-700"
                          >
                            {avg.max != null
                              ? `${fmtPoints(avg.earned)} / ${fmtPoints(avg.max)}`
                              : '—'}
                          </td>
                        );
                      }
                      return (
                        <td
                          key={a.id}
                          className="border-t border-gray-200 px-2 py-2 text-center text-gray-700"
                        >
                          {a.class_average_pct != null
                            ? `${a.class_average_pct}%`
                            : '—'}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 bg-gray-100 border-t border-l border-gray-200 px-3 py-2 text-center text-gray-800">
                      {gradebook.class_rolling_grade != null
                        ? `${gradebook.class_rolling_grade}%`
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {hasAssignments && hasStudents && (
          <p className="text-xs text-gray-500 mt-3">
            A dash (—) means no submission yet. Assignments count toward the
            rolling grade once they are published and their due date has passed.
            Attendance shows raw points earned out of points marked so far;
            sessions not yet marked are not counted in either.
            {hasBands && !hasThreshold && <> Letters come from the class's bands. </>}
            {!hasBands && hasThreshold && (
              <> Pass/fail uses the class threshold; no letters are set. </>
            )}
            {hasBands && hasThreshold && (
              <> Letters and pass/fail come from the class's grade scale. </>
            )}
            {!hasBands && !hasThreshold && (
              <>
                {' '}
                Set a pass mark and letter bands in{' '}
                <Link
                  to={`/classes/${classId}/grade-setup`}
                  className="text-indigo-600 hover:text-indigo-500 underline"
                >
                  Grade setup
                </Link>{' '}
                to see letters and pass/fail.
              </>
            )}{' '}
            Click a Rolling grade cell to adjust the grade for one student. The
            calculated value stays in place behind the adjustment.
          </p>
        )}
      </div>

      {cell && (
        <CellDetailPanel
          studentId={cell.studentId}
          assignmentId={cell.assignmentId}
          studentName={cell.studentName}
          assignmentTitle={cell.assignmentTitle}
          onClose={() => setCell(null)}
        />
      )}

      {overrideFor && (
        <OverrideModal
          student={overrideFor}
          classId={classId}
          onClose={() => setOverrideFor(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}