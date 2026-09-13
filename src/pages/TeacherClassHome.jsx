// src/pages/TeacherClassHome.jsx
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import {
  getClassById,
  listClassRoster,
  removeStudentFromClass,
  resetStudentPassword,
} from '../lib/lmsApi';
import {
  listAssignmentsForClass,
  listClassLessonCopies,
  formatJst,
  reorderAssignments,
} from '../lib/assignmentsApi';
import PasswordRevealModal from '../components/PasswordRevealModal';

const TABS = [
  { key: 'assignments', label: 'Assignments' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'people', label: 'People' },
];

const headerBtnStyle = {
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

function SortableAssignmentRow({ assignment, classId }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: assignment.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="p-4 flex items-center justify-between gap-3 bg-white"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab text-gray-400 hover:text-gray-700 px-2 py-1 select-none flex-shrink-0"
        title="Drag to reorder"
      >
        ⋮⋮
      </button>
      <div className="min-w-0 flex-1">
        <Link
          to={`/classes/${classId}/assignments/${assignment.id}`}
          className="font-medium text-indigo-600 hover:text-indigo-500 truncate"
        >
          {assignment.title}
        </Link>
        <div className="text-xs text-gray-500 mt-1">
          {assignment.status === 'draft' && (
            <span className="inline-block mr-2 px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded">
              draft
            </span>
          )}
          {assignment.status === 'published' && (
            <span className="inline-block mr-2 px-2 py-0.5 bg-green-100 text-green-800 rounded">
              published
            </span>
          )}
          {assignment.due_at && <span>Due {formatJst(assignment.due_at)}</span>}
          {!assignment.due_at && <span>No due date</span>}
        </div>
      </div>
    </li>
  );
}

export default function TeacherClassHome() {
  const { id } = useParams();
  const [tab, setTab] = useState('assignments');
  const [cls, setCls] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [lessonCopies, setLessonCopies] = useState([]);
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reveal, setReveal] = useState({
    open: false,
    studentName: '',
    password: '',
  });

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const load = async () => {
    setLoading(true);
    try {
      const [c, a, lc, r] = await Promise.all([
        getClassById(id),
        listAssignmentsForClass(id),
        listClassLessonCopies(id),
        listClassRoster(id),
      ]);
      setCls(c);
      setAssignments(a);
      setLessonCopies(lc);
      setRoster(r);
    } catch (err) {
      console.error(err);
      toast.error('Could not load class.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleRemove = async (studentId, displayName) => {
    if (!window.confirm(`Remove ${displayName} from this class? Their account is kept.`)) return;
    try {
      await removeStudentFromClass(id, studentId);
      toast.success('Removed.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not remove student.');
    }
  };

  const handleReset = async (studentId, displayName) => {
    if (!window.confirm(`Reset password for ${displayName}?`)) return;
    try {
      const result = await resetStudentPassword(studentId);
      const temp = result?.temp_password;
      if (temp) {
        setReveal({ open: true, studentName: displayName, password: temp });
      } else {
        toast.success('Password reset.');
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not reset password.');
    }
  };

  const handleAssignmentsDragEnd = async (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = assignments.findIndex((a) => a.id === active.id);
    const newIndex = assignments.findIndex((a) => a.id === over.id);
    const reordered = arrayMove(assignments, oldIndex, newIndex);
    setAssignments(reordered);
    try {
      await reorderAssignments(reordered.map((a) => a.id));
    } catch (err) {
      console.error(err);
      toast.error('Could not save order.');
      await load();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  if (!cls) {
    return (
      <div className="min-h-screen p-8 text-center">
        <p className="text-gray-600">Class not found.</p>
        <Link to="/classes" className="text-indigo-600 underline mt-4 inline-block">
          Back to classes
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <Link to="/classes" className="text-sm text-indigo-600 hover:text-indigo-500">
              ← Back to classes
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 mt-1">{cls.name}</h1>
            {cls.description && (
              <p className="text-sm text-gray-600 mt-1">{cls.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/classes/${id}/import`} style={headerBtnStyle}>
              Import students
            </Link>
            <Link to={`/classes/${id}/assignments/new`} style={headerBtnStyle}>
              + New assignment
            </Link>
          </div>
        </div>

        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-6">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={
                  'pb-3 px-1 text-sm font-medium border-b-2 transition ' +
                  (tab === t.key
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700')
                }
              >
                {t.label}
                {t.key === 'assignments' ? ` (${assignments.length})` : ''}
                {t.key === 'lessons' ? ` (${lessonCopies.length})` : ''}
                {t.key === 'people' ? ` (${roster.length})` : ''}
              </button>
            ))}
          </nav>
        </div>

        {tab === 'assignments' && (
          <section className="bg-white rounded-lg shadow overflow-hidden">
            {assignments.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No assignments yet.
                <div className="mt-4">
                  <Link
                    to={`/classes/${id}/assignments/new`}
                    className="text-indigo-600 hover:text-indigo-500 font-medium"
                  >
                    Create the first one →
                  </Link>
                </div>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleAssignmentsDragEnd}
              >
                <SortableContext
                  items={assignments.map((a) => a.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="divide-y divide-gray-100">
                    {assignments.map((a) => (
                      <SortableAssignmentRow
                        key={a.id}
                        assignment={a}
                        classId={id}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </section>
        )}

        {tab === 'lessons' && (
          <section className="bg-white rounded-lg shadow">
            {lessonCopies.length === 0 ? (
              <p className="p-8 text-center text-gray-500">
                Lessons appear here when you create assignments.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {lessonCopies.map((l) => (
                  <li key={l.id} className="p-4 flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{l.title}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {l.level || ''} · {l.status}
                      </div>
                    </div>
                    <Link
                      to={`/lesson/${l.share_slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-indigo-600 hover:text-indigo-500"
                    >
                      Preview
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'people' && (
          <section className="bg-white rounded-lg shadow">
            {roster.length === 0 ? (
              <p className="p-8 text-center text-gray-500">
                No students yet. Import a CSV to add them.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {roster.map((row) => {
                  const s = row.student;
                  if (!s) return null;
                  return (
                    <li key={row.id} className="p-4 flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-900">{s.display_name}</div>
                        <div className="text-xs text-gray-500">
                          ID: {s.institutional_id}
                          {s.must_change_password ? ' · must change password' : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => handleReset(s.id, s.display_name)}
                          className="text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          Reset password
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(s.id, s.display_name)}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      <PasswordRevealModal
        open={reveal.open}
        studentName={reveal.studentName}
        password={reveal.password}
        onClose={() => setReveal({ open: false, studentName: '', password: '' })}
      />
    </div>
  );
}