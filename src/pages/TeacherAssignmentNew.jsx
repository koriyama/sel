// src/pages/TeacherAssignmentNew.jsx
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

import { getClassById } from '../lib/lmsApi';
import {
  listMyLibraryLessons,
  createBareAssignment,
  addLessonItem,
  addTextItem,
  addFileItem,
  addLinkItem,
  attachFileToItem,
  jstLocalInputToIso,
  formatFileSize,
  isAllowedAttachment,
  attachmentMaxBytes,
} from '../lib/assignmentsApi';

let tempIdCounter = 0;
function makeTempId() {
  tempIdCounter += 1;
  return `tmp_${Date.now()}_${tempIdCounter}`;
}

function combineDateTime(dateStr, timeStr, fallbackTime) {
  if (!dateStr) return '';
  const t = timeStr || fallbackTime || '00:00';
  return `${dateStr}T${t}`;
}

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

function SortableItem({ item, onUpdate, onRemove }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.tempId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const fileInputRef = useRef(null);

  const handleFilePick = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!isAllowedAttachment(f)) {
      toast.error('That file type is not allowed.');
      return;
    }
    if (f.size > attachmentMaxBytes()) {
      toast.error(`File is too large. Maximum is ${formatFileSize(attachmentMaxBytes())}.`);
      return;
    }
    const oldName = item.pendingFile?.name || '';
    const shouldUpdateTitle =
      !item.title || item.title === 'File' || item.title === oldName;
    onUpdate({
      pendingFile: f,
      ...(shouldUpdateTitle ? { title: f.name } : {}),
    });
  };

  const linkUrlInvalid =
    item.type === 'link' && item.url && !/^https?:\/\//i.test(item.url);

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
          value={item.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder="Item title"
          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-600 hover:text-red-700 px-2"
        >
          Remove
        </button>
      </div>

      {item.type === 'lesson' && (
        <p className="text-xs text-gray-500 pl-8">
          Copies from: <span className="font-medium">{item.sourceLessonTitle}</span>
        </p>
      )}

      {item.type === 'text' && (
        <div className="pl-8">
          <Editor
            value={item.body || ''}
            onChange={(e) => onUpdate({ body: e.target.value })}
            placeholder="Type your note here..."
          />
        </div>
      )}

      {item.type === 'file' && (
        <div className="pl-8 space-y-2">
          {item.pendingFile ? (
            <div className="flex items-center gap-3 text-xs text-gray-600 flex-wrap">
              <span className="font-medium truncate max-w-xs">
                {item.pendingFile.name}
              </span>
              <span className="text-gray-400">
                {formatFileSize(item.pendingFile.size)}
              </span>
              <button
                type="button"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className="text-gray-700 hover:text-gray-900 underline"
              >
                Replace file
              </button>
              <button
                type="button"
                onClick={() => onUpdate({ pendingFile: null })}
                className="text-red-600 hover:text-red-700"
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
          <p className="text-xs text-gray-400">
            The file uploads when you click Create assignment.
          </p>
        </div>
      )}

      {item.type === 'link' && (
        <div className="pl-8 space-y-2">
          <input
            type="url"
            value={item.url || ''}
            onChange={(e) => onUpdate({ url: e.target.value })}
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
            value={item.body || ''}
            onChange={(e) => onUpdate({ body: e.target.value })}
            placeholder="Optional description"
            className="block w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
      )}
    </div>
  );
}

export default function TeacherAssignmentNew() {
  const { id: classId } = useParams();
  const navigate = useNavigate();
  const [cls, setCls] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showLessonPicker, setShowLessonPicker] = useState(false);
  const [pickerLessonId, setPickerLessonId] = useState('');

  const [form, setForm] = useState({
    title: '',
    instructions: '',
    startDate: '',
    startTime: '00:00',
    dueDate: '',
    dueTime: '23:59',
  });
  const [items, setItems] = useState([]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    (async () => {
      try {
        const [c, l] = await Promise.all([
          getClassById(classId),
          listMyLibraryLessons(),
        ]);
        setCls(c);
        setLessons(l);
      } catch (err) {
        console.error(err);
        toast.error('Could not load data.');
      } finally {
        setLoading(false);
      }
    })();
  }, [classId]);

  // New items are inserted at the top of the list so they appear
  // directly under the Add buttons.
  const handleAddLesson = () => {
    const lesson = lessons.find((l) => l.id === pickerLessonId);
    if (!lesson) {
      toast.error('Please choose a lesson.');
      return;
    }
    setItems((prev) => [
      {
        tempId: makeTempId(),
        type: 'lesson',
        title: lesson.title,
        sourceLessonId: lesson.id,
        sourceLessonTitle: lesson.title,
        body: '',
      },
      ...prev,
    ]);
    setPickerLessonId('');
    setShowLessonPicker(false);
  };

  const handleAddText = () => {
    setItems((prev) => [
      {
        tempId: makeTempId(),
        type: 'text',
        title: 'Note',
        body: '',
        sourceLessonId: null,
        sourceLessonTitle: null,
      },
      ...prev,
    ]);
  };

  // Opens the OS file picker immediately. The item is only created if
  // a valid file is chosen. Cancelling changes nothing.
  const handleAddFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = (e) => {
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
      setItems((prev) => [
        {
          tempId: makeTempId(),
          type: 'file',
          title: f.name,
          body: '',
          pendingFile: f,
          sourceLessonId: null,
          sourceLessonTitle: null,
        },
        ...prev,
      ]);
    };
    input.click();
  };

  const handleAddLink = () => {
    setItems((prev) => [
      {
        tempId: makeTempId(),
        type: 'link',
        title: 'Link',
        body: '',
        url: '',
        sourceLessonId: null,
        sourceLessonTitle: null,
      },
      ...prev,
    ]);
  };

  const handleUpdateItem = (tempId, patch) => {
    setItems((prev) =>
      prev.map((it) => (it.tempId === tempId ? { ...it, ...patch } : it))
    );
  };

  const handleRemoveItem = (tempId) => {
    setItems((prev) => prev.filter((it) => it.tempId !== tempId));
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((prev) => {
      const oldIndex = prev.findIndex((it) => it.tempId === active.id);
      const newIndex = prev.findIndex((it) => it.tempId === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Please enter a title.');
      return;
    }

    for (const item of items) {
      if (item.type === 'link') {
        const u = (item.url || '').trim();
        if (!u) {
          toast.error('A link item is missing its URL. Fill it in or remove the item.');
          return;
        }
        if (!/^https?:\/\//i.test(u)) {
          toast.error('Every link URL must start with http:// or https://');
          return;
        }
      }
      if (item.type === 'file' && !item.pendingFile) {
        toast.error('A file item has no file attached. Attach a file or remove the item.');
        return;
      }
    }

    setSaving(true);
    try {
      const startLocal = combineDateTime(form.startDate, form.startTime, '00:00');
      const dueLocal = combineDateTime(form.dueDate, form.dueTime, '23:59');

      const assignment = await createBareAssignment({
        classId,
        title: form.title,
        instructions: form.instructions,
        startAt: startLocal ? jstLocalInputToIso(startLocal) : null,
        dueAt: dueLocal ? jstLocalInputToIso(dueLocal) : null,
      });

      const itemErrors = [];

      for (const item of items) {
        try {
          if (item.type === 'lesson') {
            await addLessonItem({
              assignmentId: assignment.id,
              classId,
              originalLessonId: item.sourceLessonId,
              title: item.title,
            });
          } else if (item.type === 'text') {
            await addTextItem({
              assignmentId: assignment.id,
              title: item.title,
              body: item.body || '',
            });
          } else if (item.type === 'file') {
            const created = await addFileItem({
              assignmentId: assignment.id,
              title: item.title,
            });
            if (item.pendingFile) {
              await attachFileToItem({
                itemId: created.id,
                assignmentId: assignment.id,
                file: item.pendingFile,
              });
            }
          } else if (item.type === 'link') {
            await addLinkItem({
              assignmentId: assignment.id,
              title: item.title,
              url: item.url.trim(),
              description: item.body || '',
            });
          }
        } catch (err) {
          console.error(err);
          itemErrors.push(`${item.title || item.type}: ${err.message}`);
        }
      }

      if (itemErrors.length > 0) {
        toast.error(
          `Assignment created, but some items failed:\n${itemErrors.join('\n')}`
        );
      } else {
        toast.success('Assignment created as draft.');
      }
      navigate(`/classes/${classId}/assignments/${assignment.id}`);
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not create assignment.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6">
          <Link
            to={`/classes/${classId}`}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← Back to class
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">
            New assignment {cls ? `for ${cls.name}` : ''}
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            An assignment can hold lessons, text notes, files, and links, in any
            order.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <section className="bg-white rounded-lg shadow p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Assignment title
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="e.g. Week 3 Reading and Grammar"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Overall instructions (optional)
              </label>
              <textarea
                rows={3}
                value={form.instructions}
                onChange={(e) =>
                  setForm({ ...form, instructions: e.target.value })
                }
                className="block w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Shown to the student before the item list."
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start (JST)
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) =>
                      setForm({ ...form, startDate: e.target.value })
                    }
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) =>
                      setForm({ ...form, startTime: e.target.value })
                    }
                    className="w-28 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Optional. Leave the date blank to open immediately.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Due (JST)
                </label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) =>
                      setForm({ ...form, dueDate: e.target.value })
                    }
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  <input
                    type="time"
                    value={form.dueTime}
                    onChange={(e) =>
                      setForm({ ...form, dueTime: e.target.value })
                    }
                    className="w-28 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Time defaults to 23:59. Optional.
                </p>
              </div>
            </div>
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
                  disabled={lessons.length === 0}
                  className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
                >
                  + Add lesson
                </button>
                <button
                  type="button"
                  onClick={handleAddText}
                  className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
                >
                  + Add note
                </button>
                <button
                  type="button"
                  onClick={handleAddFile}
                  className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
                >
                  + Add file
                </button>
                <button
                  type="button"
                  onClick={handleAddLink}
                  className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
                >
                  + Add link
                </button>
              </div>
            </div>

            {showLessonPicker && (
              <div className="mb-4 p-3 border border-indigo-200 bg-indigo-50 rounded-md">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Choose a lesson to copy into this assignment
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={pickerLessonId}
                    onChange={(e) => setPickerLessonId(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="">— Choose a lesson —</option>
                    {lessons.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.title} ({l.level || 'B1'})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddLesson}
                    className="py-2 px-4 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
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
                No items yet. Add a lesson, note, file, or link above.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={items.map((it) => it.tempId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-3">
                    {items.map((item) => (
                      <SortableItem
                        key={item.tempId}
                        item={item}
                        onUpdate={(patch) => handleUpdateItem(item.tempId, patch)}
                        onRemove={() => handleRemoveItem(item.tempId)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </section>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="py-2 px-4 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create assignment (draft)'}
            </button>
            <Link
              to={`/classes/${classId}`}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}