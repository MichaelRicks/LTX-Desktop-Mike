import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installProjectStorageDevtools } from './lib/project-storage-devtools'
import { initTheme } from './lib/theme'
import './index.css'

installProjectStorageDevtools()
// Apply the saved color palette before first paint.
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
