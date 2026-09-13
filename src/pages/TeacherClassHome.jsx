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
  enrollStudentByInstitutionalId,
} from '../lib/lmsApi';
import {
  listAssignmentsForClass,
  listClassLessonCopies,
  formatJst,
  reorderAssignments,
} from '../lib/assignmentsApi';
import PasswordRevealModal from '../components/PasswordRevealModal';

const TABS = [
  { key: 'assignments', label: 'Assignments', type: 'tab' },
  { key: 'lessons', label: 'Lessons', type: 'tab' },
  { key: 'people', label: 'People', type: 'tab' },
  { key: 'gradebook', label: 'Grade book', type: 'link', href: (id) => `/classes/${id}/gradebook` },
  { key: 'grade-setup', label: 'Grade setup', type: 'link', href: (id) => `/classes/${id}/grade-setup` },
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

  const [addId, setAddId] = useState('');
  const [addBusy, setAddBusy] = useState(false);

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

  const handleAddExistingStudent = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    const value = addId.trim();
    if (!value) {
      toast.error('Please enter a student ID.');
      return;
    }
    setAddBusy(true);
    try {
      const result = await enrollStudentByInstitutionalId(id, value);
      if (!result || result.ok !== true) {
        toast.error(result?.error || 'Could not add student.');
        return;
      }
      if (result.already_enrolled) {
        toast.success(`${result.student.display_name} is already in this class.`);
      } else {
        toast.success(`Added ${result.student.display_name}.`);
        setAddId('');
      }
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not add student.');
    } finally {
      setAddBusy(false);
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
          <nav className="flex gap-6 flex-wrap">
            {TABS.map((t) => {
              const label =
                t.label +
                (t.key === 'assignments'
                  ? ` (${assignments.length})`
                  : t.key === 'lessons'
                  ? ` (${lessonCopies.length})`
                  : t.key === 'people'
                  ? ` (${roster.length})`
                  : '');
              if (t.type === 'link') {
                return (
                  <Link
                    key={t.key}
                    to={t.href(id)}
                    className="pb-3 px-1 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 transition"
                  >
                    {label}
                  </Link>
                );
              }
              return (
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
                  {label}
                </button>
              );
            })}
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
          <section className="space-y-4">
            <form
              onSubmit={handleAddExistingStudent}
              className="bg-white rounded-lg shadow p-4"
            >
              <label
                htmlFor="add-student-id"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Add an existing student by ID
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="add-student-id"
                  type="text"
                  value={addId}
                  onChange={(e) => setAddId(e.target.value)}
                  placeholder="e.g. TEST001"
                  autoComplete="off"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={addBusy}
                />
                <button
                  type="submit"
                  disabled={addBusy || !addId.trim()}
                  className="py-2 px-4 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
                >
                  {addBusy ? 'Adding…' : 'Add'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                The student must already have an account. To create new
                accounts, use <span className="font-medium">Import students</span>.
              </p>
            </form>

            <div className="bg-white rounded-lg shadow">
              {roster.length === 0 ? (
                <p className="p-8 text-center text-gray-500">
                  No students yet. Import a CSV or add one by ID above.
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
            </div>
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