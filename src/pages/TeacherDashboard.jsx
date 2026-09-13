// src/pages/TeacherDashboard.jsx
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useConfirm } from '../context/ConfirmContext'
import {
  listLessonsWithStats,
  listFolders,
  createFolder,
  deleteFolder,
  renameFolder,
  moveLessonWithAutoShare,
  setLessonStatus,
  duplicateLesson,
  deleteLesson,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { listTeacherCalendarAssignments } from '../lib/calendarApi'
import DueSoonStrip from '../components/DueSoonStrip'

export default function TeacherDashboard() {
  const { user, logout } = useAuth()
  const { confirm } = useConfirm()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [folders, setFolders] = useState([])
  const [lessons, setLessons] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedFolderId, setSelectedFolderId] = useState(null)
  const [viewMode, setViewMode] = useState('folders')
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreatingFolder, setIsCreatingFolder] = useState(false)
  const [calendarAssignments, setCalendarAssignments] = useState([])

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    if (!loading && folders.length > 0) {
      const folderParam = searchParams.get('folder')
      if (folderParam && folderParam !== 'all' && folderParam !== 'uncategorised') {
        const folderExists = folders.some(f => f.id === folderParam)
        if (folderExists) {
          setSelectedFolderId(folderParam)
          setViewMode('lessons')
        }
      }
    }
  }, [loading, folders, searchParams])

  async function loadData() {
    setLoading(true)
    try {
      const [lessonsData, foldersData, calendarData] = await Promise.all([
        listLessonsWithStats(user.id),
        listFolders(user.id),
        listTeacherCalendarAssignments(),
      ])
      setLessons(lessonsData)
      setFolders(foldersData)
      setCalendarAssignments(calendarData)
    } catch (err) {
      console.error('Failed to load dashboard:', err)
      toast.error('Could not load data. Please refresh.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateFolder(e) {
    e.preventDefault()
    if (!newFolderName.trim()) return
    setIsCreatingFolder(true)
    try {
      await createFolder(newFolderName.trim(), user.id)
      setNewFolderName('')
      await loadData()
      toast.success('Folder created!')
    } catch (err) {
      toast.error('Failed to create folder: ' + err.message)
    } finally {
      setIsCreatingFolder(false)
    }
  }

  async function handleDeleteFolder(folderId) {
    const ok = await confirm({
      title: 'Delete Folder',
      message: 'Delete this folder? Lessons will be moved to "Uncategorised".',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger'
    })
    if (!ok) return
    try {
      await deleteFolder(folderId)
      await loadData()
      toast.success('Folder deleted.')
    } catch (err) {
      toast.error('Failed to delete folder: ' + err.message)
    }
  }

  async function handleRenameFolder(folderId, newName) {
    try {
      await renameFolder(folderId, newName)
      await loadData()
      toast.success('Folder renamed.')
    } catch (err) {
      toast.error('Failed to rename folder: ' + err.message)
    }
  }

  function viewFolder(folderId) {
    setSelectedFolderId(folderId)
    setViewMode('lessons')
    navigate(`/?folder=${folderId}`, { replace: true })
  }

  function backToFolders() {
    setViewMode('folders')
    setSelectedFolderId(null)
    navigate('/', { replace: true })
  }

  async function handleDeleteLesson(lessonId, lessonTitle) {
    const ok = await confirm({
      title: 'Delete Lesson',
      message: `Permanently delete "${lessonTitle}"? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger'
    })
    if (!ok) return
    try {
      await deleteLesson(lessonId)
      await loadData()
      toast.success('Lesson deleted.')
    } catch (err) {
      toast.error('Failed to delete lesson: ' + err.message)
    }
  }

  async function handleMoveLesson(lessonId, folderId) {
    try {
      await moveLessonWithAutoShare(lessonId, folderId, user.id)
      await loadData()
    } catch (err) {
      toast.error('Failed to move lesson: ' + err.message)
    }
  }

  function handleCopyLink(slug) {
    const baseUrl = window.location.origin
    const url = `${baseUrl}/lesson/${slug}`
    navigator.clipboard.writeText(url).then(() => {
      toast.success('✅ Student lesson link copied!')
    }).catch(() => {
      const textarea = document.createElement('textarea')
      textarea.value = url
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      toast.success('✅ Student lesson link copied!')
    })
  }

  async function handleDuplicate(lessonId) {
    const ok = await confirm({
      title: 'Duplicate Lesson',
      message: 'Create a copy of this lesson?',
      confirmText: 'Duplicate',
      cancelText: 'Cancel',
      type: 'info'
    })
    if (!ok) return
    try {
      await duplicateLesson(lessonId, user.id)
      await loadData()
      toast.success('Lesson duplicated.')
    } catch (err) {
      toast.error('Failed to duplicate: ' + err.message)
    }
  }

  async function handlePublish(id) {
    await setLessonStatus(id, 'published')
    await loadData()
    toast.success('Lesson published.')
  }

  async function handleUnpublish(id) {
    await setLessonStatus(id, 'draft')
    await loadData()
    toast.success('Lesson unpublished.')
  }

  const filteredLessons = lessons.filter(lesson => {
    if (selectedFolderId === null) return true
    if (selectedFolderId === 'uncategorised') return lesson.folder_id === null
    return lesson.folder_id === selectedFolderId
  })

  const getFolderName = () => {
    if (selectedFolderId === null) return 'All Lessons'
    if (selectedFolderId === 'uncategorised') return 'Uncategorised'
    const folder = folders.find(f => f.id === selectedFolderId)
    return folder ? folder.name : 'Unknown Folder'
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm-50">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-warm-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (viewMode === 'folders') {
    const uncategorisedCount = lessons.filter(l => l.folder_id === null).length

    return (
      <div className="min-h-screen bg-warm-50">
        <header className="bg-white/80 backdrop-blur-md border-b border-warm-200/60 sticky top-0 z-20">
          <div className="container-wide py-4 flex flex-wrap justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <img src="/sel.png" alt="SEL Logo" className="h-10 w-auto" />
              <h1 className="text-2xl font-display text-warm-900 tracking-tight">
                SEL Lesson Builder
              </h1>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm text-warm-700">
                {user?.user_metadata?.display_name || user?.email}
              </span>
              <button
                onClick={async () => {
                  await logout()
                  window.location.href = '/login'
                }}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Logout
              </button>
              <Link
                to="/public-library"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-warm-600 hover:text-warm-800"
              >
                🌍 Shared Lessons
              </Link>
              <Link
                to="/calendar"
                className="text-sm text-warm-700 hover:text-warm-900 border border-warm-300 rounded-md px-3 py-1.5"
              >
                📅 Calendar
              </Link>
              <Link
                to="/classes"
                className="text-sm text-warm-700 hover:text-warm-900 border border-warm-300 rounded-md px-3 py-1.5"
              >
                🏫 My Classes
              </Link>
              <Link to="/builder" className="btn-primary">
                + New Lesson
              </Link>
            </div>
          </div>
        </header>

        <div className="container-wide py-8">
          <div className="card p-6 mb-8">
            <form onSubmit={handleCreateFolder} className="flex gap-4 items-center flex-wrap">
              <input
                type="text"
                placeholder="New folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="input-field flex-1 min-w-[200px]"
                disabled={isCreatingFolder}
                autoFocus
              />
              <button
                type="submit"
                disabled={isCreatingFolder || !newFolderName.trim()}
                className="btn-primary"
              >
                + Create Folder
              </button>
            </form>
          </div>

          <div className="mb-8">
            <DueSoonStrip
              assignments={calendarAssignments}
              linkBuilder={(a) => `/classes/${a.class_id}/assignments/${a.id}`}
              emptyText="No assignments due in the next 7 days."
            />
          </div>

          {folders.length === 0 && uncategorisedCount === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-warm-500 text-lg mb-4">No folders or lessons yet.</p>
              <p className="text-warm-400 text-sm mb-6">Create your first folder above, or create a lesson directly.</p>
              <Link to="/builder" className="btn-primary inline-block">
                Create your first lesson
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div
                onClick={() => viewFolder(null)}
                className="card-hover p-6 cursor-pointer border-2 border-primary-200 hover:border-primary-400"
              >
                <div className="text-3xl mb-2">📂</div>
                <h3 className="text-lg font-semibold text-warm-900">All Lessons</h3>
                <p className="text-sm text-warm-500">{lessons.length} lessons</p>
              </div>

              <div
                onClick={() => viewFolder('uncategorised')}
                className={`card-hover p-6 cursor-pointer border-2 ${
                  uncategorisedCount === 0
                    ? 'border-warm-200 opacity-60'
                    : 'border-warm-300 hover:border-warm-400'
                }`}
              >
                <div className="text-3xl mb-2">📄</div>
                <h3 className="text-lg font-semibold text-warm-900">Uncategorised</h3>
                <p className="text-sm text-warm-500">{uncategorisedCount} lessons</p>
              </div>

              {folders.map((folder) => {
                const count = lessons.filter(l => l.folder_id === folder.id).length
                return (
                  <div
                    key={folder.id}
                    onClick={() => viewFolder(folder.id)}
                    className="card-hover p-6 cursor-pointer border-2 border-warm-200 hover:border-primary-400 group"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="text-3xl mb-2">📁</div>
                        <h3 className="text-lg font-semibold text-warm-900 group-hover:text-primary-600 transition">
                          {folder.name}
                          {folder.name === 'Shared' && (
                            <span className="text-xs bg-accent-100 text-accent-700 px-2 py-0.5 rounded-full ml-2 font-medium">
                              Auto‑share
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-warm-500">{count} lessons</p>
                        {folder.name === 'Shared' && (
                          <p className="text-xs text-warm-400 mt-1">Lessons here are automatically shared</p>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            const newName = prompt('Rename folder:', folder.name)
                            if (newName && newName.trim()) {
                              handleRenameFolder(folder.id, newName.trim())
                            }
                          }}
                          className="text-xs text-warm-400 hover:text-warm-600 p-1"
                          title="Rename"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteFolder(folder.id)
                          }}
                          className="text-xs text-warm-400 hover:text-red-500 p-1"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-warm-50">
      <header className="bg-white/80 backdrop-blur-md border-b border-warm-200/60 sticky top-0 z-20">
        <div className="container-wide py-4 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={backToFolders}
              className="text-warm-500 hover:text-warm-700 flex items-center gap-1"
            >
              ← Folders
            </button>
            <img src="/sel.png" alt="SEL Logo" className="h-10 w-auto" />
            <h1 className="text-xl font-display text-warm-900">
              📁 {getFolderName()}
            </h1>
            <span className="text-sm text-warm-400">({filteredLessons.length} lessons)</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm text-warm-700">
              {user?.user_metadata?.display_name || user?.email}
            </span>
            <button
              onClick={async () => {
                await logout()
                window.location.href = '/login'
              }}
              className="text-sm text-red-600 hover:text-red-800"
            >
              Logout
            </button>
            <Link
              to="/public-library"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-warm-600 hover:text-warm-800"
            >
              🌍 Shared Lessons
            </Link>
            <Link
              to="/calendar"
              className="text-sm text-warm-700 hover:text-warm-900 border border-warm-300 rounded-md px-3 py-1.5"
            >
              📅 Calendar
            </Link>
            <Link
              to="/classes"
              className="text-sm text-warm-700 hover:text-warm-900 border border-warm-300 rounded-md px-3 py-1.5"
            >
              🏫 My Classes
            </Link>
            <Link to="/builder" className="btn-primary">
              + New Lesson
            </Link>
          </div>
        </div>
      </header>

      <div className="container-wide py-8">
        {filteredLessons.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-warm-500 mb-4">No lessons in this folder.</p>
            <Link to="/builder" className="btn-primary inline-block">
              Create a lesson
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredLessons.map((lesson) => {
              const isPublic = lesson.is_public
              const level = lesson.level || 'B1'
              const description = lesson.description || 'No description available.'

              return (
                <div key={lesson.id} className="lesson-card">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-warm-900 truncate">
                        {lesson.title}
                      </h3>
                      <p className="text-sm text-warm-500 mt-1 line-clamp-2">
                        {description}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 mt-3">
                        <span className={`level-badge level-badge-${level.toUpperCase()}`}>
                          {level}
                        </span>
                        <span className="text-xs text-warm-400 flex items-center gap-2">
                          <span>Language: English</span>
                          <span className="w-px h-3 bg-warm-200 inline-block"></span>
                          <span>CEFR Level {level}</span>
                        </span>
                        {isPublic && (
                          <span className="text-xs bg-accent-100 text-accent-700 px-2 py-0.5 rounded-full font-medium">
                            🌍 Public
                          </span>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                          lesson.status === 'published'
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                        }`}>
                          {lesson.status}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap flex-shrink-0 mt-2 md:mt-0">
                      <div className="flex items-center gap-3 mr-2 text-xs text-warm-500">
                        <span title="Completions">📝 {lesson.completedCount || 0}</span>
                        {lesson.avgPercent !== null && (
                          <span title="Average score">📊 {lesson.avgPercent}%</span>
                        )}
                      </div>

                      <select
                        value={lesson.folder_id || ''}
                        onChange={(e) => handleMoveLesson(lesson.id, e.target.value || null)}
                        className="text-xs border border-warm-200 rounded-full px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400/20"
                      >
                        <option value="">Move</option>
                        <option value="">📄 Uncategorised</option>
                        {folders.map(f => (
                          <option key={f.id} value={f.id}>📁 {f.name}</option>
                        ))}
                      </select>

                      <Link
                        to={`/lesson/${lesson.share_slug}`}
                        target="_blank"
                        className="btn-primary text-xs py-1.5 px-4"
                      >
                        Try It
                      </Link>

                      <button
                        onClick={() => handleCopyLink(lesson.share_slug)}
                        className="btn-secondary text-xs py-1.5 px-4"
                      >
                        Link
                      </button>

                      <Link
                        to={`/builder/${lesson.id}`}
                        className="btn-ghost text-xs py-1 px-3"
                      >
                        ✏️ Edit
                      </Link>

                      <Link
                        to={`/results/${lesson.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-ghost text-xs py-1 px-3"
                      >
                        Results
                      </Link>

                      <button
                        onClick={() => handleDuplicate(lesson.id)}
                        className="btn-ghost text-xs py-1 px-3"
                      >
                        Copy
                      </button>

                      <button
                        onClick={() => handleDeleteLesson(lesson.id, lesson.title)}
                        className="text-red-400 hover:text-red-600 text-xs py-1 px-2 font-medium"
                      >
                        🗑️
                      </button>

                      {lesson.status === 'draft' ? (
                        <button
                          onClick={() => handlePublish(lesson.id)}
                          className="btn-primary text-xs py-1.5 px-4"
                        >
                          Publish
                        </button>
                      ) : (
                        <button
                          onClick={() => handleUnpublish(lesson.id)}
                          className="btn-secondary text-xs py-1.5 px-4"
                        >
                          Unpublish
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}