// src/pages/LessonResults.jsx
import { useEffect, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useConfirm } from '../context/ConfirmContext'
import { getLesson, getResultsForLesson, deleteSubmissions, listSections } from '../lib/api'
import { supabase } from '../lib/supabaseClient'

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

export default function LessonResults() {
  const { lessonId } = useParams()
  const [searchParams] = useSearchParams()
  const fromContext = searchParams.get('from')
  const classIdParam = searchParams.get('class')
  const assignmentIdParam = searchParams.get('assignment')

  const { confirm } = useConfirm()
  const [lesson, setLesson] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportStatus, setExportStatus] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [expandedIds, setExpandedIds] = useState(new Set())
  let activityMap = {}

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
              config: act.config || {}
            }
          })
        })
        activityMap = map

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
            const actInfo = activityMap[activityId] || {
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
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [lessonId])

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
      if (s.responses.length === 0) {
        rows.push([s.display_name, s.institutional_id || '', s.status, s.submitted_at || '', s.score ?? '', s.max_auto_score ?? '', '', '', '', ''])
        continue
      }
      for (const r of s.responses) {
        let resultLabel = 'teacher review'
        const autoTypes = ['gap_fill', 'multiple_choice', 'gap_fill_dropdown', 'sentence_jumble', 'vocabulary_matching', 'listening', 'dictation']
        if (autoTypes.includes(r.type)) {
          if (r.maxScore > 0 && r.score === r.maxScore) resultLabel = 'correct'
          else if (r.maxScore > 0 && r.score < r.maxScore) resultLabel = 'incorrect'
          else if (r.auto_correct === true) resultLabel = 'correct'
          else resultLabel = 'incorrect'
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

  // Context-aware back link.
  const isFromAssignment = fromContext === 'assignment' && classIdParam && assignmentIdParam

  if (loading) return <p className="text-muted mx-4">Loading…</p>
  if (error) return <div className="card p-4 border-crest bg-crestSoft text-crest text-sm mx-4">{error}</div>
  if (!lesson) return null

  const completed = submissions.filter((s) => s.status === 'completed')
  const allSelected = submissions.length > 0 && selectedIds.size === submissions.length

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
                  <span>{s.status === 'completed' && s.max_auto_score > 0 ? `${s.score}%` : '-'}</span>
                  <span className="text-gray-400 truncate hidden sm:block">
                    {s.submitted_at ? new Date(s.submitted_at).toLocaleDateString() : '—'}
                  </span>
                </div>
                <span className="text-gray-400 text-[10px] px-0.5 flex-shrink-0">
                  {isExpanded ? '▲' : '▼'}
                </span>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-100 px-2 py-1 bg-gray-50 space-y-1">
                  {s.responses.length === 0 ? (
                    <p className="text-[10px] text-gray-400 italic">No responses recorded.</p>
                  ) : (
                    s.responses.map((r, index) => {
                      let resultLabel = 'teacher review'
                      let resultClass = 'text-amber-600'
                      const autoTypes = ['gap_fill', 'multiple_choice', 'gap_fill_dropdown', 'sentence_jumble', 'vocabulary_matching', 'listening', 'dictation']
                      if (autoTypes.includes(r.type)) {
                        if (r.maxScore > 0 && r.score === r.maxScore) { resultLabel = 'correct'; resultClass = 'text-green-600' }
                        else if (r.maxScore > 0 && r.score < r.maxScore) { resultLabel = 'incorrect'; resultClass = 'text-red-600' }
                        else if (r.auto_correct === true) { resultLabel = 'correct'; resultClass = 'text-green-600' }
                        else { resultLabel = 'incorrect'; resultClass = 'text-red-600' }
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