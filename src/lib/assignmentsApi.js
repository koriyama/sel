// src/lib/assignmentsApi.js
import { supabase } from './supabaseClient';
import { duplicateLesson } from './api';

// ---------- attachment constants ----------

const ATTACHMENT_BUCKET = 'assignment-attachments';
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const ATTACHMENT_SIGNED_URL_SECONDS = 60 * 60; // 60 minutes

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.tex', '.pages',
  '.xls', '.xlsx', '.ods', '.csv', '.numbers',
  '.ppt', '.pptx', '.odp', '.key',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.bmp', '.svg',
  '.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac',
  '.r', '.rmd', '.ipynb',
]);

const BLOCKED_ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.aac', '.flac']);

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

// ---------- attachment helpers (exported for the UI) ----------

function getExtension(fileName) {
  if (!fileName) return '';
  const name = String(fileName);
  const lastDot = name.lastIndexOf('.');
  if (lastDot < 0) return '';
  return name.slice(lastDot).toLowerCase();
}

export function isAllowedAttachment(file) {
  if (!file || !file.name) return false;
  const ext = getExtension(file.name);
  return ALLOWED_EXTENSIONS.has(ext);
}

export function isAudioAttachment(fileName) {
  return AUDIO_EXTENSIONS.has(getExtension(fileName));
}

export function allowedAttachmentExtensions() {
  return Array.from(ALLOWED_EXTENSIONS).sort();
}

export function attachmentMaxBytes() {
  return ATTACHMENT_MAX_BYTES;
}

export function formatFileSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function validateAttachment(file) {
  if (!file) throw new Error('No file selected.');
  if (typeof file.size !== 'number') {
    throw new Error('That is not a file. Please choose a file from your device.');
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new Error(
      `That file is too large. The maximum is ${formatFileSize(ATTACHMENT_MAX_BYTES)}.`
    );
  }
  const ext = getExtension(file.name);
  if (!ext) {
    throw new Error('That file has no extension, so we cannot check its type.');
  }
  if (BLOCKED_ARCHIVE_EXTENSIONS.has(ext)) {
    throw new Error(
      `Archive files (${ext}) are not allowed. Please upload the individual files.`
    );
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `File type "${ext}" is not allowed. Allowed types: ${allowedAttachmentExtensions().join(', ')}.`
    );
  }
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sanitizeFileName(name) {
  return String(name)
    .replace(/[\/\\]/g, '_')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 200) || 'file';
}

function buildAttachmentPath(assignmentId, itemId, fileName) {
  const uuid = generateUuid();
  const safe = sanitizeFileName(fileName);
  return `assignments/${assignmentId}/${itemId}/${uuid}-${safe}`;
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
      'id, assignment_id, position, type, title, body, lesson_id, is_optional, url, file_path, file_name, file_size, mime_type, created_at, lesson:lessons(id, title, share_slug, level, status)'
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
      'id, assignment_id, position, type, title, body, lesson_id, url, file_path, file_name, file_size, mime_type, lesson:lessons(id, title, share_slug, level, status)'
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

async function nextItemPosition(assignmentId) {
  const { data } = await supabase
    .from('assignment_items')
    .select('position')
    .eq('assignment_id', assignmentId)
    .order('position', { ascending: false })
    .limit(1);
  return data && data[0] ? data[0].position + 1 : 0;
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

  const nextPos = await nextItemPosition(assignmentId);
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
  const nextPos = await nextItemPosition(assignmentId);
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

export async function addFileItem({ assignmentId, title }) {
  const nextPos = await nextItemPosition(assignmentId);
  const { data, error } = await supabase
    .from('assignment_items')
    .insert({
      assignment_id: assignmentId,
      position: nextPos,
      type: 'file',
      title: (title || '').trim() || 'File',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function addLinkItem({
  assignmentId,
  title,
  url,
  description,
  allowEmptyUrl = false,
}) {
  const cleanUrl = (url || '').trim();
  if (!allowEmptyUrl) {
    if (!cleanUrl) throw new Error('Please enter a URL.');
    if (!/^https?:\/\//i.test(cleanUrl)) {
      throw new Error('The URL must start with http:// or https://');
    }
  }
  const nextPos = await nextItemPosition(assignmentId);
  const { data, error } = await supabase
    .from('assignment_items')
    .insert({
      assignment_id: assignmentId,
      position: nextPos,
      type: 'link',
      title: (title || '').trim() || 'Link',
      url: cleanUrl || null,
      body: description || '',
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
    .select('id, type, lesson_id, file_path')
    .eq('id', itemId)
    .maybeSingle();
  if (getErr) throw getErr;
  if (!item) return;

  const { error: delErr } = await supabase
    .from('assignment_items')
    .delete()
    .eq('id', itemId);
  if (delErr) throw delErr;

  if (item.type === 'file' && item.file_path) {
    try { await deleteAttachment(item.file_path); } catch { /* ignore */ }
  }

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
  const filePaths = items
    .filter((it) => it.type === 'file' && it.file_path)
    .map((it) => it.file_path);

  const { error: aErr } = await supabase.from('assignments').delete().eq('id', id);
  if (aErr) throw aErr;

  if (filePaths.length > 0) {
    try {
      await supabase.storage.from(ATTACHMENT_BUCKET).remove(filePaths);
    } catch { /* best effort */ }
  }

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

// ---------- attachments (storage) ----------

export async function uploadAttachment(file, assignmentId, itemId) {
  validateAttachment(file);
  const path = buildAttachmentPath(assignmentId, itemId, file.name);

  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (error) throw error;

  return {
    path,
    name: file.name,
    size: file.size,
    mime_type: file.type || null,
  };
}

export async function deleteAttachment(filePath) {
  if (!filePath) return;
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .remove([filePath]);
  if (error) throw error;
}

export async function getAttachmentSignedUrl(filePath, opts = {}) {
  if (!filePath) throw new Error('No file path provided.');
  const {
    download = true,
    fileName = null,
    expiresIn = ATTACHMENT_SIGNED_URL_SECONDS,
  } = opts;

  const options = {};
  if (download) {
    options.download = fileName || true;
  }

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(filePath, expiresIn, options);
  if (error) throw error;
  if (!data || !data.signedUrl) {
    throw new Error('Could not create a download link.');
  }
  return data.signedUrl;
}

export async function attachFileToItem({ itemId, assignmentId, file, oldPath = null }) {
  validateAttachment(file);
  const path = buildAttachmentPath(assignmentId, itemId, file.name);

  const { error: upErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
  if (upErr) throw upErr;

  const patch = {
    file_path: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || null,
  };

  const { data, error: dbErr } = await supabase
    .from('assignment_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .select()
    .single();

  if (dbErr) {
    try { await deleteAttachment(path); } catch { /* ignore */ }
    throw dbErr;
  }

  if (oldPath && oldPath !== path) {
    try { await deleteAttachment(oldPath); } catch { /* best effort */ }
  }

  return data;
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

// ---------- duplicate ----------
//
// Copies an assignment, all its items, and any lesson copies the items point
// at. Submissions and grades are NOT copied. The copy lands as a draft at the
// top of the target class.
//
// The title carries over unchanged. If you want a different title in the
// target class, edit it in the modal before confirming.
export async function duplicateAssignment(sourceAssignmentId, targetClassId, overrides = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not logged in');

  const source = await getAssignmentById(sourceAssignmentId);
  if (!source) throw new Error('Source assignment not found.');
  const sourceItems = await listAssignmentItems(sourceAssignmentId);

  const targetCategoryId =
    source.class_id === targetClassId ? source.category_id : null;

  const { data: topRows } = await supabase
    .from('assignments')
    .select('position')
    .eq('class_id', targetClassId)
    .order('position', { ascending: false, nullsFirst: false })
    .limit(1);
  const maxPosition = topRows && topRows[0] && topRows[0].position
    ? topRows[0].position
    : 0;
  const nextPosition = maxPosition + 1;

  // Source title, with any legacy "(copy)" suffix stripped so we don't
  // propagate old naming into a fresh copy.
  const baseTitle = stripCopySuffix(source.title || '') || 'Assignment';
  const finalTitle =
    overrides.title && overrides.title.trim()
      ? overrides.title.trim()
      : baseTitle;

  const { data: newAssignment, error: asnErr } = await supabase
    .from('assignments')
    .insert({
      class_id: targetClassId,
      teacher_id: user.id,
      title: finalTitle,
      instructions: source.instructions || null,
      start_at: source.start_at || null,
      due_at: source.due_at || null,
      status: 'draft',
      position: nextPosition,
      grade_points: source.grade_points,
      category_id: targetCategoryId,
      allow_retakes: source.allow_retakes || false,
    })
    .select()
    .single();
  if (asnErr) throw asnErr;

  try {
    for (let i = 0; i < sourceItems.length; i++) {
      const item = sourceItems[i];
      const baseRow = {
        assignment_id: newAssignment.id,
        position: i,
        type: item.type,
        title: item.title || null,
        body: item.body || null,
        is_optional: item.is_optional || false,
      };

      if (item.type === 'lesson' && item.lesson_id) {
        const lessonCopy = await duplicateLesson(item.lesson_id, user.id, null);
        const cleanLessonTitle = stripCopySuffix(lessonCopy.title);
        const { error: tagErr } = await supabase
          .from('lessons')
          .update({ class_id: targetClassId, title: cleanLessonTitle })
          .eq('id', lessonCopy.id);
        if (tagErr) throw tagErr;

        const { error: itmErr } = await supabase
          .from('assignment_items')
          .insert({ ...baseRow, lesson_id: lessonCopy.id })
          .select()
          .single();
        if (itmErr) throw itmErr;
      } else if (item.type === 'file' && item.file_path) {
        const { data: created, error: itmErr } = await supabase
          .from('assignment_items')
          .insert(baseRow)
          .select()
          .single();
        if (itmErr) throw itmErr;

        try {
          const blob = await downloadAttachmentBlob(item.file_path);
          if (blob) {
            const newFile = new File(
              [blob],
              item.file_name || 'file',
              { type: item.mime_type || '' }
            );
            await attachFileToItem({
              itemId: created.id,
              assignmentId: newAssignment.id,
              file: newFile,
            });
          }
        } catch (fileErr) {
          console.error('Could not copy attachment:', fileErr);
        }
      } else if (item.type === 'link') {
        const { error: itmErr } = await supabase
          .from('assignment_items')
          .insert({ ...baseRow, url: item.url || null })
          .select()
          .single();
        if (itmErr) throw itmErr;
      } else {
        const { error: itmErr } = await supabase
          .from('assignment_items')
          .insert(baseRow)
          .select()
          .single();
        if (itmErr) throw itmErr;
      }
    }
  } catch (err) {
    try { await deleteAssignment(newAssignment.id); } catch { /* ignore */ }
    throw err;
  }

  return newAssignment;
}

async function downloadAttachmentBlob(filePath) {
  if (!filePath) return null;
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .download(filePath);
  if (error) throw error;
  return data;
}