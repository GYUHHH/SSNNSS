import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

import { initOwnSync, initVisit, onRoomRefresh } from './services/social'

// Server first: a visited room's data — or the owner's own published room — must be in hand before the
// store initializes from storage. A live room-data update while visiting remounts the app from the fresh
// snapshot.
void Promise.allSettled([initVisit(), initOwnSync()]).finally(() => {
  const root = createRoot(document.getElementById('root')!)
  const mount = () => root.render(<StrictMode><App key={Date.now()} /></StrictMode>)
  onRoomRefresh(mount)
  mount()
})