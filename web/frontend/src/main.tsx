import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

type ErrorBoundaryState = {
  hasError: boolean
  message: string
}

class RootErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || '未知前端錯誤',
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('RootErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: '#0f172a',
            color: '#e2e8f0',
          }}
        >
          <div
            style={{
              maxWidth: '920px',
              width: '100%',
              borderRadius: '20px',
              border: '1px solid rgba(148, 163, 184, 0.28)',
              background: 'rgba(15, 23, 42, 0.9)',
              padding: '24px',
              boxShadow: '0 18px 60px rgba(0, 0, 0, 0.35)',
            }}
          >
            <p style={{ margin: 0, fontSize: '12px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#fda4af' }}>
              Frontend Error
            </p>
            <h1 style={{ margin: '10px 0 8px', fontSize: '28px', lineHeight: 1.2 }}>
              前端執行時發生錯誤
            </h1>
            <p style={{ margin: 0, fontSize: '15px', lineHeight: 1.7, color: '#cbd5e1' }}>
              請把下面這段錯誤訊息截圖或貼給我，我會直接沿著它修。
            </p>
            <pre
              style={{
                marginTop: '16px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                borderRadius: '16px',
                background: 'rgba(2, 6, 23, 0.72)',
                padding: '16px',
                fontSize: '13px',
                lineHeight: 1.6,
                color: '#f8fafc',
              }}
            >
              {this.state.message}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
)
