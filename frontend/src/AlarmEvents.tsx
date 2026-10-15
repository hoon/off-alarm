import { useEffect, useState, useMemo } from 'react'

interface AlarmEvent {
  atime: number | string
  tune_no: number
  decision_data: string
}

function tuneNumberToText(tuneNo: number) {
  switch (tuneNo) {
    case 7:
      return 'Tune 7 (Machine off)'
    case 9:
      return 'Tune 9 (Bad sleep position)'
    default:
      return `Tune ${tuneNo}`
  }
}

function AlarmEventRow({ ae }: { ae: AlarmEvent }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const { lastWatt, formattedJson } = useMemo(() => {
    let lastWatt: number | undefined
    let formattedJson = ''
    try {
      const parsedData = JSON.parse(ae.decision_data)
      if (parsedData && typeof parsedData.lastWatt === 'number') {
        lastWatt = parsedData.lastWatt
      }
      formattedJson = JSON.stringify(parsedData, null, 2)
    } catch (e) {
      formattedJson = ae.decision_data
    }
    return { lastWatt, formattedJson }
  }, [ae.decision_data])

  return (
    <tbody className="border-t border-slate-100 dark:border-slate-800">
      <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <td className="px-4 py-3 font-mono whitespace-nowrap">
          {new Date(ae.atime).toISOString().split('T')[0]}
        </td>
        <td className="px-4 py-3 font-mono whitespace-nowrap">
          {new Date(ae.atime).toLocaleTimeString()}
        </td>
        <td className="px-4 py-3">
          {tuneNumberToText(ae.tune_no)}
        </td>
        <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
          {lastWatt != null ? `${lastWatt.toFixed(1)} W` : ''}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            className="cursor-pointer rounded-md border border-indigo-200 px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Hide' : 'JSON'}
          </button>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={5} className="px-4 pb-4">
            <pre className="max-w-0 min-w-full rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs break-all whitespace-pre-wrap text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
              <code>{formattedJson}</code>
            </pre>
          </td>
        </tr>
      )}
    </tbody>
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
    <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
      No events
    </div>
  ) : (
    <div className="overflow-x-auto">
      <table
        aria-labelledby="alarm-events-heading"
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
              Alarm
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Power
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              Data
            </th>
          </tr>
        </thead>
        {aEvents.map((ae) => {
          const eventKey =
            typeof ae.atime === 'number'
              ? ae.atime
              : new Date(ae.atime).getTime()
          return <AlarmEventRow key={eventKey} ae={ae} />
        })}
      </table>
    </div>
  )
}
