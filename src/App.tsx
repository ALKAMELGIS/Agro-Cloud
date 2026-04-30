import { Component, Suspense, lazy, useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import HeaderBar from './components/HeaderBar'
import NavMenu from './components/NavMenu'
import { readCurrentUser } from './lib/auth'

const Home = lazy(() => import('./pages/Home'))
const Login = lazy(() => import('./pages/Login'))
const SatelliteIntelligence = lazy(() => import('./pages/satellite/SatelliteIntelligence'))
const SatelliteMultidimensional = lazy(() => import('./pages/satellite/Multidimensional'))
const GisMap = lazy(() => import('./pages/satellite/GisMap'))
const DataEntryFertigationRecords = lazy(() => import('./pages/data-entry/FertigationRecords'))
const DataEntryIrrigation = lazy(() => import('./pages/data-entry/Irrigation'))
const DataEntryHarvest = lazy(() => import('./pages/data-entry/Harvest'))
const DataEntryQHIS = lazy(() => import('./pages/data-entry/QHIS'))
const DataEntryECPH = lazy(() => import('./pages/data-entry/EC'))
const AccountProfile = lazy(() => import('./pages/account/Profile'))
const AccountSettings = lazy(() => import('./pages/account/Settings'))
const MasterGisContent = lazy(() => import('./pages/master/GisContent'))
const AdminUsers = lazy(() => import('./pages/admin/Users'))
const AdminGitHub = lazy(() => import('./pages/admin/GitHubIntegration'))
const DashboardOverview = lazy(() => import('./pages/dashboards/Overview'))
const DashboardPlantAI = lazy(() => import('./pages/dashboards/PlantAI'))
const DashboardAiChatbot = lazy(() => import('./pages/dashboards/AiChatbot'))
const DashboardModel = lazy(() => import('./pages/dashboards/Model'))
const StyleGuide = lazy(() => import('./pages/StyleGuide'))
const UsabilityTest = lazy(() => import('./pages/UsabilityTest'))

type AuthUser = {
  id: number
  name: string
  email: string
  role: string
}

type AppErrorState = {
  error: unknown
  kind: 'render' | 'window'
  details?: string
} | null

class AppErrorBoundary extends Component<{ children: JSX.Element }, { err: AppErrorState }> {
  state: { err: AppErrorState } = { err: null }
  private onUnhandledRejection?: (e: PromiseRejectionEvent) => void
  private onErrorEvent?: (e: ErrorEvent) => void

  static getDerivedStateFromError(error: unknown) {
    return { err: { error, kind: 'render' as const } }
  }

  componentDidCatch(error: unknown) {
    try {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[AppErrorBoundary]', message, error)
    } catch {
    }
  }

  componentDidMount() {
    if (typeof window === 'undefined') return
    this.onUnhandledRejection = (e) => {
      const reason = (e as any).reason
      const details = reason instanceof Error ? reason.stack : undefined
      this.setState({ err: { error: reason ?? e, kind: 'window', details } })
      try {
        console.error('[unhandledrejection]', reason)
      } catch {
      }
    }
    this.onErrorEvent = (e) => {
      const details = typeof e?.error?.stack === 'string' ? e.error.stack : undefined
      this.setState({ err: { error: e.error ?? e.message, kind: 'window', details } })
      try {
        console.error('[window.error]', e.error ?? e.message)
      } catch {
      }
    }
    window.addEventListener('unhandledrejection', this.onUnhandledRejection)
    window.addEventListener('error', this.onErrorEvent)
  }

  componentWillUnmount() {
    if (typeof window === 'undefined') return
    if (this.onUnhandledRejection) window.removeEventListener('unhandledrejection', this.onUnhandledRejection)
    if (this.onErrorEvent) window.removeEventListener('error', this.onErrorEvent)
  }

  render() {
    if (!this.state.err) return this.props.children

    const message =
      this.state.err.error instanceof Error
        ? this.state.err.error.message
        : typeof this.state.err.error === 'string'
          ? this.state.err.error
          : 'A runtime error prevented the page from loading.'

    const reset = async () => {
      try {
        localStorage.clear()
      } catch {
      }
      try {
        sessionStorage.clear()
      } catch {
      }
      try {
        if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('GisMapStore')
      } catch {
      }
      try {
        if (typeof window !== 'undefined' && 'caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        }
      } catch {
      }
      try {
        if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof navigator.serviceWorker.getRegistrations === 'function') {
          const regs = await navigator.serviceWorker.getRegistrations()
          await Promise.all(regs.map((r) => r.unregister()))
        }
      } catch {
      }
      window.location.reload()
    }

    return (
      <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>حدث خطأ ومنع الصفحة من التحميل</div>
        <div style={{ marginBottom: 12, color: '#444' }}>{message}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button type="button" className="gis-btn" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            type="button"
            className="gis-btn"
            onClick={() => {
              void reset()
            }}
          >
            Reset App Storage
          </button>
        </div>
        {this.state.err.details ? (
          <pre style={{ background: '#f6f6f6', padding: 12, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{this.state.err.details}</pre>
        ) : null}
      </div>
    )
  }
}

function AppShell() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => {
    const u = readCurrentUser()
    if (!u) return null
    return { id: u.id, name: u.name, email: u.email, role: String(u.role) }
  })
  const location = useLocation()

  const handleLogin = (user: AuthUser) => {
    setCurrentUser(user)
  }

  const handleLogout = () => {
    localStorage.removeItem('currentUser')
    setCurrentUser(null)
  }

  const isOnLogin = location.pathname === '/login'
  const showChrome = !!currentUser && !isOnLogin

  useEffect(() => {
    const onStorage = () => {
      const u = readCurrentUser()
      if (!u) {
        setCurrentUser(null)
        return
      }
      setCurrentUser({ id: u.id, name: u.name, email: u.email, role: String(u.role) })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (currentUser && isOnLogin) {
    const from = (location.state as any)?.from?.pathname
    return <Navigate to={typeof from === 'string' && from ? from : '/'} replace />
  }

  if (!currentUser && !isOnLogin) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return (
    <>
      {showChrome && <HeaderBar />}
      <div className={showChrome ? 'layout layout-topnav' : 'layout'}>
        {showChrome && <NavMenu onLogout={handleLogout} />}
        <main className="content">
          <Suspense fallback={<div style={{ padding: 12 }}>Loading</div>}>
            <Routes>
              <Route path="/login" element={<Login onLogin={handleLogin} />} />
              <Route path="/" element={<Home />} />
              <Route path="/satellite" element={<Navigate to="/satellite/indices" replace />} />
              <Route path="/data/fertigation" element={<Navigate to="/data/fertigation-records" replace />} />
              <Route path="/data/fertigation-records" element={<DataEntryFertigationRecords />} />
              <Route path="/data/irrigation" element={<DataEntryIrrigation />} />
              <Route path="/data/harvest" element={<DataEntryHarvest />} />
              <Route path="/data/qhis" element={<DataEntryQHIS />} />
              <Route path="/data/production" element={<DataEntryHarvest />} />
              <Route path="/data/ec-ph" element={<DataEntryECPH />} />
              <Route path="/satellite/indices" element={<SatelliteIntelligence />} />
              <Route path="/satellite/multidimensional" element={<SatelliteMultidimensional />} />
              <Route path="/satellite/gis" element={<GisMap />} />
              <Route path="/dashboards/overview" element={<DashboardOverview />} />
              <Route path="/dashboards/plant-ai" element={<DashboardPlantAI />} />
              <Route path="/dashboards/ai-chatbot" element={<DashboardAiChatbot />} />
              <Route path="/dashboards/model" element={<DashboardModel />} />
              <Route path="/master/gis-content" element={<MasterGisContent />} />
              <Route path="/master/workflow-settings" element={<AccountSettings />} />
              <Route path="/account/profile" element={<AccountProfile />} />
              <Route path="/account/settings" element={<AccountSettings />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/github" element={<AdminGitHub />} />
              <Route path="/style-guide" element={<StyleGuide />} />
              <Route path="/usability-test" element={<UsabilityTest />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppErrorBoundary>
        <AppShell />
      </AppErrorBoundary>
    </HashRouter>
  )
}
