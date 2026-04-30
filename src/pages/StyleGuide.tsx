import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { Select } from '../components/ui/Select'
import { Textarea } from '../components/ui/Textarea'

export default function StyleGuide() {
  const [modalOpen, setModalOpen] = useState(false)
  const palette = useMemo(
    () => [
      { name: 'Background', var: '--ds-color-bg' },
      { name: 'Surface', var: '--ds-color-surface' },
      { name: 'Text', var: '--ds-color-text' },
      { name: 'Muted', var: '--ds-color-text-muted' },
      { name: 'Border', var: '--ds-color-border' },
      { name: 'Primary', var: '--ds-color-primary' },
      { name: 'Danger', var: '--ds-color-danger' },
      { name: 'Info', var: '--ds-color-info' },
    ],
    []
  )

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: -0.2 }}>Design System</div>
          <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13 }}>
            Tokens, components, and patterns used across the application.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Badge>v1</Badge>
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            Open Modal
          </Button>
        </div>
      </div>

      <div className="grid-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {palette.map((p) => (
          <Card key={p.var}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ fontWeight: 800 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--ds-color-text-muted)' }}>{p.var}</div>
              </div>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  border: '1px solid var(--ds-color-border)',
                  background: `var(${p.var})`,
                }}
              />
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ fontWeight: 900, marginBottom: 12 }}>Components</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
          <div>
            <div className="ds-label">Input</div>
            <Input placeholder="Type here" />
          </div>
          <div>
            <div className="ds-label">Select</div>
            <Select defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              <option value="one">Option One</option>
              <option value="two">Option Two</option>
            </Select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div className="ds-label">Textarea</div>
            <Textarea placeholder="Write details…" />
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button>Secondary</Button>
            <Button variant="primary">Primary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
        </div>
      </Card>

      <Modal
        isOpen={modalOpen}
        title="Example Modal"
        onClose={() => setModalOpen(false)}
        actions={
          <>
            <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>
              Confirm
            </Button>
          </>
        }
      >
        <div style={{ color: 'var(--ds-color-text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          This is the baseline modal pattern for dialogs. It supports click-outside close, keyboard focus ring styling via
          :focus-visible, and consistent spacing.
        </div>
      </Modal>
    </div>
  )
}

