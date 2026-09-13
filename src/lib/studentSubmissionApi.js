// src/lib/studentSubmissionApi.js
import { supabase } from './supabaseClient';

// Find the logged-in student's latest submission for a specific
// (lesson, assignment, item) triple.
export async function findMySubmission({ lessonId, assignmentId, assignmentItemId }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let query = supabase
    .from('submissions')
    .select('*')
    .eq('student_id', user.id)
    .eq('lesson_id', lessonId);

  if (assignmentItemId) {
    query = query.eq('assignment_item_id', assignmentItemId);
  } else if (assignmentId) {
    query = query.eq('assignment_id', assignmentId);
  } else {
    query = query.is('assignment_id', null);
  }

  const { data, error } = await query
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data;
}

// Create a new submission for the logged-in student.
export async function createMySubmission({
  lessonId,
  assignmentId,
  assignmentItemId,
  displayName,
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in');

  // Determine next attempt number for this exact context.
  let attemptQuery = supabase
    .from('submissions')
    .select('attempt_number')
    .eq('lesson_id', lessonId)
    .eq('student_id', user.id);

  if (assignmentItemId) {
    attemptQuery = attemptQuery.eq('assignment_item_id', assignmentItemId);
  } else if (assignmentId) {
    attemptQuery = attemptQuery.eq('assignment_id', assignmentId);
  } else {
    attemptQuery = attemptQuery.is('assignment_id', null);
  }

  const { data: lastAttempt, error: qErr } = await attemptQuery
    .order('attempt_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (qErr && qErr.code !== 'PGRST116') throw qErr;
  const nextAttempt = (lastAttempt?.attempt_number || 0) + 1;

  const { data, error } = await supabase
    .from('submissions')
    .insert({
      lesson_id: lessonId,
      assignment_id: assignmentId || null,
      assignment_item_id: assignmentItemId || null,
      student_id: user.id,
      student_identifier: displayName,
      attempt_number: nextAttempt,
      status: 'in_progress',
      current_page: 0,
      answers: {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMySubmission(id, patch) {
  const { data, error } = await supabase
    .from('submissions')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// For the student dashboard: for each assignment, return the
// student's progress across its lesson items.
//
// Returns:
//   {
//     [assignment_id]: {
//       totalLessonItems,   // number of lesson items in the assignment
//       completedItems,     // number of lesson items with a completed submission
//       startedItems,       // number with any submission (in_progress or completed)
//       latestSubmission,   // the most recent submission across all items
//     }
//   }
export async function getMyAssignmentProgress(assignmentIds) {
  if (!assignmentIds || assignmentIds.length === 0) return {};
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};

  const [itemsRes, subsRes] = await Promise.all([
    supabase
      .from('assignment_items')
      .select('id, assignment_id, type')
      .in('assignment_id', assignmentIds),
    supabase
      .from('submissions')
      .select(
        'id, assignment_id, assignment_item_id, status, score, max_auto_score, attempt_number, submitted_at, created_at'
      )
      .eq('student_id', user.id)
      .in('assignment_id', assignmentIds),
  ]);

  if (itemsRes.error) throw itemsRes.error;
  if (subsRes.error) throw subsRes.error;

  const items = itemsRes.data || [];
  const subs = subsRes.data || [];

  const out = {};
  for (const id of assignmentIds) {
    out[id] = {
      totalLessonItems: 0,
      completedItems: 0,
      startedItems: 0,
      latestSubmission: null,
    };
  }

  for (const it of items) {
    const bucket = out[it.assignment_id];
    if (!bucket) continue;
    if (it.type === 'lesson') bucket.totalLessonItems += 1;
  }

  // Only the latest attempt per item counts.
  const latestByItem = {};
  for (const s of subs) {
    const key = s.assignment_item_id || `legacy_${s.assignment_id}`;
    const existing = latestByItem[key];
    if (!existing || (s.attempt_number || 0) > (existing.attempt_number || 0)) {
      latestByItem[key] = s;
    }
  }

  for (const key of Object.keys(latestByItem)) {
    const s = latestByItem[key];
    const bucket = out[s.assignment_id];
    if (!bucket) continue;
    bucket.startedItems += 1;
    if (s.status === 'completed') bucket.completedItems += 1;
    const stamp = s.submitted_at || s.created_at || 0;
    if (
      !bucket.latestSubmission ||
      new Date(stamp) > new Date(bucket.latestSubmission.submitted_at || bucket.latestSubmission.created_at || 0)
    ) {
      bucket.latestSubmission = s;
    }
  }

  return out;
}

// For the assignment detail page: return the student's status for
// each item in one assignment.
//   Map of item_id -> { status, score, max_auto_score, attempt_number }
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
    if (!existing || (row.attempt_number || 0) > (existing.attempt_number || 0)) {
      map[row.assignment_item_id] = row;
    }
  }
  return map;
}