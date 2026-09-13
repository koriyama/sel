// src/pages/LessonLibrary.jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { listLessonsWithStats, listFolders, deleteLessons, bulkMoveLessons } from '../lib/api';
import { useConfirm } from '../context/ConfirmContext';

export default function LessonLibrary() {
  const { user } = useAuth();
  const { confirm } = useConfirm();
  const [lessons, setLessons] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [targetFolderId, setTargetFolderId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [folderFilter, setFolderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadData = async () => {
    setLoading(true);
    try {
      const [allLessons, userFolders] = await Promise.all([
        listLessonsWithStats(user.id),
        listFolders(user.id)
      ]);
      // Hide lessons that belong to a class. Those are managed inside
      // the class view, not the personal library.
      setLessons(allLessons.filter(l => !l.class_id));
      setFolders(userFolders);
    } catch (err) {
      toast.error('Failed to load lessons: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const filteredLessons = lessons.filter(lesson => {
    const matchesSearch = lesson.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFolder = folderFilter === 'all' || (folderFilter === 'uncategorised' ? lesson.folder_id === null : lesson.folder_id === folderFilter);
    const matchesStatus = statusFilter === 'all' || lesson.status === statusFilter;
    return matchesSearch && matchesFolder && matchesStatus;
  });

  const toggleSelect = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLessons.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLessons.map(l => l.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: 'Delete Lessons',
      message: `Delete ${selectedIds.size} lesson(s)? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger'
    });
    if (!ok) return;
    try {
      await deleteLessons(Array.from(selectedIds));
      setSelectedIds(new Set());
      await loadData();
      toast.success('Lessons deleted.');
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  const handleBulkMove = async () => {
    if (selectedIds.size === 0 || !targetFolderId) return;
    const ok = await confirm({
      title: 'Move Lessons',
      message: `Move ${selectedIds.size} lesson(s) to folder?`,
      confirmText: 'Move',
      cancelText: 'Cancel',
      type: 'info'
    });
    if (!ok) return;
    try {
      await bulkMoveLessons(Array.from(selectedIds), targetFolderId);
      setSelectedIds(new Set());
      await loadData();
      toast.success('Lessons moved.');
    } catch (err) {
      toast.error('Failed to move: ' + err.message);
    }
  };

  const handleBulkExport = () => {
    if (selectedIds.size === 0) {
      toast.error('Select at least one lesson to export.');
      return;
    }
    const ids = Array.from(selectedIds);
    toast.success(`Exporting ${ids.length} lessons (IDs: ${ids.join(', ')})`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-warm-50 py-8">
      <div className="container-wide">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <img src="/sel.png" alt="SEL Logo" className="h-10 w-auto" />
            <h1 className="text-2xl font-display text-warm-900">My Lesson Library</h1>
          </div>
          <Link to="/" className="btn-secondary">← Back to Dashboard</Link>
        </div>

        <div className="card p-4 mb-6 space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <input
                type="text"
                placeholder="Search by title..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-warm-700">Folder:</label>
              <select
                className="input-field w-auto min-w-[140px]"
                value={folderFilter}
                onChange={(e) => setFolderFilter(e.target.value)}
              >
                <option value="all">All Folders</option>
                <option value="uncategorised">📄 Uncategorised</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>📁 {f.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-warm-700">Status:</label>
              <select
                className="input-field w-auto min-w-[120px]"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          {filteredLessons.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 border-t border-warm-100 pt-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredLessons.length && filteredLessons.length > 0}
                  onChange={toggleSelectAll}
                  className="w-4 h-4 text-primary-600 rounded border-warm-300 focus:ring-primary-500"
                />
                <span className="text-sm text-warm-600">
                  {selectedIds.size} of {filteredLessons.length} selected
                </span>
              </div>

              <select
                className="input-field w-auto min-w-[150px]"
                value={targetFolderId}
                onChange={(e) => setTargetFolderId(e.target.value)}
              >
                <option value="">Move to...</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>📁 {f.name}</option>
                ))}
                <option value="">📄 Uncategorised</option>
              </select>

              <button onClick={handleBulkMove} disabled={selectedIds.size === 0 || !targetFolderId} className="btn-secondary text-sm">
                Move
              </button>

              <button onClick={handleBulkExport} disabled={selectedIds.size === 0} className="btn-secondary text-sm">
                📤 Export
              </button>

              <button
                onClick={handleBulkDelete}
                disabled={selectedIds.size === 0}
                className="btn-secondary text-sm text-red-600 hover:bg-red-50"
              >
                🗑️ Delete
              </button>

              <span className="text-xs text-warm-400 ml-auto">
                {filteredLessons.length} lesson{filteredLessons.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {filteredLessons.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-warm-500">
              {lessons.length === 0
                ? "You haven't created any lessons yet."
                : 'No lessons match your current filters.'}
            </p>
            {lessons.length === 0 && (
              <Link to="/builder" className="btn-primary inline-block mt-4">
                Create your first lesson
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLessons.map((lesson) => (
              <div key={lesson.id} className="card p-4 hover:shadow-hover transition-shadow flex flex-wrap items-center gap-4">
                <input
                  type="checkbox"
                  checked={selectedIds.has(lesson.id)}
                  onChange={() => toggleSelect(lesson.id)}
                  className="w-4 h-4 text-primary-600 rounded border-warm-300 focus:ring-primary-500 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-base font-medium text-warm-900 truncate">{lesson.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      lesson.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {lesson.status}
                    </span>
                    <span className="text-xs text-warm-400 font-mono">{lesson.level}</span>
                    {lesson.is_public && (
                      <span className="text-xs bg-accent-100 text-accent-700 px-2 py-0.5 rounded-full font-medium">🌍 Public</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-1 text-sm text-warm-500">
                    <span>📝 {lesson.completedCount || 0} completions</span>
                    {lesson.avgPercent !== null && <span>📊 Avg: {lesson.avgPercent}%</span>}
                    <span className="text-warm-400">{new Date(lesson.created_at).toLocaleDateString()}</span>
                    <span className="text-warm-400 truncate">
                      {lesson.folder_id
                        ? `📁 ${folders.find(f => f.id === lesson.folder_id)?.name || 'Folder'}`
                        : '📄 Uncategorised'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                  <Link to={`/builder/${lesson.id}`} className="btn-secondary text-sm px-3 py-1">✏️ Edit</Link>
                  <Link to={`/results/${lesson.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-warm-500 hover:underline">
                    Results
                  </Link>
                  <button
                    onClick={() => {
                      const url = `${window.location.origin}/lesson/${lesson.share_slug}`;
                      navigator.clipboard.writeText(url);
                      toast.success('Student link copied!');
                    }}
                    className="text-sm text-primary-600 hover:underline"
                  >
                    🔗 Link
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}