import { useEffect, useState, useMemo } from 'react'

interface AlarmEvent {
  atime: number | string
  tune_no: number
  decision_data: string
}

function tuneNumberToText(tuneNo: number) {
  switch (tuneNo) {
    case 7:
      return 'Tune 7 (Sleeping w/ machine off)'
    case 9:
      return 'Tune 9 (Bad sleep position)'
    default:
      return `Tune ${tuneNo}`
  }
}

function AlarmEventRow({ ae }: { ae: AlarmEvent }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const { lastWatt, darkRatio, formattedJson } = useMemo(() => {
    let lastWatt: number | undefined
    let darkRatio: number | undefined
    let formattedJson = ''
    try {
      const parsedData = JSON.parse(ae.decision_data)
      if (parsedData && typeof parsedData.lastWatt === 'number') {
        lastWatt = parsedData.lastWatt
      }
      if (parsedData && typeof parsedData.darkRatio === 'number') {
        darkRatio = parsedData.darkRatio
      }
      formattedJson = JSON.stringify(parsedData, null, 2)
    } catch (e) {
      formattedJson = ae.decision_data
    }
    return { lastWatt, darkRatio, formattedJson }
  }, [ae.decision_data])

  return (
    <div className="alarm-event-container">
      <div className="button-event alarm-event">
        <div className="button-event-date">
          {new Date(ae.atime).toISOString().split('T')[0]}
        </div>
        <div className="button-event-time">
          {new Date(ae.atime).toLocaleTimeString()}
        </div>
        <div className="button-event-type">{tuneNumberToText(ae.tune_no)}</div>
        <div className="button-event-temp">
          {lastWatt != null ? `${lastWatt.toFixed(1)} W` : ''}
        </div>
        <div className="button-event-lux">
          {darkRatio != null ? `${(darkRatio * 100).toFixed(0)}%` : ''}
        </div>
        <div className="alarm-event-toggle">
          <button
            className="json-toggle-button"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Hide' : 'JSON'}
          </button>
        </div>
      </div>
      {isExpanded && (
        <div className="decision-data-detail">
          <pre>
            <code>{formattedJson}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

export default function AlarmEvents() {
  const [aEvents, setAEvents] = useState<AlarmEvent[] | null>(null)

  useEffect(() => {
    fetch('/api/v1/alarm-events')
      .then((res) => res.json())
      .then((json) => setAEvents(json))
  }, [])

  if (aEvents == null) {
    return <>❌</>
  }

  return !aEvents || aEvents.length < 1 ? (
    <div>No events</div>
  ) : (
    <>
      <div className="button-event alarm-event button-event-header">
        <div className="button-event-date">Date</div>
        <div className="button-event-time">Time</div>
        <div className="button-event-type">Alarm</div>
        <div className="button-event-temp">Power</div>
        <div className="button-event-lux">Dark ratio</div>
        <div className="alarm-event-toggle">Data</div>
      </div>
      {aEvents.map((ae) => {
        const eventKey =
          typeof ae.atime === 'number' ? ae.atime : new Date(ae.atime).getTime()
        return <AlarmEventRow key={eventKey} ae={ae} />
      })}
    </>
  )
}
