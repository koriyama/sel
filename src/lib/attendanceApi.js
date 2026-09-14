// src/lib/attendanceApi.js
import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------
// Default points for a status, given the class settings.
// This is what gets stored when a record is first created. It can be
// overridden per record by the teacher later.
// ---------------------------------------------------------------------
export function defaultPointsForStatus(status, settings) {
  const per = Number(settings?.attendance_points_per_session ?? 1);
  const latePenalty = Number(settings?.attendance_late_penalty ?? 0);
  switch (status) {
    case 'present': return per;
    case 'late':    return Math.max(0, per - latePenalty);
    case 'absent':  return 0;
    case 'excused': return 0;
    default:        return 0;
  }
}

// ---------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------

export async function listAttendanceSessions(classId) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('id, class_id, session_date, session_time, label, notes, position, created_at, updated_at')
    .eq('class_id', classId)
    .order('session_date', { ascending: true })
    .order('position', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createAttendanceSession(classId, { sessionDate, sessionTime, label, notes, position }) {
  const row = {
    class_id: classId,
    session_date: sessionDate,
    session_time: sessionTime || null,
    label: label || null,
    notes: notes || null,
    position: typeof position === 'number' ? position : 0,
  };
  const { data, error } = await supabase
    .from('attendance_sessions')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Bulk create. Callers pass an array from parseAttendanceCsv.
// Duplicates on (class_id, session_date, session_time) are skipped via
// the unique index; we catch the conflict and retry row by row.
export async function createAttendanceSessionsBulk(classId, sessions) {
  if (!sessions || sessions.length === 0) return { created: [], skipped: [] };

  const rows = sessions.map((s, i) => ({
    class_id: classId,
    session_date: s.sessionDate,
    session_time: s.sessionTime || null,
    label: s.label || null,
    notes: s.notes || null,
    position: s.position ?? i,
  }));

  const { data, error } = await supabase
    .from('attendance_sessions')
    .insert(rows)
    .select();
  if (!error) {
    return { created: data || [], skipped: [] };
  }

  // Fallback: insert one at a time so we can report which rows were
  // duplicates and which succeeded.
  const created = [];
  const skipped = [];
  for (const row of rows) {
    const { data, error: rowErr } = await supabase
      .from('attendance_sessions')
      .insert(row)
      .select()
      .single();
    if (rowErr) {
      if (rowErr.code === '23505') {
        skipped.push(row);
      } else {
        throw rowErr;
      }
    } else {
      created.push(data);
    }
  }
  return { created, skipped };
}

export async function updateAttendanceSession(sessionId, patch) {
  const clean = { ...patch, updated_at: new Date().toISOString() };
  if (clean.session_time === undefined) clean.session_time = null;
  if (clean.label === undefined) clean.label = null;
  if (clean.notes === undefined) clean.notes = null;
  const { data, error } = await supabase
    .from('attendance_sessions')
    .update(clean)
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAttendanceSession(sessionId) {
  const { error } = await supabase
    .from('attendance_sessions')
    .delete()
    .eq('id', sessionId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------

export async function listRecordsForSession(sessionId) {
  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, session_id, student_id, status, points_awarded, note, marked_at, marked_by')
    .eq('session_id', sessionId);
  if (error) throw error;
  return data || [];
}

export async function listRecordsForClass(classId) {
  const { data: sessions, error: sErr } = await supabase
    .from('attendance_sessions')
    .select('id')
    .eq('class_id', classId);
  if (sErr) throw sErr;
  const sessionIds = (sessions || []).map((s) => s.id);
  if (sessionIds.length === 0) return [];
  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, session_id, student_id, status, points_awarded, note, marked_at, marked_by')
    .in('session_id', sessionIds);
  if (error) throw error;
  return data || [];
}

export async function listRecordsForStudent(classId, studentId) {
  const { data: sessions, error: sErr } = await supabase
    .from('attendance_sessions')
    .select('id, session_date, session_time, label')
    .eq('class_id', classId)
    .order('session_date', { ascending: true });
  if (sErr) throw sErr;
  const sessionIds = (sessions || []).map((s) => s.id);
  if (sessionIds.length === 0) return { sessions: [], records: [] };

  const { data, error } = await supabase
    .from('attendance_records')
    .select('id, session_id, student_id, status, points_awarded, note, marked_at, marked_by')
    .in('session_id', sessionIds)
    .eq('student_id', studentId);
  if (error) throw error;
  return { sessions: sessions || [], records: data || [] };
}

export async function saveAttendanceRecord({
  sessionId,
  studentId,
  status,
  pointsAwarded,
  note,
  markedBy,
}) {
  if (!sessionId || !studentId) throw new Error('sessionId and studentId are required.');
  const payload = {
    session_id: sessionId,
    student_id: studentId,
    status,
    points_awarded: pointsAwarded,
    note: note || null,
    marked_at: new Date().toISOString(),
    marked_by: markedBy || null,
  };
  const { data: existing, error: findErr } = await supabase
    .from('attendance_records')
    .select('id')
    .eq('session_id', sessionId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const { data, error } = await supabase
      .from('attendance_records')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('attendance_records')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Bulk save for one session. rows is [{ studentId, status, pointsAwarded?, note? }]
export async function saveAttendanceRecordsBulk(sessionId, rows, settings, markedBy) {
  if (!sessionId) throw new Error('sessionId is required.');
  if (!rows || rows.length === 0) return [];

  const { data: existing, error: fetchErr } = await supabase
    .from('attendance_records')
    .select('id, student_id')
    .eq('session_id', sessionId);
  if (fetchErr) throw fetchErr;

  const existingByStudent = {};
  for (const r of existing || []) existingByStudent[r.student_id] = r.id;

  const now = new Date().toISOString();
  const updates = [];
  const inserts = [];
  for (const row of rows) {
    const points =
      row.pointsAwarded != null
        ? row.pointsAwarded
        : defaultPointsForStatus(row.status, settings);
    const payload = {
      session_id: sessionId,
      student_id: row.studentId,
      status: row.status,
      points_awarded: points,
      note: row.note || null,
      marked_at: now,
      marked_by: markedBy || null,
    };
    if (existingByStudent[row.studentId]) {
      updates.push({ ...payload, id: existingByStudent[row.studentId] });
    } else {
      inserts.push(payload);
    }
  }

  const saved = [];
  if (updates.length > 0) {
    const { data, error } = await supabase
      .from('attendance_records')
      .upsert(updates)
      .select();
    if (error) throw error;
    saved.push(...(data || []));
  }
  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from('attendance_records')
      .insert(inserts)
      .select();
    if (error) throw error;
    saved.push(...(data || []));
  }
  return saved;
}

export async function deleteAttendanceRecord(sessionId, studentId) {
  const { error } = await supabase
    .from('attendance_records')
    .delete()
    .eq('session_id', sessionId)
    .eq('student_id', studentId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Class-level settings (columns on classes)
// ---------------------------------------------------------------------

export async function getClassAttendanceSettings(classId) {
  const { data, error } = await supabase
    .from('classes')
    .select('id, attendance_points_per_session, attendance_late_penalty, attendance_default_time, attendance_category_id')
    .eq('id', classId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateClassAttendanceSettings(classId, patch) {
  const clean = {};
  if (patch.attendance_points_per_session !== undefined)
    clean.attendance_points_per_session = patch.attendance_points_per_session;
  if (patch.attendance_late_penalty !== undefined)
    clean.attendance_late_penalty = patch.attendance_late_penalty;
  if (patch.attendance_default_time !== undefined)
    clean.attendance_default_time = patch.attendance_default_time;
  if (patch.attendance_category_id !== undefined)
    clean.attendance_category_id = patch.attendance_category_id;
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from('classes')
    .update(clean)
    .eq('id', classId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// CSV parsing
//
// Lenient. Accepts:
//   - Date shapes: YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY
//     (disambiguated by which part exceeds 12), YYYY年M月D日.
//   - Headers in English or Japanese: date/日付, time/period/時限,
//     label/title/内容, notes/メモ.
//   - Headerless CSVs: first column is taken as the date.
//
// Returns { rows: [{ sessionDate, sessionTime, label, notes }], errors: [] }
// ---------------------------------------------------------------------
export function parseAttendanceCsv(text) {
  if (!text) return { rows: [], errors: [] };
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], errors: [] };

  const splitCsvLine = (line) => {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { out.push(cur); cur = ''; }
        else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const first = splitCsvLine(lines[0]).map((h) => h.toLowerCase());

  const dateAliases = ['date', 'day', '日付', '年月日'];
  const timeAliases = ['time', 'period', '時限', '時間', '開始'];
  const labelAliases = ['label', 'title', 'topic', 'name', '内容', 'タイトル', 'テーマ'];
  const notesAliases = ['notes', 'note', 'memo', 'メモ', '備考'];

  const findCol = (aliases) => {
    for (let i = 0; i < first.length; i++) {
      const h = first[i];
      if (aliases.some((a) => h === a || h.includes(a))) return i;
    }
    return -1;
  };

  const dateIdx = findCol(dateAliases);
  const timeIdx = findCol(timeAliases);
  const labelIdx = findCol(labelAliases);
  const notesIdx = findCol(notesAliases);
  const headerDetected = dateIdx >= 0;

  const parseDate = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const y = m[3];
      let mo, d;
      if (a > 12) { d = String(a); mo = String(b); }
      else { mo = String(a); d = String(b); }
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const y = dt.getFullYear();
      const mo = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${mo}-${d}`;
    }
    return null;
  };

  const rows = [];
  const errors = [];
  const startLine = headerDetected ? 1 : 0;

  for (let i = startLine; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length === 0 || (cols.length === 1 && !cols[0])) continue;

    let dateRaw, timeRaw, labelRaw, notesRaw;
    if (headerDetected) {
      dateRaw = cols[dateIdx];
      timeRaw = timeIdx >= 0 ? cols[timeIdx] : '';
      labelRaw = labelIdx >= 0 ? cols[labelIdx] : '';
      notesRaw = notesIdx >= 0 ? cols[notesIdx] : '';
    } else {
      dateRaw = cols[0];
      timeRaw = '';
      labelRaw = cols.slice(1).filter(Boolean).join(' ').trim();
      notesRaw = '';
    }

    const date = parseDate(dateRaw);
    if (!date) {
      errors.push(`Line ${i + 1}: could not read a date from "${dateRaw}".`);
      continue;
    }
    rows.push({
      sessionDate: date,
      sessionTime: timeRaw || null,
      label: labelRaw || null,
      notes: notesRaw || null,
    });
  }

  return { rows, errors };
}