import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Textarea'

type ResponseItem = {
  id: string
  createdAt: string
  participantRole: string
  tasks: Record<string, boolean>
  satisfaction: 'very_satisfied' | 'satisfied' | 'neutral' | 'dissatisfied' | 'very_dissatisfied' | ''
  notes: string
}

const STORAGE_KEY = 'usabilityTestResponses:v1'

export default function UsabilityTest() {
  const tasks = useMemo(
    () => [
      { id: 't1', label: 'Login and navigate to a dashboard' },
      { id: 't2', label: 'Open Satellite Intelligence and explore layers' },
      { id: 't3', label: 'Create a relationship and preview the generated form' },
      { id: 't4', label: 'Edit a record in the generated form and save' },
      { id: 't5', label: 'Navigate to Data Entry and submit a record' },
    ],
    []
  )

  const [participantRole, setParticipantRole] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [satisfaction, setSatisfaction] = useState<ResponseItem['satisfaction']>('')
  const [notes, setNotes] = useState('')
  const [responses, setResponses] = useState<ResponseItem[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? (JSON.parse(raw) as ResponseItem[]) : []
      setResponses(Array.isArray(parsed) ? parsed : [])
    } catch {
      setResponses([])
    }
  }, [])

  const satisfactionPct = useMemo(() => {
    if (!responses.length) return 0
    const ok = responses.filter((r) => r.satisfaction === 'very_satisfied' || r.satisfaction === 'satisfied').length
    return Math.round((ok / responses.length) * 100)
  }, [responses])

  const completionPct = useMemo(() => {
    const total = tasks.length
    if (!total) return 0
    const done = tasks.filter((t) => checked[t.id]).length
    return Math.round((done / total) * 100)
  }, [checked, tasks])

  const submit = () => {
    if (!participantRole.trim()) {
      window.alert('Participant role is required.')
      return
    }
    if (!satisfaction) {
      window.alert('Satisfaction rating is required.')
      return
    }
    const item: ResponseItem = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString(),
      participantRole: participantRole.trim(),
      tasks: tasks.reduce((acc, t) => ({ ...acc, [t.id]: Boolean(checked[t.id]) }), {}),
      satisfaction,
      notes: notes.trim(),
    }
    const next = [item, ...responses]
    setResponses(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setParticipantRole('')
    setChecked({})
    setSatisfaction('')
    setNotes('')
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(responses, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `usability_test_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const clearAll = () => {
    if (!window.confirm('Clear all stored test responses?')) return
    localStorage.removeItem(STORAGE_KEY)
    setResponses([])
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.2 }}>Usability Test</div>
          <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>
            Collect responses from 10+ users and track satisfaction (target ≥ 90%).
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Badge>Responses: {responses.length}</Badge>
          <Badge>Satisfaction: {responses.length ? `${satisfactionPct}%` : '—'}</Badge>
          <Button variant="ghost" onClick={() => exportJson()} disabled={!responses.length}>
            Export JSON
          </Button>
          <Button variant="danger" onClick={() => clearAll()} disabled={!responses.length}>
            Clear
          </Button>
        </div>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <div>
            <div className="ds-label">Participant role</div>
            <Input placeholder="e.g., GIS user, Admin, Data-entry" value={participantRole} onChange={(e) => setParticipantRole(e.target.value)} />
          </div>
          <div>
            <div className="ds-label">Task completion</div>
            <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ds-color-text-muted)' }}>
              {completionPct}% complete
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="ds-label">Tasks</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {tasks.map((t) => (
                <label
                  key={t.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    padding: 10,
                    borderRadius: 12,
                    border: '1px solid var(--ds-color-border)',
                    background: 'var(--ds-color-surface)',
                  }}
                >
                  <input type="checkbox" checked={Boolean(checked[t.id])} onChange={(e) => setChecked((p) => ({ ...p, [t.id]: e.target.checked }))} />
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="ds-label">Satisfaction</div>
            <select className="ds-input" value={satisfaction} onChange={(e) => setSatisfaction(e.target.value as any)}>
              <option value="" disabled>
                Select…
              </option>
              <option value="very_satisfied">Very satisfied</option>
              <option value="satisfied">Satisfied</option>
              <option value="neutral">Neutral</option>
              <option value="dissatisfied">Dissatisfied</option>
              <option value="very_dissatisfied">Very dissatisfied</option>
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <div className="ds-label">Notes</div>
            <Textarea placeholder="What was confusing? What was easiest? Suggested changes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button variant="primary" onClick={() => submit()}>
              Save Response
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Recent Responses</div>
        {responses.length === 0 ? (
          <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>No responses recorded yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {responses.slice(0, 10).map((r) => (
              <div
                key={r.id}
                style={{
                  border: '1px solid var(--ds-color-border)',
                  borderRadius: 12,
                  padding: 12,
                  background: 'var(--ds-color-surface)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ fontWeight: 900 }}>{r.participantRole}</div>
                  <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</div>
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Badge>{r.satisfaction.split('_').join(' ')}</Badge>
                  <Badge>
                    Tasks:{' '}
                    {tasks.filter((t) => r.tasks[t.id]).length}/{tasks.length}
                  </Badge>
                </div>
                {r.notes ? (
                  <div style={{ marginTop: 8, color: 'var(--ds-color-text-muted)', fontSize: 13, lineHeight: 1.5 }}>{r.notes}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
