// src/pages/TeacherAssignmentDetail.jsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Editor from 'react-simple-wysiwyg';

import {
  getAssignmentById,
  listAssignmentItems,
  listMyLibraryLessons,
  addLessonItem,
  addTextItem,
  updateAssignmentItem,
  deleteAssignmentItem,
  reorderAssignmentItems,
  setAssignmentStatus,
  deleteAssignment,
  listSubmissionsForAssignment,
  formatJst,
} from '../lib/assignmentsApi';
import { supabase } from '../lib/supabaseClient';

function SortableItemRow({
  item,
  onUpdate,
  onDelete,
  onOpenLesson,
  onViewResults,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const [titleDraft, setTitleDraft] = useState(item.title || '');
  const [bodyDraft, setBodyDraft] = useState(item.body || '');

  useEffect(() => {
    setTitleDraft(item.title || '');
  }, [item.title]);
  useEffect(() => {
    setBodyDraft(item.body || '');
  }, [item.body]);

  const commitTitle = () => {
    if (titleDraft !== item.title) {
      onUpdate({ title: titleDraft });
    }
  };
  const commitBody = () => {
    if (bodyDraft !== item.body) {
      onUpdate({ body: bodyDraft });
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-gray-400 hover:text-gray-700 px-2 py-1 select-none"
          title="Drag to reorder"
        >
          ⋮⋮
        </button>
        <span
          className={
            'text-xs font-medium px-2 py-0.5 rounded-full ' +
            (item.type === 'lesson'
              ? 'bg-indigo-100 text-indigo-800'
              : 'bg-amber-100 text-amber-800')
          }
        >
          {item.type === 'lesson' ? 'Lesson' : 'Note'}
        </span>
        <input
          type="text"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          placeholder="Item title"
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={onDelete}
          className="text-xs text-red-600 hover:text-red-700 px-2"
        >
          Remove
        </button>
      </div>

      {item.type === 'lesson' && item.lesson && (
        <div className="pl-8 flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          <span>
            Lesson copy: <span className="font-medium">{item.lesson.title}</span>
          </span>
          {item.lesson.share_slug && (
            <Link
              to={`/lesson/${item.lesson.share_slug}?draft=true`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 hover:text-indigo-500"
            >
              Preview →
            </Link>
          )}
          <button
            type="button"
            onClick={onViewResults}
            className="text-indigo-600 hover:text-indigo-500"
          >
            View results →
          </button>
          <button
            type="button"
            onClick={onOpenLesson}
            className="text-indigo-600 hover:text-indigo-500"
          >
            Edit lesson in Builder →
          </button>
        </div>
      )}

      {item.type === 'text' && (
        <div className="pl-8">
          <Editor
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            onBlur={commitBody}
            placeholder="Type your note here..."
          />
          <div className="text-right">
            <button
              type="button"
              onClick={commitBody}
              className="text-xs text-indigo-600 hover:text-indigo-500 mt-1"
            >
              Save note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TeacherAssignmentDetail() {
  const { id: classId, assignmentId } = useParams();
  const navigate = useNavigate();
  const [assignment, setAssignment] = useState(null);
  const [items, setItems] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [libraryLessons, setLibraryLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showLessonPicker, setShowLessonPicker] = useState(false);
  const [pickerLessonId, setPickerLessonId] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const load = async () => {
    setLoading(true);
    try {
      const a = await getAssignmentById(assignmentId);
      setAssignment(a);
      if (a) {
        const [its, subs, lib] = await Promise.all([
          listAssignmentItems(assignmentId),
          listSubmissionsForAssignment(assignmentId),
          listMyLibraryLessons(),
        ]);
        setItems(its);
        setSubmissions(subs);
        setLibraryLessons(lib);
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not load assignment.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const handleAddLesson = async () => {
    if (!pickerLessonId) {
      toast.error('Please choose a lesson.');
      return;
    }
    setBusy(true);
    try {
      await addLessonItem({
        assignmentId,
        classId,
        originalLessonId: pickerLessonId,
      });
      toast.success('Lesson added.');
      setPickerLessonId('');
      setShowLessonPicker(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not add lesson.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddText = async () => {
    setBusy(true);
    try {
      await addTextItem({ assignmentId, title: 'Note', body: '' });
      toast.success('Note added.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not add note.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateItem = async (itemId, patch) => {
    try {
      await updateAssignmentItem(itemId, patch);
      setItems((prev) =>
        prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it))
      );
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save item.');
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!window.confirm('Remove this item? If it is a lesson with no submissions, the lesson copy will be deleted.')) {
      return;
    }
    setBusy(true);
    try {
      await deleteAssignmentItem(itemId);
      toast.success('Item removed.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not delete item.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSubmission = async (submissionId, studentName) => {
    if (
      !window.confirm(
        `Delete ${studentName}'s submission? They will be able to retake the lesson. This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const { error } = await supabase
        .from('submissions')
        .delete()
        .eq('id', submissionId);
      if (error) throw error;
      toast.success('Submission deleted.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not delete submission.');
    }
  };

  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((it) => it.id === active.id);
    const newIndex = items.findIndex((it) => it.id === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    try {
      await reorderAssignmentItems(reordered.map((it) => it.id));
    } catch (err) {
      console.error(err);
      toast.error('Could not save order.');
      await load();
    }
  };

  const handlePublish = async () => {
    if (items.length === 0) {
      toast.error('Add at least one item before publishing.');
      return;
    }
    setBusy(true);
    try {
      await setAssignmentStatus(assignmentId, 'published');
      toast.success('Assignment published.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not publish.');
    } finally {
      setBusy(false);
    }
  };

  const handleUnpublish = async () => {
    setBusy(true);
    try {
      await setAssignmentStatus(assignmentId, 'draft');
      toast.success('Reverted to draft.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not unpublish.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAssignment = async () => {
    if (
      !window.confirm(
        'Delete this assignment, its items, and its lesson copies? Submissions attached to those lessons will also be removed. This cannot be undone.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await deleteAssignment(assignmentId);
      toast.success('Assignment deleted.');
      navigate(`/classes/${classId}`);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not delete.');
      setBusy(false);
    }
  };

  const openResultsForLesson = (lessonId) => {
    const url = `/results/${lessonId}?from=assignment&class=${classId}&assignment=${assignmentId}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="min-h-screen p-8 text-center">
        <p className="text-gray-600">Assignment not found.</p>
        <Link
          to={`/classes/${classId}`}
          className="text-indigo-600 underline mt-4 inline-block"
        >
          Back to class
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto p-6">
        <div className="mb-6">
          <Link
            to={`/classes/${classId}`}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← Back to {assignment.class?.name || 'class'}
          </Link>
          <div className="flex items-start justify-between gap-4 mt-1 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {assignment.title}
              </h1>
              <div className="text-sm text-gray-600 mt-1 space-x-3">
                <span>
                  Status:{' '}
                  <span className="font-medium">{assignment.status}</span>
                </span>
                {assignment.start_at && (
                  <span>Starts {formatJst(assignment.start_at)}</span>
                )}
                {assignment.due_at && (
                  <span>Due {formatJst(assignment.due_at)}</span>
                )}
                <span>
                  Retakes:{' '}
                  <span className="font-medium">
                    {assignment.allow_retakes ? 'allowed' : 'not allowed'}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {assignment.status === 'draft' ? (
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={busy}
                  className="py-2 px-4 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  Publish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleUnpublish}
                  disabled={busy}
                  className="py-2 px-4 bg-gray-200 text-gray-800 text-sm font-medium rounded-md hover:bg-gray-300 disabled:opacity-50"
                >
                  Unpublish
                </button>
              )}
              <button
                type="button"
                onClick={handleDeleteAssignment}
                disabled={busy}
                className="py-2 px-4 text-red-600 text-sm font-medium hover:bg-red-50 rounded-md disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        {assignment.instructions && (
          <section className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Instructions shown to students
            </h2>
            <p className="text-gray-800 whitespace-pre-wrap">
              {assignment.instructions}
            </p>
          </section>
        )}

        {/* ---- Submissions (moved above items) ---- */}
        <section className="bg-white rounded-lg shadow mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Submissions ({submissions.length})
            </h2>
          </div>
          {submissions.length === 0 ? (
            <p className="p-6 text-gray-500">
              No student submissions yet.
              {assignment.status === 'draft' && (
                <span className="block text-xs text-gray-400 mt-1">
                  Students cannot see this assignment until you publish it.
                </span>
              )}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {submissions.map((s) => (
                <li key={s.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {s.display_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {s.institutional_id && <span>ID: {s.institutional_id} · </span>}
                      {s.status === 'completed' ? '✅ completed' : '⏳ in progress'}
                      {s.status === 'completed' && s.max_auto_score > 0 && (
                        <span> · {s.score}%</span>
                      )}
                      {s.attempt_number > 1 && <span> · attempt {s.attempt_number}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-xs text-gray-400 text-right">
                      {s.submitted_at ? formatJst(s.submitted_at) : 'not submitted'}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteSubmission(s.id, s.display_name)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Items ---- */}
        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Items ({items.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowLessonPicker(true)}
                disabled={libraryLessons.length === 0 || busy}
                className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
              >
                + Add lesson
              </button>
              <button
                type="button"
                onClick={handleAddText}
                disabled={busy}
                className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
              >
                + Add note
              </button>
            </div>
          </div>

          {showLessonPicker && (
            <div className="mb-4 p-3 border border-indigo-200 bg-indigo-50 rounded-md">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Choose a lesson to copy
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={pickerLessonId}
                  onChange={(e) => setPickerLessonId(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">— Choose a lesson —</option>
                  {libraryLessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title} ({l.level || 'B1'})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddLesson}
                  disabled={busy}
                  className="py-2 px-4 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLessonPicker(false);
                    setPickerLessonId('');
                  }}
                  className="py-2 px-3 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {items.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No items yet. Add a lesson or a note above.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={items.map((it) => it.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {items.map((item) => (
                    <SortableItemRow
                      key={item.id}
                      item={item}
                      onUpdate={(patch) => handleUpdateItem(item.id, patch)}
                      onDelete={() => handleDeleteItem(item.id)}
                      onOpenLesson={() =>
                        item.lesson_id
                          ? navigate(`/builder/${item.lesson_id}`)
                          : null
                      }
                      onViewResults={() =>
                        item.lesson_id
                          ? openResultsForLesson(item.lesson_id)
                          : null
                      }
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>
      </div>
    </div>
  );
}