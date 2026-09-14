// src/pages/LessonResults.jsx
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useConfirm } from '../context/ConfirmContext'
import { useAuth } from '../context/AuthContext'
import { getLesson, getResultsForLesson, deleteSubmissions, listSections } from '../lib/api'
import { supabase } from '../lib/supabaseClient'
import {
  listReviewGradesForSubmissions,
  saveHolisticGrade,
  saveActivityGrade,
  deleteReviewGrade,
  computeSubmissionTotals,
} from '../lib/reviewGradesApi'

const AUTO_GRADED_TYPES = [
  'gap_fill',
  'multiple_choice',
  'gap_fill_dropdown',
  'sentence_jumble',
  'vocabulary_matching',
  'listening',
  'dictation',
]

function isAutoGraded(type) {
  return AUTO_GRADED_TYPES.includes(type)
}

function formatResponseText(activityType, storedValue, config) {
  if (storedValue === undefined || storedValue === null || storedValue === '') return ''
  const value = String(storedValue)
  switch (activityType) {
    case 'multiple_choice': {
      let options = config?.options_en || config?.options_ja || config?.options || []
      if (!Array.isArray(options) || options.length === 0) options = config?.options_ja || []
      if (Array.isArray(options) && options.length > 0) {
        const idx = parseInt(value, 10)
        if (!isNaN(idx) && idx >= 0 && idx < options.length) return options[idx]
      }
      return value
    }
    case 'gap_fill_dropdown': {
      const dropdownOptions = config?.dropdownOptions || []
      const indices = value.split(',').map(s => parseInt(s.trim(), 10))
      const chosenWords = indices.map((idx, i) => {
        const opts = dropdownOptions[i] || []
        return (!isNaN(idx) && idx >= 0 && idx < opts.length) ? opts[idx] : '—'
      })
      return chosenWords.join(', ')
    }
    case 'sentence_jumble': {
      const words = config?.words || []
      const indices = value.split(',').map(s => parseInt(s.trim(), 10))
      return indices.map(idx => {
        const word = (idx >= 0 && idx < words.length) ? words[idx] : '?'
        return word.replace(/[.,!?;:"]$/, '')
      }).join(' ')
    }
    case 'vocabulary_matching': {
      const pairs = config?.pairs || []
      let attempts = {}
      try { attempts = JSON.parse(value) } catch { return value }
      const entries = Object.entries(attempts)
        .filter(([t, d]) => {
          const ti = parseInt(t, 10); const di = parseInt(d, 10)
          return !isNaN(ti) && !isNaN(di) && ti >= 0 && ti < pairs.length && di >= 0 && di < pairs.length
        })
        .map(([t, d]) => {
          const ti = parseInt(t, 10); const di = parseInt(d, 10)
          const term = pairs[ti]?.term || '?'
          const def = pairs[di]?.definition || '?'
          return `${term} → ${def}${ti === di ? ' ✅' : ' ❌'}`
        })
      return entries.length > 0 ? entries.join('; ') : 'No valid matches'
    }
    case 'listening': {
      const questions = config?.questions || []
      let answersObj = {}
      try { answersObj = JSON.parse(value) } catch { return value }
      const parts = Object.entries(answersObj)
        .filter(([, val]) => val !== undefined && val !== null && val !== -1)
        .map(([qIdx, val]) => {
          const idx = parseInt(qIdx, 10)
          const question = questions[idx] || {}
          const selected = parseInt(val, 10)
          if (question.type === 'true_false' || !question.options) {
            return `Q${idx+1}: ${selected === 0 ? 'True' : 'False'}`
          }
          const opts = question.options || []
          const chosen = (selected >= 0 && selected < opts.length) ? opts[selected] : '—'
          return `Q${idx+1}: ${chosen}`
        })
      return parts.length > 0 ? parts.join('; ') : 'No answers'
    }
    default: return value
  }
}

function ReviewBadge({ status }) {
  if (!status) return null
  const styles = {
    ungraded: 'bg-amber-100 text-amber-800',
    'part graded': 'bg-indigo-100 text-indigo-800',
    graded: 'bg-green-100 text-green-800',
  }
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
        styles[status] || 'bg-gray-100 text-gray-700'
      }`}
    >
      {status}
    </span>
  )
}

function SubmissionGradingPanel({
  submission,
  lesson,
  reviewActivities,
  initialGrades,
  onSaved,
  userId,
}) {
  const mode = lesson.review_grading_mode || 'holistic'
  const holisticMax = lesson.max_review_points

  const initialHolistic = (initialGrades || []).find((g) => g.activity_id === null)
  const [holisticEarned, setHolisticEarned] = useState(
    initialHolistic ? String(initialHolistic.points_earned) : ''
  )
  const [holisticComment, setHolisticComment] = useState(initialHolistic?.comment || '')

  const [perActivity, setPerActivity] = useState(() => {
    const init = {}
    for (const ra of reviewActivities) {
      const g = (initialGrades || []).find((x) => x.activity_id === ra.id)
      init[ra.id] = {
        earned: g ? String(g.points_earned) : '',
        comment: g ? (g.comment || '') : '',
      }
    }
    return init
  })

  const [saving, setSaving] = useState(false)

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (mode === 'holistic') {
        if (holisticEarned === '') {
          toast.error('Enter a mark before saving.')
          setSaving(false)
          return
        }
        await saveHolisticGrade({
          submissionId: submission.id,
          pointsEarned: Number(holisticEarned),
          pointsMax: holisticMax,
          comment: holisticComment,
          gradedBy: userId,
        })
      } else {
        let anySaved = false
        for (const ra of reviewActivities) {
          const row = perActivity[ra.id] || { earned: '', comment: '' }
          if (row.earned === '') continue
          await saveActivityGrade({
            submissionId: submission.id,
            activityId: ra.id,
            pointsEarned: Number(row.earned),
            pointsMax: ra.points ?? 1,
            comment: row.comment,
            gradedBy: userId,
          })
          anySaved = true
        }
        if (!anySaved) {
          toast.error('Enter at least one mark before saving.')
          setSaving(false)
          return
        }
      }
      toast.success('Review marks saved.')
      if (onSaved) await onSaved()
    } catch (err) {
      console.error(err)
      toast.error('Save failed: ' + (err.message || 'unknown error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleClearHolistic() {
    setSaving(true)
    try {
      await deleteReviewGrade({ submissionId: submission.id, activityId: null })
      setHolisticEarned('')
      setHolisticComment('')
      toast.success('Mark cleared.')
      if (onSaved) await onSaved()
    } catch (err) {
      console.error(err)
      toast.error('Clear failed: ' + (err.message || 'unknown error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleClearActivity(activityId) {
    setSaving(true)
    try {
      await deleteReviewGrade({ submissionId: submission.id, activityId })
      setPerActivity((prev) => ({
        ...prev,
        [activityId]: { earned: '', comment: '' },
      }))
      toast.success('Mark cleared.')
      if (onSaved) await onSaved()
    } catch (err) {
      console.error(err)
      toast.error('Clear failed: ' + (err.message || 'unknown error'))
    } finally {
      setSaving(false)
    }
  }

  const hasAnyHolistic = !!initialHolistic

  return (
    <div className="mt-1 mb-2 border-l-4 border-purple-400 bg-purple-50/40 rounded-r px-3 py-2 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-[11px] font-semibold text-purple-900 uppercase tracking-wide">
          Review grading — {mode === 'holistic' ? 'holistic' : 'per activity'}
        </span>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="text-[11px] px-2 py-0.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save marks'}
        </button>
      </div>

      {mode === 'holistic' && holisticMax == null && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          No maximum is set for this lesson. Open it in the Lesson Builder and set
          <strong> Maximum points</strong> under Review grading.
        </p>
      )}

      {mode === 'holistic' && holisticMax != null && (
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <label className="flex items-center gap-1">
            <span className="text-gray-700">Mark:</span>
            <input
              type="number"
              min={0}
              max={holisticMax}
              step="0.5"
              value={holisticEarned}
              onChange={(e) => setHolisticEarned(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-20 px-2 py-0.5 border border-gray-300 rounded text-xs"
            />
            <span className="text-gray-500">/ {holisticMax}</span>
          </label>
          <input
            type="text"
            value={holisticComment}
            onChange={(e) => setHolisticComment(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Comment (optional)"
            className="flex-1 min-w-[8rem] px-2 py-0.5 border border-gray-300 rounded text-xs"
          />
          {hasAnyHolistic && (
            <button
              type="button"
              onClick={handleClearHolistic}
              disabled={saving}
              className="text-[10px] text-gray-500 hover:text-red-600 disabled:opacity-50"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {mode === 'per_activity' && (
        <div className="space-y-1">
          {reviewActivities.map((ra, i) => {
            const row = perActivity[ra.id] || { earned: '', comment: '' }
            const existing = (initialGrades || []).find((g) => g.activity_id === ra.id)
            return (
              <div key={ra.id} className="flex items-center gap-2 flex-wrap text-[11px]">
                <span className="font-medium text-gray-600 shrink-0">
                  Q{i + 1}:
                </span>
                <input
                  type="number"
                  min={0}
                  max={ra.points ?? 1}
                  step="1"
                  value={row.earned}
                  onChange={(e) =>
                    setPerActivity((prev) => ({
                      ...prev,
                      [ra.id]: { ...row, earned: e.target.value },
                    }))
                  }
                  onKeyDown={handleKeyDown}
                  className="w-16 px-2 py-0.5 border border-gray-300 rounded text-xs"
                />
                <span className="text-gray-500 shrink-0">/ {ra.points ?? 1}</span>
                <input
                  type="text"
                  value={row.comment}
                  onChange={(e) =>
                    setPerActivity((prev) => ({
                      ...prev,
                      [ra.id]: { ...row, comment: e.target.value },
                    }))
                  }
                  onKeyDown={handleKeyDown}
                  placeholder="Comment (optional)"
                  className="flex-1 min-w-[8rem] px-2 py-0.5 border border-gray-300 rounded text-xs"
                />
                {existing && (
                  <button
                    type="button"
                    onClick={() => handleClearActivity(ra.id)}
                    disabled={saving}
                    className="text-[10px] text-gray-500 hover:text-red-600 disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function LessonResults() {
  const { lessonId } = useParams()
  const [searchParams] = useSearchParams()
  const fromContext = searchParams.get('from')
  const classIdParam = searchParams.get('class')
  const assignmentIdParam = searchParams.get('assignment')

  const { confirm } = useConfirm()
  const { user } = useAuth()
  const [lesson, setLesson] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [activityMap, setActivityMap] = useState({})
  const [reviewGradesBySub, setReviewGradesBySub] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportStatus, setExportStatus] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [expandedIds, setExpandedIds] = useState(new Set())

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true)
        const lessonData = await getLesson(lessonId)
        setLesson(lessonData)

        const sectionsData = await listSections(lessonId)
        const map = {}
        sectionsData.forEach(section => {
          (section.activities || []).forEach(act => {
            map[act.id] = {
              prompt: act.prompt || '',
              position: act.position ?? 0,
              type: act.type,
              sectionTitle: section.title || '',
              config: act.config || {},
              points: act.points ?? 1,
            }
          })
        })
        setActivityMap(map)

        const results = await getResultsForLesson(lessonId)

        const studentIds = [...new Set(results.map(r => r.student_id).filter(Boolean))]
        const profileMap = {}
        if (studentIds.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, display_name, institutional_id')
            .in('id', studentIds)
          for (const p of profiles || []) profileMap[p.id] = p
        }

        const enhanced = results.map(sub => {
          const answers = sub.answers || {}
          const activityIds = Object.keys(answers).filter(key => !key.endsWith('_graded'))
          const responses = activityIds.map(activityId => {
            const responseText = answers[activityId]
            const gradedKey = activityId + '_graded'
            const graded = answers[gradedKey] || {}
            const score = graded.score ?? 0
            const maxScore = graded.maxScore ?? 0
            const autoCorrect = graded.autoCorrect !== undefined ? graded.autoCorrect : null
            const actInfo = map[activityId] || {
              prompt: `Activity ${activityId}`, position: 999, type: 'unknown', config: {}
            }
            const displayResponse = formatResponseText(actInfo.type, responseText, actInfo.config)
            return {
              id: `resp-${activityId}`,
              activity_id: activityId,
              response_text: typeof displayResponse === 'string' ? displayResponse : JSON.stringify(displayResponse),
              auto_correct: autoCorrect,
              score: score,
              maxScore: maxScore,
              prompt: actInfo.prompt,
              position: actInfo.position,
              type: actInfo.type,
              sectionTitle: actInfo.sectionTitle
            }
          })
          responses.sort((a, b) => a.position - b.position)
          const profile = sub.student_id ? profileMap[sub.student_id] : null
          return {
            ...sub,
            responses,
            display_name: profile?.display_name || sub.student_identifier || '(unknown)',
            institutional_id: profile?.institutional_id || null,
          }
        })

        enhanced.sort((a, b) => {
          if (a.status === 'completed' && b.status !== 'completed') return -1
          if (a.status !== 'completed' && b.status === 'completed') return 1
          const da = a.submitted_at ? new Date(a.submitted_at) : new Date(0)
          const db = b.submitted_at ? new Date(b.submitted_at) : new Date(0)
          return db - da
        })
        setSubmissions(enhanced)

        const subIds = enhanced.map((s) => s.id)
        const gradesBySub = await listReviewGradesForSubmissions(subIds)
        setReviewGradesBySub(gradesBySub)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [lessonId])

  const reviewActivities = useMemo(() => {
    return Object.entries(activityMap)
      .filter(([, info]) => !isAutoGraded(info.type))
      .map(([id, info]) => ({
        id,
        type: info.type,
        prompt: info.prompt,
        position: info.position,
        points: info.points ?? 1,
      }))
      .sort((a, b) => a.position - b.position)
  }, [activityMap])

  const refreshReviewGrades = useCallback(async () => {
    if (submissions.length === 0) return
    try {
      const grades = await listReviewGradesForSubmissions(submissions.map((s) => s.id))
      setReviewGradesBySub(grades)
    } catch (err) {
      console.error('Failed to refresh review grades:', err)
    }
  }, [submissions])

  function computeGradingStatus(sub) {
    if (reviewActivities.length === 0) return null
    if (sub.status !== 'completed') return null
    const grades = reviewGradesBySub[sub.id] || []
    if ((lesson?.review_grading_mode || 'holistic') === 'holistic') {
      return grades.some((g) => g.activity_id === null) ? 'graded' : 'ungraded'
    }
    let gradedCount = 0
    for (const ra of reviewActivities) {
      if (grades.some((g) => g.activity_id === ra.id)) gradedCount++
    }
    if (gradedCount === 0) return 'ungraded'
    if (gradedCount === reviewActivities.length) return 'graded'
    return 'part graded'
  }

  function toggleSelect(id) {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id)
    setSelectedIds(newSet)
  }

  function toggleSelectAll() {
    if (!submissions) return
    if (selectedIds.size === submissions.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(submissions.map(s => s.id)))
  }

  function toggleExpand(id) {
    const newSet = new Set(expandedIds)
    if (newSet.has(id)) newSet.delete(id); else newSet.add(id)
    setExpandedIds(newSet)
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const ok = await confirm({
      title: 'Delete Submissions',
      message: `Delete ${ids.length} submission${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
      confirmText: 'Delete', cancelText: 'Cancel', type: 'danger'
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      await deleteSubmissions(ids)
      setSelectedIds(new Set())
      setExpandedIds(new Set())
      window.location.reload()
    } catch (err) {
      toast.error('Failed to delete: ' + err.message)
    } finally {
      setIsDeleting(false)
    }
  }

  function downloadCSV() {
    if (!submissions.length) return
    const rows = [['Student', 'Institutional ID', 'Status', 'Submitted', 'Score %', 'Max score', 'Q#', 'Question', 'Response', 'Result']]
    for (const s of submissions) {
      const grades = reviewGradesBySub[s.id] || []
      const holisticGrade = grades.find((g) => g.activity_id === null)
      if (s.responses.length === 0) {
        rows.push([s.display_name, s.institutional_id || '', s.status, s.submitted_at || '', s.score ?? '', s.max_auto_score ?? '', '', '', '', ''])
        continue
      }
      for (const r of s.responses) {
        let resultLabel = 'teacher review'
        if (isAutoGraded(r.type)) {
          if (r.maxScore > 0 && r.score === r.maxScore) resultLabel = 'correct'
          else if (r.maxScore > 0 && r.score < r.maxScore) resultLabel = 'incorrect'
          else if (r.auto_correct === true) resultLabel = 'correct'
          else resultLabel = 'incorrect'
        } else {
          const g = grades.find((x) => x.activity_id === r.activity_id)
          if (g) {
            resultLabel = `${g.points_earned}/${g.points_max}`
          } else if (holisticGrade) {
            resultLabel = `holistic ${holisticGrade.points_earned}/${holisticGrade.points_max}`
          }
        }
        rows.push([
          s.display_name,
          s.institutional_id || '',
          s.status,
          s.submitted_at || '',
          s.score ?? '',
          s.max_auto_score ?? '',
          r.position + 1,
          r.prompt,
          r.response_text,
          resultLabel
        ])
      }
    }
    const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${lesson.title.replace(/\s+/g, '-').toLowerCase()}-results.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('CSV exported successfully!')
  }

  async function exportToSheets() {
    setExportStatus('exporting')
    try {
      const { data, error } = await supabase.functions.invoke('export-to-sheets', { body: { lessonId } })
      if (error) throw error
      setExportStatus(data?.spreadsheetUrl ? `done:${data.spreadsheetUrl}` : 'done')
      toast.success('Exported to Google Sheets!')
    } catch (e) {
      setExportStatus(`error:${e.message}`)
      toast.error('Export failed: ' + e.message)
    }
  }

  const isFromAssignment = fromContext === 'assignment' && classIdParam && assignmentIdParam

  if (loading) return <p className="text-muted mx-4">Loading…</p>
  if (error) return <div className="card p-4 border-crest bg-crestSoft text-crest text-sm mx-4">{error}</div>
  if (!lesson) return null

  const completed = submissions.filter((s) => s.status === 'completed')
  const allSelected = submissions.length > 0 && selectedIds.size === submissions.length
  const reviewMode = lesson.review_grading_mode || 'holistic'

  return (
    <div className="space-y-3 pb-24 px-4">
      {isFromAssignment ? (
        <Link
          to={`/classes/${classIdParam}/assignments/${assignmentIdParam}`}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-warm-300 text-warm-800 text-sm font-medium rounded-md hover:bg-warm-100 shadow-sm"
        >
          ← Back to assignment
        </Link>
      ) : (
        <Link to="/" className="btn-ghost text-sm pl-1">← My lessons</Link>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <img src="/sel.png" alt="SEL Logo" className="h-10 w-auto" />
          <div>
            <p className="rail-label mb-0.5">results</p>
            <h1 className="text-xl font-display">{lesson.title}</h1>
            <p className="text-xs text-muted mt-0.5">
              {completed.length} completed · {submissions.length - completed.length} in progress
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button className="btn-secondary text-xs px-3 py-1" onClick={downloadCSV} disabled={!submissions.length}>
            Export CSV
          </button>
          <button className="btn-secondary text-xs px-3 py-1" onClick={exportToSheets} disabled={!submissions.length}>
            Export Sheets
          </button>
        </div>
      </div>

      {reviewActivities.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded px-3 py-2 text-xs text-purple-900">
          <strong>Review grading:</strong>{' '}
          {reviewMode === 'per_activity'
            ? `Per activity — ${reviewActivities.length} item${reviewActivities.length === 1 ? '' : 's'}`
            : lesson.max_review_points != null
              ? `Holistic — out of ${lesson.max_review_points}`
              : 'Holistic — no maximum set yet. Open this lesson in the Lesson Builder to set one.'}
        </div>
      )}

      {exportStatus === 'exporting' && <p className="text-xs text-muted">Exporting…</p>}
      {exportStatus?.startsWith('done') && (
        <div className="card p-2 bg-forestSoft text-forest text-xs">
          Exported.{' '}
          {exportStatus.includes(':') && exportStatus.split(':')[1] && (
            <a className="underline" href={exportStatus.split('done:')[1]} target="_blank" rel="noreferrer">
              Open sheet
            </a>
          )}
        </div>
      )}
      {exportStatus?.startsWith('error') && (
        <div className="card p-2 bg-crestSoft text-crest text-xs">{exportStatus.split('error:')[1]}</div>
      )}

      {submissions.length === 0 && <p className="text-muted text-sm">No student activity yet.</p>}

      {submissions.length > 0 && (
        <div className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1">
          <div className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
            />
            <span className="text-xs text-gray-600">{selectedIds.size} / {submissions.length}</span>
          </div>
          <button
            onClick={handleBulkDelete}
            disabled={selectedIds.size === 0 || isDeleting}
            className="px-2.5 py-0.5 bg-red-600 text-white text-xs rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDeleting ? '...' : `Delete (${selectedIds.size})`}
          </button>
        </div>
      )}

      <div className="space-y-1">
        {submissions.map((s) => {
          const isExpanded = expandedIds.has(s.id)
          const gradingStatus = computeGradingStatus(s)
          const subGrades = reviewGradesBySub[s.id] || []
          const totals = computeSubmissionTotals({
            submission: s,
            lesson,
            reviewActivities,
            grades: subGrades,
          })
          const subReviewActivities = reviewActivities.filter(
            (ra) => s.answers && Object.prototype.hasOwnProperty.call(s.answers, ra.id)
          )
          const showScorePct =
            s.status === 'completed' && totals.overall_pct != null
          return (
            <div key={s.id} className="bg-white border border-gray-200 rounded overflow-hidden shadow-sm">
              <div
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => toggleExpand(s.id)}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(s.id)}
                  onChange={(e) => { e.stopPropagation(); toggleSelect(s.id) }}
                  className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 flex-shrink-0"
                />
                <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs">
                  <span className="font-medium truncate">
                    {s.display_name}
                    {s.institutional_id && (
                      <span className="text-gray-400 font-normal ml-1">
                        ({s.institutional_id})
                      </span>
                    )}
                  </span>
                  <span className="capitalize">{s.status === 'completed' ? '✅' : '⏳'} {s.status}</span>
                  <span className="flex items-center gap-1">
                    {showScorePct ? (
                      <>
                        <span className="font-medium">
                          {Math.round(totals.overall_pct)}%
                        </span>
                        {totals.review_pending > 0 && (
                          <span className="text-[10px] text-amber-700">
                            (pending review)
                          </span>
                        )}
                      </>
                    ) : (
                      '-'
                    )}
                  </span>
                  <span className="text-gray-400 truncate hidden sm:block">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : '—'}
                  </span>
                </div>
                <ReviewBadge status={gradingStatus} />
                <span className="text-gray-400 text-[10px] px-0.5 flex-shrink-0">
                  {isExpanded ? '▲' : '▼'}
                </span>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-100 px-2 py-1 bg-gray-50 space-y-1">
                  {subReviewActivities.length > 0 && s.status === 'completed' && (
                    <SubmissionGradingPanel
                      submission={s}
                      lesson={lesson}
                      reviewActivities={subReviewActivities}
                      initialGrades={subGrades}
                      onSaved={refreshReviewGrades}
                      userId={user?.id}
                    />
                  )}
                  {s.responses.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic">No responses recorded.</p>
                  ) : (
                    s.responses.map((r, index) => {
                      let resultLabel = 'teacher review'
                      let resultClass = 'text-amber-600'
                      if (isAutoGraded(r.type)) {
                        if (r.maxScore > 0 && r.score === r.maxScore) { resultLabel = 'correct'; resultClass = 'text-green-600' }
                        else if (r.maxScore > 0 && r.score < r.maxScore) { resultLabel = 'incorrect'; resultClass = 'text-red-600' }
                        else if (r.auto_correct === true) { resultLabel = 'correct'; resultClass = 'text-green-600' }
                        else { resultLabel = 'incorrect'; resultClass = 'text-red-600' }
                      } else {
                        const g = subGrades.find((x) => x.activity_id === r.activity_id)
                        if (g) {
                          resultLabel = `${g.points_earned}/${g.points_max}`
                          resultClass = 'text-indigo-600 font-medium'
                        }
                      }
                      const questionNum = index + 1
                      return (
                        <div key={r.id} className="text-[11px] bg-white rounded px-1.5 py-0.5 border border-gray-100 flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-500">Q{questionNum}.</span>
                          <span className="font-medium">{r.response_text || <span className="text-gray-400 italic">no response</span>}</span>
                          <span className={`text-[10px] font-mono ${resultClass}`}>{resultLabel}</span>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}