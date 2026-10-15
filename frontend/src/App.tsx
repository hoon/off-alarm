import { useEffect, useState } from 'react'
import ButtonEvents from './ButtonEvents'
import AlarmEvents from './AlarmEvents'

function App() {
  const [sleepPositionAlarmEnabled, setSleepPositionAlarmEnabled] = useState<
    boolean | null
  >(null)
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
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        off-alarm
      </h1>
      <section
        aria-label="Alarm settings"
        className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6"
      >
        <div className="flex items-center gap-3">
          <span id="sleep-position-alarm-label" className="text-sm font-medium">
            Sleep position alarm
          </span>
          <button
            className={`min-w-16 cursor-pointer rounded-lg border px-4 py-2 text-sm font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-default disabled:opacity-50 ${sleepPositionAlarmEnabled ? 'border-indigo-600 bg-indigo-600 text-white enabled:hover:border-indigo-500 enabled:hover:bg-indigo-500' : 'border-slate-300 bg-slate-100 text-slate-600 enabled:hover:border-indigo-500 enabled:hover:text-indigo-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:enabled:hover:text-indigo-400'}`}
            aria-labelledby="sleep-position-alarm-label"
            aria-pressed={sleepPositionAlarmEnabled === true}
            onClick={toggleSleepPositionAlarm}
            disabled={sleepPositionAlarmEnabled === null}
            title="Toggle whether the server sends alarm tone events for bad sleeping position"
          >
            {sleepPositionAlarmEnabled === null
              ? '…'
              : sleepPositionAlarmEnabled
                ? 'ON'
                : 'OFF'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="tolerance-minutes" className="text-sm font-medium">
            Tolerance
          </label>
          <div className="flex items-center gap-2">
            <input
              id="tolerance-minutes"
              className="w-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"
              type="number"
              min={1}
              step={1}
              value={toleranceInput}
              disabled={toleranceMinutes === null}
              onChange={(e) => setToleranceInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitToleranceMinutes()
              }}
              title="Minutes of consistent bad sleep position before the alarm plays"
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">
              min
            </span>
            <button
              className="cursor-pointer rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors enabled:hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-default disabled:opacity-50"
              disabled={toleranceMinutes === null}
              onClick={submitToleranceMinutes}
            >
              Set
            </button>
          </div>
        </div>
      </section>
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="button-events-heading"
          className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <h2
            id="button-events-heading"
            className="border-b border-slate-200 px-5 py-4 text-lg font-semibold dark:border-slate-800"
          >
            Button events
          </h2>
          <ButtonEvents />
        </section>
        <section
          aria-labelledby="alarm-events-heading"
          className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <h2
            id="alarm-events-heading"
            className="border-b border-slate-200 px-5 py-4 text-lg font-semibold dark:border-slate-800"
          >
            Alarm events
          </h2>
          <AlarmEvents />
        </section>
      </div>
    </main>
  )
}

export default App
