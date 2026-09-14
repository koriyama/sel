// src/pages/LessonBuilder.jsx
console.log('✅ LessonBuilder loaded (folder‑aware navigation with fallback)');

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, Link, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useConfirm } from '../context/ConfirmContext'
import {
  getLesson,
  createLesson,
  updateLesson,
  setLessonStatus,
  listSections,
  saveSections,
  listActivities,
  saveActivities,
  listVocabulary,
  saveVocabulary,
  uploadAudio,
  uploadImage,
  listFolders,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { renderInline } from '../lib/inlineMarkup.jsx'
import AudioPlayer from '../components/AudioPlayer.jsx'
import ReadingText from '../components/ReadingText.jsx'
import GapFillDropdownEditor from '../components/activity-editors/GapFillDropdownEditor.jsx'
import SentenceJumbleEditor from '../components/activity-editors/SentenceJumbleEditor.jsx'
import VocabularyMatchingEditor from '../components/activity-editors/VocabularyMatchingEditor.jsx'
import TextToSpeechGenerator from '../components/TextToSpeechGenerator.jsx'

// ---- Default section intro texts (bilingual) ----
const DEFAULT_SECTION_INTRO = {
  en: 'Read the instructions and complete the activities below.',
  ja: '指示を読んで、以下のアクティビティを完了してください。'
}

// ---- TEMPLATE DEFINITIONS ----
const TEMPLATES = {
  full: {
    label: '📚 Full Lesson',
    description: 'All 9 activity types (vocabulary, gap fill, MC, jumble, listening, dictation, short answer, reasoning)',
    sections: [
      {
        id: `temp-section-${Date.now()}`,
        title: 'Section 1',
        intro_text_en: '',
        intro_text_ja: '',
        activities: [
          { type: 'vocabulary_matching', config: { pairs: [] }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'gap_fill_dropdown', config: { text: '', text_en: '', text_ja: '', dropdownOptions: [] }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'multiple_choice', config: { options_en: ['', '', '', ''], options_ja: ['', '', '', ''], correctIndex: -1 }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'gap_fill', config: { answers: [], text_en: '', text_ja: '' }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'sentence_jumble', config: { words: [] }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'listening', config: { audio_url: '', listening_text: '', questions: [] }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'dictation', config: { audio_url: '', expected_text: '' }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'short_answer', config: { suggestedAnswer: '' }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'reasoning', config: {}, points: 1, prompt_en: '', prompt_ja: '', audio_url: null }
        ]
      }
    ]
  },
  reading_mc_gap: {
    label: '📖 Reading + Comprehension',
    description: 'Multiple Choice + Gap Fill (great for reading lessons)',
    sections: [
      {
        id: `temp-section-${Date.now()}`,
        title: 'Section 1',
        intro_text_en: '',
        intro_text_ja: '',
        activities: [
          { type: 'multiple_choice', config: { options_en: ['', '', '', ''], options_ja: ['', '', '', ''], correctIndex: -1 }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null },
          { type: 'gap_fill', config: { answers: [], text_en: '', text_ja: '' }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null }
        ]
      }
    ]
  },
  quiz: {
    label: '❓ Quick Quiz',
    description: 'Just multiple choice questions (fast to build)',
    sections: [
      {
        id: `temp-section-${Date.now()}`,
        title: 'Section 1',
        intro_text_en: '',
        intro_text_ja: '',
        activities: [
          { type: 'multiple_choice', config: { options_en: ['', '', '', ''], options_ja: ['', '', '', ''], correctIndex: -1 }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null }
        ]
      }
    ]
  },
  listening_dictation: {
    label: '🎧 Listening & Dictation',
    description: 'Listening comprehension + dictation practice',
    sections: [
      {
        id: `temp-section-${Date.now()}`,
        title: 'Section 1',
        intro_text_en: '',
        intro_text_ja: '',
        activities: [
          { 
            type: 'listening', 
            config: { 
              audio_url: '', 
              listening_text: '',
              questions: [ 
                { question_en: '', question_ja: '', type: 'multiple_choice', options: ['', ''], correct_answer: -1 } 
              ] 
            }, 
            points: 1, 
            prompt_en: '', 
            prompt_ja: '', 
            audio_url: null 
          },
          { type: 'dictation', config: { audio_url: '', expected_text: '' }, points: 1, prompt_en: '', prompt_ja: '', audio_url: null }
        ]
      }
    ]
  },
  blank: {
    label: '📝 Start from Scratch',
    description: 'Empty lesson – 0 sections, 0 activities',
    sections: []
  }
}

// ---- Activity Editor Components (compact) ----
function GapFillEditor({ activity, onChange, inputRef }) {
  const config = activity.config || {}
  const updateConfig = (patch) => onChange({ ...activity, config: { ...config, ...patch } })
  const [answerString, setAnswerString] = useState(
    config.answers ? config.answers.join(', ') : ''
  )
  useEffect(() => {
    setAnswerString(config.answers ? config.answers.join(', ') : '')
  }, [config.answers])
  const handleAnswerBlur = () => {
    const arr = answerString.split(',').map(s => s.trim()).filter(Boolean)
    updateConfig({ answers: arr })
  }
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Prompt (English)</label>
        <textarea
          ref={inputRef}
          className="input-field"
          rows={2}
          value={activity.prompt_en || ''}
          onChange={(e) => onChange({ ...activity, prompt_en: e.target.value })}
          placeholder="e.g. Fill in the missing words."
        />
      </div>
      <div>
        <label className="label">Prompt (日本語)</label>
        <textarea
          className="input-field"
          rows={2}
          value={activity.prompt_ja || ''}
          onChange={(e) => onChange({ ...activity, prompt_ja: e.target.value })}
          placeholder="例：欠けている単語を埋めてください。"
        />
      </div>
      <div>
        <label className="label">Text with blanks (English)</label>
        <textarea
          className="input-field"
          rows={3}
          value={config.text_en || ''}
          onChange={(e) => updateConfig({ text_en: e.target.value })}
          placeholder='Use [[curly brackets]], ____, or ___ for blanks, e.g. "The ___ sat on the ___."'
        />
      </div>
      <div>
        <label className="label">Text with blanks (日本語)</label>
        <textarea
          className="input-field"
          rows={3}
          value={config.text_ja || ''}
          onChange={(e) => updateConfig({ text_ja: e.target.value })}
          placeholder='例：「____ は ____ に座った。」'
        />
        <p className="text-xs text-warm-400 mt-1">
          Use <code className="bg-warm-100 px-1 rounded">[[ ]]</code>, <code className="bg-warm-100 px-1 rounded">____</code>, or <code className="bg-warm-100 px-1 rounded">___</code> around the missing word(s).
        </p>
      </div>
      <div>
        <label className="label">Answer key (one per blank, comma separated)</label>
        <input
          className="input-field"
          value={answerString}
          onChange={(e) => setAnswerString(e.target.value)}
          onBlur={handleAnswerBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAnswerBlur()
            }
          }}
          placeholder="great, trivialised|trivialized, New York|New York City"
        />
        <p className="text-xs text-warm-400 mt-1">
          For each blank, you can list multiple acceptable answers separated by a pipe (<code className="bg-warm-100 px-1 rounded">|</code>).
          Spaces around the pipe are ignored. Multi‑word answers are supported.
        </p>
      </div>
    </div>
  )
}

function MultipleChoiceEditor({ activity, onChange, inputRef }) {
  const config = activity.config || {}
  const updateConfig = (patch) => onChange({ ...activity, config: { ...config, ...patch } })
  const options_en = config.options_en || []
  const options_ja = config.options_ja || []
  const correctIndex = config.correctIndex !== undefined ? config.correctIndex : -1
  const addOption = () => {
    const newOptions_en = [...options_en, '']
    const newOptions_ja = [...options_ja, '']
    updateConfig({ options_en: newOptions_en, options_ja: newOptions_ja })
  }
  const removeOption = (index) => {
    if (options_en.length <= 1) return
    const newOptions_en = options_en.filter((_, i) => i !== index)
    const newOptions_ja = options_ja.filter((_, i) => i !== index)
    let newCorrectIndex = correctIndex
    if (correctIndex === index) newCorrectIndex = -1
    else if (correctIndex > index) newCorrectIndex = correctIndex - 1
    updateConfig({ options_en: newOptions_en, options_ja: newOptions_ja, correctIndex: newCorrectIndex })
  }
  const updateOption = (index, field, value) => {
    if (field === 'en') {
      const newOptions = [...options_en]
      newOptions[index] = value
      updateConfig({ options_en: newOptions })
    } else {
      const newOptions = [...options_ja]
      newOptions[index] = value
      updateConfig({ options_ja: newOptions })
    }
  }
  const selectCorrect = (index) => {
    updateConfig({ correctIndex: index })
  }
  const radioName = `correct-option-${activity.id}`
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Prompt (English)</label>
        <textarea
          ref={inputRef}
          className="input-field"
          rows={2}
          value={activity.prompt_en || ''}
          onChange={(e) => onChange({ ...activity, prompt_en: e.target.value })}
          placeholder="e.g. Choose the correct answer."
        />
      </div>
      <div>
        <label className="label">Prompt (日本語)</label>
        <textarea
          className="input-field"
          rows={2}
          value={activity.prompt_ja || ''}
          onChange={(e) => onChange({ ...activity, prompt_ja: e.target.value })}
          placeholder="例：正しい答えを選んでください。"
        />
      </div>
      <div>
        <label className="label">Options (English / 日本語)</label>
        <div className="space-y-1">
          {options_en.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name={radioName}
                checked={correctIndex === i}
                onChange={() => selectCorrect(i)}
                className="w-4 h-4 text-primary-600 focus:ring-primary-500"
              />
              <input
                className="input-field flex-1"
                value={opt}
                onChange={(e) => updateOption(i, 'en', e.target.value)}
                placeholder={`Option ${i + 1} (EN)`}
              />
              <input
                className="input-field flex-1"
                value={options_ja[i] || ''}
                onChange={(e) => updateOption(i, 'ja', e.target.value)}
                placeholder={`選択肢 ${i + 1} (JA)`}
              />
              <button
                type="button"
                className="text-xs text-red-500 hover:text-red-700"
                onClick={() => removeOption(i)}
                disabled={options_en.length <= 1}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={addOption}
          >
            + Add option
          </button>
        </div>
        <p className="text-xs text-warm-400 mt-1">
          Select the correct answer by clicking the circle next to the option.
        </p>
      </div>
    </div>
  )
}

function ShortAnswerEditor({ activity, onChange, inputRef }) {
  const config = activity.config || {}
  const updateConfig = (patch) => onChange({ ...activity, config: { ...config, ...patch } })
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Prompt (English)</label>
        <textarea
          ref={inputRef}
          className="input-field"
          rows={3}
          value={activity.prompt_en || ''}
          onChange={(e) => onChange({ ...activity, prompt_en: e.target.value })}
          placeholder="e.g. Write your answer."
        />
      </div>
      <div>
        <label className="label">Prompt (日本語)</label>
        <textarea
          className="input-field"
          rows={3}
          value={activity.prompt_ja || ''}
          onChange={(e) => onChange({ ...activity, prompt_ja: e.target.value })}
          placeholder="例：あなたの答えを書いてください。"
        />
      </div>
      <div>
        <label className="label">Suggested answer (optional)</label>
        <textarea
          className="input-field"
          rows={2}
          value={config.suggestedAnswer || ''}
          onChange={(e) => updateConfig({ suggestedAnswer: e.target.value })}
          placeholder="Teacher reference (not shown to students)"
        />
      </div>
    </div>
  )
}

function ReasoningEditor({ activity, onChange, inputRef }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Prompt (English)</label>
        <textarea
          ref={inputRef}
          className="input-field"
          rows={3}
          value={activity.prompt_en || ''}
          onChange={(e) => onChange({ ...activity, prompt_en: e.target.value })}
          placeholder="e.g. Explain your reasoning."
        />
      </div>
      <div>
        <label className="label">Prompt (日本語)</label>
        <textarea
          className="input-field"
          rows={3}
          value={activity.prompt_ja || ''}
          onChange={(e) => onChange({ ...activity, prompt_ja: e.target.value })}
          placeholder="例：自分の考えを説明してください。"
        />
      </div>
    </div>
  )
}

// ---- UPDATED ListeningEditor with TTS support ----
function ListeningEditor({ activity, onChange, inputRef }) {
  const config = activity.config || {}
  const updateConfig = (patch) => onChange({ ...activity, config: { ...config, ...patch } })
  const questions = config.questions || []

  // Handle TTS for listening script
  const handleTtsGenerated = (url) => {
    updateConfig({ audio_url: url })
    toast.success('Listening audio generated and attached!')
  }

  const handleTtsDeleted = () => {
    updateConfig({ audio_url: null })
    toast.success('Listening audio removed')
  }

  const addQuestion = () => {
    const newQ = {
      question_en: '',
      question_ja: '',
      type: 'multiple_choice',
      options: ['', ''],
      correct_answer: -1,
    }
    updateConfig({ questions: [...questions, newQ] })
  }

  const removeQuestion = (idx) => {
    const newQuestions = questions.filter((_, i) => i !== idx)
    updateConfig({ questions: newQuestions })
  }

  const updateQuestion = (idx, field, value) => {
    const newQuestions = [...questions]
    newQuestions[idx][field] = value
    updateConfig({ questions: newQuestions })
  }

  const updateOption = (qIdx, optIdx, value) => {
    const newQuestions = [...questions]
    newQuestions[qIdx].options[optIdx] = value
    updateConfig({ questions: newQuestions })
  }

  const addOption = (qIdx) => {
    const newQuestions = [...questions]
    newQuestions[qIdx].options.push('')
    updateConfig({ questions: newQuestions })
  }

  const removeOption = (qIdx, optIdx) => {
    const newQuestions = [...questions]
    newQuestions[qIdx].options.splice(optIdx, 1)
    if (newQuestions[qIdx].correct_answer === optIdx) {
      newQuestions[qIdx].correct_answer = -1
    } else if (newQuestions[qIdx].correct_answer > optIdx) {
      newQuestions[qIdx].correct_answer--
    }
    updateConfig({ questions: newQuestions })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Instructions (English)</label>
        <textarea
          ref={inputRef}
          className="input-field"
          rows={2}
          value={activity.prompt_en || ''}
          onChange={(e) => onChange({ ...activity, prompt_en: e.target.value })}
          placeholder="e.g. Listen to the audio and answer the questions."
        />
      </div>
      <div>
        <label className="label">Instructions (日本語)</label>
        <textarea
          className="input-field"
          rows={2}
          value={activity.prompt_ja || ''}
          onChange={(e) => onChange({ ...activity, prompt_ja: e.target.value })}
          placeholder="例：音声を聞いて質問に答えてください。"
        />
      </div>

      {/* ---- TTS Generator for Listening Script ---- */}
      <div className="border-l-4 border-blue-400 pl-4 bg-blue-50/30 rounded-r-card py-3 pr-4">
        <label className="label flex items-center gap-2">
          🎙️ Listening Script / Text
          <span className="text-xs text-warm-400 font-normal">Paste script to generate audio</span>
        </label>
        <textarea
          className="input-field"
          rows={4}
          value={config.listening_text || ''}
          onChange={(e) => updateConfig({ listening_text: e.target.value })}
          placeholder="Paste the listening script / passage here..."
        />
        <TextToSpeechGenerator
          defaultText={config.listening_text || ''}
          onGenerated={handleTtsGenerated}
          onDeleted={handleTtsDeleted}
          buttonLabel="Generate Listening Audio"
          clearButtonLabel="🗑️ Remove Audio"
          showClearButton={!!config.audio_url}
        />
        {config.audio_url && (
          <div className="mt-3">
            <AudioPlayer src={config.audio_url} />
          </div>
        )}
      </div>

      {/* Audio URL (manual fallback) */}
      <div>
        <label className="label">Audio URL (manual)</label>
        <input
          className="input-field"
          value={config.audio_url || ''}
          onChange={(e) => updateConfig({ audio_url: e.target.value })}
          placeholder="https://example.com/audio.mp3"
        />
        <p className="text-xs text-warm-400 mt-1">Upload audio manually or use the generator above.</p>
      </div>

      {/* Questions */}
      <div>
        <label className="label">Questions</label>
        {questions.map((q, qIdx) => (
          <div key={qIdx} className="border border-warm-200 rounded-card p-3 mt-2 bg-warm-50">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium">Question {qIdx + 1}</span>
              <button
                type="button"
                className="text-red-400 hover:text-red-600"
                onClick={() => removeQuestion(qIdx)}
              >
                ×
              </button>
            </div>
            <div className="space-y-2 mt-2">
              <input
                className="input-field text-sm"
                placeholder="Question (EN)"
                value={q.question_en}
                onChange={(e) => updateQuestion(qIdx, 'question_en', e.target.value)}
              />
              <input
                className="input-field text-sm"
                placeholder="Question (JA)"
                value={q.question_ja}
                onChange={(e) => updateQuestion(qIdx, 'question_ja', e.target.value)}
              />
              <select
                className="input-field text-sm"
                value={q.type}
                onChange={(e) => updateQuestion(qIdx, 'type', e.target.value)}
              >
                <option value="multiple_choice">Multiple Choice</option>
                <option value="true_false">True / False</option>
              </select>
              {q.type === 'multiple_choice' ? (
                <div className="space-y-1">
                  {q.options.map((opt, optIdx) => (
                    <div key={optIdx} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct-${qIdx}`}
                        checked={q.correct_answer === optIdx}
                        onChange={() => updateQuestion(qIdx, 'correct_answer', optIdx)}
                      />
                      <input
                        className="input-field text-sm flex-1"
                        placeholder={`Option ${optIdx + 1}`}
                        value={opt}
                        onChange={(e) => updateOption(qIdx, optIdx, e.target.value)}
                      />
                      {q.options.length > 2 && (
                        <button
                          type="button"
                          className="text-red-400"
                          onClick={() => removeOption(qIdx, optIdx)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-xs text-primary-600 hover:underline"
                    onClick={() => addOption(qIdx)}
                  >
                    + Add option
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      name={`tf-${qIdx}`}
                      checked={q.correct_answer === 0}
                      onChange={() => updateQuestion(qIdx, 'correct_answer', 0)}
                    />
                    True
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="radio"
                      name={`tf-${qIdx}`}
                      checked={q.correct_answer === 1}
                      onChange={() => updateQuestion(qIdx, 'correct_answer', 1)}
                    />
                    False
                  </label>
                </div>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn-secondary text-xs mt-2"
          onClick={addQuestion}
        >
          + Add Question
        </button>
      </div>
    </div>
  )
}

// ---- UPDATED DictationEditor with TTS support ----
function DictationEditor({ activity, onChange, inputRef }) {
  const config = activity.config || {}
  const updateConfig = (patch) => onChange({ ...activity, config: { ...config, ...patch } })

  // Handle TTS generation for dictation
  const handleTtsGenerated = (url) => {
    updateConfig({ audio_url: url })
    toast.success('Audio attached to dictation!')
  }

  const handleTtsDeleted = () => {
    updateConfig({ audio_url: null })
    toast.success('Audio removed from dictation')
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Instructions (English)</label>
        <textarea
          ref={inputRef}
          className="input-field"
          rows={2}
          value={activity.prompt_en || ''}
          onChange={(e) => onChange({ ...activity, prompt_en: e.target.value })}
          placeholder="e.g. Listen and type what you hear."
        />
      </div>
      <div>
        <label className="label">Instructions (日本語)</label>
        <textarea
          className="input-field"
          rows={2}
          value={activity.prompt_ja || ''}
          onChange={(e) => onChange({ ...activity, prompt_ja: e.target.value })}
          placeholder="例：聞いて、聞こえた通りに入力してください。"
        />
      </div>

      {/* Audio section with TTS generator */}
      <div className="border-l-4 border-blue-400 pl-4 bg-blue-50/30 rounded-r-card py-3 pr-4">
        <label className="label flex items-center gap-2">
          🎙️ Dictation Audio
          <span className="text-xs text-warm-400 font-normal">Generate from text or upload file</span>
        </label>

        {/* TTS Generator for dictation text */}
        <TextToSpeechGenerator
          defaultText={config.expected_text || ''}
          onGenerated={handleTtsGenerated}
          onDeleted={handleTtsDeleted}
          buttonLabel="Generate Audio from Text"
          clearButtonLabel="🗑️ Remove Audio"
          showClearButton={!!config.audio_url}
        />

        {/* Manual upload (fallback) */}
        <div className="mt-3">
          <p className="text-xs text-warm-500 mb-1">Or upload a custom audio file:</p>
          <input
            type="file"
            accept="audio/*"
            className="text-sm"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                toast.info('Please use the upload button in the activity toolbar above.')
              }
              e.target.value = ''
            }}
          />
          <p className="text-xs text-warm-400 mt-1">
            For manual upload, use the <strong>"Upload audio"</strong> button in the activity toolbar.
          </p>
        </div>

        {/* Show existing audio player */}
        {config.audio_url && (
          <div className="mt-3">
            <AudioPlayer src={config.audio_url} />
          </div>
        )}
      </div>

      <div>
        <label className="label">Expected text (for grading)</label>
        <textarea
          className="input-field"
          rows={3}
          value={config.expected_text || ''}
          onChange={(e) => updateConfig({ expected_text: e.target.value })}
          placeholder="The quick brown fox jumps over the lazy dog."
        />
        <p className="text-xs text-warm-400 mt-1">
          This text will be used for grading. The TTS generator will speak this text for dictation practice.
        </p>
      </div>
    </div>
  )
}

const EDITORS = {
  gap_fill: GapFillEditor,
  multiple_choice: MultipleChoiceEditor,
  short_answer: ShortAnswerEditor,
  reasoning: ReasoningEditor,
  gap_fill_dropdown: GapFillDropdownEditor,
  sentence_jumble: SentenceJumbleEditor,
  vocabulary_matching: VocabularyMatchingEditor,
  listening: ListeningEditor,
  dictation: DictationEditor,
}

const ACTIVITY_TYPES = [
  { value: 'gap_fill', label: 'Gap Fill' },
  { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'gap_fill_dropdown', label: 'Gap Fill (Dropdown)' },
  { value: 'sentence_jumble', label: 'Sentence Jumble' },
  { value: 'vocabulary_matching', label: 'Vocabulary Matching' },
  { value: 'listening', label: 'Listening' },
  { value: 'dictation', label: 'Dictation' },
]

// ---- Helper functions for import ----
function validateActivityType(type) {
  const validTypes = [
    'gap_fill', 'multiple_choice', 'short_answer', 'reasoning',
    'gap_fill_dropdown', 'sentence_jumble', 'vocabulary_matching',
    'listening', 'dictation'
  ]
  return validTypes.includes(type) ? type : 'gap_fill'
}

function normalizeConfig(type, config) {
  const cfg = (config && typeof config === 'object' && !Array.isArray(config)) ? config : {}
  if (type === 'multiple_choice') {
    if (!cfg.options_en && cfg.options) {
      cfg.options_en = cfg.options
      cfg.options_ja = cfg.options
    }
    if (cfg.correct_index !== undefined && cfg.correctIndex === undefined) {
      cfg.correctIndex = cfg.correct_index
    }
  }
  if ((type === 'gap_fill' || type === 'gap_fill_dropdown') && !cfg.text_en && cfg.text) {
    cfg.text_en = cfg.text
    cfg.text_ja = ''
  }
  return cfg
}

// ---- Coerce a possibly-empty value into a number or null ----
function toNullableNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// ---- Main Builder Component ----
export default function LessonBuilder() {
  console.log('✅ LessonBuilder rendered (folder‑aware navigation with fallback)');
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const isEditing = Boolean(id)
  const { user } = useAuth()
  const { confirm } = useConfirm()

  const initialData = location.state || {}

  const [lesson, setLesson] = useState(initialData.lesson || null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState(null)

  const [sections, setSections] = useState(initialData.sections || [])
  const [activities, setActivities] = useState(initialData.activities || [])
  const [vocabulary, setVocabulary] = useState(initialData.vocabulary || [])

  const [folders, setFolders] = useState([])
  const [selectedFolderId, setSelectedFolderId] = useState(
    initialData.folderId || searchParams.get('folder') || null
  )
  const [folderError, setFolderError] = useState(false)

  const [showTemplateModal, setShowTemplateModal] = useState(!isEditing && !initialData.lesson)

  const [audioFile, setAudioFile] = useState(null)
  const [imageFiles, setImageFiles] = useState([])

  const activitiesContainerRef = useRef(null)
  const inputRefs = useRef({})
  const focusedRef = useRef(new Set())
  const folderSelectRef = useRef(null)

  // ---- Load folders only once ----
  useEffect(() => {
    async function loadFolders() {
      if (!user) return
      try {
        const data = await listFolders(user.id)
        setFolders(data)
        const folderParam = searchParams.get('folder')
        if (folderParam && folderParam !== 'all' && folderParam !== 'uncategorised') {
          const folderExists = data.some(f => f.id === folderParam)
          if (folderExists && !selectedFolderId) {
            setSelectedFolderId(folderParam)
          }
        }
      } catch (err) {
        console.error('Failed to load folders:', err)
      }
    }
    loadFolders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // ---- Load lesson data only when id or initialData changes ----
  useEffect(() => {
    if (initialData.lesson) {
      if (initialData.lesson.folder_id && !selectedFolderId) {
        setSelectedFolderId(initialData.lesson.folder_id)
      }
      return
    }

    if (!id) {
      const folderParam = searchParams.get('folder')
      if (folderParam && folderParam !== 'all' && folderParam !== 'uncategorised') {
        setSelectedFolderId(folderParam)
      }
      setLesson({ 
        title: '', 
        level: 'B1', 
        reading_text: '', 
        description: '',
        audio_url: null, 
        images: [], 
        is_public: false,
        review_grading_mode: 'holistic',
        max_review_points: null
      })
      setShowTemplateModal(true)
      setSections([])
      setActivities([])
      setVocabulary([])
      return
    }

    async function load() {
      try {
        const l = await getLesson(id)
        setLesson(l)
        if (l.folder_id && !selectedFolderId) {
          setSelectedFolderId(l.folder_id)
        }
        const secs = await listSections(id)
        setSections(secs)
        const acts = await listActivities(id)
        setActivities(acts)
        const voc = await listVocabulary(id)
        setVocabulary(voc)
      } catch (err) {
        setError('Failed to load lesson: ' + err.message)
        toast.error('Failed to load lesson: ' + err.message)
      }
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // ---- Focus on new activity ----
  useEffect(() => {
    if (activities.length === 0) return
    const last = activities[activities.length - 1]
    if (last.id && typeof last.id === 'string' && last.id.startsWith('temp-') && !focusedRef.current.has(last.id)) {
      const ref = inputRefs.current[last.id]
      if (ref) {
        ref.focus()
        focusedRef.current.add(last.id)
        const el = ref.closest('.activity-card')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activities])

  // ---- Validate folder ----
  const validateFolder = useCallback(() => {
    if (!selectedFolderId) {
      setFolderError(true)
      if (folderSelectRef.current) {
        folderSelectRef.current.focus()
        folderSelectRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      toast.error('Please select a folder before saving.')
      return false
    }
    setFolderError(false)
    return true
  }, [selectedFolderId])

  // ---- Apply template ----
  const applyTemplate = useCallback((templateKey) => {
    const template = TEMPLATES[templateKey]
    if (!template) return
    const newSections = template.sections.map(s => ({
      ...s,
      id: `temp-section-${Date.now()}-${Math.random()}`,
      activities: s.activities.map(act => ({
        ...act,
        id: `temp-act-${Date.now()}-${Math.random()}`,
        section_id: null
      }))
    }))
    const newActivities = newSections.flatMap(s => s.activities)
    setSections(newSections)
    setActivities(newActivities)
    setVocabulary([])
    setShowTemplateModal(false)
  }, [])

  // ---- Navigate back to the current folder ----
  const goBackToFolder = useCallback(() => {
    const folderToUse = selectedFolderId || lesson?.folder_id
    if (folderToUse) {
      navigate(`/?folder=${folderToUse}`)
    } else {
      navigate('/')
    }
  }, [selectedFolderId, lesson, navigate])

  // ---- Save (draft/publish) ----
  const handleSave = useCallback(async (shouldPublish = false) => {
    if (!validateFolder()) return

    setSaving(true)
    setError(null)
    try {
      let savedLesson
      if (isEditing || initialData.lesson) {
        const lessonId = id || initialData.lesson?.id
        savedLesson = await updateLesson(lessonId, {
          title: lesson.title,
          level: lesson.level,
          reading_text: lesson.reading_text,
          description: lesson.description || null,
          audio_url: lesson.audio_url,
          images: lesson.images || [],
          folder_id: selectedFolderId,
          is_public: lesson.is_public || false,
          review_grading_mode: lesson.review_grading_mode || 'holistic',
          max_review_points: toNullableNumber(lesson.max_review_points)
        })
      } else {
        savedLesson = await createLesson({
          title: lesson.title,
          level: lesson.level,
          reading_text: lesson.reading_text,
          description: lesson.description || null,
          audio_url: lesson.audio_url,
          images: lesson.images || [],
          is_public: lesson.is_public || false,
          review_grading_mode: lesson.review_grading_mode || 'holistic',
          max_review_points: toNullableNumber(lesson.max_review_points)
        }, user.id, selectedFolderId)
      }

      const lessonId = savedLesson.id

      const sectionData = sections.map(({ activities, ...rest }) => rest)
      const savedSections = await saveSections(lessonId, sectionData)

      const sectionIdMap = {}
      sections.forEach((oldSection, index) => {
        const newSection = savedSections[index]
        if (newSection) {
          sectionIdMap[oldSection.id] = newSection.id
        }
      })

      const firstSectionId = savedSections.length > 0 ? savedSections[0].id : null
      const updatedActivities = activities.map(act => {
        if (act.section_id && sectionIdMap[act.section_id]) {
          return { ...act, section_id: sectionIdMap[act.section_id] }
        }
        if (!act.section_id && firstSectionId) {
          return { ...act, section_id: firstSectionId }
        }
        return act
      })

      await saveActivities(lessonId, updatedActivities, false)
      await saveVocabulary(lessonId, vocabulary)

      if (shouldPublish) {
        await setLessonStatus(lessonId, 'published')
      } else if (shouldPublish === false && !isEditing && !initialData.lesson) {
        await setLessonStatus(lessonId, 'draft')
      }

      const folderName = folders.find(f => f.id === selectedFolderId)?.name || 'Uncategorised'
      toast.success(`✅ Lesson saved to "${folderName}"!`)

      const folderToUse = selectedFolderId || savedLesson.folder_id
      if (folderToUse) {
        navigate(`/?folder=${folderToUse}`)
      } else {
        navigate('/')
      }

    } catch (err) {
      setError(err.message)
      toast.error(`❌ Save failed: ${err.message}`)
      console.error('Save error:', err)
    } finally {
      setSaving(false)
      setPublishing(false)
    }
  }, [validateFolder, isEditing, initialData, id, lesson, selectedFolderId, folders, sections, activities, vocabulary, user, navigate])

  const handlePublish = useCallback(async () => {
    if (!validateFolder()) {
      toast.error('Please select a folder before publishing.')
      return
    }
    setPublishing(true)
    await handleSave(true)
  }, [validateFolder, handleSave])

  // ---- Audio/Image uploads ----
  const handleAudioUpload = useCallback(async (file) => {
    if (!file) return
    try {
      const url = await uploadAudio(file)
      setLesson(prev => ({ ...prev, audio_url: url }))
      setAudioFile(null)
      toast.success('Audio uploaded successfully!')
    } catch (err) {
      toast.error('Failed to upload audio: ' + err.message)
    }
  }, [])

  const handleImageUpload = useCallback(async (files) => {
    if (!files || files.length === 0) return
    try {
      const urls = await Promise.all(Array.from(files).map(f => uploadImage(f)))
      setLesson(prev => ({ ...prev, images: [...(prev.images || []), ...urls] }))
      setImageFiles([])
      toast.success('Images uploaded successfully!')
    } catch (err) {
      toast.error('Failed to upload images: ' + err.message)
    }
  }, [])

  // ---- Activity CRUD ----
  const addActivity = useCallback((type) => {
    const defaultSectionId = sections.length > 0 ? sections[0].id : null
    let newActivity = {
      id: `temp-${Date.now()}-${Math.random()}`,
      type,
      prompt_en: '',
      prompt_ja: '',
      config: {},
      points: 1,
      section_id: defaultSectionId,
      audio_url: null
    }
    switch (type) {
      case 'multiple_choice':
        newActivity.config = { options_en: ['', '', ''], options_ja: ['', '', ''], correctIndex: -1 }
        break
      case 'gap_fill_dropdown':
        newActivity.config = { text_en: '', text_ja: '', dropdownOptions: [] }
        break
      case 'sentence_jumble':
        newActivity.config = { words: [] }
        break
      case 'vocabulary_matching':
        newActivity.config = { pairs: [] }
        break
      case 'listening':
        newActivity.config = { audio_url: '', listening_text: '', questions: [] }
        break
      case 'dictation':
        newActivity.config = { audio_url: '', expected_text: '' }
        break
      default:
        newActivity.config = {}
    }
    setActivities(prev => [...prev, newActivity])
  }, [sections])

  const updateActivity = useCallback((index, updated) => {
    setActivities(prev => {
      const newActs = [...prev]
      newActs[index] = updated
      return newActs
    })
  }, [])

  const removeActivity = useCallback((index) => {
    setActivities(prev => prev.filter((_, i) => i !== index))
  }, [])

  const moveActivity = useCallback((index, direction) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= activities.length) return
    setActivities(prev => {
      const newActs = [...prev]
      const [removed] = newActs.splice(index, 1)
      newActs.splice(newIndex, 0, removed)
      return newActs
    })
  }, [activities.length])

  const handleActivityAudioUpload = useCallback(async (activityIndex, file) => {
    if (!file) return
    try {
      const uploadingActivity = { ...activities[activityIndex] }
      uploadingActivity._uploading = true
      updateActivity(activityIndex, uploadingActivity)
      const url = await uploadAudio(file)
      const updated = { ...activities[activityIndex] }
      updated.audio_url = url
      updated.config = { ...updated.config, audio_url: url }
      updated._uploading = false
      updated._fileName = file.name
      updateActivity(activityIndex, updated)
      toast.success('Activity audio uploaded!')
    } catch (err) {
      toast.error('Failed to upload activity audio: ' + err.message)
      const failed = { ...activities[activityIndex] }
      failed._uploading = false
      updateActivity(activityIndex, failed)
    }
  }, [activities, updateActivity])

  // ---- Vocabulary CRUD ----
  const addVocabularyItem = useCallback(() => {
    setVocabulary(prev => [...prev, { id: `temp-${Date.now()}`, term: '', definition: '', example: '' }])
  }, [])

  const updateVocabulary = useCallback((index, field, value) => {
    setVocabulary(prev => {
      const newVoc = [...prev]
      newVoc[index][field] = value
      return newVoc
    })
  }, [])

  const removeVocabulary = useCallback((index) => {
    setVocabulary(prev => prev.filter((_, i) => i !== index))
  }, [])

  // ---- Section CRUD ----
  const addSection = useCallback(() => {
    setSections(prev => [...prev, {
      id: `temp-${Date.now()}-${Math.random()}`,
      title: '',
      intro_text_en: DEFAULT_SECTION_INTRO.en,
      intro_text_ja: DEFAULT_SECTION_INTRO.ja
    }])
  }, [])

  const updateSection = useCallback((index, field, value) => {
    setSections(prev => {
      const newSecs = [...prev]
      newSecs[index][field] = value
      return newSecs
    })
  }, [])

  const removeSection = useCallback((index) => {
    setSections(prev => prev.filter((_, i) => i !== index))
  }, [])

  const moveSection = useCallback((index, direction) => {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= sections.length) return
    setSections(prev => {
      const newSecs = [...prev]
      const [removed] = newSecs.splice(index, 1)
      newSecs.splice(newIndex, 0, removed)
      return newSecs
    })
  }, [sections.length])

  // ---- Export/Import/Preview ----
  const handleExport = useCallback(() => {
    const cleanLesson = {
      title: lesson.title || 'Untitled',
      level: lesson.level || 'B1',
      reading_text: lesson.reading_text || '',
      description: lesson.description || '',
      audio_url: lesson.audio_url || null,
      images: lesson.images || [],
      review_grading_mode: lesson.review_grading_mode || 'holistic',
      max_review_points: toNullableNumber(lesson.max_review_points)
    }

    const cleanSections = sections.map(section => {
      const cleanActivities = activities
        .filter(act => act.section_id === section.id)
        .map(act => ({
          type: act.type,
          config: act.config || {},
          points: act.points ?? 1,
          prompt_en: act.prompt_en || '',
          prompt_ja: act.prompt_ja || '',
          audio_url: act.audio_url || null,
          position: act.position !== undefined ? act.position : null
        }))
      const { lesson_id, position, created_at, updated_at, ...rest } = section
      return {
        id: rest.id,
        title: rest.title || '',
        intro_text_en: rest.intro_text_en || '',
        intro_text_ja: rest.intro_text_ja || '',
        intro_text: rest.intro_text || '',
        activities: cleanActivities
      }
    })

    const cleanVocabulary = vocabulary.map(v => {
      const { id, lesson_id, created_at, updated_at, ...rest } = v
      return {
        term: rest.term || '',
        definition: rest.definition || '',
        example: rest.example || ''
      }
    })

    const data = { version: '1.0', lesson: cleanLesson, sections: cleanSections, vocabulary: cleanVocabulary }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${lesson.title || 'lesson'}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Lesson exported successfully!')
  }, [lesson, sections, activities, vocabulary])

  const fileInputRef = useRef(null)
  const handleImportClick = useCallback(() => fileInputRef.current?.click(), [])
  const handleImportFile = useCallback((e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result)
        if (!data.lesson) throw new Error('Invalid lesson file: missing "lesson"')

        setLesson({
          title: data.lesson.title || 'Untitled',
          level: data.lesson.level || 'B1',
          reading_text: data.lesson.reading_text || '',
          description: data.lesson.description || '',
          audio_url: data.lesson.audio_url || null,
          images: data.lesson.images || [],
          is_public: data.lesson.is_public || false,
          review_grading_mode: data.lesson.review_grading_mode || 'holistic',
          max_review_points: toNullableNumber(data.lesson.max_review_points)
        })

        let importedSections = data.sections || []
        let importedActivities = data.activities || []
        const hasNestedActivities = importedSections.some(s => s.activities && s.activities.length > 0)

        let newSections = []
        let newActivities = []

        if (hasNestedActivities) {
          importedSections.forEach((s, idx) => {
            const tempId = `temp-section-${Date.now()}-${idx}-${Math.random()}`
            newSections.push({
              id: tempId,
              title: s.title || `Section ${idx + 1}`,
              intro_text_en: s.intro_text_en || s.intro_text || '',
              intro_text_ja: s.intro_text_ja || '',
            })

            ;(s.activities || []).forEach((act, actIdx) => {
              const type = validateActivityType(act.type)
              const config = normalizeConfig(type, act.config)
              newActivities.push({
                id: `temp-${Date.now()}-${idx}-${actIdx}-${Math.random()}`,
                type: type,
                prompt_en: act.prompt_en || act.prompt || '',
                prompt_ja: act.prompt_ja || '',
                config: config,
                points: act.points ?? 1,
                section_id: tempId,
                audio_url: act.audio_url || null,
                position: act.position !== undefined ? act.position : actIdx
              })
            })
          })
        } else if (importedActivities.length > 0) {
          if (importedSections.length === 0) {
            throw new Error('Flat import requires at least one section with an "id" field.')
          }

          const missingIdSections = importedSections
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => s.id === undefined || s.id === null)
          if (missingIdSections.length > 0) {
            const indices = missingIdSections.map(({ i }) => i).join(', ')
            throw new Error(`Flat import requires each section to have an "id" field. Missing id in section(s): ${indices}`)
          }

          const sectionIdMap = {}
          importedSections.forEach((s, idx) => {
            const tempId = `temp-section-${Date.now()}-${idx}-${Math.random()}`
            sectionIdMap[s.id] = tempId
            newSections.push({
              id: tempId,
              title: s.title || `Section ${idx + 1}`,
              intro_text_en: s.intro_text_en || s.intro_text || '',
              intro_text_ja: s.intro_text_ja || '',
            })
          })

          const mismatches = []
          importedActivities.forEach((act, idx) => {
            const sid = act.section_id
            if (sid === undefined || sid === null || !(sid in sectionIdMap)) {
              mismatches.push({
                index: idx,
                section_id: sid,
                activity: act
              })
            }
          })

          if (mismatches.length > 0) {
            const details = mismatches
              .map(m => `Activity #${m.index} has section_id "${m.section_id}" (no matching section id)`)
              .join('\n')
            throw new Error(`Flat import validation failed:\n${details}`)
          }

          importedActivities.forEach((act, idx) => {
            const type = validateActivityType(act.type)
            const config = normalizeConfig(type, act.config)
            const tempSectionId = sectionIdMap[act.section_id]
            newActivities.push({
              id: `temp-${Date.now()}-flat-${idx}-${Math.random()}`,
              type: type,
              prompt_en: act.prompt_en || act.prompt || '',
              prompt_ja: act.prompt_ja || '',
              config: config,
              points: act.points ?? 1,
              section_id: tempSectionId,
              audio_url: act.audio_url || null,
              position: act.position !== undefined ? act.position : idx
            })
          })
        } else {
          const defaultId = `temp-section-${Date.now()}-empty-${Math.random()}`
          newSections.push({
            id: defaultId,
            title: 'Activities',
            intro_text_en: '',
            intro_text_ja: ''
          })
        }

        setSections(newSections)
        setActivities(newActivities)

        let newVocabulary = []
        const vocabData = data.vocabulary || []
        if (vocabData.length > 0) {
          const isWordFormat = vocabData[0].word !== undefined
          newVocabulary = vocabData.map((v, i) => ({
            id: `temp-${Date.now()}-${i}-${Math.random()}`,
            term: isWordFormat ? v.word : v.term || '',
            definition: v.definition || '',
            example: v.example || ''
          }))
        }
        setVocabulary(newVocabulary)
        setError(null)
        toast.success('Lesson imported successfully!')
      } catch (err) {
        setError('Failed to import lesson: ' + err.message)
        toast.error('Failed to import: ' + err.message)
        console.error('Import error:', err)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }, [])

  const handlePreview = useCallback(() => {
    if (!lesson?.share_slug) {
      toast.error('Please save the lesson first to generate a preview link.')
      return
    }
    window.open(`/lesson/${lesson.share_slug}?draft=true`, '_blank')
  }, [lesson])

  // ---- Render ----
  if (error) {
    return (
      <div className="min-h-screen p-6 bg-warm-50">
        <div className="card p-6 border-red-200 bg-red-50 text-red-700">
          <p>{error}</p>
          <button className="btn-secondary mt-4" onClick={() => navigate('/')}>
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (!lesson) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm-50">
        <p className="text-warm-500">Loading…</p>
      </div>
    )
  }

  const isPublished = lesson.status === 'published'
  const activityCount = activities.length
  const reviewMode = lesson.review_grading_mode || 'holistic'

  // ---- Main JSX ----
  return (
    <div className="min-h-screen bg-warm-50">
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-card max-w-3xl w-full p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-display mb-2">Choose a Lesson Template</h2>
            <p className="text-warm-500 text-sm mb-6">
              Pick a starting structure for your new lesson. You can add, remove, or rearrange activities and sections later.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(TEMPLATES).map(([key, template]) => (
                <button
                  key={key}
                  className="text-left border border-warm-200 rounded-card p-4 hover:border-primary-400 hover:bg-primary-50 transition-all duration-200"
                  onClick={() => applyTemplate(key)}
                >
                  <div className="text-xl font-semibold">{template.label}</div>
                  <div className="text-sm text-warm-600 mt-1">{template.description}</div>
                  <div className="text-xs text-warm-400 mt-2">
                    {template.sections.length} section{template.sections.length !== 1 ? 's' : ''} ·{' '}
                    {template.sections.reduce((acc, s) => acc + (s.activities ? s.activities.length : 0), 0)} activities
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                className="text-sm text-warm-500 hover:text-warm-700"
                onClick={() => navigate('/')}
              >
                Cancel (go back)
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="sticky-header sticky top-0 z-10">
        <div className="container-wide py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                onClick={goBackToFolder}
                className="text-warm-500 hover:text-warm-700"
              >
                ← Back to {selectedFolderId ? 'Folder' : 'Dashboard'}
              </button>
              <img src="/sel.png" alt="SEL Logo" className="h-10 w-auto" />
              <h1 className="text-xl font-display">
                {isEditing || initialData.lesson ? 'Edit Lesson' : 'New Lesson'}
              </h1>
              {(isEditing || initialData.lesson) && (
                <>
                  <span className={`text-xs px-2 py-1 rounded-full ${isPublished ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {isPublished ? 'Published' : 'Draft'}
                  </span>
                  <span className={`level-badge level-badge-${(lesson.level || 'B1').toUpperCase()}`}>
                    {lesson.level || 'B1'}
                  </span>
                  <select
                    value={lesson.is_public ? 'public' : 'private'}
                    onChange={(e) => setLesson({ ...lesson, is_public: e.target.value === 'public' })}
                    className="text-xs px-2 py-1 rounded-full border border-warm-200 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400/20"
                  >
                    <option value="private">🔒 Private</option>
                    <option value="public">🌍 Public</option>
                  </select>
                </>
              )}
              <span className="text-xs bg-warm-100 px-2 py-1 rounded-full">{activityCount} activities</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-secondary text-sm" onClick={handleExport}>📤 Export</button>
              <button className="btn-secondary text-sm" onClick={handleImportClick}>📥 Import</button>
              <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />
              <button
                className={`text-sm px-4 py-2 rounded transition ${lesson.share_slug ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' : 'bg-warm-100 text-warm-400 cursor-not-allowed'}`}
                onClick={handlePreview}
                disabled={!lesson.share_slug}
              >
                👁️ Preview
              </button>
              <button className="btn-secondary text-sm" onClick={() => handleSave(false)} disabled={saving}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              {!isPublished ? (
                <button className="btn-primary text-sm" onClick={handlePublish} disabled={publishing}>
                  {publishing ? 'Publishing…' : 'Publish'}
                </button>
              ) : (
                <button
                  className="btn-secondary text-sm"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Unpublish Lesson',
                      message: 'Unpublish this lesson? It will no longer be accessible to students.',
                      confirmText: 'Unpublish',
                      cancelText: 'Cancel',
                      type: 'danger'
                    })
                    if (ok) handleSave(false)
                  }}
                >
                  Unpublish
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container-wide py-8 space-y-8">
        {/* Lesson Metadata */}
        <section className="card p-6 space-y-4">
          <h2 className="text-lg font-display">Lesson Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Title</label>
              <input
                className="input-field"
                value={lesson.title || ''}
                onChange={(e) => setLesson({ ...lesson, title: e.target.value })}
                placeholder="e.g. The Great Gatsby"
              />
            </div>
            <div>
              <label className="label">Level</label>
              <select
                className="input-field"
                value={lesson.level || 'B1'}
                onChange={(e) => setLesson({ ...lesson, level: e.target.value })}
              >
                <option value="A1">A1 (Beginner)</option>
                <option value="A2">A2 (Elementary)</option>
                <option value="B1">B1 (Intermediate)</option>
                <option value="B2">B2 (Upper Intermediate)</option>
                <option value="C1">C1 (Advanced)</option>
                <option value="C2">C2 (Proficiency)</option>
              </select>
            </div>
            <div>
              <label className="label">
                Folder <span className="text-red-500">*</span>
              </label>
              <select
                ref={folderSelectRef}
                className={`input-field ${folderError ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                value={selectedFolderId || ''}
                onChange={(e) => {
                  setSelectedFolderId(e.target.value || null)
                  setFolderError(false)
                }}
              >
                <option value="">Select a folder...</option>
                {folders.map(f => (
                  <option key={f.id} value={f.id}>📁 {f.name}</option>
                ))}
              </select>
              {folderError && (
                <p className="text-xs text-red-500 mt-1">Please select a folder before saving.</p>
              )}
            </div>
          </div>

          <div>
            <label className="label">Reading Text</label>
            <textarea
              className="input-field"
              rows={6}
              value={lesson.reading_text || ''}
              onChange={(e) => setLesson({ ...lesson, reading_text: e.target.value })}
              placeholder="Paste the main reading text here."
            />
          </div>

          {/* ---- TTS Generator for Reading Text (no duplicate player) ---- */}
          <div className="border-l-4 border-blue-400 pl-4 bg-blue-50/30 rounded-r-card py-3 pr-4">
            <label className="label flex items-center gap-2">
              🎙️ Text‑to‑Speech for Reading Text
              <span className="text-xs text-warm-400 font-normal">Generate and attach audio</span>
            </label>
            <TextToSpeechGenerator
              defaultText={lesson.reading_text || ''}
              onGenerated={(url) => {
                setLesson({ ...lesson, audio_url: url })
                toast.success('Audio attached to lesson!')
              }}
              buttonLabel="Generate Audio for Reading Text"
            />
          </div>

          {/* ----- DESCRIPTION FIELD ----- */}
          <div className="border-l-4 border-primary-400 pl-4 bg-primary-50/30 rounded-r-card py-3 pr-4">
            <label className="label flex items-center gap-2">
              Description (for shared lessons)
              <span className="text-xs text-warm-400 font-normal">optional</span>
            </label>
            <textarea
              className="input-field"
              rows={3}
              value={lesson.description || ''}
              onChange={(e) => setLesson({ ...lesson, description: e.target.value })}
              placeholder="Optional: Write a short description for the Shared Lessons library. This helps other teachers understand what the lesson covers."
            />
            <p className="text-xs text-warm-400 mt-1">
              This description appears in the Shared Lessons repository. Leave blank if not needed.
            </p>
          </div>

          {/* ----- REVIEW GRADING PANEL ----- */}
          <div className="border-l-4 border-purple-400 pl-4 bg-purple-50/30 rounded-r-card py-3 pr-4">
            <label className="label flex items-center gap-2">
              📝 Review grading
              <span className="text-xs text-warm-400 font-normal">for teacher-marked activities</span>
            </label>
            <p className="text-xs text-warm-500 mb-3">
              Short answer and reasoning activities are marked by you, not auto-graded. Choose how you want to mark them.
            </p>

            <div className="space-y-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="review_grading_mode"
                  value="holistic"
                  checked={reviewMode === 'holistic'}
                  onChange={() => setLesson({ ...lesson, review_grading_mode: 'holistic' })}
                  className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500"
                />
                <div>
                  <div className="text-sm font-medium">Holistic — one mark for the whole submission</div>
                  <div className="text-xs text-warm-500">
                    Best for Response Cards or any task where the student's work is one piece.
                  </div>
                </div>
              </label>

              {reviewMode === 'holistic' && (
                <div className="ml-6">
                  <label className="text-xs font-medium text-warm-600">Maximum points</label>
                  <input
                    type="number"
                    className="input-field text-sm mt-1 w-32"
                    min={0}
                    step="0.5"
                    value={lesson.max_review_points ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setLesson({
                        ...lesson,
                        max_review_points: v === '' ? null : Number(v)
                      })
                    }}
                    placeholder="e.g. 5"
                  />
                  <p className="text-xs text-warm-400 mt-1">
                    The whole submission is marked out of this number. Students see their mark out of the same number.
                  </p>
                </div>
              )}

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="review_grading_mode"
                  value="per_activity"
                  checked={reviewMode === 'per_activity'}
                  onChange={() => setLesson({ ...lesson, review_grading_mode: 'per_activity' })}
                  className="mt-1 w-4 h-4 text-primary-600 focus:ring-primary-500"
                />
                <div>
                  <div className="text-sm font-medium">Per activity — one mark per review activity</div>
                  <div className="text-xs text-warm-500">
                    Each review activity is marked out of its own Points value (set on the activity below).
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div>
            <label className="label">Audio (manual upload)</label>
            <div className="flex items-center gap-4 flex-wrap">
              {lesson.audio_url && (
                <div className="flex-1 min-w-[200px]">
                  <AudioPlayer src={lesson.audio_url} />
                </div>
              )}
              <input
                type="file"
                accept="audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleAudioUpload(file)
                  e.target.value = ''
                }}
                className="text-sm"
              />
            </div>
            <p className="text-xs text-warm-400 mt-1">Upload an audio file manually, or use the TTS generator above.</p>
          </div>

          <div>
            <label className="label">Images</label>
            <div className="flex flex-wrap gap-3 mb-2">
              {(lesson.images || []).map((url, i) => (
                <div key={i} className="relative">
                  <img src={url} alt="" className="max-h-32 rounded-card border border-warm-200" />
                  <button
                    type="button"
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center"
                    onClick={() => {
                      const newImages = [...(lesson.images || [])]
                      newImages.splice(i, 1)
                      setLesson({ ...lesson, images: newImages })
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                const files = e.target.files
                if (files && files.length) handleImageUpload(files)
                e.target.value = ''
              }}
              className="text-sm"
            />
          </div>

          <div>
            <label className="label">Share with other teachers</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={lesson.is_public || false}
                onChange={(e) => setLesson({ ...lesson, is_public: e.target.checked })}
                className="w-4 h-4 text-primary-600 rounded border-warm-300 focus:ring-primary-500"
              />
              <span className="text-sm text-warm-600">
                Make this lesson public (visible to other teachers)
              </span>
            </div>
            <p className="text-xs text-warm-400 mt-1">
              Public lessons appear in the Shared Lessons library for other teachers to copy and use.
            </p>
          </div>
        </section>

        {/* Sections */}
        <section className="card p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-display">Sections (Pages)</h2>
            <button className="btn-secondary text-sm" onClick={addSection}>+ Add Section</button>
          </div>
          <p className="text-xs text-warm-500">
            Sections group activities into pages. Students see one section at a time.
          </p>
          <div className="space-y-3">
            {sections.map((sec, idx) => (
              <div key={sec.id || idx} className="card p-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-warm-600">Title</label>
                      <input
                        className="input-field text-sm"
                        value={sec.title || ''}
                        onChange={(e) => updateSection(idx, 'title', e.target.value)}
                        placeholder="e.g. Comprehension Questions"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-warm-600">Intro Text (English)</label>
                      <input
                        className="input-field text-sm"
                        value={sec.intro_text_en || ''}
                        onChange={(e) => updateSection(idx, 'intro_text_en', e.target.value)}
                        placeholder="Instructions in English"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-warm-600">Intro Text (日本語)</label>
                      <input
                        className="input-field text-sm"
                        value={sec.intro_text_ja || ''}
                        onChange={(e) => updateSection(idx, 'intro_text_ja', e.target.value)}
                        placeholder="日本語の指示"
                      />
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {idx > 0 && <button type="button" className="text-warm-400 hover:text-warm-600 px-1" onClick={() => moveSection(idx, -1)} title="Move up">↑</button>}
                    {idx < sections.length - 1 && <button type="button" className="text-warm-400 hover:text-warm-600 px-1" onClick={() => moveSection(idx, 1)} title="Move down">↓</button>}
                    <button type="button" className="text-red-400 hover:text-red-600 px-1" onClick={() => removeSection(idx)} title="Remove section">×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Activities */}
        <section className="card p-6 space-y-4" ref={activitiesContainerRef}>
          <div className="sticky top-16 z-10 bg-white -mx-6 px-6 py-3 border-b border-warm-200 shadow-sm flex flex-wrap justify-between items-center gap-2">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-display">Activities ({activityCount})</h2>
            </div>
            <div className="flex gap-2 flex-wrap">
              {ACTIVITY_TYPES.map((type) => (
                <button key={type.value} className="btn-secondary text-xs" onClick={() => addActivity(type.value)}>
                  + {type.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-warm-500 mt-2">
            Drag activities to reorder. Assign a section to group them into pages.
          </p>
          {activityCount === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-2 rounded text-sm">
              ⚠️ No activities yet. Add some using the buttons above.
            </div>
          )}
          <div className="space-y-4">
            {activities.map((act, idx) => {
              const Editor = EDITORS[act.type]
              const setInputRef = (el) => {
                if (el) inputRefs.current[act.id] = el
                else delete inputRefs.current[act.id]
              }
              const showActivityAudio = act.type === 'listening' || act.type === 'dictation'
              const hasAudio = act.audio_url || act.config?.audio_url

              return (
                <div key={act.id || idx} className="activity-card p-4">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs font-medium bg-warm-100 px-2 py-1 rounded">
                          {ACTIVITY_TYPES.find(t => t.value === act.type)?.label || act.type}
                        </span>
                        <select
                          className="text-xs border border-warm-200 rounded-full px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-primary-400/20"
                          value={act.section_id || ''}
                          onChange={(e) => {
                            const val = e.target.value
                            updateActivity(idx, { ...act, section_id: val || null })
                          }}
                        >
                          <option value="">No section</option>
                          {sections.map((sec, i) => (
                            <option key={sec.id || i} value={sec.id || `temp-${i}`}>
                              {sec.title || `Section ${i + 1}`}
                            </option>
                          ))}
                        </select>
                        <label className="text-xs text-warm-500 flex items-center gap-1">
                          Points:
                          <input
                            type="number"
                            className="w-12 border border-warm-200 rounded-full px-1 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary-400/20"
                            value={act.points ?? 1}
                            onChange={(e) => updateActivity(idx, { ...act, points: parseInt(e.target.value) || 1 })}
                            min={1}
                          />
                        </label>
                        {showActivityAudio && (
                          <div className="flex items-center gap-2">
                            <input
                              type="file"
                              accept="audio/*"
                              className="text-xs"
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleActivityAudioUpload(idx, file)
                                e.target.value = ''
                              }}
                              key={act.id}
                            />
                            {act._uploading ? (
                              <span className="text-xs text-blue-500">⏳ Uploading...</span>
                            ) : hasAudio ? (
                              <span className="text-xs text-green-600">
                                🔊 {act._fileName || 'Audio uploaded'}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                      <Editor
                        activity={act}
                        onChange={(updated) => updateActivity(idx, updated)}
                        inputRef={setInputRef}
                      />
                      {showActivityAudio && hasAudio && (
                        <div className="mt-2">
                          <AudioPlayer src={act.audio_url || act.config?.audio_url} />
                        </div>
                      )}
                      {/* ---- TTS Generator for Activity Prompt ---- */}
                      <div className="mt-3 border-t border-warm-200 pt-3">
                        <details className="text-sm">
                          <summary className="cursor-pointer text-primary-600 hover:underline">
                            🎙️ Generate audio from prompt
                          </summary>
                          <div className="mt-2">
                            <TextToSpeechGenerator
                              defaultText={act.prompt_en || act.prompt_ja || ''}
                              onGenerated={(url) => {
                                const updated = { ...act, audio_url: url }
                                if (act.config) {
                                  updated.config = { ...act.config, audio_url: url }
                                }
                                updateActivity(idx, updated)
                                toast.success('Audio attached to activity!')
                              }}
                              buttonLabel="Generate & Attach to Activity"
                            />
                          </div>
                        </details>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {idx > 0 && <button type="button" className="text-warm-400 hover:text-warm-600 px-1" onClick={() => moveActivity(idx, -1)} title="Move up">↑</button>}
                      {idx < activities.length - 1 && <button type="button" className="text-warm-400 hover:text-warm-600 px-1" onClick={() => moveActivity(idx, 1)} title="Move down">↓</button>}
                      <button type="button" className="text-red-400 hover:text-red-600 px-1" onClick={() => removeActivity(idx)} title="Remove activity">×</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Vocabulary */}
        <section className="card p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-display">Vocabulary Support</h2>
            <button className="btn-secondary text-sm" onClick={addVocabularyItem}>+ Add Word</button>
          </div>
          <div className="space-y-2">
            {vocabulary.map((v, idx) => (
              <div key={v.id || idx} className="flex flex-wrap items-center gap-2 card p-3">
                <input className="input-field flex-1 min-w-[100px] text-sm" placeholder="Term" value={v.term || ''} onChange={(e) => updateVocabulary(idx, 'term', e.target.value)} />
                <input className="input-field flex-1 min-w-[150px] text-sm" placeholder="Definition" value={v.definition || ''} onChange={(e) => updateVocabulary(idx, 'definition', e.target.value)} />
                <input className="input-field flex-1 min-w-[150px] text-sm" placeholder="Example (optional)" value={v.example || ''} onChange={(e) => updateVocabulary(idx, 'example', e.target.value)} />
                <button type="button" className="text-red-400 hover:text-red-600 px-2" onClick={() => removeVocabulary(idx)} title="Remove">×</button>
              </div>
            ))}
          </div>
        </section>

        {/* Bottom Navigation */}
        <div className="flex justify-between items-center border-t border-warm-200 pt-6">
          <button onClick={goBackToFolder} className="text-sm text-warm-500 hover:text-warm-700">
            ← Back to {selectedFolderId ? 'Folder' : 'Dashboard'}
          </button>
          <div className="flex gap-3">
            <button className="btn-secondary" onClick={() => handleSave(false)} disabled={saving}>
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
            {!isPublished ? (
              <button className="btn-primary" onClick={handlePublish} disabled={publishing}>
                {publishing ? 'Publishing…' : 'Publish'}
              </button>
            ) : (
              <button
                className="btn-secondary"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Unpublish Lesson',
                    message: 'Unpublish this lesson? It will no longer be accessible to students.',
                    confirmText: 'Unpublish',
                    cancelText: 'Cancel',
                    type: 'danger'
                  })
                  if (ok) handleSave(false)
                }}
              >
                Unpublish
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}