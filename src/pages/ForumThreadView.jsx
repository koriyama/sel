// src/pages/ForumThreadView.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import toast from 'react-hot-toast';
import Editor from 'react-simple-wysiwyg';
import DOMPurify from 'dompurify';
import { supabase } from '../lib/supabaseClient';
import {
  getThreadById,
  getForumById,
  getProfilesByIds,
  listPostsForForum,
  createReply,
  listPrivateReplyRecipients,
  markThreadRead,
  listThreadReaderIds,
  listEnrolledStudentIds,
  renameThread,
  softDeletePost,
  setPostPinned,
  setPostLocked,
  checkIsForumModerator,
} from '../lib/forumApi';
import { formatJst } from '../lib/assignmentsApi';

const neutralBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 16px',
  backgroundColor: '#e5e7eb',
  color: '#000000',
  fontSize: '14px',
  fontWeight: '500',
  borderRadius: '6px',
  border: '1px solid #9ca3af',
  textDecoration: 'none',
};

const smallBtn = {
  ...neutralBtn,
  padding: '4px 10px',
  fontSize: '12px',
};

const linkBtn = {
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  color: '#4f46e5',
  cursor: 'pointer',
  fontSize: '12px',
  textDecoration: 'underline',
};

function buildTree(posts, rootId) {
  const byId = new Map();
  for (const p of posts) byId.set(p.id, { ...p, children: [] });

  const root = byId.get(rootId);
  if (!root) return null;

  const byParent = new Map();
  for (const p of posts) {
    if (p.id === rootId) continue;
    if (!p.parent_post_id) continue;
    if (!byParent.has(p.parent_post_id)) byParent.set(p.parent_post_id, []);
    byParent.get(p.parent_post_id).push(p.id);
  }

  const attach = (node) => {
    const childIds = byParent.get(node.id) || [];
    for (const cid of childIds) {
      const child = byId.get(cid);
      if (child) {
        node.children.push(child);
        attach(child);
      }
    }
  };
  attach(root);
  return root;
}

function defaultReplyVisibility(parentPost, currentUserId, recipients) {
  if (parentPost.visibility !== 'private') {
    return { defaultPrivate: false, defaultPrivateToId: '' };
  }

  let recipientId = '';
  if (parentPost.author_id === currentUserId) {
    recipientId = parentPost.private_to_user_id || '';
  } else {
    recipientId = parentPost.author_id || '';
  }

  const allowed = recipients.some((r) => r.id === recipientId);
  if (!allowed) {
    return { defaultPrivate: false, defaultPrivateToId: '' };
  }
  return { defaultPrivate: true, defaultPrivateToId: recipientId };
}

function ReplyForm({
  onSubmit,
  onCancel,
  recipients,
  defaultPrivate,
  defaultPrivateToId,
  isTeacher,
}) {
  const [body, setBody] = useState('');
  const [isPrivate, setIsPrivate] = useState(!!defaultPrivate);
  const [privateToId, setPrivateToId] = useState(defaultPrivateToId || '');
  const [submitting, setSubmitting] = useState(false);

  const canGoPrivate = recipients.length > 0;

  const privateLabel = isTeacher
    ? 'Private reply to one student (not visible to the rest of the class)'
    : 'Private reply only to the teacher';

  const handleSubmit = async (e) => {
    e.preventDefault();
    const safe = DOMPurify.sanitize(body || '');
    if (!safe.trim() || safe === '<br>') {
      toast.error('Please write something in the reply.');
      return;
    }
    if (isPrivate && !privateToId) {
      toast.error('Choose who this private reply is for.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        body: safe,
        visibility: isPrivate ? 'private' : 'public',
        privateToUserId: isPrivate ? privateToId : null,
      });
      setBody('');
      setIsPrivate(!!defaultPrivate);
      setPrivateToId(defaultPrivateToId || '');
    } catch {
      // Parent surfaced the error.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2">
      <div className="border border-gray-300 rounded-md bg-white">
        <Editor value={body} onChange={(e) => setBody(e.target.value)} />
      </div>

      {canGoPrivate && (
        <div className="flex flex-col gap-2 text-sm text-gray-700">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => {
                setIsPrivate(e.target.checked);
                if (e.target.checked && !privateToId) {
                  setPrivateToId(recipients[0]?.id || '');
                }
              }}
              disabled={submitting}
            />
            {privateLabel}
          </label>
          {isPrivate && (
            <label className="flex items-center gap-2">
              <span className="text-xs text-gray-600">To:</span>
              <select
                value={privateToId}
                onChange={(e) => setPrivateToId(e.target.value)}
                disabled={submitting}
                className="px-2 py-1 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="">— choose —</option>
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.display_name || 'Unknown'}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting} style={smallBtn}>
          {submitting ? 'Posting…' : 'Post reply'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          style={smallBtn}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function PostNode({
  post,
  depth,
  authors,
  threadPath,
  onReply,
  onRename,
  onDelete,
  onPin,
  onLock,
  recipients,
  currentUserId,
  isModerator,
  isTeacher,
  replyingToPostId,
  setReplyingToPostId,
}) {
  const author = authors[post.author_id];
  const isReplyingHere = replyingToPostId === post.id;
  const hasChildren = post.children.length > 0;

  const showChildrenInline = depth < 2;
  const showContinueLink = depth >= 2 && hasChildren;

  const safeBody = DOMPurify.sanitize(post.body || '');

  const isPrivate = post.visibility === 'private';
  const privateToName = isPrivate
    ? authors[post.private_to_user_id]?.display_name || 'someone'
    : null;

  const isThread = !post.parent_post_id;
  const isAuthor = post.author_id === currentUserId;
  const canReply = !post.is_locked && !post.is_deleted;
  const canRename = isThread && (isAuthor || isModerator);
  const canDelete = isAuthor || isModerator;
  const canPin = isThread && isModerator;
  // Replies cannot be pinned or locked per forum_posts_thread_flags_check.
  const canLock = isThread && isModerator;

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(post.title || '');
  const [savingRename, setSavingRename] = useState(false);

  const { defaultPrivate, defaultPrivateToId } = defaultReplyVisibility(
    post,
    currentUserId,
    recipients
  );

  const submitRename = async (e) => {
    e.preventDefault();
    const clean = (renameValue || '').trim();
    if (!clean) {
      toast.error('Title cannot be empty.');
      return;
    }
    setSavingRename(true);
    try {
      await onRename(post.id, clean);
      setIsRenaming(false);
    } catch {
      // Parent surfaced the error.
    } finally {
      setSavingRename(false);
    }
  };

  return (
    <div style={{ marginLeft: depth > 0 ? 20 : 0 }}>
      <article className="bg-white rounded-lg shadow p-4 mt-3">
        {isRenaming ? (
          <form onSubmit={submitRename} className="mb-2 space-y-2">
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              disabled={savingRename}
              className="w-full px-2 py-1 border border-gray-300 rounded-md text-sm"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={savingRename} style={smallBtn}>
                {savingRename ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRenaming(false);
                  setRenameValue(post.title || '');
                }}
                disabled={savingRename}
                style={smallBtn}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          isThread &&
          post.title && (
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {post.title}
            </h2>
          )
        )}

        <div className="text-xs text-gray-500 flex items-center flex-wrap gap-x-2 gap-y-1">
          <span>{author?.display_name || 'Unknown'}</span>
          <span>·</span>
          <span>{formatJst(post.created_at)}</span>
          {post.is_pinned && <span>· pinned</span>}
          {post.is_locked && <span>· locked</span>}
          {isPrivate && (
            <span className="text-purple-700 bg-purple-100 px-2 py-0.5 rounded">
              🔒 private to {privateToName}
            </span>
          )}
        </div>

        <div
          className="prose prose-sm max-w-none text-gray-800 mt-2"
          dangerouslySetInnerHTML={{ __html: safeBody }}
        />

        <div className="mt-2 flex items-center gap-3 flex-wrap">
          {canReply && (
            <button
              type="button"
              onClick={() =>
                setReplyingToPostId(isReplyingHere ? null : post.id)
              }
              style={smallBtn}
            >
              {isReplyingHere ? 'Cancel' : 'Reply'}
            </button>
          )}
          {canRename && !isRenaming && (
            <button
              type="button"
              onClick={() => {
                setRenameValue(post.title || '');
                setIsRenaming(true);
              }}
              style={linkBtn}
            >
              Rename
            </button>
          )}
          {canPin && (
            <button
              type="button"
              onClick={() => onPin(post.id, !post.is_pinned)}
              style={linkBtn}
            >
              {post.is_pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {canLock && (
            <button
              type="button"
              onClick={() => onLock(post.id, !post.is_locked)}
              style={linkBtn}
            >
              {post.is_locked ? 'Unlock' : 'Lock'}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(post.id, isThread)}
              style={linkBtn}
            >
              Delete
            </button>
          )}
        </div>

        {isReplyingHere && (
          <ReplyForm
            key={post.id}
            onSubmit={(payload) => onReply(post.id, payload)}
            onCancel={() => setReplyingToPostId(null)}
            recipients={recipients}
            defaultPrivate={defaultPrivate}
            defaultPrivateToId={defaultPrivateToId}
            isTeacher={isTeacher}
          />
        )}
      </article>

      {showChildrenInline &&
        post.children.map((child) => (
          <PostNode
            key={child.id}
            post={child}
            depth={depth + 1}
            authors={authors}
            threadPath={threadPath}
            onReply={onReply}
            onRename={onRename}
            onDelete={onDelete}
            onPin={onPin}
            onLock={onLock}
            recipients={recipients}
            currentUserId={currentUserId}
            isModerator={isModerator}
            isTeacher={isTeacher}
            replyingToPostId={replyingToPostId}
            setReplyingToPostId={setReplyingToPostId}
          />
        ))}

      {showContinueLink && (
        <div className="mt-2" style={{ marginLeft: 20 }}>
          <Link
            to={`${threadPath}?root=${post.id}`}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            continue this thread →
          </Link>
        </div>
      )}
    </div>
  );
}

export default function ForumThreadView({ mode }) {
  const { id: classId, forumId, threadId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const rootPostId = searchParams.get('root') || threadId;
  const isTeacher = mode === 'teacher';

  const [thread, setThread] = useState(null);
  const [forum, setForum] = useState(null);
  const [posts, setPosts] = useState([]);
  const [authors, setAuthors] = useState({});
  const [recipients, setRecipients] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [isModerator, setIsModerator] = useState(false);
  const [loading, setLoading] = useState(true);
  const [replyingToPostId, setReplyingToPostId] = useState(null);

  const [showReaders, setShowReaders] = useState(false);
  const [totalStudents, setTotalStudents] = useState(0);
  const [unreadStudents, setUnreadStudents] = useState([]);
  const [readersLoaded, setReadersLoaded] = useState(false);

  const forumPath = isTeacher
    ? `/classes/${classId}/forums/${forumId}`
    : `/student/classes/${classId}/forums/${forumId}`;
  const threadPath = isTeacher
    ? `/classes/${classId}/forums/${forumId}/threads/${threadId}`
    : `/student/classes/${classId}/forums/${forumId}/threads/${threadId}`;

  const load = async () => {
    setLoading(true);
    try {
      const [t, f] = await Promise.all([
        getThreadById(threadId),
        getForumById(forumId),
      ]);
      setThread(t);
      setForum(f);
      if (t) {
        const all = await listPostsForForum(forumId);
        setPosts(all);
        const ids = new Set();
        for (const p of all) {
          if (p.author_id) ids.add(p.author_id);
          if (p.private_to_user_id) ids.add(p.private_to_user_id);
        }
        const map = await getProfilesByIds(Array.from(ids));
        setAuthors(map);
      } else {
        setPosts([]);
        setAuthors({});
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not load thread.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, forumId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setCurrentUserId(data?.user?.id || null);
      } catch {
        if (!cancelled) setCurrentUserId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await checkIsForumModerator(forumId);
        if (!cancelled) setIsModerator(ok);
      } catch {
        if (!cancelled) setIsModerator(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [forumId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listPrivateReplyRecipients({ classId, isTeacher });
        if (!cancelled) setRecipients(list);
      } catch (err) {
        console.warn('private reply recipients:', err);
        if (!cancelled) setRecipients([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId, isTeacher]);

  useEffect(() => {
    if (!threadId) return;
    markThreadRead(threadId).catch((err) => {
      console.warn('markThreadRead:', err?.message || err);
    });
  }, [threadId]);

  useEffect(() => {
    if (!isTeacher || !threadId || !classId) return;
    let cancelled = false;
    (async () => {
      try {
        const [enrolledIds, reads] = await Promise.all([
          listEnrolledStudentIds(classId),
          listThreadReaderIds(threadId),
        ]);
        if (cancelled) return;
        const readerSet = new Set(reads.map((r) => r.user_id));
        const unreadIds = enrolledIds.filter((id) => !readerSet.has(id));
        const profilesMap = await getProfilesByIds(unreadIds);
        if (cancelled) return;
        setTotalStudents(enrolledIds.length);
        setUnreadStudents(
          unreadIds.map(
            (id) => profilesMap[id] || { id, display_name: null }
          )
        );
        setReadersLoaded(true);
      } catch (err) {
        console.warn('reader panel:', err?.message || err);
        if (!cancelled) setReadersLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isTeacher, threadId, classId]);

  const tree = useMemo(() => {
    if (!posts.length) return null;
    return buildTree(posts, rootPostId);
  }, [posts, rootPostId]);

  const handleReply = async (parentPostId, payload) => {
    try {
      await createReply({
        parentPostId,
        body: payload.body,
        visibility: payload.visibility,
        privateToUserId: payload.privateToUserId,
      });
      toast.success(
        payload.visibility === 'private'
          ? 'Private reply sent.'
          : 'Reply posted.'
      );
      setReplyingToPostId(null);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not post reply.');
      throw err;
    }
  };

  const handleRename = async (postId, title) => {
    try {
      const updated = await renameThread(postId, title);
      const newTitle = updated?.title ?? title;
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, title: newTitle } : p))
      );
      if (thread?.id === postId) {
        setThread((prev) => (prev ? { ...prev, title: newTitle } : prev));
      }
      toast.success('Thread renamed.');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not rename thread.');
      throw err;
    }
  };

  const handleDelete = async (postId, isThreadPost) => {
    const label = isThreadPost ? 'this thread' : 'this post';
    if (!window.confirm(`Delete ${label}? This cannot be undone from the UI.`)) {
      return;
    }
    try {
      await softDeletePost(postId);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not delete post.');
      return;
    }
    toast.success('Deleted.');

    if (isThreadPost && postId === threadId) {
      navigate(forumPath);
      return;
    }
    if (postId === rootPostId) {
      navigate(threadPath);
      return;
    }
    await load();
  };

  const handlePin = async (postId, pinned) => {
    try {
      await setPostPinned(postId, pinned);
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, is_pinned: pinned } : p))
      );
      toast.success(pinned ? 'Pinned.' : 'Unpinned.');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not update pin.');
    }
  };

  const handleLock = async (postId, locked) => {
    try {
      await setPostLocked(postId, locked);
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, is_locked: locked } : p))
      );
      toast.success(locked ? 'Locked.' : 'Unlocked.');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not update lock.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="min-h-screen p-8 text-center">
        <p className="text-gray-600">Thread not found, or you cannot view it.</p>
        <Link
          to={forumPath}
          className="text-indigo-600 underline mt-4 inline-block"
        >
          Back to forum
        </Link>
      </div>
    );
  }

  const isRooted = rootPostId !== threadId;
  const hasStudents = totalStudents > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-4">
          <Link
            to={forumPath}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← {forum?.title || 'Forum'}
          </Link>
          {!isRooted && (
            <h1 className="text-2xl font-bold text-gray-900 mt-1">
              {thread.title || '(no title)'}
            </h1>
          )}
          {isRooted && (
            <div className="text-xs text-gray-500 mt-1">
              <Link
                to={threadPath}
                className="text-indigo-600 hover:text-indigo-500"
              >
                ← Back to full thread
              </Link>
            </div>
          )}

          {isTeacher && readersLoaded && hasStudents && (
            <div className="mt-3 text-sm">
              <button
                type="button"
                onClick={() => setShowReaders((v) => !v)}
                className="text-indigo-600 hover:text-indigo-500"
              >
                {unreadStudents.length === 0
                  ? 'All students have read this thread'
                  : `${unreadStudents.length} of ${totalStudents} ${
                      totalStudents === 1 ? 'student has' : 'students have'
                    }n't read this thread`}
              </button>
              {showReaders && unreadStudents.length > 0 && (
                <div className="mt-2 bg-white border border-gray-200 rounded p-3">
                  <ul className="list-disc pl-5 text-gray-700">
                    {unreadStudents.map((s) => (
                      <li key={s.id}>
                        {s.display_name || 'Unknown'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {!tree ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            This post is not available.
          </div>
        ) : (
          <PostNode
            post={tree}
            depth={0}
            authors={authors}
            threadPath={threadPath}
            onReply={handleReply}
            onRename={handleRename}
            onDelete={handleDelete}
            onPin={handlePin}
            onLock={handleLock}
            recipients={recipients}
            currentUserId={currentUserId}
            isModerator={isModerator}
            isTeacher={isTeacher}
            replyingToPostId={replyingToPostId}
            setReplyingToPostId={setReplyingToPostId}
          />
        )}
      </div>
    </div>
  );
}