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
  SYSTEM_DEFAULT_LETTER_BANDS,
} from '../lib/gradebookApi';
import {
  getClassById,
  updateClass,
} from '../lib/lmsApi';
import { updateAssignment } from '../lib/assignmentsApi';
import { updateClassAttendanceSettings } from '../lib/attendanceApi';
import { supabase } from '../lib/supabaseClient';

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

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  if (editing) {
    return (
      <tr className="bg-indigo-50">
        <td className="px-3 py-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
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
            onKeyDown={handleKeyDown}
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
      <td colSpan={4} className="px-3 py-2">
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 flex-wrap"
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name (e.g. Response Cards)"
            className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded text-sm"
            autoFocus
          />
          <input
            type="number"
            min="0"
            step="0.01"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="Weight"
            className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
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
        </form>
      </td>
    </tr>
  );
}

function AttendancePanel({ cls, categories, classId, onSaved, busy: parentBusy }) {
  const [pointsPerSession, setPointsPerSession] = useState(
    String(cls?.attendance_points_per_session ?? 1)
  );
  const [latePenalty, setLatePenalty] = useState(
    String(cls?.attendance_late_penalty ?? 0)
  );
  const [defaultTime, setDefaultTime] = useState(cls?.attendance_default_time || '');
  const [categoryId, setCategoryId] = useState(cls?.attendance_category_id || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPointsPerSession(String(cls?.attendance_points_per_session ?? 1));
    setLatePenalty(String(cls?.attendance_late_penalty ?? 0));
    setDefaultTime(cls?.attendance_default_time || '');
    setCategoryId(cls?.attendance_category_id || '');
  }, [
    cls?.attendance_points_per_session,
    cls?.attendance_late_penalty,
    cls?.attendance_default_time,
    cls?.attendance_category_id,
  ]);

  const handleSave = async () => {
    const per = Number(pointsPerSession);
    if (isNaN(per) || per < 0) {
      toast.error('Points per session must be a non-negative number.');
      return;
    }
    const late = Number(latePenalty);
    if (isNaN(late) || late < 0) {
      toast.error('Late penalty must be a non-negative number.');
      return;
    }
    if (late > per) {
      toast.error('Late penalty cannot exceed the points per session.');
      return;
    }
    setBusy(true);
    try {
      await updateClassAttendanceSettings(classId, {
        attendance_points_per_session: per,
        attendance_late_penalty: late,
        attendance_default_time: defaultTime.trim() || null,
        attendance_category_id: categoryId || null,
      });
      toast.success('Attendance settings saved.');
      if (onSaved) await onSaved();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save attendance settings.');
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const disabled = busy || parentBusy;

  return (
    <section className="bg-white rounded-lg shadow mb-6 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Attendance</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Points per session, late penalty, and which grade category attendance
            counts toward.
          </p>
        </div>
        <Link
          to={`/classes/${classId}/attendance`}
          className="py-1.5 px-3 text-sm bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md"
        >
          Mark attendance
        </Link>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Points per session
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={pointsPerSession}
            onChange={(e) => setPointsPerSession(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Present earns this many points. For a 14-week class worth 2 points each,
            enter 2.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Late penalty
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={latePenalty}
            onChange={(e) => setLatePenalty(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Subtracted from Present for Late. Set to 0 if lateness costs nothing.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Default session time
          </label>
          <input
            type="text"
            value={defaultTime}
            onChange={(e) => setDefaultTime(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. 14:00-15:30"
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Prefilled when you add a session or import from CSV.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Counts toward category
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
          >
            <option value="">— Not counted —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} (weight {c.weight})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-gray-500 mt-1">
            Pick the category that should hold attendance, e.g. Attendance 20.
            Leave blank to keep attendance out of rolling grades.
          </p>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled}
          className="py-1.5 px-4 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save attendance settings'}
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// Pass mark and letter grades panel (Phase 3d)
// ---------------------------------------------------------------------

function bandKey(b, i) {
  // Stable key for editing rows. Uses index — acceptable because the list is
  // small and reordering only happens on save.
  return `band-${i}`;
}

function validateBands(bands) {
  if (!bands || bands.length === 0) {
    return 'Add at least one band, or clear the bands entirely.';
  }
  const labels = new Set();
  const mins = new Set();
  let lowest = null;
  for (const b of bands) {
    const label = (b.label || '').trim();
    if (!label) return 'Every band needs a label (e.g. A, B, Pass).';
    if (labels.has(label.toLowerCase())) {
      return `Duplicate label "${label}". Labels must be unique.`;
    }
    labels.add(label.toLowerCase());

    const m = Number(b.min);
    if (!Number.isFinite(m) || m < 0 || m > 100) {
      return `Minimum for "${label}" must be a number between 0 and 100.`;
    }
    if (mins.has(m)) {
      return `Two bands share the minimum ${m}. Minimums must be unique.`;
    }
    mins.add(m);
    if (lowest == null || m < lowest) lowest = m;
  }
  return { ok: true, lowest };
}

function GradeScalePanel({ cls, classId, onSaved, busy: parentBusy }) {
  const [thresholdDraft, setThresholdDraft] = useState(
    cls?.pass_threshold != null ? String(cls.pass_threshold) : ''
  );
  const [bands, setBands] = useState(() => {
    const raw = cls?.letter_grade_bands;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw
        .map((b) => ({ label: String(b.label || ''), min: String(b.min ?? '') }))
        .sort((a, b) => Number(b.min) - Number(a.min));
    }
    return [];
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setThresholdDraft(
      cls?.pass_threshold != null ? String(cls.pass_threshold) : ''
    );
    const raw = cls?.letter_grade_bands;
    if (Array.isArray(raw) && raw.length > 0) {
      setBands(
        raw
          .map((b) => ({ label: String(b.label || ''), min: String(b.min ?? '') }))
          .sort((a, b) => Number(b.min) - Number(a.min))
      );
    } else {
      setBands([]);
    }
  }, [cls?.pass_threshold, cls?.letter_grade_bands]);

  const hasBands = bands.length > 0;

  const handleLoadSuggestions = () => {
    setBands(
      SYSTEM_DEFAULT_LETTER_BANDS.map((b) => ({
        label: b.label,
        min: String(b.min),
      }))
    );
  };

  const handleAddBand = () => {
    setBands((prev) => [...prev, { label: '', min: '' }]);
  };

  const handleRemoveBand = (index) => {
    setBands((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBandChange = (index, field, value) => {
    setBands((prev) =>
      prev.map((b, i) => (i === index ? { ...b, [field]: value } : b))
    );
  };

  const handleClearBands = () => {
    if (!window.confirm('Remove all letter bands for this class?')) return;
    setBands([]);
  };

  const handleSave = async () => {
    // Validate threshold.
    let thresholdValue = null;
    const rawThreshold = thresholdDraft.trim();
    if (rawThreshold !== '') {
      const n = Number(rawThreshold);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        toast.error('Pass threshold must be a number between 0 and 100, or blank.');
        return;
      }
      thresholdValue = n;
    }

    // Validate bands.
    let bandsValue = null;
    if (hasBands) {
      const result = validateBands(bands);
      if (result !== true && typeof result === 'string') {
        toast.error(result);
        return;
      }
      if (result && result.ok && result.lowest > 0) {
        const proceed = window.confirm(
          `Your lowest band starts at ${result.lowest}. Students below ${result.lowest}% ` +
            `will not receive a letter. Continue anyway?`
        );
        if (!proceed) return;
      }
      bandsValue = bands
        .map((b) => ({ label: b.label.trim(), min: Number(b.min) }))
        .sort((a, b) => b.min - a.min);
    }

    setBusy(true);
    try {
      const { error } = await supabase
        .from('classes')
        .update({
          pass_threshold: thresholdValue,
          letter_grade_bands: bandsValue,
          updated_at: new Date().toISOString(),
        })
        .eq('id', classId);
      if (error) throw error;
      toast.success('Grade scale saved.');
      if (onSaved) await onSaved();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Could not save grade scale.');
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || parentBusy;

  return (
    <section className="bg-white rounded-lg shadow mb-6 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">
          Pass mark and letter grades
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Optional. Both fields are independent — set one, both, or neither.
        </p>
      </div>

      <div className="p-4 space-y-6">
        {/* Pass threshold */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Pass threshold
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="number"
              min="0"
              max="100"
              step="0.5"
              value={thresholdDraft}
              onChange={(e) => setThresholdDraft(e.target.value)}
              placeholder="e.g. 60"
              className="w-32 px-2 py-1 border border-gray-300 rounded text-sm"
            />
            <span className="text-sm text-gray-500">%</span>
            {thresholdDraft !== '' && (
              <button
                type="button"
                onClick={() => setThresholdDraft('')}
                disabled={disabled}
                className="text-xs text-gray-500 hover:text-red-600 disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            A student at or above this percentage is marked as <strong>Pass</strong>.
            Leave blank to hide pass/fail everywhere.
          </p>
        </div>

        {/* Letter bands */}
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <label className="block text-sm font-medium text-gray-700">
              Letter grade bands
            </label>
            <div className="flex items-center gap-2">
              {!hasBands && (
                <button
                  type="button"
                  onClick={handleLoadSuggestions}
                  disabled={disabled}
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
                >
                  Use suggestions
                </button>
              )}
              {hasBands && (
                <>
                  <button
                    type="button"
                    onClick={handleAddBand}
                    disabled={disabled}
                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
                  >
                    + Add band
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadSuggestions}
                    disabled={disabled}
                    className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-900 border border-gray-300 rounded-md disabled:opacity-50"
                  >
                    Reset to suggestions
                  </button>
                  <button
                    type="button"
                    onClick={handleClearBands}
                    disabled={disabled}
                    className="text-xs px-2 py-1 text-red-600 hover:text-red-800 border border-red-200 rounded-md disabled:opacity-50"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          {!hasBands && (
            <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md px-3 py-4">
              No letter bands set for this class. Students will not see a letter
              grade. Click <strong>Use suggestions</strong> to start from
              S/A/B/C/D, then edit.
            </div>
          )}

          {hasBands && (
            <div className="space-y-2">
              {bands.map((b, i) => (
                <div key={bandKey(b, i)} className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={b.label}
                    onChange={(e) => handleBandChange(i, 'label', e.target.value)}
                    placeholder="Label"
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  <span className="text-xs text-gray-500">starts at</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={b.min}
                    onChange={(e) => handleBandChange(i, 'min', e.target.value)}
                    placeholder="0"
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                  />
                  <span className="text-xs text-gray-500">% or above</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveBand(i)}
                    disabled={disabled}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 ml-auto"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <p className="text-[11px] text-gray-500 pt-1">
                Bands are checked top-down. A student at 87% with the default
                scale gets <strong>A</strong>, because the A band (80) is
                matched first.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled}
          className="py-1.5 px-4 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save grade scale'}
        </button>
      </div>
    </section>
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
        gb.assignments
          .filter(
            (a) =>
              !a.is_attendance &&
              !a.category_id &&
              a.grade_points_source !== 'manual'
          )
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
          <section className="bg-white rounded-lg shadow p-6 mb-6">
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

        <AttendancePanel
          cls={cls}
          categories={categories}
          classId={classId}
          onSaved={load}
          busy={busy}
        />

        <GradeScalePanel
          cls={cls}
          classId={classId}
          onSaved={load}
          busy={busy}
        />

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