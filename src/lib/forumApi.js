// src/lib/forumApi.js
import { supabase } from './supabaseClient';

// ---------------------------------------------------------------------------
// Data access for forums. Every function either returns data or throws.
// Plain English: the pages call these; they do the talking to the database.
// ---------------------------------------------------------------------------

export async function listForumsForClass(classId) {
  const { data, error } = await supabase
    .from('forums')
    .select('*')
    .eq('class_id', classId)
    .order('is_pinned', { ascending: false })
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getForumById(forumId) {
  const { data, error } = await supabase
    .from('forums')
    .select('*')
    .eq('id', forumId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Create a forum. Goes through an RPC (create_forum) so the insert bypasses
// the PostgREST RLS path that has been unreliable for writes on this table.
// The function itself does the permission check using user_can_insert_forum.
export async function createForum({
  classId,
  title,
  description,
  allowStudentThreads,
  replyToEmail,
}) {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw new Error('Title is required.');

  const { data, error } = await supabase.rpc('create_forum', {
    p_class_id: classId,
    p_title: cleanTitle,
    p_description: (description || '').trim() || null,
    p_allow_student_threads: !!allowStudentThreads,
    p_reply_to_email: !!replyToEmail,
  });
  if (error) throw error;
  return data;
}

// Update a forum. Goes through an RPC (update_forum) taking a JSONB patch.
// Only keys present in `patch` are applied. Recognised keys:
//   title, description, allow_student_threads, reply_to_email, position.
// The function does the permission check using user_can_moderate_forum.
export async function updateForum(forumId, patch) {
  if (!forumId) throw new Error('forumId is required.');
  if (!patch || typeof patch !== 'object') {
    throw new Error('patch must be an object.');
  }
  const { data, error } = await supabase.rpc('update_forum', {
    p_forum_id: forumId,
    p_patch: patch,
  });
  if (error) throw error;
  return data;
}

export async function deleteForum(forumId) {
  const { error } = await supabase.from('forums').delete().eq('id', forumId);
  if (error) throw error;
}

// Pin / unpin a FORUM (not a thread). Moderator only.
export async function setForumPinned(forumId, pinned) {
  if (!forumId) throw new Error('forumId is required.');
  const { data, error } = await supabase.rpc('set_forum_pinned', {
    p_forum_id: forumId,
    p_pinned: !!pinned,
  });
  if (error) throw error;
  return data;
}

export async function listThreadsForForum(forumId) {
  const { data, error } = await supabase
    .from('forum_posts')
    .select('*')
    .eq('forum_id', forumId)
    .is('parent_post_id', null)
    .eq('is_deleted', false)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createThread({ forumId, title, body }) {
  const cleanTitle = (title || '').trim();
  if (!cleanTitle) throw new Error('Title is required.');
  const cleanBody = (body || '').trim();
  if (!cleanBody) throw new Error('Body is required.');

  const { data, error } = await supabase.rpc('create_forum_post', {
    p_forum_id: forumId,
    p_parent_post_id: null,
    p_title: cleanTitle,
    p_body: cleanBody,
    p_visibility: 'public',
    p_private_to_user_id: null,
  });
  if (error) throw error;
  return data;
}

export async function createReply({
  parentPostId,
  body,
  visibility = 'public',
  privateToUserId = null,
}) {
  if (!parentPostId) throw new Error('parentPostId is required.');
  const cleanBody = (body || '').trim();
  if (!cleanBody) throw new Error('Body is required.');

  const { data, error } = await supabase.rpc('create_forum_reply', {
    p_parent_post_id: parentPostId,
    p_body: cleanBody,
    p_visibility: visibility,
    p_private_to_user_id: privateToUserId,
  });
  if (error) throw error;
  return data;
}

export async function renameThread(postId, title) {
  if (!postId) throw new Error('postId is required.');
  const clean = (title || '').trim();
  if (!clean) throw new Error('Title is required.');

  const { data, error } = await supabase.rpc('rename_forum_thread', {
    p_post_id: postId,
    p_title: clean,
  });
  if (error) throw error;
  return data;
}

export async function softDeletePost(postId) {
  if (!postId) throw new Error('postId is required.');
  const { data, error } = await supabase.rpc('soft_delete_forum_post', {
    p_post_id: postId,
  });
  if (error) throw error;
  return data;
}

export async function setPostPinned(postId, pinned) {
  if (!postId) throw new Error('postId is required.');
  const { data, error } = await supabase.rpc('set_forum_post_pinned', {
    p_post_id: postId,
    p_pinned: !!pinned,
  });
  if (error) throw error;
  return data;
}

export async function setPostLocked(postId, locked) {
  if (!postId) throw new Error('postId is required.');
  const { data, error } = await supabase.rpc('set_forum_post_locked', {
    p_post_id: postId,
    p_locked: !!locked,
  });
  if (error) throw error;
  return data;
}

export async function checkIsForumModerator(forumId) {
  if (!forumId) return false;
  const { data, error } = await supabase.rpc('user_can_moderate_forum', {
    p_forum_id: forumId,
  });
  if (error) {
    console.warn('checkIsForumModerator:', error.message);
    return false;
  }
  return data === true;
}

export async function getThreadById(threadId) {
  const { data, error } = await supabase
    .from('forum_posts')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPostsForForum(forumId) {
  const { data, error } = await supabase
    .from('forum_posts')
    .select('*')
    .eq('forum_id', forumId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function markThreadRead(threadId) {
  if (!threadId) return null;
  const { data, error } = await supabase.rpc('mark_thread_read', {
    p_post_id: threadId,
  });
  if (error) throw error;
  return data;
}

export async function listThreadReaderIds(threadId) {
  if (!threadId) return [];
  const { data, error } = await supabase
    .from('forum_reads')
    .select('user_id, last_read_at')
    .eq('post_id', threadId);
  if (error) throw error;
  return data || [];
}

export async function listEnrolledStudentIds(classId) {
  if (!classId) return [];
  const { data, error } = await supabase
    .from('class_members')
    .select('student_id')
    .eq('class_id', classId);
  if (error) throw error;
  return (data || []).map((m) => m.student_id).filter(Boolean);
}

export async function listPrivateReplyRecipients({ classId, isTeacher }) {
  if (!classId) return [];

  if (isTeacher) {
    const { data: members, error } = await supabase
      .from('class_members')
      .select('student_id')
      .eq('class_id', classId);
    if (error) {
      console.warn('listPrivateReplyRecipients (students):', error.message);
      return [];
    }
    const ids = (members || []).map((m) => m.student_id).filter(Boolean);
    if (ids.length === 0) return [];
    const map = await getProfilesByIds(ids);
    return ids
      .map((id) => map[id])
      .filter(Boolean)
      .sort((a, b) =>
        (a.display_name || '').localeCompare(b.display_name || '')
      );
  }

  const { data: cls, error } = await supabase
    .from('classes')
    .select('teacher_id')
    .eq('id', classId)
    .maybeSingle();
  if (error || !cls?.teacher_id) {
    if (error) {
      console.warn('listPrivateReplyRecipients (teacher):', error.message);
    }
    return [];
  }
  const map = await getProfilesByIds([cls.teacher_id]);
  const teacher = map[cls.teacher_id];
  return teacher ? [teacher] : [];
}

export async function getProfilesByIds(userIds) {
  if (!userIds || userIds.length === 0) return {};
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const { data, error } = await supabase.rpc('get_visible_profiles_for_ids', {
    p_user_ids: unique,
  });
  if (error) {
    console.warn('getProfilesByIds:', error.message);
    return {};
  }
  const map = {};
  for (const p of data || []) map[p.id] = p;
  return map;
}

// Testing helper: who am I right now?
// Carry-over: this does not really belong in forumApi.js. When a proper
// auth/profile API module exists, move it there.
export async function getMyIdentity() {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;
  const user = userData?.user;
  if (!user) return null;

  let display_name = null;
  let role = null;
  try {
    const map = await getProfilesByIds([user.id]);
    const p = map[user.id];
    if (p) {
      display_name = p.display_name || null;
      role = p.role || null;
    }
  } catch (err) {
    console.warn('getMyIdentity: profile lookup failed:', err?.message);
  }

  return {
    id: user.id,
    email: user.email || null,
    display_name,
    role,
  };
}