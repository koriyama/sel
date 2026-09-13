// src/lib/lmsApi.js
import { supabase } from './supabaseClient';
import { defaultClassColor } from './calendarApi';

// Convert an institutional ID to the internal Supabase Auth email.
export function institutionalIdToEmail(institutionalId) {
  if (!institutionalId) return '';
  const safe = String(institutionalId).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${safe}@students.local`;
}

// ---------- profile ----------
export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMyDisplayName(newName) {
  const { error } = await supabase.rpc('update_my_display_name', {
    new_name: newName,
  });
  if (error) throw error;
}

export async function markPasswordChanged() {
  const { error } = await supabase.rpc('mark_password_changed');
  if (error) throw error;
}

// ---------- classes ----------
export async function listMyClassesAsTeacher() {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listMyClassesAsStudent() {
  const { data, error } = await supabase
    .from('class_members')
    .select('class_id, classes(id, name, description, start_date, end_date, color)')
    .order('enrolled_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => row.classes).filter(Boolean);
}

export async function createClass({ name, description, start_date, end_date }) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in');

  const { count } = await supabase
    .from('classes')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', user.id);

  const color = defaultClassColor(count || 0);

  const { data, error } = await supabase
    .from('classes')
    .insert({
      teacher_id: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      start_date: start_date || null,
      end_date: end_date || null,
      color,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getClassById(id) {
  const { data, error } = await supabase
    .from('classes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateClass(id, patch) {
  const { data, error } = await supabase
    .from('classes')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteClass(id) {
  const { error } = await supabase.from('classes').delete().eq('id', id);
  if (error) throw error;
}

export async function listClassRoster(classId) {
  const { data, error } = await supabase
    .from('class_members')
    .select(
      'id, enrolled_at, student_id, ' +
      'student:profiles(id, institutional_id, display_name, role, must_change_password, created_at)'
    )
    .eq('class_id', classId)
    .order('enrolled_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function removeStudentFromClass(classId, studentId) {
  const { error } = await supabase
    .from('class_members')
    .delete()
    .eq('class_id', classId)
    .eq('student_id', studentId);
  if (error) throw error;
}

// Add an existing student to a class by institutional ID. Delegates to
// a SECURITY DEFINER SQL function, which handles permission checks,
// case-insensitive lookup, and the "already enrolled" case.
//
// Returns the JSON payload from the function:
//   { ok: true,  already_enrolled: false, student: {...} }  — newly added
//   { ok: true,  already_enrolled: true,  student: {...} }  — was already in the class
//   { ok: false, error: "..." }                             — problem
export async function enrollStudentByInstitutionalId(classId, institutionalId) {
  const { data, error } = await supabase.rpc(
    'enroll_student_by_institutional_id',
    {
      p_class_id: classId,
      p_institutional_id: institutionalId,
    }
  );
  if (error) throw error;
  return data;
}

// ---------- Edge Function calls ----------
async function callAdminStudentManager(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not logged in');

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-student-manager`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  let body;
  try {
    body = await res.json();
  } catch (_) {
    body = { error: 'Invalid response from server' };
  }

  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body;
}

export async function importStudentsCsv({ students, classId }) {
  return callAdminStudentManager({
    action: 'create_bulk',
    students,
    class_id: classId || undefined,
  });
}

export async function resetStudentPassword(studentId) {
  return callAdminStudentManager({
    action: 'reset_password',
    student_id: studentId,
  });
}