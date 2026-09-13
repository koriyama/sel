// src/pages/TeacherAssignmentDetail.jsx
import React, { useEffect, useRef, useState } from 'react';
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
  addFileItem,
  addLinkItem,
  attachFileToItem,
  deleteAttachment,
  getAttachmentSignedUrl,
  updateAssignmentItem,
  deleteAssignmentItem,
  reorderAssignmentItems,
  setAssignmentStatus,
  deleteAssignment,
  updateAssignment,
  listSubmissionsForAssignment,
  formatJst,
  formatFileSize,
  isAllowedAttachment,
  attachmentMaxBytes,
} from '../lib/assignmentsApi';
import {
  listGradeCategories,
  getClassGradebook,
} from '../lib/gradebookApi';
import { supabase } from '../lib/supabaseClient';

const AUTO_GRADED_TYPES = [
  'gap_fill',
  'multiple_choice',
  'gap_fill_dropdown',
  'sentence_jumble',
  'vocabulary_matching',
  'listening',
  'dictation',
];

function typeLabel(t) {
  if (t === 'lesson') return 'Lesson';
  if (t === 'text') return 'Note';
  if (t === 'file') return 'File';
  if (t === 'link') return 'Link';
  return t;
}

function typeClass(t) {
  if (t === 'lesson') return 'bg-indigo-100 text-indigo-800';
  if (t === 'text') return 'bg-amber-100 text-amber-800';
  if (t === 'file') return 'bg-slate-100 text-slate-800';
  if (t === 'link') return 'bg-teal-100 text-teal-800';
  return 'bg-slate-100 text-slate-800';
}

function SortableItemRow({
  item,
  onUpdate,
  onDelete,
  onAttachFile,
  onRemoveFile,
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
  const [linkUrlDraft, setLinkUrlDraft] = useState(item.url || '');
  const [linkBodyDraft, setLinkBodyDraft] = useState(item.body || '');
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setTitleDraft(item.title || '');
  }, [item.title]);
  useEffect(() => {
    setBodyDraft(item.body || '');
  }, [item.body]);
  useEffect(() => {
    setLinkUrlDraft(item.url || '');
  }, [item.url]);
  useEffect(() => {
    setLinkBodyDraft(item.body || '');
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
  const commitLinkUrl = () => {
    const v = linkUrlDraft.trim();
    if (!v) {
      toast.error('URL cannot be empty.');
      setLinkUrlDraft(item.url || '');
      return;
    }
    if (!/^https?:\/\//i.test(v)) {
      toast.error('URL must start with http:// or https://');
      setLinkUrlDraft(item.url || '');
      return;
    }
    if (v !== (item.url || '')) {
      onUpdate({ url: v });
    }
  };
  const commitLinkBody = () => {
    if (linkBodyDraft !== (item.body || '')) {
      onUpdate({ body: linkBodyDraft });
    }
  };

  const handleFilePick = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setAttachError(null);
    if (!isAllowedAttachment(f)) {
      setAttachError('That file type is not allowed.');
      return;
    }
    if (f.size > attachmentMaxBytes()) {
      setAttachError(
        `File is too large. Maximum is ${formatFileSize(attachmentMaxBytes())}.`
      );
      return;
    }
    setUploading(true);
    try {
      await onAttachFile(f);
    } catch (err) {
      setAttachError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async () => {
    if (!item.file_path) return;
    try {
      const url = await getAttachmentSignedUrl(item.file_path, {
        fileName: item.file_name,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = item.file_name || '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.error(err.message || 'Could not create download link.');
    }
  };

  const linkUrlInvalid =
    item.type === 'link' && linkUrlDraft && !/^https?:\/\//i.test(linkUrlDraft);

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
            'text-xs font-medium px-2 py-0.5 rounded-full ' + typeClass(item.type)
          }
        >
          {typeLabel(item.type)}
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

      {item.type === 'file' && (
        <div className="pl-8 space-y-2">
          {item.file_name ? (
            <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
              <span className="font-medium truncate max-w-xs">
                {item.file_name}
              </span>
              <span className="text-gray-400">
                {formatFileSize(item.file_size)}
              </span>
              <button
                type="button"
                onClick={handleDownload}
                className="text-gray-700 hover:text-gray-900 underline"
              >
                Download
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className="text-gray-700 hover:text-gray-900 underline"
                disabled={uploading}
              >
                Replace file
              </button>
              <button
                type="button"
                onClick={() => onRemoveFile(item.file_path)}
                className="text-red-600 hover:text-red-700"
                disabled={uploading}
              >
                Remove file
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className="text-gray-700 hover:text-gray-900 underline"
                disabled={uploading}
              >
                Choose file
              </button>
              <span className="text-gray-400">
                Max {formatFileSize(attachmentMaxBytes())}.
              </span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFilePick}
          />
          {uploading && <p className="text-xs text-gray-500">Uploading…</p>}
          {attachError && <p className="text-xs text-red-600">{attachError}</p>}
        </div>
      )}

      {item.type === 'link' && (
        <div className="pl-8 space-y-2">
          <input
            type="url"
            value={linkUrlDraft}
            onChange={(e) => setLinkUrlDraft(e.target.value)}
            onBlur={commitLinkUrl}
            placeholder="https://example.com"
            className="block w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          {linkUrlInvalid && (
            <p className="text-xs text-red-600">
              URL must start with http:// or https://
            </p>
          )}
          <textarea
            rows={2}
            value={linkBodyDraft}
            onChange={(e) => setLinkBodyDraft(e.target.value)}
            onBlur={commitLinkBody}
            placeholder="Optional description"
            className="block w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
          <div className="text-right">
            <button
              type="button"
              onClick={commitLinkBody}
              className="text-xs text-indigo-600 hover:text-indigo-500"
            >
              Save description
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
  const [categories, setCategories] = useState([]);
  const [useCategories, setUseCategories] = useState(false);
  const [derivedGp, setDerivedGp] = useState(null); // from gradebook, when in category
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showLessonPicker, setShowLessonPicker] = useState(false);
  const [pickerLessonId, setPickerLessonId] = useState('');
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [pickerLinkUrl, setPickerLinkUrl] = useState('');

  const [gradePointsDraft, setGradePointsDraft] = useState('');
  const [rawMax, setRawMax] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const computeRawMax = async (itemList) => {
    const lessonIds = itemList
      .filter((it) => it.type === 'lesson' && it.lesson_id)
      .map((it) => it.lesson_id);
    if (lessonIds.length === 0) {
      setRawMax(0);
      setReviewCount(0);
      return;
    }
    const { data: acts, error } = await supabase
      .from('activities')
      .select('id, type')
      .in('lesson_id', lessonIds);
    if (error) {
      console.error(error);
      return;
    }
    let auto = 0;
    let review = 0;
    for (const a of acts || []) {
      if (AUTO_GRADED_TYPES.includes(a.type)) auto += 1;
      else review += 1;
    }
    setRawMax(auto);
    setReviewCount(review);
  };

  const load = async () => {
    setLoading(true);
    try {
      const [a, cats, gb] = await Promise.all([
        getAssignmentById(assignmentId),
        listGradeCategories(classId),
        getClassGradebook(classId),
      ]);
      setAssignment(a);
      setCategories(cats);
      setUseCategories(Boolean(gb.use_categories));
      const gbAssignment = gb.assignments.find((x) => x.id === assignmentId);
      setDerivedGp(gbAssignment || null);
      if (a) {
        const [its, subs, lib] = await Promise.all([
          listAssignmentItems(assignmentId),
          listSubmissionsForAssignment(assignmentId),
          listMyLibraryLessons(),
        ]);
        setItems(its);
        setSubmissions(subs);
        setLibraryLessons(lib);
        await computeRawMax(its);
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

  useEffect(() => {
    if (assignment) {
      setGradePointsDraft(
        assignment.grade_points != null ? String(assignment.grade_points) : ''
      );
    }
  }, [assignment]);

  const commitGradePoints = async () => {
    const raw = gradePointsDraft.trim();
    let value = null;
    if (raw !== '') {
      const n = Number(raw);
      if (isNaN(n) || n < 0) {
        toast.error('Grade points must be a non-negative number, or blank for auto.');
        setGradePointsDraft(
          assignment.grade_points != null ? String(assignment.grade_points) : ''
        );
        return;
      }
      value = n;
    }
    if (
      (value == null && assignment.grade_points == null) ||
      (value != null &&
        assignment.grade_points != null &&
        Number(assignment.grade_points) === value)
    ) {
      return;
    }
    try {
      const updated = await updateAssignment(assignmentId, {
        grade_points: value,
      });
      setAssignment(updated);
      toast.success('Grade points saved.');
      // Reload the gradebook view for this assignment so derivedGp updates.
      const gb = await getClassGradebook(classId);
      setDerivedGp(gb.assignments.find((x) => x.id === assignmentId) || null);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save grade points.');
    }
  };

  const handleCategoryChange = async (newCategoryId) => {
    setBusy(true);
    try {
      const updated = await updateAssignment(assignmentId, {
        category_id: newCategoryId || null,
      });
      setAssignment(updated);
      toast.success(newCategoryId ? 'Category set.' : 'Category removed.');
      const gb = await getClassGradebook(classId);
      setDerivedGp(gb.assignments.find((x) => x.id === assignmentId) || null);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not change category.');
    } finally {
      setBusy(false);
    }
  };

  const moveItemToTop = async (itemId) => {
    const otherIds = items.map((it) => it.id).filter((id) => id !== itemId);
    await reorderAssignmentItems([itemId, ...otherIds]);
  };

  const handleAddLesson = async () => {
    if (!pickerLessonId) {
      toast.error('Please choose a lesson.');
      return;
    }
    setBusy(true);
    try {
      const created = await addLessonItem({
        assignmentId,
        classId,
        originalLessonId: pickerLessonId,
      });
      await moveItemToTop(created.id);
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
      const created = await addTextItem({ assignmentId, title: 'Note', body: '' });
      await moveItemToTop(created.id);
      toast.success('Note added.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not add note.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (!isAllowedAttachment(f)) {
        toast.error('That file type is not allowed.');
        return;
      }
      if (f.size > attachmentMaxBytes()) {
        toast.error(
          `File is too large. Maximum is ${formatFileSize(attachmentMaxBytes())}.`
        );
        return;
      }
      setBusy(true);
      let created = null;
      try {
        created = await addFileItem({ assignmentId, title: f.name });
        await attachFileToItem({ itemId: created.id, assignmentId, file: f });
        await moveItemToTop(created.id);
        toast.success('File added.');
        await load();
      } catch (err) {
        console.error(err);
        toast.error(err.message || 'Could not add file.');
        if (created) {
          try { await deleteAssignmentItem(created.id); } catch { /* ignore */ }
        }
      } finally {
        setBusy(false);
      }
    };
    input.click();
  };

  const handleAddLink = async () => {
    const url = pickerLinkUrl.trim();
    if (!url) {
      toast.error('Please enter a URL.');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast.error('URL must start with http:// or https://');
      return;
    }
    setBusy(true);
    try {
      const created = await addLinkItem({
        assignmentId,
        title: 'Link',
        url,
        description: '',
      });
      await moveItemToTop(created.id);
      toast.success('Link added.');
      setPickerLinkUrl('');
      setShowLinkPicker(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not add link.');
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

  const handleAttachFile = async (itemId, file) => {
    const current = items.find((it) => it.id === itemId);
    const oldPath = current ? current.file_path : null;
    const currentTitle = current?.title || '';
    const oldName = current?.file_name || '';
    const shouldUpdateTitle =
      !currentTitle || currentTitle === 'File' || currentTitle === oldName;

    const updated = await attachFileToItem({
      itemId,
      assignmentId,
      file,
      oldPath,
    });

    const finalTitle = shouldUpdateTitle ? file.name : currentTitle;
    if (shouldUpdateTitle) {
      await updateAssignmentItem(itemId, { title: file.name });
    }

    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, ...updated, title: finalTitle } : it
      )
    );
    toast.success('File uploaded.');
  };

  const handleRemoveFile = async (itemId, filePath) => {
    if (!window.confirm('Remove this file? It will be deleted from storage.')) {
      return;
    }
    setBusy(true);
    try {
      if (filePath) {
        try { await deleteAttachment(filePath); } catch { /* ignore */ }
      }
      await updateAssignmentItem(itemId, {
        file_path: null,
        file_name: null,
        file_size: null,
        mime_type: null,
      });
      toast.success('File removed.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not remove file.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (
      !window.confirm(
        'Remove this item? If it is a lesson with no submissions, the lesson copy will be deleted. If it is a file, the file will be deleted from storage.'
      )
    ) {
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
        'Delete this assignment, its items, its lesson copies, and its uploaded files? Submissions attached to those lessons will also be removed. This cannot be undone.'
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

  const usesAuto = assignment.grade_points == null;
  const inCategory = Boolean(assignment.category_id);
  const derivedValue =
    derivedGp && derivedGp.grade_points_source === 'category'
      ? derivedGp.grade_points
      : null;

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

              {useCategories && (
                <div className="mt-2 flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                  <label htmlFor="category" className="font-medium text-gray-700">
                    Category:
                  </label>
                  <select
                    id="category"
                    value={assignment.category_id || ''}
                    onChange={(e) => handleCategoryChange(e.target.value || null)}
                    disabled={busy}
                    className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">— No category —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.weight})
                      </option>
                    ))}
                  </select>
                  {!inCategory && (
                    <span className="text-xs text-amber-700">
                      Uncategorised — excluded from rolling grades.
                    </span>
                  )}
                </div>
              )}

              {!useCategories && (
                <div className="mt-2 text-xs text-gray-500">
                  Categories are off for this class.{' '}
                  <Link
                    to={`/classes/${classId}/grade-setup`}
                    className="text-indigo-600 hover:text-indigo-500 underline"
                  >
                    Set up categories
                  </Link>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2 text-sm text-gray-600 flex-wrap">
                <label htmlFor="grade-points" className="font-medium text-gray-700">
                  Grade points:
                </label>
                <input
                  id="grade-points"
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    usesAuto && derivedValue != null
                      ? String(derivedValue)
                      : gradePointsDraft
                  }
                  onChange={(e) => setGradePointsDraft(e.target.value)}
                  onBlur={commitGradePoints}
                  readOnly={usesAuto && derivedValue != null}
                  placeholder={rawMax > 0 ? `auto (${rawMax})` : 'auto (0)'}
                  className={
                    'w-28 px-2 py-1 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 ' +
                    (usesAuto && derivedValue != null ? 'bg-gray-50 text-gray-600' : '')
                  }
                />
                <span className="text-xs text-gray-500">
                  {usesAuto && derivedValue != null ? (
                    <>From category (raw max {rawMax}{reviewCount > 0 ? ` · ${reviewCount} review` : ''})</>
                  ) : usesAuto ? (
                    <>Auto: {rawMax} raw max{reviewCount > 0 ? ` · ${reviewCount} review item${reviewCount === 1 ? '' : 's'} not counted` : ''}</>
                  ) : (
                    <>Manual override (raw max {rawMax}{reviewCount > 0 ? ` · ${reviewCount} review item${reviewCount === 1 ? '' : 's'} not counted` : ''})</>
                  )}
                </span>
                {!usesAuto && (
                  <button
                    type="button"
                    onClick={() => {
                      setGradePointsDraft('');
                      setTimeout(commitGradePoints, 0);
                    }}
                    className="text-xs text-indigo-600 hover:text-indigo-500 underline"
                  >
                    Clear override
                  </button>
                )}
              </div>

              {usesAuto && rawMax === 0 && reviewCount > 0 && !inCategory && (
                <p className="text-xs text-amber-700 mt-1">
                  This assignment has only review items. Set grade points manually,
                  or assign it to a category, so it counts toward the rolling grade.
                </p>
              )}
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

        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-semibold text-gray-900">
              Items ({items.length})
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
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
              <button
                type="button"
                onClick={handleAddFile}
                disabled={busy}
                className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
              >
                + Add file
              </button>
              <button
                type="button"
                onClick={() => setShowLinkPicker(true)}
                disabled={busy}
                className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
              >
                + Add link
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

          {showLinkPicker && (
            <div className="mb-4 p-3 border border-teal-200 bg-teal-50 rounded-md">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enter a URL for the new link
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={pickerLinkUrl}
                  onChange={(e) => setPickerLinkUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddLink();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddLink}
                  disabled={busy}
                  className="py-2 px-4 text-sm bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLinkPicker(false);
                    setPickerLinkUrl('');
                  }}
                  className="py-2 px-3 text-sm text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                You can edit the title and add a description on the card after
                it is created.
              </p>
            </div>
          )}

          {items.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              No items yet. Add a lesson, note, file, or link above.
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
                      onAttachFile={(file) => handleAttachFile(item.id, file)}
                      onRemoveFile={(filePath) => handleRemoveFile(item.id, filePath)}
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