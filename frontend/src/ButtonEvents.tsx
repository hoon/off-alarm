import { useEffect, useState } from 'react'

interface ButtonEvent {
  etime: string
  event_type: number
  temp_c?: number
  illuminance_lux?: number
}

export default function ButtonEvents() {
  const [bEvents, setBEvents] = useState<ButtonEvent[] | null>(null)

  useEffect(() => {
    fetch('/api/v1/button-events')
      .then((res) => res.json())
      .then((json) => setBEvents(json))
  }, [])

  if (bEvents == null) {
    return <>❌</>
  }

  function eventTypeNumberToText(eventTypeNumber: number) {
    switch (eventTypeNumber) {
      case 10:
        return 'In bed'
      case 20:
        return 'Awake'
      case 30:
        return 'Out of bed'
      default:
        'Unknown'
    }
  }

  return !bEvents || bEvents.length < 1 ? (
    <div>No events</div>
  ) : (
    <>
      <div className="button-event button-event-header">
        <div className="button-event-date">Date</div>
        <div className="button-event-time">Time</div>
        <div className="button-event-type">Event</div>
        <div className="button-event-temp">Temp</div>
        <div className="button-event-lux">Lux</div>
      </div>
      {bEvents.map((be) => (
        <div className="button-event" key={be.etime}>
          <div className="button-event-date">
            {new Date(be.etime).toISOString().split('T')[0]}
          </div>
          <div className="button-event-time">
            {new Date(be.etime).toLocaleTimeString()}
          </div>
          <div className="button-event-type">
            {eventTypeNumberToText(be.event_type)}
          </div>
          {be.temp_c != null && (
            <div className="button-event-temp">
              {be.temp_c.toFixed(1)} &deg;C
            </div>
          )}
          {be.illuminance_lux && (
            <div className="button-event-lux">
              {be.illuminance_lux.toFixed(1)} lx
            </div>
          )}
        </div>
      ))}
    </>
  )
}
