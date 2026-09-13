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
// Distribute category weights across assignments.
//
// Rule 2 (Canvas/Moodle style):
//   - Each category is a fixed budget = its weight.
//   - Manual overrides inside a category consume part of that budget.
//   - Whatever is left is distributed among the non-overridden
//     assignments, proportionally to their raw max.
//   - If overrides alone exceed the category weight, the non-overridden
//     assignments get 0 and a warning is raised.
//
// Outside any category (or when the class has categories off), a manual
// override is absolute and the rest fall back to raw max.
//
// Returns:
//   {
//     map: { assignment_id: { value, source, category_id, category_name } },
//     warnings: [ { type, message, ... } ],
//     categoryInfo: { category_id: { ...counters and totals } },
//   }
//
// source is one of:
//   'manual'    — teacher set grade_points on the assignment
//   'category'  — derived from the category distribution
//   'default'   — raw max fallback (categories off)
//   'excluded'  — uncategorised while categories are on
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

  // Step 1 — manual overrides. Attach the category name if the
  // assignment is in a category, so the display is consistent.
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

  // Step 2 — categories off: everything falls back to raw max.
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

  // Step 3 — group assignments by category.
  //   byCategoryAll       — every assignment in each category
  //   byCategoryRemaining — only the non-overridden ones
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

  // Step 4 — distribute each category's weight under Rule 2.
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

    // Empty category — weight but no assignments.
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

    // Overrides exceed the category weight.
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

    // No non-overridden assignments to receive the leftover.
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

    // Remaining assignments have no auto-graded activities.
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

    // Distribute the leftover proportionally to raw max.
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

  // Step 5 — uncategorised assignments are excluded in strict mode.
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

  // Step 6 — total weight check.
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
// Category CRUD.
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
// Teacher-side grade book for a whole class.
// ---------------------------------------------------------------------
export async function getClassGradebook(classId) {
  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('id, name, use_categories')
    .eq('id', classId)
    .maybeSingle();
  if (clsErr) throw clsErr;
  const useCategories = Boolean(cls?.use_categories);

  const { data: members, error: memErr } = await supabase
    .from('class_members')
    .select('student_id, student:profiles(id, institutional_id, display_name)')
    .eq('class_id', classId)
    .order('enrolled_at', { ascending: true });
  if (memErr) throw memErr;

  const students = (members || []).map((m) => m.student).filter(Boolean);
  const studentIds = students.map((s) => s.id);

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

  if (assignmentIds.length === 0) {
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
      assignments: [],
      students: students.map((s) => ({
        id: s.id,
        display_name: s.display_name,
        institutional_id: s.institutional_id,
        cells: {},
        rolling_grade: null,
        total_earned_points: 0,
        total_possible_points: 0,
      })),
      class_rolling_grade: null,
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
      .select('id, lesson_id, type')
      .in('lesson_id', lessonIds);
    if (actErr) throw actErr;
    activities = acts || [];
  }

  const autoCountByLesson = {};
  const reviewCountByLesson = {};
  for (const a of activities) {
    if (isAutoGraded(a.type)) {
      autoCountByLesson[a.lesson_id] = (autoCountByLesson[a.lesson_id] || 0) + 1;
    } else {
      reviewCountByLesson[a.lesson_id] =
        (reviewCountByLesson[a.lesson_id] || 0) + 1;
    }
  }

  const assignmentAgg = {};
  for (const a of assignments) {
    assignmentAgg[a.id] = { raw_max: 0, review_item_count: 0 };
  }
  for (const it of items) {
    const agg = assignmentAgg[it.assignment_id];
    if (!agg) continue;
    agg.raw_max += autoCountByLesson[it.lesson_id] || 0;
    agg.review_item_count += reviewCountByLesson[it.lesson_id] || 0;
  }

  const rawMaxByAssignment = {};
  for (const a of assignments) {
    rawMaxByAssignment[a.id] = assignmentAgg[a.id].raw_max;
  }

  const { map: gpMap, warnings, categoryInfo } = computeGradePointsMap({
    assignments,
    categories,
    rawMaxByAssignment,
    useCategories,
  });

  let submissions = [];
  if (studentIds.length > 0) {
    const { data: subs, error: subErr } = await supabase
      .from('submissions')
      .select(
        'id, assignment_id, assignment_item_id, lesson_id, student_id, status, score, max_auto_score, attempt_number, submitted_at, created_at'
      )
      .in('assignment_id', assignmentIds)
      .in('student_id', studentIds);
    if (subErr) throw subErr;
    submissions = subs || [];
  }

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
      agg.raw_max > 0;

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
      let rawEarned = 0;
      let hasAnySub = false;

      for (const it of items) {
        if (it.assignment_id !== asn.id) continue;
        const sub = latestByKey[`${s.id}|${it.id}`];
        if (!sub) continue;
        hasAnySub = true;
        if (sub.status === 'completed' && sub.max_auto_score > 0) {
          rawEarned += (sub.score / 100) * sub.max_auto_score;
        }
      }

      const pct = meta.raw_max > 0 ? (rawEarned / meta.raw_max) * 100 : null;
      const contribution =
        meta.raw_max > 0 ? (rawEarned / meta.raw_max) * meta.grade_points_raw : 0;

      cells[asn.id] = {
        raw_earned: round2(rawEarned),
        raw_max: meta.raw_max,
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

    const rolling =
      totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;

    return {
      id: s.id,
      display_name: s.display_name,
      institutional_id: s.institutional_id,
      cells,
      rolling_grade: rolling != null ? round1(rolling) : null,
      total_earned_points: round2(totalEarned),
      total_possible_points: round2(totalPossible),
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
    assignments: assignmentsOut,
    students: studentRows,
    class_rolling_grade: classRolling != null ? round1(classRolling) : null,
  };
}

// ---------------------------------------------------------------------
// Per-cell detail for the click-a-cell panel.
// ---------------------------------------------------------------------
export async function getCellDetail(studentId, assignmentId) {
  const { data: items, error: itmErr } = await supabase
    .from('assignment_items')
    .select('id, position, type, title, lesson_id, lesson:lessons(id, title)')
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
      .select('id, lesson_id, type')
      .in('lesson_id', lessonIds);
    if (actErr) throw actErr;
    activities = acts || [];
  }
  const autoByLesson = {};
  const reviewByLesson = {};
  for (const a of activities) {
    if (isAutoGraded(a.type)) {
      autoByLesson[a.lesson_id] = (autoByLesson[a.lesson_id] || 0) + 1;
    } else {
      reviewByLesson[a.lesson_id] = (reviewByLesson[a.lesson_id] || 0) + 1;
    }
  }

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

  const rows = itemList.map((it) => {
    const sub = latestByItem[it.id];
    const rawMax = autoByLesson[it.lesson_id] || 0;
    const reviewCount = reviewByLesson[it.lesson_id] || 0;
    let rawEarned = 0;
    if (sub && sub.status === 'completed' && sub.max_auto_score > 0) {
      rawEarned = (sub.score / 100) * sub.max_auto_score;
    }
    const pct = rawMax > 0 ? (rawEarned / rawMax) * 100 : null;
    return {
      item_id: it.id,
      title: it.title || it.lesson?.title || 'Lesson',
      lesson_id: it.lesson_id,
      raw_earned: round2(rawEarned),
      raw_max: rawMax,
      review_count: reviewCount,
      pct: pct != null ? round1(pct) : null,
      status: sub ? sub.status : 'not_started',
      submitted_at: sub ? sub.submitted_at : null,
      attempt_number: sub ? sub.attempt_number : null,
    };
  });

  return rows;
}

// ---------------------------------------------------------------------
// Student dashboard badge.
// ---------------------------------------------------------------------
export async function getStudentRollingGradeForClass(classId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { rolling_grade: null, total_earned_points: 0, total_possible_points: 0 };
  }

  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('use_categories')
    .eq('id', classId)
    .maybeSingle();
  if (clsErr) throw clsErr;
  const useCategories = Boolean(cls?.use_categories);

  const { data: assignments, error: asnErr } = await supabase
    .from('assignments')
    .select('id, status, due_at, grade_points, category_id, title')
    .eq('class_id', classId);
  if (asnErr) throw asnErr;
  if (!assignments || assignments.length === 0) {
    return { rolling_grade: null, total_earned_points: 0, total_possible_points: 0 };
  }
  const assignmentIds = assignments.map((a) => a.id);

  let categories = [];
  if (useCategories) {
    const { data: cats, error: catErr } = await supabase
      .from('grade_categories')
      .select('id, name, weight')
      .eq('class_id', classId);
    if (catErr) throw catErr;
    categories = cats || [];
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
      .select('id, lesson_id, type')
      .in('lesson_id', lessonIds);
    if (actErr) throw actErr;
    activities = acts || [];
  }
  const autoCountByLesson = {};
  for (const a of activities) {
    if (isAutoGraded(a.type)) {
      autoCountByLesson[a.lesson_id] = (autoCountByLesson[a.lesson_id] || 0) + 1;
    }
  }
  const rawMaxByAssignment = {};
  for (const it of itemList) {
    rawMaxByAssignment[it.assignment_id] =
      (rawMaxByAssignment[it.assignment_id] || 0) +
      (autoCountByLesson[it.lesson_id] || 0);
  }

  const { map: gpMap } = computeGradePointsMap({
    assignments,
    categories,
    rawMaxByAssignment,
    useCategories,
  });

  const { data: subs, error: subErr } = await supabase
    .from('submissions')
    .select('assignment_item_id, status, score, max_auto_score, attempt_number')
    .in('assignment_id', assignmentIds)
    .eq('student_id', user.id);
  if (subErr) throw subErr;

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

  for (const asn of assignments) {
    const rawMax = rawMaxByAssignment[asn.id] || 0;
    const gp = gpMap[asn.id] || { value: 0, source: 'default' };
    const isDue = asn.due_at ? new Date(asn.due_at).getTime() < now : false;
    const isPublished = asn.status === 'published' || asn.status === 'archived';
    if (
      !isDue ||
      !isPublished ||
      rawMax === 0 ||
      gp.value <= 0 ||
      gp.source === 'excluded'
    ) {
      continue;
    }

    let rawEarned = 0;
    for (const it of itemList) {
      if (it.assignment_id !== asn.id) continue;
      const sub = latestByItem[it.id];
      if (sub && sub.status === 'completed' && sub.max_auto_score > 0) {
        rawEarned += (sub.score / 100) * sub.max_auto_score;
      }
    }
    totalEarned += (rawEarned / rawMax) * gp.value;
    totalPossible += gp.value;
  }

  const rolling = totalPossible > 0 ? (totalEarned / totalPossible) * 100 : null;
  return {
    rolling_grade: rolling != null ? round1(rolling) : null,
    total_earned_points: round2(totalEarned),
    total_possible_points: round2(totalPossible),
  };
}