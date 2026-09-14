// src/lib/reviewGradesApi.js
//
// Teacher review marks for review-type activities (short_answer, reasoning).
//
// Two shapes, one table:
//   Holistic:     one row per submission, activity_id is null.
//   Per-activity: one row per (submission, activity).
//
// The unique partial indexes on the table enforce "one holistic grade per
// submission" and "one grade per submission+activity". We look up any
// existing row first and decide between insert and update.

import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------

export async function listReviewGradesForSubmission(submissionId) {
  if (!submissionId) return [];
  const { data, error } = await supabase
    .from('review_grades')
    .select('id, submission_id, activity_id, points_earned, points_max, comment, graded_at, graded_by')
    .eq('submission_id', submissionId);
  if (error) throw error;
  return data || [];
}

export async function listReviewGradesForSubmissions(submissionIds) {
  if (!submissionIds || submissionIds.length === 0) return {};
  const { data, error } = await supabase
    .from('review_grades')
    .select('id, submission_id, activity_id, points_earned, points_max, comment, graded_at, graded_by')
    .in('submission_id', submissionIds);
  if (error) throw error;
  const grouped = {};
  for (const row of data || []) {
    if (!grouped[row.submission_id]) grouped[row.submission_id] = [];
    grouped[row.submission_id].push(row);
  }
  return grouped;
}

export async function listReviewGradesForAssignment(assignmentId) {
  if (!assignmentId) return {};
  const { data: subs, error: subErr } = await supabase
    .from('submissions')
    .select('id')
    .eq('assignment_id', assignmentId);
  if (subErr) throw subErr;
  const ids = (subs || []).map((s) => s.id);
  if (ids.length === 0) return {};
  return listReviewGradesForSubmissions(ids);
}

// ---------------------------------------------------------------------
// Totals calculation
// ---------------------------------------------------------------------

export function computeSubmissionTotals({
  submission,
  lesson,
  reviewActivities,
  grades,
}) {
  const autoMax = submission?.max_auto_score || 0;
  const autoPct = submission?.score != null ? Number(submission.score) : null;
  const autoEarned =
    submission?.status === 'completed' && autoMax > 0 && autoPct != null
      ? (autoPct / 100) * autoMax
      : 0;

  let reviewEarned = 0;
  let reviewMax = 0;
  let reviewPending = 0;
  let hasAnyReviewGrade = false;

  const mode = lesson?.review_grading_mode || 'holistic';
  const activities = reviewActivities || [];
  const rows = grades || [];

  if (activities.length > 0 && submission?.status === 'completed') {
    if (mode === 'holistic') {
      const h = rows.find((g) => g.activity_id === null);
      if (h) {
        reviewEarned = Number(h.points_earned);
        reviewMax = Number(h.points_max);
        hasAnyReviewGrade = true;
      } else {
        reviewPending = 1;
      }
    } else {
      const byActivity = {};
      for (const g of rows) {
        if (g.activity_id) byActivity[g.activity_id] = g;
      }
      for (const ra of activities) {
        const g = byActivity[ra.id];
        if (g) {
          reviewEarned += Number(g.points_earned);
          reviewMax += Number(g.points_max);
          hasAnyReviewGrade = true;
        } else {
          reviewPending += 1;
        }
      }
    }
  }

  const totalEarned = autoEarned + reviewEarned;
  const totalMax = autoMax + reviewMax;
  const overallPct = totalMax > 0 ? (totalEarned / totalMax) * 100 : null;

  return {
    auto_pct: autoPct,
    auto_earned: autoEarned,
    auto_max: autoMax,
    review_earned: reviewEarned,
    review_max: reviewMax,
    review_pending: reviewPending,
    has_any_review_grade: hasAnyReviewGrade,
    total_earned: totalEarned,
    total_max: totalMax,
    overall_pct: overallPct,
    is_complete_review_wise: activities.length === 0 || reviewPending === 0,
  };
}

// ---------------------------------------------------------------------
// Student-side bulk summary.
//
// Given the assignment's items and the status map from
// getMyItemStatusMap, return per-item summaries with the review-aware
// totals and any comments the teacher has left.
//
//   items     — the assignment_items rows (need id and lesson_id)
//   statusMap — { [item_id]: { id, status, score, max_auto_score,
//                              attempt_number, answers } }
//
// Returns: { [item_id]: { ...totals, comments: [{activity_id, comment}] } | null }
// ---------------------------------------------------------------------
const AUTO_GRADED_TYPES_FOR_STUDENT = [
  'gap_fill',
  'multiple_choice',
  'gap_fill_dropdown',
  'sentence_jumble',
  'vocabulary_matching',
  'listening',
  'dictation',
];

function isAutoGradedLocal(type) {
  return AUTO_GRADED_TYPES_FOR_STUDENT.includes(type);
}

export async function getReviewSummariesForItems({ items, statusMap }) {
  const out = {};
  const itemList = items || [];
  const map = statusMap || {};

  const lessonIds = [...new Set(itemList.map((i) => i.lesson_id).filter(Boolean))];
  const subIds = Object.values(map).map((s) => s?.id).filter(Boolean);

  if (lessonIds.length === 0) {
    for (const item of itemList) out[item.id] = null;
    return out;
  }

  const [lessonsRes, actsRes, gradesBySub] = await Promise.all([
    supabase
      .from('lessons')
      .select('id, review_grading_mode, max_review_points')
      .in('id', lessonIds),
    supabase
      .from('activities')
      .select('id, lesson_id, type, points')
      .in('lesson_id', lessonIds),
    listReviewGradesForSubmissions(subIds),
  ]);
  if (lessonsRes.error) throw lessonsRes.error;
  if (actsRes.error) throw actsRes.error;

  const lessonById = {};
  for (const l of lessonsRes.data || []) lessonById[l.id] = l;

  const reviewActsByLesson = {};
  for (const a of actsRes.data || []) {
    if (isAutoGradedLocal(a.type)) continue;
    if (!reviewActsByLesson[a.lesson_id]) reviewActsByLesson[a.lesson_id] = [];
    reviewActsByLesson[a.lesson_id].push({ id: a.id, points: a.points ?? 1 });
  }

  for (const item of itemList) {
    const sub = map[item.id];
    if (!sub) {
      out[item.id] = null;
      continue;
    }
    const lesson = lessonById[item.lesson_id] || null;
    const allReviewActs = reviewActsByLesson[item.lesson_id] || [];
    const answers = sub.answers || {};

    // Only count review activities the student actually answered.
    const answeredReviewActs = allReviewActs.filter((ra) =>
      Object.prototype.hasOwnProperty.call(answers, ra.id)
    );

    const grades = gradesBySub[sub.id] || [];
    const totals = computeSubmissionTotals({
      submission: sub,
      lesson,
      reviewActivities: answeredReviewActs,
      grades,
    });

    const comments = [];
    for (const g of grades) {
      if (g.comment) {
        comments.push({ activity_id: g.activity_id, comment: g.comment });
      }
    }

    out[item.id] = { ...totals, comments };
  }

  return out;
}

// ---------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------

function numberOrThrow(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a number.`);
  }
  return n;
}

async function upsertReviewGradeRow({
  submissionId,
  activityId,
  pointsEarned,
  pointsMax,
  comment,
  gradedBy,
}) {
  if (!submissionId) throw new Error('submissionId is required.');

  const earned = numberOrThrow(pointsEarned, 'points_earned');
  const max = numberOrThrow(pointsMax, 'points_max');
  if (max <= 0) throw new Error('points_max must be greater than zero.');
  if (earned < 0) throw new Error('points_earned cannot be negative.');
  if (earned > max) throw new Error('points_earned cannot be greater than points_max.');

  let findQuery = supabase
    .from('review_grades')
    .select('id')
    .eq('submission_id', submissionId);
  if (activityId === null || activityId === undefined) {
    findQuery = findQuery.is('activity_id', null);
  } else {
    findQuery = findQuery.eq('activity_id', activityId);
  }
  const { data: existing, error: findErr } = await findQuery.maybeSingle();
  if (findErr) throw findErr;

  const trimmedComment = (comment || '').trim();

  const payload = {
    submission_id: submissionId,
    activity_id: activityId ?? null,
    points_earned: earned,
    points_max: max,
    comment: trimmedComment ? trimmedComment : null,
    graded_at: new Date().toISOString(),
    graded_by: gradedBy || null,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('review_grades')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('review_grades')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveHolisticGrade({
  submissionId,
  pointsEarned,
  pointsMax,
  comment,
  gradedBy,
}) {
  return upsertReviewGradeRow({
    submissionId,
    activityId: null,
    pointsEarned,
    pointsMax,
    comment,
    gradedBy,
  });
}

export async function saveActivityGrade({
  submissionId,
  activityId,
  pointsEarned,
  pointsMax,
  comment,
  gradedBy,
}) {
  if (!activityId) throw new Error('activityId is required for per-activity grades.');
  return upsertReviewGradeRow({
    submissionId,
    activityId,
    pointsEarned,
    pointsMax,
    comment,
    gradedBy,
  });
}

export async function deleteReviewGradeById(gradeId) {
  if (!gradeId) return;
  const { error } = await supabase
    .from('review_grades')
    .delete()
    .eq('id', gradeId);
  if (error) throw error;
}

export async function deleteReviewGrade({ submissionId, activityId }) {
  if (!submissionId) return;
  let q = supabase
    .from('review_grades')
    .delete()
    .eq('submission_id', submissionId);
  if (activityId === null || activityId === undefined) {
    q = q.is('activity_id', null);
  } else {
    q = q.eq('activity_id', activityId);
  }
  const { error } = await q;
  if (error) throw error;
}