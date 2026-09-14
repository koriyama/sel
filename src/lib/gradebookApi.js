// src/lib/gradebookApi.js
import { supabase } from './supabaseClient';

// Auto-graded activity types, matching LessonResults.jsx.
const AUTO_GRADED_TYPES = [
  'gap_fill',
  'multiple_choice',
  'gap_fill_dropdown',
  'sentence_jumble',
  'vocabulary_matching',
  'listening',
  'dictation',
];

function isAutoGraded(type) {
  return AUTO_GRADED_TYPES.includes(type);
}

function round2(n) {
  if (n == null || isNaN(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round1(n) {
  if (n == null || isNaN(n)) return null;
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

// ---------------------------------------------------------------------
// Letter grades and pass marks (Phase 3d)
// ---------------------------------------------------------------------

// Suggestions offered by the Grade setup UI when a class has no bands of
// its own yet. This constant is NOT used as a runtime fallback — a class
// with no bands gets nulls, and no letters are computed.
export const SYSTEM_DEFAULT_LETTER_BANDS = [
  { label: 'S', min: 90 },
  { label: 'A', min: 80 },
  { label: 'B', min: 70 },
  { label: 'C', min: 60 },
  { label: 'D', min: 0 },
];

// Returns the class's own bands, sorted descending by min, or null if the
// class has none set.
export function bandsForClass(cls) {
  const raw = cls?.letter_grade_bands;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const cleaned = raw
    .filter((b) => b && typeof b.min === 'number' && typeof b.label === 'string')
    .map((b) => ({ label: b.label, min: Number(b.min) }))
    .sort((a, b) => b.min - a.min);
  return cleaned.length > 0 ? cleaned : null;
}

export function letterForPercent(pct, bands) {
  if (pct == null || !bands || bands.length === 0) return null;
  for (const band of bands) {
    if (pct >= band.min) return band.label;
  }
  return null;
}

function computeFinalGrade({ rolling_grade, override_percent, bands, pass_threshold }) {
  const hasOverride = override_percent != null;
  const final_percent = hasOverride ? Number(override_percent) : rolling_grade;
  const final_letter = final_percent != null ? letterForPercent(final_percent, bands) : null;
  const pass_fail =
    pass_threshold != null && final_percent != null
      ? final_percent >= Number(pass_threshold)
        ? 'pass'
        : 'fail'
      : null;
  return { final_percent, final_letter, pass_fail, hasOverride };
}

// ---------------------------------------------------------------------
// Review-grading helpers (Phase 3b)
// ---------------------------------------------------------------------

function reviewTotalsForSubmission(sub, lesson, reviewActivities, grades) {
  const result = { earned: 0, max: 0, pending: 0 };
  if (!sub) return result;
  if (!reviewActivities || reviewActivities.length === 0) return result;

  const mode = (lesson && lesson.review_grading_mode) || 'holistic';
  const isCompleted = sub.status === 'completed';

  if (mode === 'holistic') {
    const holistic = (grades || []).find((g) => g.activity_id === null);
    if (holistic) {
      result.earned = Number(holistic.points_earned);
      result.max = Number(holistic.points_max);
    } else if (isCompleted) {
      result.pending = 1;
    }
    return result;
  }

  const byActivity = {};
  for (const g of grades || []) {
    if (g.activity_id) byActivity[g.activity_id] = g;
  }
  for (const ra of reviewActivities) {
    const g = byActivity[ra.id];
    if (g) {
      result.earned += Number(g.points_earned);
      result.max += Number(g.points_max);
    } else if (isCompleted) {
      result.pending += 1;
    }
  }
  return result;
}

function buildReviewActivityMap(activities) {
  const byLesson = {};
  for (const a of activities || []) {
    if (isAutoGraded(a.type)) continue;
    if (!byLesson[a.lesson_id]) byLesson[a.lesson_id] = [];
    byLesson[a.lesson_id].push({ id: a.id, points: a.points ?? 1 });
  }
  return byLesson;
}

function buildAutoCountMap(activities) {
  const byLesson = {};
  for (const a of activities || []) {
    if (!isAutoGraded(a.type)) continue;
    byLesson[a.lesson_id] = (byLesson[a.lesson_id] || 0) + 1;
  }
  return byLesson;
}

function groupReviewGradesBySubmission(rows) {
  const out = {};
  for (const g of rows || []) {
    if (!out[g.submission_id]) out[g.submission_id] = [];
    out[g.submission_id].push(g);
  }
  return out;
}

async function fetchLessonsReviewSettings(lessonIds) {
  const map = {};
  if (!lessonIds || lessonIds.length === 0) return map;
  const { data, error } = await supabase
    .from('lessons')
    .select('id, review_grading_mode, max_review_points')
    .in('id', lessonIds);
  if (error) throw error;
  for (const l of data || []) map[l.id] = l;
  return map;
}

async function fetchReviewGradesBySubmission(submissionIds) {
  if (!submissionIds || submissionIds.length === 0) return {};
  const { data, error } = await supabase
    .from('review_grades')
    .select('id, submission_id, activity_id, points_earned, points_max')
    .in('submission_id', submissionIds);
  if (error) throw error;
  return groupReviewGradesBySubmission(data || []);
}

// ---------------------------------------------------------------------
// Attendance context (Phase 3c)
// ---------------------------------------------------------------------
async function fetchAttendanceContext(classId, attCategoryId, useCategories, categories) {
  const { data: sessions, error: sErr } = await supabase
    .from('attendance_sessions')
    .select('id, session_date, session_time, label, position')
    .eq('class_id', classId)
    .order('session_date', { ascending: true });
  if (sErr) throw sErr;
  const sessionList = sessions || [];
  const sessionIds = sessionList.map((s) => s.id);

  let records = [];
  if (sessionIds.length > 0) {
    const { data, error } = await supabase
      .from('attendance_records')
      .select('id, session_id, student_id, status, points_awarded')
      .in('session_id', sessionIds);
    if (error) throw error;
    records = data || [];
  }

  const byStudent = {};
  for (const r of records) {
    const b = byStudent[r.student_id] || (byStudent[r.student_id] = { earned: 0, marked: 0 });
    b.earned += Number(r.points_awarded);
    b.marked += 1;
  }

  let gradePoints = 0;
  if (attCategoryId && useCategories) {
    const cat = (categories || []).find((c) => c.id === attCategoryId);
    if (cat) gradePoints = Number(cat.weight);
  }

  return {
    sessions: sessionList,
    records,
    byStudent,
    gradePoints,
    sessionCount: sessionList.length,
  };
}

// ---------------------------------------------------------------------
// computeGradePointsMap (unchanged from Phase 3a / 3c)
// ---------------------------------------------------------------------
function computeGradePointsMap({
  assignments,
  categories,
  rawMaxByAssignment,
  useCategories,
}) {
  const map = {};
  const warnings = [];
  const categoryInfo = {};

  const catById = {};
  for (const c of categories) catById[c.id] = c;

  for (const a of assignments) {
    const manual = a.grade_points != null ? Number(a.grade_points) : null;
    if (manual != null && manual > 0) {
      const cat = a.category_id ? catById[a.category_id] : null;
      map[a.id] = {
        value: manual,
        source: 'manual',
        category_id: a.category_id || null,
        category_name: cat ? cat.name : null,
      };
    }
  }

  if (!useCategories) {
    for (const a of assignments) {
      if (map[a.id]) continue;
      map[a.id] = {
        value: rawMaxByAssignment[a.id] || 0,
        source: 'default',
        category_id: null,
        category_name: null,
      };
    }
    return { map, warnings, categoryInfo };
  }

  const byCategoryAll = {};
  const byCategoryRemaining = {};
  const uncategorised = [];

  for (const a of assignments) {
    if (!a.category_id) {
      if (!map[a.id]) uncategorised.push(a);
      continue;
    }
    if (!byCategoryAll[a.category_id]) byCategoryAll[a.category_id] = [];
    byCategoryAll[a.category_id].push(a);
    if (!map[a.id]) {
      if (!byCategoryRemaining[a.category_id]) {
        byCategoryRemaining[a.category_id] = [];
      }
      byCategoryRemaining[a.category_id].push(a);
    }
  }

  for (const cat of categories) {
    const all = byCategoryAll[cat.id] || [];
    const remaining = byCategoryRemaining[cat.id] || [];
    const overriddenInCat = all.filter(
      (a) => map[a.id] && map[a.id].source === 'manual'
    );
    const overriddenTotal = overriddenInCat.reduce(
      (s, a) => s + (map[a.id]?.value || 0),
      0
    );
    const weight = Number(cat.weight);
    const leftover = weight - overriddenTotal;

    let rawTotal = 0;
    for (const a of remaining) rawTotal += rawMaxByAssignment[a.id] || 0;

    categoryInfo[cat.id] = {
      id: cat.id,
      name: cat.name,
      weight,
      assignment_count: all.length,
      overridden_count: overriddenInCat.length,
      overridden_total: round2(overriddenTotal),
      raw_max_total: round2(rawTotal),
      distributed: 0,
      leftover_weight: 0,
    };

    if (all.length === 0) {
      categoryInfo[cat.id].leftover_weight = round2(weight);
      warnings.push({
        type: 'empty_category',
        message:
          `Category "${cat.name}" has weight ${weight} but no assignments. ` +
          `It will not contribute to rolling grades.`,
        category_id: cat.id,
      });
      continue;
    }

    if (leftover < -0.005) {
      warnings.push({
        type: 'overrides_exceed_weight',
        message:
          `Category "${cat.name}" has overrides totalling ` +
          `${round2(overriddenTotal)} but only ${weight} weight. ` +
          `Non-overridden assignments in it will get 0.`,
        category_id: cat.id,
      });
      for (const a of remaining) {
        map[a.id] = {
          value: 0,
          source: 'category',
          category_id: cat.id,
          category_name: cat.name,
        };
      }
      categoryInfo[cat.id].distributed = round2(overriddenTotal);
      categoryInfo[cat.id].leftover_weight = 0;
      continue;
    }

    if (remaining.length === 0) {
      if (leftover > 0.005) {
        warnings.push({
          type: 'category_weight_unspent',
          message:
            `Category "${cat.name}" has ${round2(leftover)} weight not spent, ` +
            `because every assignment in it is overridden and the overrides ` +
            `total less than the category weight.`,
          category_id: cat.id,
        });
      }
      categoryInfo[cat.id].distributed = round2(overriddenTotal);
      categoryInfo[cat.id].leftover_weight = round2(leftover);
      continue;
    }

    if (rawTotal === 0) {
      warnings.push({
        type: 'zero_raw_max_category',
        message:
          `Category "${cat.name}" has non-overridden assignments but none of ` +
          `them contain auto-graded activities, so they will get 0 grade points.`,
        category_id: cat.id,
      });
      for (const a of remaining) {
        map[a.id] = {
          value: 0,
          source: 'category',
          category_id: cat.id,
          category_name: cat.name,
        };
      }
      categoryInfo[cat.id].distributed = round2(overriddenTotal);
      categoryInfo[cat.id].leftover_weight = round2(leftover);
      continue;
    }

    let distributedToRemaining = 0;
    for (const a of remaining) {
      const raw = rawMaxByAssignment[a.id] || 0;
      const share = (raw / rawTotal) * leftover;
      map[a.id] = {
        value: share,
        source: 'category',
        category_id: cat.id,
        category_name: cat.name,
      };
      distributedToRemaining += share;
    }
    categoryInfo[cat.id].distributed = round2(
      overriddenTotal + distributedToRemaining
    );
    categoryInfo[cat.id].leftover_weight = 0;
  }

  for (const a of uncategorised) {
    map[a.id] = {
      value: 0,
      source: 'excluded',
      category_id: null,
      category_name: null,
    };
  }
  if (uncategorised.length > 0) {
    warnings.push({
      type: 'uncategorised',
      message:
        `${uncategorised.length} assignment${uncategorised.length === 1 ? '' : 's'} ` +
        `not in a category. They will not count toward rolling grades.`,
      assignment_ids: uncategorised.map((a) => a.id),
      assignment_titles: uncategorised.map((a) => a.title),
    });
  }

  const totalWeight = categories.reduce((s, c) => s + Number(c.weight), 0);
  if (categories.length > 0 && Math.abs(totalWeight - 100) > 0.01) {
    warnings.push({
      type: 'weights_not_100',
      message: `Category weights total ${round2(totalWeight)} instead of 100.`,
      total: round2(totalWeight),
    });
  }

  return { map, warnings, categoryInfo };
}

// ---------------------------------------------------------------------
// Category CRUD
// ---------------------------------------------------------------------
export async function listGradeCategories(classId) {
  const { data, error } = await supabase
    .from('grade_categories')
    .select('id, class_id, name, weight, position, created_at, updated_at')
    .eq('class_id', classId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createGradeCategory(classId, { name, weight, position }) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Please enter a category name.');
  const w = Number(weight);
  if (isNaN(w) || w < 0) throw new Error('Weight must be a non-negative number.');
  const { data, error } = await supabase
    .from('grade_categories')
    .insert({
      class_id: classId,
      name: trimmed,
      weight: w,
      position: typeof position === 'number' ? position : 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateGradeCategory(categoryId, patch) {
  const clean = { ...patch, updated_at: new Date().toISOString() };
  if (clean.name != null) clean.name = String(clean.name).trim();
  if (clean.weight != null) {
    const w = Number(clean.weight);
    if (isNaN(w) || w < 0) throw new Error('Weight must be a non-negative number.');
    clean.weight = w;
  }
  const { data, error } = await supabase
    .from('grade_categories')
    .update(clean)
    .eq('id', categoryId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteGradeCategory(categoryId) {
  const { error } = await supabase
    .from('grade_categories')
    .delete()
    .eq('id', categoryId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Overrides CRUD (Phase 3d)
// ---------------------------------------------------------------------
export async function listOverridesForClass(classId) {
  const { data, error } = await supabase
    .from('student_grade_overrides')
    .select('id, class_id, student_id, override_percent, comment, created_at, updated_at')
    .eq('class_id', classId);
  if (error) throw error;
  return data || [];
}

export async function saveOverride({
  classId,
  studentId,
  overridePercent,
  comment,
  userId,
}) {
  if (!classId || !studentId) throw new Error('classId and studentId are required.');
  const pct = Number(overridePercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error('Override percentage must be a number between 0 and 100.');
  }
  const trimmedComment = (comment || '').trim();
  const now = new Date().toISOString();

  const { data: existing, error: findErr } = await supabase
    .from('student_grade_overrides')
    .select('id')
    .eq('class_id', classId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (findErr) throw findErr;

  const payload = {
    class_id: classId,
    student_id: studentId,
    override_percent: pct,
    comment: trimmedComment ? trimmedComment : null,
    updated_at: now,
    updated_by: userId || null,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('student_grade_overrides')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('student_grade_overrides')
    .insert({ ...payload, created_by: userId || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteOverride({ classId, studentId }) {
  if (!classId || !studentId) return;
  const { error } = await supabase
    .from('student_grade_overrides')
    .delete()
    .eq('class_id', classId)
    .eq('student_id', studentId);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Teacher-facing grade book for one class.
// ---------------------------------------------------------------------
export async function getClassGradebook(classId) {
  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select(
      'id, name, use_categories, attendance_points_per_session, attendance_late_penalty, attendance_category_id, pass_threshold, letter_grade_bands'
    )
    .eq('id', classId)
    .maybeSingle();
  if (clsErr) throw clsErr;
  const useCategories = Boolean(cls?.use_categories);
  const attPointsPerSession = Number(cls?.attendance_points_per_session ?? 1);
  const attCategoryId = cls?.attendance_category_id || null;
  const attendanceAssignmentId = `attendance:${classId}`;
  const bands = bandsForClass(cls);
  const passThreshold = cls?.pass_threshold != null ? Number(cls.pass_threshold) : null;

  const { data: members, error: memErr } = await supabase
    .from('class_members')
    .select('student_id, student:profiles(id, institutional_id, display_name)')
    .eq('class_id', classId)
    .order('enrolled_at', { ascending: true });
  if (memErr) throw memErr;

  const students = (members || []).map((m) => m.student).filter(Boolean);

  const { data: overrideRows, error: ovErr } = await supabase
    .from('student_grade_overrides')
    .select('student_id, override_percent, comment, updated_at')
    .eq('class_id', classId);
  if (ovErr) throw ovErr;
  const overridesByStudent = {};
  for (const o of overrideRows || []) overridesByStudent[o.student_id] = o;
  const hasAnyOverride = (overrideRows || []).length > 0;

  let categories = [];
  if (useCategories) {
    const { data: cats, error: catErr } = await supabase
      .from('grade_categories')
      .select('id, name, weight, position')
      .eq('class_id', classId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (catErr) throw catErr;
    categories = cats || [];
  }

  const { data: assignmentsRaw, error: asnErr } = await supabase
    .from('assignments')
    .select(
      'id, title, status, start_at, due_at, grade_points, category_id, position, created_at'
    )
    .eq('class_id', classId)
    .order('position', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (asnErr) throw asnErr;

  const assignments = assignmentsRaw || [];
  const assignmentIds = assignments.map((a) => a.id);

  const attendance = await fetchAttendanceContext(
    classId,
    attCategoryId,
    useCategories,
    categories
  );

  const attendanceAssignment = {
    id: attendanceAssignmentId,
    title: 'Attendance',
    status: 'published',
    start_at: null,
    due_at: null,
    raw_max: attPointsPerSession,
    grade_points: round2(attendance.gradePoints),
    grade_points_source: 'attendance',
    category_id: attCategoryId,
    category_name: null,
    review_item_count: 0,
    is_due: true,
    counts_toward_rolling: attendance.gradePoints > 0,
    class_average_pct: null,
    is_attendance: true,
    attendance_session_count: attendance.sessionCount,
    attendance_points_per_session: attPointsPerSession,
  };

  if (assignmentIds.length === 0) {
    const studentRows = students.map((s) => {
      const b = attendance.byStudent[s.id] || { earned: 0, marked: 0 };
      const attMax = b.marked * attPointsPerSession;
      const attPct = attMax > 0 ? (b.earned / attMax) * 100 : null;
      const attContrib =
        attPct != null && attendance.gradePoints > 0
          ? (attPct / 100) * attendance.gradePoints
          : 0;
      const cells = {
        [attendanceAssignmentId]: {
          auto_earned: 0,
          auto_max: 0,
          review_earned: 0,
          review_max: 0,
          review_pending_count: 0,
          raw_earned: round2(b.earned),
          raw_max: round2(attMax),
          grade_points: round2(attendance.gradePoints),
          grade_points_source: 'attendance',
          category_id: attCategoryId,
          category_name: null,
          pct: attPct != null ? round1(attPct) : null,
          contribution: round2(attContrib),
          has_any_submission: b.marked > 0,
          counts_toward_rolling: attendance.gradePoints > 0,
          is_attendance: true,
          attendance_session_count: attendance.sessionCount,
          attendance_marked_count: b.marked,
        },
      };
      const totalEarned = attContrib;
      const totalPossible = attendance.gradePoints > 0 ? attendance.gradePoints : 0;
      const rolling =
        totalPossible > 0 ? round1((totalEarned / totalPossible) * 100) : null;
      const overrideRow = overridesByStudent[s.id];
      const final = computeFinalGrade({
        rolling_grade: rolling,
        override_percent: overrideRow ? Number(overrideRow.override_percent) : null,
        bands,
        pass_threshold: passThreshold,
      });
      return {
        id: s.id,
        display_name: s.display_name,
        institutional_id: s.institutional_id,
        cells,
        rolling_grade: rolling,
        total_earned_points: round2(totalEarned),
        total_possible_points: round2(totalPossible),
        override_percent: overrideRow ? Number(overrideRow.override_percent) : null,
        override_comment: overrideRow?.comment || null,
        override_updated_at: overrideRow?.updated_at || null,
        final_percent: final.final_percent != null ? round1(final.final_percent) : null,
        final_letter: final.final_letter,
        pass_fail: final.pass_fail,
      };
    });

    let classEarned = 0;
    let classPossible = 0;
    for (const s of studentRows) {
      classEarned += s.total_earned_points || 0;
      classPossible += s.total_possible_points || 0;
    }
    const classRolling =
      classPossible > 0 ? (classEarned / classPossible) * 100 : null;

    const attPcts = studentRows
      .map((s) => s.cells[attendanceAssignmentId]?.pct)
      .filter((p) => p != null);
    const attAvg =
      attPcts.length > 0 ? attPcts.reduce((a, b) => a + b, 0) / attPcts.length : null;
    attendanceAssignment.class_average_pct = attAvg != null ? round1(attAvg) : null;

    return {
      use_categories: useCategories,
      warnings: [],
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        weight: Number(c.weight),
        position: c.position,
        assignment_count: 0,
        overridden_count: 0,
        overridden_total: 0,
        raw_max_total: 0,
        distributed: 0,
        leftover_weight: 0,
      })),
      assignments: [attendanceAssignment],
      students: studentRows,
      class_rolling_grade: classRolling != null ? round1(classRolling) : null,
      letter_bands: bands,
      pass_threshold: passThreshold,
      has_any_override: hasAnyOverride,
    };
  }

  const { data: itemsRaw, error: itmErr } = await supabase
    .from('assignment_items')
    .select('id, assignment_id, type, lesson_id')
    .in('assignment_id', assignmentIds)
    .eq('type', 'lesson');
  if (itmErr) throw itmErr;

  const items = itemsRaw || [];
  const lessonIds = [...new Set(items.map((i) => i.lesson_id).filter(Boolean))];

  let activities = [];
  if (lessonIds.length > 0) {
    const { data: acts, error: actErr } = await supabase
      .from('activities')
      .select('id, lesson_id, type, points')
      .in('lesson_id', lessonIds);
    if (actErr) throw actErr;
    activities = acts || [];
  }

  const autoCountByLesson = buildAutoCountMap(activities);
  const reviewActivitiesByLesson = buildReviewActivityMap(activities);
  const lessonById = await fetchLessonsReviewSettings(lessonIds);

  const assignmentAgg = {};
  for (const a of assignments) {
    assignmentAgg[a.id] = { raw_max: 0, review_item_count: 0 };
  }
  for (const it of items) {
    const agg = assignmentAgg[it.assignment_id];
    if (!agg) continue;
    agg.raw_max += autoCountByLesson[it.lesson_id] || 0;
    agg.review_item_count += (reviewActivitiesByLesson[it.lesson_id] || []).length;
  }

  const rawMaxByAssignment = {};
  for (const a of assignments) {
    rawMaxByAssignment[a.id] = assignmentAgg[a.id].raw_max;
  }

  const attendanceForDistribution = attendance.gradePoints > 0
    ? [{
        id: attendanceAssignmentId,
        title: 'Attendance',
        category_id: attCategoryId,
        grade_points: attendance.gradePoints,
        status: 'published',
        due_at: null,
      }]
    : [];

  const { map: gpMap, warnings, categoryInfo } = computeGradePointsMap({
    assignments: [...assignments, ...attendanceForDistribution],
    categories,
    rawMaxByAssignment: {
      ...rawMaxByAssignment,
      [attendanceAssignmentId]: attPointsPerSession,
    },
    useCategories,
  });

  let submissions = [];
  if (students.length > 0) {
    const { data: subs, error: subErr } = await supabase
      .from('submissions')
      .select(
        'id, assignment_id, assignment_item_id, lesson_id, student_id, status, score, max_auto_score, attempt_number, submitted_at, created_at'
      )
      .in('assignment_id', assignmentIds)
      .in('student_id', students.map((s) => s.id));
    if (subErr) throw subErr;
    submissions = subs || [];
  }

  const reviewGradesBySubmission = await fetchReviewGradesBySubmission(
    submissions.map((s) => s.id)
  );

  const latestByKey = {};
  for (const s of submissions) {
    if (!s.assignment_item_id) continue;
    const key = `${s.student_id}|${s.assignment_item_id}`;
    const existing = latestByKey[key];
    if (!existing || (s.attempt_number || 0) > (existing.attempt_number || 0)) {
      latestByKey[key] = s;
    }
  }

  const now = Date.now();
  const assignmentMeta = {};
  for (const asn of assignments) {
    const agg = assignmentAgg[asn.id];
    const gp = gpMap[asn.id] || {
      value: 0,
      source: 'default',
      category_id: null,
      category_name: null,
    };
    const isDue = asn.due_at ? new Date(asn.due_at).getTime() < now : false;
    const isPublished = asn.status === 'published' || asn.status === 'archived';
    const counts =
      isDue &&
      isPublished &&
      gp.value > 0 &&
      gp.source !== 'excluded' &&
      (agg.raw_max > 0 || agg.review_item_count > 0);

    assignmentMeta[asn.id] = {
      raw_max: agg.raw_max,
      review_item_count: agg.review_item_count,
      grade_points: round2(gp.value),
      grade_points_raw: gp.value,
      grade_points_source: gp.source,
      category_id: gp.category_id,
      category_name: gp.category_name,
      is_due: isDue,
      is_published: isPublished,
      counts_toward_rolling: counts,
    };
  }

  const studentRows = students.map((s) => {
    const cells = {};
    let totalEarned = 0;
    let totalPossible = 0;

    for (const asn of assignments) {
      const meta = assignmentMeta[asn.id];
      let autoEarned = 0;
      let autoMax = 0;
      let reviewEarned = 0;
      let reviewMax = 0;
      let reviewPending = 0;
      let hasAnySub = false;

      for (const it of items) {
        if (it.assignment_id !== asn.id) continue;
        const sub = latestByKey[`${s.id}|${it.id}`];
        const itemAutoMax = autoCountByLesson[it.lesson_id] || 0;
        const itemReviews = reviewActivitiesByLesson[it.lesson_id] || [];
        const lesson = lessonById[it.lesson_id] || null;

        if (!sub) continue;
        hasAnySub = true;

        if (sub.status === 'completed' && sub.max_auto_score > 0) {
          autoEarned += (sub.score / 100) * sub.max_auto_score;
        }
        autoMax += itemAutoMax;

        if (itemReviews.length > 0) {
          const totals = reviewTotalsForSubmission(
            sub,
            lesson,
            itemReviews,
            reviewGradesBySubmission[sub.id] || []
          );
          reviewEarned += totals.earned;
          reviewMax += totals.max;
          reviewPending += totals.pending;
        }
      }

      const cellRawEarned = autoEarned + reviewEarned;
      const cellRawMax = autoMax + reviewMax;
      const pct = cellRawMax > 0 ? (cellRawEarned / cellRawMax) * 100 : null;
      const contribution =
        cellRawMax > 0 && meta.grade_points_raw > 0
          ? (cellRawEarned / cellRawMax) * meta.grade_points_raw
          : 0;

      cells[asn.id] = {
        auto_earned: round2(autoEarned),
        auto_max: autoMax,
        review_earned: round2(reviewEarned),
        review_max: round2(reviewMax),
        review_pending_count: reviewPending,
        raw_earned: round2(cellRawEarned),
        raw_max: cellRawMax,
        grade_points: meta.grade_points,
        grade_points_source: meta.grade_points_source,
        category_id: meta.category_id,
        category_name: meta.category_name,
        pct: pct != null ? round1(pct) : null,
        contribution: round2(contribution),
        has_any_submission: hasAnySub,
        counts_toward_rolling: meta.counts_toward_rolling,
      };

      if (meta.counts_toward_rolling) {
        totalEarned += contribution;
        totalPossible += meta.grade_points_raw;
      }
    }

    const b = attendance.byStudent[s.id] || { earned: 0, marked: 0 };
    const attMax = b.marked * attPointsPerSession;
    const attPct = attMax > 0 ? (b.earned / attMax) * 100 : null;
    const attContrib =
      attPct != null && attendance.gradePoints > 0
        ? (attPct / 100) * attendance.gradePoints
        : 0;
    cells[attendanceAssignmentId] = {
      auto_earned: 0,
      auto_max: 0,
      review_earned: 0,
      review_max: 0,
      review_pending_count: 0,
      raw_earned: round2(b.earned),
      raw_max: round2(attMax),
      grade_points: round2(attendance.gradePoints),
      grade_points_source: 'attendance',
      category_id: attCategoryId,
      category_name: null,
      pct: attPct != null ? round1(attPct) : null,
      contribution: round2(attContrib),
      has_any_submission: b.marked > 0,
      counts_toward_rolling: attendance.gradePoints > 0,
      is_attendance: true,
      attendance_session_count: attendance.sessionCount,
      attendance_marked_count: b.marked,
    };
    if (attendance.gradePoints > 0) {
      totalEarned += attContrib;
      totalPossible += attendance.gradePoints;
    }

    const rolling = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;
    const overrideRow = overridesByStudent[s.id];
    const final = computeFinalGrade({
      rolling_grade: rolling != null ? round1(rolling) : null,
      override_percent: overrideRow ? Number(overrideRow.override_percent) : null,
      bands,
      pass_threshold: passThreshold,
    });

    return {
      id: s.id,
      display_name: s.display_name,
      institutional_id: s.institutional_id,
      cells,
      rolling_grade: rolling != null ? round1(rolling) : null,
      total_earned_points: round2(totalEarned),
      total_possible_points: round2(totalPossible),
      override_percent: overrideRow ? Number(overrideRow.override_percent) : null,
      override_comment: overrideRow?.comment || null,
      override_updated_at: overrideRow?.updated_at || null,
      final_percent: final.final_percent != null ? round1(final.final_percent) : null,
      final_letter: final.final_letter,
      pass_fail: final.pass_fail,
    };
  });

  const assignmentsOut = assignments.map((asn) => {
    const meta = assignmentMeta[asn.id];
    const pcts = [];
    for (const s of studentRows) {
      const c = s.cells[asn.id];
      if (c && c.has_any_submission && c.pct != null) pcts.push(c.pct);
    }
    const avgPct =
      pcts.length > 0 ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;

    return {
      id: asn.id,
      title: asn.title,
      status: asn.status,
      start_at: asn.start_at,
      due_at: asn.due_at,
      raw_max: meta.raw_max,
      grade_points: meta.grade_points,
      grade_points_source: meta.grade_points_source,
      category_id: meta.category_id,
      category_name: meta.category_name,
      review_item_count: meta.review_item_count,
      is_due: meta.is_due,
      counts_toward_rolling: meta.counts_toward_rolling,
      class_average_pct: avgPct != null ? round1(avgPct) : null,
    };
  });

  const attPcts = studentRows
    .map((s) => s.cells[attendanceAssignmentId]?.pct)
    .filter((p) => p != null);
  const attAvg =
    attPcts.length > 0 ? attPcts.reduce((a, b) => a + b, 0) / attPcts.length : null;
  attendanceAssignment.class_average_pct = attAvg != null ? round1(attAvg) : null;

  const finalAssignments = [attendanceAssignment, ...assignmentsOut];

  let classEarned = 0;
  let classPossible = 0;
  for (const s of studentRows) {
    classEarned += s.total_earned_points || 0;
    classPossible += s.total_possible_points || 0;
  }
  const classRolling =
    classPossible > 0 ? (classEarned / classPossible) * 100 : null;

  return {
    use_categories: useCategories,
    warnings,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      weight: Number(c.weight),
      position: c.position,
      ...(categoryInfo[c.id] || {
        assignment_count: 0,
        overridden_count: 0,
        overridden_total: 0,
        raw_max_total: 0,
        distributed: 0,
        leftover_weight: 0,
      }),
    })),
    assignments: finalAssignments,
    students: studentRows,
    class_rolling_grade: classRolling != null ? round1(classRolling) : null,
    letter_bands: bands,
    pass_threshold: passThreshold,
    has_any_override: hasAnyOverride,
  };
}

// ---------------------------------------------------------------------
// Cell detail for the click-a-cell panel.
// ---------------------------------------------------------------------
export async function getCellDetail(studentId, assignmentId) {
  if (typeof assignmentId === 'string' && assignmentId.startsWith('attendance:')) {
    const classId = assignmentId.slice('attendance:'.length);

    const { data: sessions, error: sErr } = await supabase
      .from('attendance_sessions')
      .select('id, session_date, session_time, label, position')
      .eq('class_id', classId)
      .order('session_date', { ascending: true });
    if (sErr) throw sErr;

    const sessionList = sessions || [];
    const sessionIds = sessionList.map((s) => s.id);
    if (sessionIds.length === 0) return [];

    const { data: records, error: rErr } = await supabase
      .from('attendance_records')
      .select('id, session_id, student_id, status, points_awarded')
      .in('session_id', sessionIds)
      .eq('student_id', studentId);
    if (rErr) throw rErr;

    const bySession = {};
    for (const r of records || []) bySession[r.session_id] = r;

    return sessionList.map((sess) => {
      const rec = bySession[sess.id];
      return {
        item_id: sess.id,
        title: sess.label || sess.session_date,
        is_attendance: true,
        session_date: sess.session_date,
        session_time: sess.session_time,
        status: rec ? rec.status : 'unmarked',
        raw_earned: rec ? Number(rec.points_awarded) : 0,
        raw_max: 0,
        pct: null,
        attempt_number: null,
        submitted_at: null,
      };
    });
  }

  const { data: items, error: itmErr } = await supabase
    .from('assignment_items')
    .select('id, position, type, title, lesson_id, lesson:lessons(id, title, review_grading_mode, max_review_points)')
    .eq('assignment_id', assignmentId)
    .eq('type', 'lesson')
    .order('position', { ascending: true });
  if (itmErr) throw itmErr;
  const itemList = items || [];

  const lessonIds = [...new Set(itemList.map((i) => i.lesson_id).filter(Boolean))];

  let activities = [];
  if (lessonIds.length > 0) {
    const { data: acts, error: actErr } = await supabase
      .from('activities')
      .select('id, lesson_id, type, points')
      .in('lesson_id', lessonIds);
    if (actErr) throw actErr;
    activities = acts || [];
  }

  const autoByLesson = buildAutoCountMap(activities);
  const reviewByLesson = buildReviewActivityMap(activities);

  let subs = [];
  if (itemList.length > 0) {
    const { data: rows, error: subErr } = await supabase
      .from('submissions')
      .select(
        'id, assignment_item_id, status, score, max_auto_score, attempt_number, submitted_at'
      )
      .eq('student_id', studentId)
      .eq('assignment_id', assignmentId);
    if (subErr) throw subErr;
    subs = rows || [];
  }
  const latestByItem = {};
  for (const s of subs) {
    if (!s.assignment_item_id) continue;
    const existing = latestByItem[s.assignment_item_id];
    if (!existing || (s.attempt_number || 0) > (existing.attempt_number || 0)) {
      latestByItem[s.assignment_item_id] = s;
    }
  }

  const reviewGradesBySubmission = await fetchReviewGradesBySubmission(
    subs.map((s) => s.id)
  );

  const rows = itemList.map((it) => {
    const sub = latestByItem[it.id];
    const autoMax = autoByLesson[it.lesson_id] || 0;
    const reviewActivities = reviewByLesson[it.lesson_id] || [];
    const lesson = it.lesson || null;
    const reviewMode = lesson?.review_grading_mode || 'holistic';

    let autoEarned = 0;
    if (sub && sub.status === 'completed' && sub.max_auto_score > 0) {
      autoEarned = (sub.score / 100) * sub.max_auto_score;
    }

    let reviewEarned = 0;
    let reviewMax = 0;
    let reviewPending = 0;
    if (sub && reviewActivities.length > 0) {
      const totals = reviewTotalsForSubmission(
        sub,
        lesson,
        reviewActivities,
        reviewGradesBySubmission[sub.id] || []
      );
      reviewEarned = totals.earned;
      reviewMax = totals.max;
      reviewPending = totals.pending;
    }

    const rawEarned = autoEarned + reviewEarned;
    const rawMax = autoMax + reviewMax;
    const pct = rawMax > 0 ? (rawEarned / rawMax) * 100 : null;

    return {
      item_id: it.id,
      title: it.title || it.lesson?.title || 'Lesson',
      lesson_id: it.lesson_id,
      review_mode: reviewMode,
      auto_earned: round2(autoEarned),
      auto_max: autoMax,
      review_earned: round2(reviewEarned),
      review_max: reviewMax,
      review_count: reviewActivities.length,
      review_pending_count: reviewPending,
      raw_earned: round2(rawEarned),
      raw_max: rawMax,
      pct: pct != null ? round1(pct) : null,
      status: sub ? sub.status : 'not_started',
      submitted_at: sub ? sub.submitted_at : null,
      attempt_number: sub ? sub.attempt_number : null,
    };
  });

  return rows;
}

// ---------------------------------------------------------------------
// Student-side rolling grade badge.
// ---------------------------------------------------------------------
export async function getStudentRollingGradeForClass(classId) {
  const empty = {
    rolling_grade: null,
    total_earned_points: 0,
    total_possible_points: 0,
    final_percent: null,
    final_letter: null,
    pass_fail: null,
    override_percent: null,
    override_comment: null,
    letter_bands: null,
    pass_threshold: null,
  };

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return empty;

  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select(
      'use_categories, attendance_points_per_session, attendance_category_id, pass_threshold, letter_grade_bands'
    )
    .eq('id', classId)
    .maybeSingle();
  if (clsErr) throw clsErr;
  const useCategories = Boolean(cls?.use_categories);
  const attPointsPerSession = Number(cls?.attendance_points_per_session ?? 1);
  const attCategoryId = cls?.attendance_category_id || null;
  const bands = bandsForClass(cls);
  const passThreshold = cls?.pass_threshold != null ? Number(cls.pass_threshold) : null;

  const { data: overrideRow } = await supabase
    .from('student_grade_overrides')
    .select('override_percent, comment, updated_at')
    .eq('class_id', classId)
    .eq('student_id', user.id)
    .maybeSingle();

  const { data: assignments, error: asnErr } = await supabase
    .from('assignments')
    .select('id, status, due_at, grade_points, category_id, title')
    .eq('class_id', classId);
  if (asnErr) throw asnErr;
  const assignmentList = assignments || [];
  const assignmentIds = assignmentList.map((a) => a.id);

  let categories = [];
  if (useCategories) {
    const { data: cats, error: catErr } = await supabase
      .from('grade_categories')
      .select('id, name, weight')
      .eq('class_id', classId);
    if (catErr) throw catErr;
    categories = cats || [];
  }

  const attendance = await fetchAttendanceContext(
    classId,
    attCategoryId,
    useCategories,
    categories
  );

  const wrapResult = (rolling) => {
    const final = computeFinalGrade({
      rolling_grade: rolling,
      override_percent: overrideRow ? Number(overrideRow.override_percent) : null,
      bands,
      pass_threshold: passThreshold,
    });
    return {
      rolling_grade: rolling,
      total_earned_points: null,
      total_possible_points: null,
      final_percent: final.final_percent != null ? round1(final.final_percent) : null,
      final_letter: final.final_letter,
      pass_fail: final.pass_fail,
      override_percent: overrideRow ? Number(overrideRow.override_percent) : null,
      override_comment: overrideRow?.comment || null,
      letter_bands: bands,
      pass_threshold: passThreshold,
    };
  };

  if (assignmentIds.length === 0) {
    let totalEarned = 0;
    let totalPossible = 0;
    if (attendance.gradePoints > 0) {
      const b = attendance.byStudent[user.id] || { earned: 0, marked: 0 };
      const attMax = b.marked * attPointsPerSession;
      const attPct = attMax > 0 ? (b.earned / attMax) * 100 : null;
      if (attPct != null) {
        totalEarned = (attPct / 100) * attendance.gradePoints;
      }
      totalPossible = attendance.gradePoints;
    }
    const rolling = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;
    const out = wrapResult(rolling != null ? round1(rolling) : null);
    out.total_earned_points = round2(totalEarned);
    out.total_possible_points = round2(totalPossible);
    return out;
  }

  const { data: items, error: itmErr } = await supabase
    .from('assignment_items')
    .select('id, assignment_id, lesson_id')
    .in('assignment_id', assignmentIds)
    .eq('type', 'lesson');
  if (itmErr) throw itmErr;
  const itemList = items || [];
  const lessonIds = [...new Set(itemList.map((i) => i.lesson_id).filter(Boolean))];

  let activities = [];
  if (lessonIds.length > 0) {
    const { data: acts, error: actErr } = await supabase
      .from('activities')
      .select('id, lesson_id, type, points')
      .in('lesson_id', lessonIds);
    if (actErr) throw actErr;
    activities = acts || [];
  }

  const autoCountByLesson = buildAutoCountMap(activities);
  const reviewActivitiesByLesson = buildReviewActivityMap(activities);
  const lessonById = await fetchLessonsReviewSettings(lessonIds);

  const rawMaxByAssignment = {};
  for (const it of itemList) {
    rawMaxByAssignment[it.assignment_id] =
      (rawMaxByAssignment[it.assignment_id] || 0) +
      (autoCountByLesson[it.lesson_id] || 0);
  }

  const attendanceForDistribution = attendance.gradePoints > 0
    ? [{
        id: `attendance:${classId}`,
        title: 'Attendance',
        category_id: attCategoryId,
        grade_points: attendance.gradePoints,
      }]
    : [];

  const { map: gpMap } = computeGradePointsMap({
    assignments: [...assignmentList, ...attendanceForDistribution],
    categories,
    rawMaxByAssignment: {
      ...rawMaxByAssignment,
      [`attendance:${classId}`]: attPointsPerSession,
    },
    useCategories,
  });

  const { data: subs, error: subErr } = await supabase
    .from('submissions')
    .select('id, assignment_id, assignment_item_id, status, score, max_auto_score, attempt_number')
    .in('assignment_id', assignmentIds)
    .eq('student_id', user.id);
  if (subErr) throw subErr;

  const reviewGradesBySubmission = await fetchReviewGradesBySubmission(
    (subs || []).map((s) => s.id)
  );

  const latestByItem = {};
  for (const s of subs || []) {
    if (!s.assignment_item_id) continue;
    const existing = latestByItem[s.assignment_item_id];
    if (!existing || (s.attempt_number || 0) > (existing.attempt_number || 0)) {
      latestByItem[s.assignment_item_id] = s;
    }
  }

  const now = Date.now();
  let totalEarned = 0;
  let totalPossible = 0;

  for (const asn of assignmentList) {
    const autoMaxForAsn = rawMaxByAssignment[asn.id] || 0;
    const gp = gpMap[asn.id] || { value: 0, source: 'default' };
    const isDue = asn.due_at ? new Date(asn.due_at).getTime() < now : false;
    const isPublished = asn.status === 'published' || asn.status === 'archived';

    let reviewItemCountForAsn = 0;
    for (const it of itemList) {
      if (it.assignment_id !== asn.id) continue;
      reviewItemCountForAsn += (reviewActivitiesByLesson[it.lesson_id] || []).length;
    }

    if (
      !isDue ||
      !isPublished ||
      gp.value <= 0 ||
      gp.source === 'excluded' ||
      (autoMaxForAsn === 0 && reviewItemCountForAsn === 0)
    ) {
      continue;
    }

    let autoEarned = 0;
    let autoMax = 0;
    let reviewEarned = 0;
    let reviewMax = 0;

    for (const it of itemList) {
      if (it.assignment_id !== asn.id) continue;
      const sub = latestByItem[it.id];
      const itemAutoMax = autoCountByLesson[it.lesson_id] || 0;
      const itemReviews = reviewActivitiesByLesson[it.lesson_id] || [];
      const lesson = lessonById[it.lesson_id] || null;

      if (!sub) continue;

      if (sub.status === 'completed' && sub.max_auto_score > 0) {
        autoEarned += (sub.score / 100) * sub.max_auto_score;
      }
      autoMax += itemAutoMax;

      if (itemReviews.length > 0) {
        const totals = reviewTotalsForSubmission(
          sub,
          lesson,
          itemReviews,
          reviewGradesBySubmission[sub.id] || []
        );
        reviewEarned += totals.earned;
        reviewMax += totals.max;
      }
    }

    const cellRawEarned = autoEarned + reviewEarned;
    const cellRawMax = autoMax + reviewMax;
    if (cellRawMax > 0) {
      totalEarned += (cellRawEarned / cellRawMax) * gp.value;
    }
    totalPossible += gp.value;
  }

  if (attendance.gradePoints > 0) {
    const b = attendance.byStudent[user.id] || { earned: 0, marked: 0 };
    const attMax = b.marked * attPointsPerSession;
    const attPct = attMax > 0 ? (b.earned / attMax) * 100 : null;
    if (attPct != null) {
      totalEarned += (attPct / 100) * attendance.gradePoints;
    }
    totalPossible += attendance.gradePoints;
  }

  const rolling = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;
  const out = wrapResult(rolling != null ? round1(rolling) : null);
  out.total_earned_points = round2(totalEarned);
  out.total_possible_points = round2(totalPossible);
  return out;
}