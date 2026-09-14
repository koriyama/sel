// src/pages/TeacherAttendance.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useConfirm } from '../context/ConfirmContext';
import { getClassById } from '../lib/lmsApi';
import { supabase } from '../lib/supabaseClient';
import {
  listAttendanceSessions,
  createAttendanceSession,
  createAttendanceSessionsBulk,
  deleteAttendanceSession,
  saveAttendanceRecordsBulk,
  defaultPointsForStatus,
  parseAttendanceCsv,
} from '../lib/attendanceApi';

const STATUS_OPTIONS = [
  { value: 'present', label: 'Present' },
  { value: 'late',    label: 'Late' },
  { value: 'absent',  label: 'Absent' },
  { value: 'excused', label: 'Excused' },
];

function statusActiveClass(status) {
  switch (status) {
    case 'present': return 'bg-green-600 text-white border-green-600';
    case 'late':    return 'bg-amber-500 text-white border-amber-500';
    case 'absent':  return 'bg-red-600 text-white border-red-600';
    case 'excused': return 'bg-blue-600 text-white border-blue-600';
    default:        return 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100';
  }
}

function statusTextClass(status) {
  switch (status) {
    case 'present': return 'text-green-700';
    case 'late':    return 'text-amber-700';
    case 'absent':  return 'text-red-700';
    case 'excused': return 'text-blue-700';
    default:        return 'text-gray-400';
  }
}

function fmtDate(iso) {
  if (!iso) return '';
  // iso is YYYY-MM-DD; show as-is, no TZ conversion.
  return iso;
}

export default function TeacherAttendance() {
  const { id: classId } = useParams();
  const { confirm } = useConfirm();

  const [cls, setCls] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [students, setStudents] = useState([]);
  const [recordsBySession, setRecordsBySession] = useState({});
  const [draftsBySession, setDraftsBySession] = useState({});
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importErrors, setImportErrors] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, sess] = await Promise.all([
        getClassById(classId),
        listAttendanceSessions(classId),
      ]);
      setCls(c);
      setSessions(sess);

      const { data: members, error: memErr } = await supabase
        .from('class_members')
        .select('student_id, student:profiles(id, institutional_id, display_name)')
        .eq('class_id', classId)
        .order('enrolled_at', { ascending: true });
      if (memErr) throw memErr;
      const studs = (members || []).map((m) => m.student).filter(Boolean);
      studs.sort((a, b) =>
        (a.display_name || '').localeCompare(b.display_name || '')
      );
      setStudents(studs);

      let grouped = {};
      if (sess.length > 0) {
        const { data: recs, error: recErr } = await supabase
          .from('attendance_records')
          .select('id, session_id, student_id, status, points_awarded')
          .in('session_id', sess.map((s) => s.id));
        if (recErr) throw recErr;
        for (const r of recs || []) {
          if (!grouped[r.session_id]) grouped[r.session_id] = {};
          grouped[r.session_id][r.student_id] = r;
        }
      }
      setRecordsBySession(grouped);

      const drafts = {};
      for (const s of sess) {
        drafts[s.id] = {};
        for (const stud of studs) {
          const r = grouped[s.id]?.[stud.id];
          drafts[s.id][stud.id] = r
            ? { status: r.status, points: String(r.points_awarded) }
            : { status: null, points: '' };
        }
      }
      setDraftsBySession(drafts);

      setSelectedSessionId((prev) => {
        if (prev && sess.some((s) => s.id === prev)) return prev;
        return sess.length > 0 ? sess[0].id : null;
      });
    } catch (err) {
      console.error(err);
      toast.error('Could not load attendance.');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) || null;
  const selectedDraft = selectedSessionId ? (draftsBySession[selectedSessionId] || {}) : {};

  const setDraft = (studentId, patch) => {
    if (!selectedSessionId) return;
    setDraftsBySession((prev) => ({
      ...prev,
      [selectedSessionId]: {
        ...(prev[selectedSessionId] || {}),
        [studentId]: {
          ...((prev[selectedSessionId] || {})[studentId] || {}),
          ...patch,
        },
      },
    }));
  };

  const setStatusFor = (studentId, status) => {
    const points = defaultPointsForStatus(status, cls);
    setDraft(studentId, { status, points: String(points) });
  };

  const handleMarkAll = (status) => {
    if (!selectedSessionId) return;
    const points = String(defaultPointsForStatus(status, cls));
    const next = {};
    for (const stud of students) {
      next[stud.id] = { status, points };
    }
    setDraftsBySession((prev) => ({
      ...prev,
      [selectedSessionId]: next,
    }));
  };

  const handleClearAll = () => {
    if (!selectedSessionId) return;
    const next = {};
    for (const stud of students) {
      next[stud.id] = { status: null, points: '' };
    }
    setDraftsBySession((prev) => ({
      ...prev,
      [selectedSessionId]: next,
    }));
  };

  const handleSave = async () => {
    if (!selectedSessionId) return;
    const rows = [];
    for (const stud of students) {
      const d = selectedDraft[stud.id];
      if (!d || !d.status) continue;
      const pts =
        d.points === '' || d.points == null
          ? defaultPointsForStatus(d.status, cls)
          : Number(d.points);
      if (!Number.isFinite(pts)) {
        toast.error(`${stud.display_name}: points must be a number.`);
        return;
      }
      rows.push({ studentId: stud.id, status: d.status, pointsAwarded: pts });
    }
    if (rows.length === 0) {
      toast('Nothing to save. Click Present, Late, Absent, or Excused for at least one student.');
      return;
    }
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await saveAttendanceRecordsBulk(selectedSessionId, rows, cls, user?.id);
      toast.success(
        `Saved marks for ${rows.length} student${rows.length === 1 ? '' : 's'}.`
      );
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save marks.');
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAdd = () => {
    setNewDate(new Date().toISOString().slice(0, 10));
    setNewTime(cls?.attendance_default_time || '');
    setNewLabel('');
    setShowAddForm(true);
  };

  const handleAddSession = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newDate) {
      toast.error('Please pick a date.');
      return;
    }
    setSaving(true);
    try {
      await createAttendanceSession(classId, {
        sessionDate: newDate,
        sessionTime: newTime.trim() || cls?.attendance_default_time || null,
        label: newLabel.trim() || null,
        position: sessions.length,
      });
      toast.success('Session added.');
      setShowAddForm(false);
      setNewDate('');
      setNewTime('');
      setNewLabel('');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not add session.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSession = async (session) => {
    const ok = await confirm({
      title: 'Delete session',
      message: `Delete the session on ${fmtDate(session.session_date)}${
        session.label ? ` (${session.label})` : ''
      }? Any marks recorded for it will also be deleted.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger',
    });
    if (!ok) return;
    try {
      await deleteAttendanceSession(session.id);
      toast.success('Session deleted.');
      if (selectedSessionId === session.id) setSelectedSessionId(null);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not delete session.');
    }
  };

  const handleCsvFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const { rows, errors } = parseAttendanceCsv(text);
        const rowsWithTime = rows.map((r) => ({
          ...r,
          sessionTime: r.sessionTime || cls?.attendance_default_time || null,
        }));
        setImportRows(rowsWithTime);
        setImportErrors(errors);
      } catch (err) {
        console.error(err);
        toast.error('Could not read that file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleImportConfirm = async () => {
    if (importRows.length === 0) return;
    setSaving(true);
    try {
      const result = await createAttendanceSessionsBulk(classId, importRows);
      const created = result.created.length;
      const skipped = result.skipped.length;
      const parts = [
        `Imported ${created} session${created === 1 ? '' : 's'}`,
      ];
      if (skipped > 0) {
        parts.push(`skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`);
      }
      toast.success(parts.join(' · ') + '.');
      setShowImport(false);
      setImportRows([]);
      setImportErrors([]);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not import sessions.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  const totalStudents = students.length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto p-6">
        <div className="mb-4">
          <Link
            to={`/classes/${classId}`}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← Back to {cls?.name || 'class'}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Attendance</h1>
          <p className="text-sm text-gray-600 mt-1">
            {cls?.name ? `${cls.name} · ` : ''}
            Mark each student for a session. {cls?.attendance_points_per_session ?? 1} point
            {Number(cls?.attendance_points_per_session ?? 1) === 1 ? '' : 's'} per
            session. Late costs {cls?.attendance_late_penalty ?? 0}.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4">
          {/* Sessions panel */}
          <aside className="bg-white rounded-lg shadow">
            <div className="p-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-sm">
                Sessions ({sessions.length})
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  disabled={showAddForm}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
                >
                  + Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setImportRows([]);
                    setImportErrors([]);
                    setShowImport(true);
                  }}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
                >
                  Import
                </button>
              </div>
            </div>

            {showAddForm && (
              <form
                onSubmit={handleAddSession}
                className="p-3 border-b border-gray-100 bg-gray-50 space-y-2"
              >
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-0.5">
                    Date
                  </label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-0.5">
                    Time
                  </label>
                  <input
                    type="text"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                    placeholder="e.g. 14:00-15:30"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-0.5">
                    Label (optional)
                  </label>
                  <input
                    type="text"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="e.g. Unit 3"
                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="text-xs px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </form>
            )}

            {sessions.length === 0 && !showAddForm && (
              <p className="p-4 text-sm text-gray-500">
                No sessions yet. Click <strong>+ Add</strong> to create one, or
                <strong> Import</strong> to load a CSV of dates.
              </p>
            )}

            <ul className="divide-y divide-gray-100 max-h-[32rem] overflow-auto">
              {sessions.map((s) => {
                const marked = Object.keys(recordsBySession[s.id] || {}).length;
                const selected = s.id === selectedSessionId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedSessionId(s.id)}
                      className={
                        'w-full text-left px-3 py-2 flex items-center justify-between gap-2 ' +
                        (selected ? 'bg-indigo-50' : 'hover:bg-gray-50')
                      }
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {fmtDate(s.session_date)}
                          {s.session_time ? ` · ${s.session_time}` : ''}
                        </div>
                        {s.label && (
                          <div className="text-xs text-gray-500 truncate">
                            {s.label}
                          </div>
                        )}
                      </div>
                      <span
                        className={
                          'text-[10px] px-1.5 py-0.5 rounded-full ' +
                          (marked === 0
                            ? 'bg-gray-100 text-gray-600'
                            : marked === totalStudents
                            ? 'bg-green-100 text-green-800'
                            : 'bg-amber-100 text-amber-800')
                        }
                      >
                        {marked}/{totalStudents}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Marking panel */}
          <section className="bg-white rounded-lg shadow">
            {!selectedSession && (
              <div className="p-8 text-center text-gray-500">
                {sessions.length === 0
                  ? 'Create a session on the left to start marking.'
                  : 'Pick a session on the left.'}
              </div>
            )}

            {selectedSession && (
              <>
                <div className="p-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">
                      {fmtDate(selectedSession.session_date)}
                      {selectedSession.session_time
                        ? ` · ${selectedSession.session_time}`
                        : ''}
                    </div>
                    {selectedSession.label && (
                      <div className="text-xs text-gray-500">
                        {selectedSession.label}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleMarkAll('present')}
                      className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
                    >
                      Mark all present
                    </button>
                    <button
                      type="button"
                      onClick={handleClearAll}
                      className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
                    >
                      Clear all
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteSession(selectedSession)}
                      className="text-xs px-2 py-1 text-red-600 hover:text-red-800 border border-red-200 rounded-md"
                    >
                      Delete session
                    </button>
                  </div>
                </div>

                {totalStudents === 0 && (
                  <div className="p-6 text-center text-gray-500 text-sm">
                    No students enrolled in this class yet.
                  </div>
                )}

                {totalStudents > 0 && (
                  <>
                    <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-500">
                      Set a status for each student. Points default from the class
                      settings; edit any value if you want to award something
                      different.
                    </div>
                    <ul className="divide-y divide-gray-100 max-h-[36rem] overflow-auto">
                      {students.map((stud) => {
                        const d = selectedDraft[stud.id] || { status: null, points: '' };
                        return (
                          <li
                            key={stud.id}
                            className="px-3 py-2 flex items-center gap-2 flex-wrap"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {stud.display_name}
                              </div>
                              {stud.institutional_id && (
                                <div className="text-[11px] text-gray-500">
                                  {stud.institutional_id}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              {STATUS_OPTIONS.map((opt) => {
                                const active = d.status === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setStatusFor(stud.id, opt.value)}
                                    className={
                                      'text-[11px] px-2 py-0.5 rounded border ' +
                                      statusActiveClass(active ? opt.value : null)
                                    }
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                value={d.points}
                                onChange={(e) =>
                                  setDraft(stud.id, { points: e.target.value })
                                }
                                className="w-16 px-2 py-0.5 border border-gray-300 rounded text-xs text-right"
                              />
                              <span className="text-[11px] text-gray-500">pts</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="px-3 py-3 border-t border-gray-100 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {saving ? 'Saving…' : 'Save marks'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {/* CSV import modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] overflow-auto">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Import sessions from CSV</h3>
              <button
                type="button"
                onClick={() => {
                  setShowImport(false);
                  setImportRows([]);
                  setImportErrors([]);
                }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-600">
                Expected columns: <code>date</code>, optional <code>time</code>,{' '}
                optional <code>label</code>. Dates may be YYYY-MM-DD, YYYY/MM/DD,
                or YYYY年M月D日. Time falls back to the class default time
                {cls?.attendance_default_time
                  ? ` (currently "${cls.attendance_default_time}")`
                  : ' (not set — leave blank or set one in Grade setup)'}.
              </p>

              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFile}
                className="text-sm"
              />

              {importErrors.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                  <div className="font-medium mb-1">
                    {importErrors.length} row{importErrors.length === 1 ? '' : 's'} could
                    not be read:
                  </div>
                  <ul className="list-disc list-inside">
                    {importErrors.slice(0, 5).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {importErrors.length > 5 && (
                      <li>…and {importErrors.length - 5} more.</li>
                    )}
                  </ul>
                </div>
              )}

              {importRows.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-700 mb-1">
                    {importRows.length} session{importRows.length === 1 ? '' : 's'} ready
                    to import:
                  </div>
                  <ul className="border border-gray-200 rounded max-h-48 overflow-auto divide-y divide-gray-100 text-xs">
                    {importRows.slice(0, 50).map((r, i) => (
                      <li key={i} className="px-2 py-1 flex justify-between gap-2">
                        <span className="font-medium">{r.sessionDate}</span>
                        <span className="text-gray-500 truncate">
                          {r.sessionTime || '—'}
                          {r.label ? ` · ${r.label}` : ''}
                        </span>
                      </li>
                    ))}
                    {importRows.length > 50 && (
                      <li className="px-2 py-1 text-gray-500">
                        …and {importRows.length - 50} more.
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowImport(false);
                  setImportRows([]);
                  setImportErrors([]);
                }}
                className="px-3 py-1.5 text-sm text-gray-700 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportConfirm}
                disabled={saving || importRows.length === 0}
                className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving
                  ? 'Importing…'
                  : `Import ${importRows.length || ''} session${
                      importRows.length === 1 ? '' : 's'
                    }`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}