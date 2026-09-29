import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Show the error instead of a blank page if anything in the app throws
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-screen bg-slate-900 text-slate-200 p-6 text-center">
        <p className="text-lg font-semibold mb-2">Something went wrong</p>
        <p className="text-sm text-slate-400 mb-4 break-words">{this.state.error.message}</p>
        <button className="px-4 py-2 rounded bg-slate-700" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
