import { useEffect, useState } from 'react'
import './App.css'
import ButtonEvents from './ButtonEvents'
import AlarmEvents from './AlarmEvents'

function App() {
  const [sleepPositionAlarmEnabled, setSleepPositionAlarmEnabled] = useState<boolean | null>(null)
  const [toleranceMinutes, setToleranceMinutes] = useState<number | null>(null)
  const [toleranceInput, setToleranceInput] = useState<string>('')

  useEffect(() => {
    fetch('/api/v1/sleep-position-alarm')
      .then((res) => res.json())
      .then((data) => {
        setSleepPositionAlarmEnabled(data.enabled)
        setToleranceMinutes(data.toleranceMinutes)
        setToleranceInput(String(data.toleranceMinutes))
      })
      .catch(() => setSleepPositionAlarmEnabled(null))
  }, [])

  function toggleSleepPositionAlarm() {
    if (sleepPositionAlarmEnabled === null) return
    const next = !sleepPositionAlarmEnabled
    fetch('/api/v1/sleep-position-alarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
      .then((res) => res.json())
      .then((data) => {
        setSleepPositionAlarmEnabled(data.enabled)
        setToleranceMinutes(data.toleranceMinutes)
      })
      .catch(() => {})
  }

  function submitToleranceMinutes() {
    const parsed = Number(toleranceInput)
    if (!Number.isFinite(parsed) || parsed <= 0) return
    fetch('/api/v1/sleep-position-alarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toleranceMinutes: parsed }),
    })
      .then((res) => res.json())
      .then((data) => {
        setToleranceMinutes(data.toleranceMinutes)
        setToleranceInput(String(data.toleranceMinutes))
      })
      .catch(() => {})
  }

  return (
    <div className="app-container">
      <h1>off-alarm</h1>
      <div className="sleep-position-alarm-toggle">
        <span className="sleep-position-alarm-label">
          Sleep position alarm
        </span>
        <button
          className={`alarm-toggle-button ${sleepPositionAlarmEnabled ? 'alarm-toggle-button--on' : 'alarm-toggle-button--off'}`}
          onClick={toggleSleepPositionAlarm}
          disabled={sleepPositionAlarmEnabled === null}
          title="Toggle whether the server sends alarm tone events for bad sleeping position"
        >
          {sleepPositionAlarmEnabled === null ? '…' : sleepPositionAlarmEnabled ? 'ON' : 'OFF'}
        </button>
        <span className="sleep-position-alarm-label tolerance-label">
          Tolerance
        </span>
        <div className="tolerance-input-group">
          <input
            className="tolerance-input"
            type="number"
            min={1}
            step={1}
            value={toleranceInput}
            disabled={toleranceMinutes === null}
            onChange={(e) => setToleranceInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitToleranceMinutes() }}
            title="Minutes of consistent bad sleep position before the alarm plays"
          />
          <span className="tolerance-unit">min</span>
          <button
            className="tolerance-set-button"
            disabled={toleranceMinutes === null}
            onClick={submitToleranceMinutes}
          >
            Set
          </button>
        </div>
      </div>
      <div className="events-tables-container">
        <div className="events-table-section">
          <h2>Button events</h2>
          <ButtonEvents />
        </div>
        <div className="events-table-section">
          <h2>Alarm events</h2>
          <AlarmEvents />
        </div>
      </div>
    </div>
  )
}

export default App
