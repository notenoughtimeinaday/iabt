import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { normalizeRoutingLocation } from '@/lib/routing'

normalizeRoutingLocation()

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
