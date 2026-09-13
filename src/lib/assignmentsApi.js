// src/lib/assignmentsApi.js
import { supabase } from './supabaseClient';
import { duplicateLesson } from './api';

// ---------- helpers ----------
export function formatJst(iso, opts = {}) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...opts,
    });
  } catch {
    return iso;
  }
}

export function jstLocalInputToIso(localValue) {
  if (!localValue) return null;
  const [datePart, timePart] = localValue.split('T');
  if (!datePart || !timePart) return null;
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0);
  return new Date(utcMs).toISOString();
}

export function isoToJstLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
    `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
  );
}

function stripCopySuffix(title) {
  if (!title) return title;
  return title.replace(/\s*\(copy\)\s*$/i, '');
}

export function stripHtml(html) {
  if (!html) return '';
  return String(html).replace(/<[^>]*>/g, '').trim();
}

// ---------- library reads ----------

export async function listMyLibraryLessons() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in');
  const { data, error } = await supabase
    .from('lessons')
    .select('id, title, level, status, created_at')
    .eq('user_id', user.id)
    .is('class_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------- class reads ----------

export async function listAssignmentsForClass(classId) {
  const { data, error } = await supabase
    .from('assignments')
    .select('id, title, status, start_at, due_at, created_at, position')
    .eq('class_id', classId)
    .order('position', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listClassLessonCopies(classId) {
  const { data, error } = await supabase
    .from('lessons')
    .select('id, title, level, status, share_slug, created_at')
    .eq('class_id', classId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------- assignment reads ----------

export async function getAssignmentById(id) {
  const { data, error } = await supabase
    .from('assignments')
    .select('*, class:classes(id, name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listAssignmentItems(assignmentId) {
  const { data, error } = await supabase
    .from('assignment_items')
    .select(
      'id, assignment_id, position, type, title, body, lesson_id, is_optional, created_at, lesson:lessons(id, title, share_slug, level, status)'
    )
    .eq('assignment_id', assignmentId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map((item) => ({
    ...item,
    lesson: item.lesson
      ? { ...item.lesson, title: stripCopySuffix(item.lesson.title) }
      : null,
  }));
}

export async function getAssignmentItemById(itemId) {
  const { data, error } = await supabase
    .from('assignment_items')
    .select(
      'id, assignment_id, position, type, title, body, lesson_id, lesson:lessons(id, title, share_slug, level, status)'
    )
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listAssignmentsForStudent() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: memberships, error: memErr } = await supabase
    .from('class_members')
    .select('class_id')
    .eq('student_id', user.id);
  if (memErr) throw memErr;
  const classIds = (memberships || []).map((m) => m.class_id);
  if (classIds.length === 0) return [];

  const { data, error } = await supabase
    .from('assignments')
    .select(
      'id, title, status, start_at, due_at, created_at, class_id, class:classes(id, name)'
    )
    .in('class_id', classIds)
    .eq('status', 'published')
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

// ---------- assignment writes ----------

export async function renameClass(classId, newName) {
  if (!newName || !newName.trim()) throw new Error('Name cannot be empty');
  const { data, error } = await supabase
    .from('classes')
    .update({ name: newName.trim(), updated_at: new Date().toISOString() })
    .eq('id', classId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function createBareAssignment({
  classId,
  title,
  instructions,
  startAt,
  dueAt,
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in');

  // Find highest existing position in this class.
  const { data: topRows } = await supabase
    .from('assignments')
    .select('position')
    .eq('class_id', classId)
    .order('position', { ascending: false, nullsFirst: false })
    .limit(1);
  const maxPosition = topRows && topRows[0] && topRows[0].position
    ? topRows[0].position
    : 0;
  const nextPosition = maxPosition + 1;

  const { data, error } = await supabase
    .from('assignments')
    .insert({
      class_id: classId,
      teacher_id: user.id,
      title: title.trim(),
      instructions: instructions?.trim() || null,
      start_at: startAt || null,
      due_at: dueAt || null,
      status: 'draft',
      position: nextPosition,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Persist a new order for a list of assignment IDs (top → bottom on screen).
// Internally we store the top row with the highest position.
export async function reorderAssignments(orderedIds) {
  if (!orderedIds || orderedIds.length === 0) return;
  const total = orderedIds.length;
  const updates = orderedIds.map((id, index) =>
    supabase
      .from('assignments')
      .update({
        position: total - index,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
  );
  const results = await Promise.all(updates);
  const firstErr = results.find((r) => r.error);
  if (firstErr) throw firstErr.error;
}

export async function addLessonItem({
  assignmentId,
  classId,
  originalLessonId,
  title,
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in');

  const lessonCopy = await duplicateLesson(originalLessonId, user.id, null);
  const cleanTitle = stripCopySuffix(lessonCopy.title);

  const { error: tagErr } = await supabase
    .from('lessons')
    .update({ class_id: classId, title: cleanTitle })
    .eq('id', lessonCopy.id);
  if (tagErr) {
    await supabase.from('lessons').delete().eq('id', lessonCopy.id);
    throw tagErr;
  }

  const { data: existingItems } = await supabase
    .from('assignment_items')
    .select('position')
    .eq('assignment_id', assignmentId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = existingItems && existingItems[0] ? existingItems[0].position + 1 : 0;

  const itemTitle = (title && title.trim()) || cleanTitle || 'Lesson';

  const { data, error } = await supabase
    .from('assignment_items')
    .insert({
      assignment_id: assignmentId,
      position: nextPos,
      type: 'lesson',
      title: itemTitle,
      lesson_id: lessonCopy.id,
    })
    .select()
    .single();
  if (error) {
    await supabase.from('lessons').delete().eq('id', lessonCopy.id);
    throw error;
  }
  return data;
}

export async function addTextItem({ assignmentId, title, body }) {
  const { data: existingItems } = await supabase
    .from('assignment_items')
    .select('position')
    .eq('assignment_id', assignmentId)
    .order('position', { ascending: false })
    .limit(1);
  const nextPos = existingItems && existingItems[0] ? existingItems[0].position + 1 : 0;

  const { data, error } = await supabase
    .from('assignment_items')
    .insert({
      assignment_id: assignmentId,
      position: nextPos,
      type: 'text',
      title: (title || '').trim() || 'Note',
      body: body || '',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateAssignmentItem(itemId, patch) {
  const { data, error } = await supabase
    .from('assignment_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAssignmentItem(itemId) {
  const { data: item, error: getErr } = await supabase
    .from('assignment_items')
    .select('id, type, lesson_id')
    .eq('id', itemId)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!item) return;

  const { error: delErr } = await supabase
    .from('assignment_items')
    .delete()
    .eq('id', itemId);
  if (delErr) throw delErr;

  if (item.type === 'lesson' && item.lesson_id) {
    const { data: subs } = await supabase
      .from('submissions')
      .select('id')
      .eq('lesson_id', item.lesson_id)
      .limit(1);
    if (!subs || subs.length === 0) {
      await supabase.from('lessons').delete().eq('id', item.lesson_id);
    }
  }
}

export async function reorderAssignmentItems(orderedIds) {
  if (!orderedIds || orderedIds.length === 0) return;
  const updates = orderedIds.map((id, index) =>
    supabase
      .from('assignment_items')
      .update({ position: index, updated_at: new Date().toISOString() })
      .eq('id', id)
  );
  const results = await Promise.all(updates);
  const firstErr = results.find((r) => r.error);
  if (firstErr) throw firstErr.error;
}

export async function updateAssignment(id, patch) {
  const { data, error } = await supabase
    .from('assignments')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function setAssignmentStatus(id, status) {
  const items = await listAssignmentItems(id);
  const lessonStatus = status === 'published' ? 'published' : 'draft';

  const updated = await updateAssignment(id, { status });

  const lessonIds = items
    .filter((it) => it.type === 'lesson' && it.lesson_id)
    .map((it) => it.lesson_id);

  if (lessonIds.length > 0) {
    await supabase
      .from('lessons')
      .update({ status: lessonStatus })
      .in('id', lessonIds);
  }

  return updated;
}

export async function deleteAssignment(id) {
  const items = await listAssignmentItems(id);
  const lessonIds = items
    .filter((it) => it.type === 'lesson' && it.lesson_id)
    .map((it) => it.lesson_id);

  const { error: aErr } = await supabase.from('assignments').delete().eq('id', id);
  if (aErr) throw aErr;

  if (lessonIds.length > 0) {
    for (const lid of lessonIds) {
      const { data: subs } = await supabase
        .from('submissions')
        .select('id')
        .eq('lesson_id', lid)
        .limit(1);
      if (!subs || subs.length === 0) {
        await supabase.from('lessons').delete().eq('id', lid);
      }
    }
  }
}

// ---------- submissions ----------

export async function listSubmissionsForAssignment(assignmentId) {
  const { data: submissions, error } = await supabase
    .from('submissions')
    .select(
      'id, student_id, student_identifier, assignment_item_id, status, score, max_auto_score, submitted_at, attempt_number, created_at'
    )
    .eq('assignment_id', assignmentId)
    .order('submitted_at', { ascending: false, nullsFirst: false });
  if (error) throw error;

  const studentIds = [
    ...new Set((submissions || []).map((s) => s.student_id).filter(Boolean)),
  ];
  const profileMap = {};
  if (studentIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, display_name, institutional_id')
      .in('id', studentIds);
    for (const p of profiles || []) {
      profileMap[p.id] = p;
    }
  }

  return (submissions || []).map((s) => {
    const profile = s.student_id ? profileMap[s.student_id] : null;
    return {
      ...s,
      display_name: profile?.display_name || s.student_identifier || '(unknown)',
      institutional_id: profile?.institutional_id || null,
    };
  });
}

export async function getMySubmissionForAssignment(assignmentId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

export async function getMyItemStatusMap(assignmentId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const { data, error } = await supabase
    .from('submissions')
    .select('assignment_item_id, status, score, max_auto_score, attempt_number')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id);
  if (error) throw error;
  const map = {};
  for (const row of data || []) {
    if (!row.assignment_item_id) continue;
    const existing = map[row.assignment_item_id];
    if (
      !existing ||
      (row.attempt_number || 0) > (existing.attempt_number || 0)
    ) {
      map[row.assignment_item_id] = row;
    }
  }
  return map;
}