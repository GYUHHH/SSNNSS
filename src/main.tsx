import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

import { initOwnSync, initVisit } from './services/social'
import './services/roomHistory'

// Server first: a visited room's data — or the owner's own room — must be in hand before the
// store initializes from the in-memory bundle. Later live updates are read into state by the store itself, so the app
// mounts exactly once and a room change never looks like a page refresh.
void Promise.allSettled([initVisit(), initOwnSync()]).finally(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
})
