import './App.css'
import ButtonEvents from './ButtonEvents'
import AlarmEvents from './AlarmEvents'

function App() {
  return (
    <div className="app-container">
      <h1>off-alarm</h1>
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
