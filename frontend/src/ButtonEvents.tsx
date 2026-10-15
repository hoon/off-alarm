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
    <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
      No events
    </div>
  ) : (
    <div className="overflow-x-auto">
      <table
        aria-labelledby="button-events-heading"
        className="w-full text-left text-sm"
      >
        <thead className="bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:bg-slate-800/50 dark:text-slate-400">
          <tr>
            <th scope="col" className="px-4 py-3">
              Date
            </th>
            <th scope="col" className="px-4 py-3">
              Time
            </th>
            <th scope="col" className="px-4 py-3">
              Event
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Temp
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Lux
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {bEvents.map((be) => (
            <tr
              className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
              key={be.etime}
            >
              <td className="px-4 py-3 font-mono whitespace-nowrap">
                {new Date(be.etime).toISOString().split('T')[0]}
              </td>
              <td className="px-4 py-3 font-mono whitespace-nowrap">
                {new Date(be.etime).toLocaleTimeString()}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                {eventTypeNumberToText(be.event_type)}
              </td>
              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                {be.temp_c != null ? `${be.temp_c.toFixed(1)} °C` : ''}
              </td>
              <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                {be.illuminance_lux != null
                  ? `${be.illuminance_lux.toFixed(1)} lx`
                  : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
