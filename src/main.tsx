import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

import { initOwnSync, initVisit } from './services/social'

// Server first: a visited room's data — or the owner's own published room — must be in hand before the
// store initializes from storage. Later live updates are read into state by the store itself, so the app
// mounts exactly once and a room change never looks like a page refresh.
void Promise.allSettled([initVisit(), initOwnSync()]).finally(() => {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
})
