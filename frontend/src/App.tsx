import { useEffect, useState } from 'react'
import './App.css'
import ButtonEvents from './ButtonEvents'
import AlarmEvents from './AlarmEvents'

function App() {
  const [sleepPositionAlarmEnabled, setSleepPositionAlarmEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/v1/sleep-position-alarm')
      .then((res) => res.json())
      .then((data) => setSleepPositionAlarmEnabled(data.enabled))
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
      .then((data) => setSleepPositionAlarmEnabled(data.enabled))
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
