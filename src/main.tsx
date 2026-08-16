import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

import { initVisit } from './services/social'

// a visited room's data must be in hand before the store initializes from storage
void initVisit().finally(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>))