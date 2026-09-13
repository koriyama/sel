// src/lib/calendarApi.js
import { supabase } from './supabaseClient';

export const CLASS_COLORS = [
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

export function defaultClassColor(index) {
  return CLASS_COLORS[index % CLASS_COLORS.length];
}

// Return the JST date for an ISO timestamp, as 'YYYY-MM-DD'.
export function toJstDateKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}`;
}

export function todayJstKey() {
  return toJstDateKey(new Date().toISOString());
}

export function offsetDateKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function formatJstTimeOnly(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatJstLongDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Build a map: 'YYYY-MM-DD' -> [assignment, ...]
export function buildDateMap(assignments) {
  const map = {};
  for (const a of assignments || []) {
    const key = toJstDateKey(a.due_at);
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(a);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  }
  return map;
}

// Return the grid of dates for a given month.
// weekStartsOn: 0 = Sunday, 1 = Monday.
// Returns 42 date keys.
export function buildMonthGrid(year, month, weekStartsOn = 1) {
  const first = new Date(Date.UTC(year, month, 1));
  const firstWeekday = first.getUTCDay();
  let offset = firstWeekday - weekStartsOn;
  if (offset < 0) offset += 7;
  const startDate = new Date(first);
  startDate.setUTCDate(startDate.getUTCDate() - offset);
  const days = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (let i = 0; i < 42; i++) {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    );
  }
  return days;
}

// Fetch all assignments owned by the current teacher.
export async function listTeacherCalendarAssignments() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('assignments')
    .select('id, title, due_at, start_at, status, class_id, class:classes(id, name, color)')
    .eq('teacher_id', user.id)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((a) => ({
    ...a,
    class: a.class
      ? { ...a.class, color: a.class.color || '#94a3b8' }
      : null,
  }));
}

// Fetch published assignments for the current student's classes.
export async function listStudentCalendarAssignments() {
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
    .select('id, title, due_at, start_at, status, class_id, class:classes(id, name, color)')
    .in('class_id', classIds)
    .eq('status', 'published')
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((a) => ({
    ...a,
    class: a.class
      ? { ...a.class, color: a.class.color || '#94a3b8' }
      : null,
  }));
}

// Filter assignments whose due_at falls between startKey and endKey
// (inclusive), both 'YYYY-MM-DD' in JST.
export function filterByDateWindow(assignments, startKey, endKey) {
  return (assignments || []).filter((a) => {
    const k = toJstDateKey(a.due_at);
    if (!k) return false;
    return k >= startKey && k <= endKey;
  });
}