import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

import { initVisit, onRoomRefresh } from './services/social'

// a visited room's data must be in hand before the store initializes from storage; a live room-data update
// while visiting remounts the app so every piece re-initializes from the fresh snapshot
void initVisit().finally(() => {
  const root = createRoot(document.getElementById('root')!)
  const mount = () => root.render(<StrictMode><App key={Date.now()} /></StrictMode>)
  onRoomRefresh(mount)
  mount()
})