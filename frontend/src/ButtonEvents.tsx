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

  return (
    <>
      {bEvents.map((be) => (
        <div className="button-event">
          <div>{new Date(be.etime).toLocaleString()}</div>
          <div>{eventTypeNumberToText(be.event_type)}</div>
          {be.temp_c && <div>{Math.round(be.temp_c * 10) / 10} &deg;C</div>}
          {be.illuminance_lux && (
            <div>{Math.round(be.illuminance_lux * 1000) / 1000} lx</div>
          )}
        </div>
      ))}
    </>
  )
}
