// src/pages/TeacherGradeSetup.jsx
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  getClassGradebook,
  listGradeCategories,
  createGradeCategory,
  updateGradeCategory,
  deleteGradeCategory,
} from '../lib/gradebookApi';
import {
  getClassById,
  updateClass,
} from '../lib/lmsApi';
import { updateAssignment } from '../lib/assignmentsApi';

function EditableCategoryRow({ category, onSave, onDelete, busy }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [weight, setWeight] = useState(String(category.weight));

  useEffect(() => {
    setName(category.name);
    setWeight(String(category.weight));
  }, [category.name, category.weight]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty.');
      return;
    }
    const w = Number(weight);
    if (isNaN(w) || w < 0) {
      toast.error('Weight must be a non-negative number.');
      return;
    }
    await onSave({ name: trimmed, weight: w });
    setEditing(false);
  };

  const handleCancel = () => {
    setName(category.name);
    setWeight(String(category.weight));
    setEditing(false);
  };

  if (editing) {
    return (
      <tr className="bg-indigo-50">
        <td className="px-3 py-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="number"
            min="0"
            step="0.01"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
          />
        </td>
        <td className="px-3 py-2 text-xs text-gray-500">
          {category.assignment_count} assignment
          {category.assignment_count === 1 ? '' : 's'}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="text-xs text-indigo-600 hover:text-indigo-800 mr-3"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-3 py-2 text-sm font-medium text-gray-900">
        {category.name}
      </td>
      <td className="px-3 py-2 text-sm text-gray-700">{category.weight}</td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {category.assignment_count} assignment
        {category.assignment_count === 1 ? '' : 's'}
        {category.overridden_count > 0
          ? ` · ${category.overridden_count} overridden`
          : ''}
        {category.distributed > 0 && category.weight > 0
          ? ` · ${category.distributed}/${category.weight} distributed`
          : ''}
      </td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          className="text-xs text-indigo-600 hover:text-indigo-800 mr-3"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete()}
          disabled={busy}
          className="text-xs text-red-600 hover:text-red-700"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function NewCategoryForm({ onCancel, onSave, busy }) {
  const [name, setName] = useState('');
  const [weight, setWeight] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty.');
      return;
    }
    const w = Number(weight);
    if (isNaN(w) || w < 0) {
      toast.error('Weight must be a non-negative number.');
      return;
    }
    await onSave({ name: trimmed, weight: w });
    setName('');
    setWeight('');
  };

  return (
    <tr className="bg-gray-50">
      <td className="px-3 py-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name (e.g. Response Cards)"
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          autoFocus
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="0"
          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
        />
      </td>
      <td className="px-3 py-2 text-xs text-gray-400">new</td>
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy}
          className="text-xs text-indigo-600 hover:text-indigo-800 mr-3"
        >
          Create
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
}

export default function TeacherGradeSetup() {
  const { id: classId } = useParams();
  const [cls, setCls] = useState(null);
  const [categories, setCategories] = useState([]);
  const [uncategorised, setUncategorised] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, cats, gb] = await Promise.all([
        getClassById(classId),
        listGradeCategories(classId),
        getClassGradebook(classId),
      ]);
      setCls(c);
      setCategories(cats);
      setWarnings(gb.warnings || []);
      setUncategorised(
        gb.assignments.filter((a) => !a.category_id && a.grade_points_source !== 'manual')
          .map((a) => ({ id: a.id, title: a.title, raw_max: a.raw_max }))
      );
    } catch (err) {
      console.error(err);
      toast.error('Could not load grade setup.');
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => {
    load();
  }, [load]);

  const useCategories = Boolean(cls?.use_categories);

  const handleEnable = async () => {
    setBusy(true);
    try {
      await updateClass(classId, { use_categories: true });
      toast.success('Categories enabled.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not enable categories.');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (
      !window.confirm(
        'Turn categories off? Assignments revert to their raw max for rolling grades. The categories themselves are kept and can be turned back on later.'
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await updateClass(classId, { use_categories: false });
      toast.success('Categories turned off.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not turn off categories.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async ({ name, weight }) => {
    setBusy(true);
    try {
      await createGradeCategory(classId, {
        name,
        weight,
        position: categories.length,
      });
      toast.success(`Created "${name}".`);
      setShowNewForm(false);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not create category.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (categoryId, patch) => {
    setBusy(true);
    try {
      await updateGradeCategory(categoryId, patch);
      toast.success('Saved.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not update category.');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (category, assignmentCount) => {
    const msg =
      assignmentCount > 0
        ? `Delete "${category.name}"? ${assignmentCount} assignment${
            assignmentCount === 1 ? '' : 's'
          } will become uncategorised and stop counting toward rolling grades.`
        : `Delete "${category.name}"?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await deleteGradeCategory(category.id);
      toast.success('Deleted.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not delete category.');
    } finally {
      setBusy(false);
    }
  };

  const handleAssignAssignment = async (assignmentId, categoryId) => {
    setBusy(true);
    try {
      await updateAssignment(assignmentId, {
        category_id: categoryId || null,
      });
      toast.success(categoryId ? 'Added to category.' : 'Removed from category.');
      await load();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not update assignment.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading…
      </div>
    );
  }

  const totalWeight = categories.reduce((s, c) => s + Number(c.weight), 0);
  const totalOff = Math.abs(totalWeight - 100) > 0.01 && categories.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="mb-6">
          <Link
            to={`/classes/${classId}`}
            className="text-sm text-indigo-600 hover:text-indigo-500"
          >
            ← Back to {cls?.name || 'class'}
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Grade setup</h1>
          <p className="text-sm text-gray-600 mt-1">
            {cls?.name ? `${cls.name} · ` : ''}
            Define weighted categories to control how each assignment contributes
            to the rolling grade.
          </p>
        </div>

        {!useCategories && (
          <section className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Categories are off
            </h2>
            <p className="text-sm text-gray-700 mb-4">
              Every assignment currently counts its own raw max toward the
              rolling grade — one auto-graded activity is worth one grade point.
              Turn categories on if you want to weight groups of assignments
              (for example, Response Cards 20, Essays 40, Attendance 20, Final
              test 20).
            </p>
            <p className="text-xs text-gray-500 mb-4">
              You can turn this back off at any time. Nothing is lost.
            </p>
            <button
              type="button"
              onClick={handleEnable}
              disabled={busy}
              className="py-2 px-4 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
            >
              Enable categories
            </button>
          </section>
        )}

        {useCategories && (
          <>
            {totalOff && (
              <div className="mb-4 p-3 border border-amber-300 bg-amber-50 rounded-md text-sm text-amber-900">
                Category weights total <strong>{totalWeight}</strong>, not 100.
                Rolling grades will still work, but the class total will be out
                of {totalWeight} rather than out of 100.
              </div>
            )}

            <section className="bg-white rounded-lg shadow mb-6 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Categories ({categories.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setShowNewForm(true)}
                  disabled={busy || showNewForm}
                  className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
                >
                  + Add category
                </button>
              </div>
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2 text-left font-medium">Name</th>
                    <th className="px-3 py-2 text-left font-medium">Weight</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {categories.map((c) => (
                    <EditableCategoryRow
                      key={c.id}
                      category={c}
                      onSave={(patch) => handleUpdate(c.id, patch)}
                      onDelete={() => handleDelete(c, c.assignment_count)}
                      busy={busy}
                    />
                  ))}
                  {showNewForm && (
                    <NewCategoryForm
                      onCancel={() => setShowNewForm(false)}
                      onSave={handleCreate}
                      busy={busy}
                    />
                  )}
                  {categories.length === 0 && !showNewForm && (
                    <tr>
                      <td colSpan="4" className="px-3 py-6 text-center text-sm text-gray-500">
                        No categories yet. Click "+ Add category" to start.
                      </td>
                    </tr>
                  )}
                </tbody>
                {categories.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-100 font-semibold text-sm">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2">{totalWeight}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {totalOff ? (
                          <span className="text-amber-700">should equal 100</span>
                        ) : (
                          <span className="text-green-700">100 ✓</span>
                        )}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </section>

            {uncategorised.length > 0 && (
              <section className="bg-white rounded-lg shadow mb-6">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Uncategorised assignments ({uncategorised.length})
                  </h2>
                  <p className="text-xs text-amber-700 mt-1">
                    These do not count toward rolling grades until you put them
                    in a category.
                  </p>
                </div>
                <ul className="divide-y divide-gray-100">
                  {uncategorised.map((a) => (
                    <li
                      key={a.id}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {a.title}
                        </div>
                        <div className="text-xs text-gray-500">
                          raw max {a.raw_max}
                        </div>
                      </div>
                      <select
                        value=""
                        onChange={(e) =>
                          handleAssignAssignment(a.id, e.target.value || null)
                        }
                        disabled={busy || categories.length === 0}
                        className="px-2 py-1 border border-gray-300 rounded text-sm"
                      >
                        <option value="">— Choose category —</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {warnings.filter((w) => w.type !== 'weights_not_100' && w.type !== 'uncategorised').length > 0 && (
              <section className="bg-white rounded-lg shadow mb-6">
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Other warnings
                  </h2>
                </div>
                <ul className="divide-y divide-gray-100">
                  {warnings
                    .filter(
                      (w) => w.type !== 'weights_not_100' && w.type !== 'uncategorised'
                    )
                    .map((w, idx) => (
                      <li key={idx} className="px-4 py-3 text-sm text-amber-800">
                        {w.message}
                      </li>
                    ))}
                </ul>
              </section>
            )}

            <section className="bg-white rounded-lg shadow p-4">
              <h2 className="text-sm font-medium text-gray-700 mb-2">
                Turn off categories
              </h2>
              <p className="text-xs text-gray-500 mb-3">
                Categories are kept, but assignments revert to raw max for
                rolling grades. You can turn them back on later.
              </p>
              <button
                type="button"
                onClick={handleDisable}
                disabled={busy}
                className="py-1.5 px-3 text-xs text-gray-700 hover:text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
              >
                Turn off
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  );
}