import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import './Home.css'

interface MenuItem {
  id: string
  label: string
  icon: string
  color: string
  items?: SubMenuItem[]
  to?: string
}

interface SubMenuItem {
  label: string
  icon: string
  to: string
}

const menuItems: MenuItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'fa-solid fa-house',
    color: '#22C55E',
    to: '/'
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'fa-solid fa-chart-line',
    color: '#F97316',
    items: [
      { label: 'Develop Dashboard', icon: 'fa-solid fa-grip', to: '/dashboard/develop' },
      { label: 'Design & Publish', icon: 'fa-solid fa-palette', to: '/dashboard/design' },
    ]
  },
  {
    id: 'satellite',
    label: 'Satellite Imagery',
    icon: 'fa-solid fa-satellite-dish',
    color: '#8B5CF6', // Violet
    items: [
      { label: 'Satellite Intelligence', icon: 'fa-solid fa-layer-group', to: '/satellite/indices' },
      { label: 'GIS Map', icon: 'fa-solid fa-map', to: '/satellite/gis' },
    ]
  },
  {
    id: 'data',
    label: 'Operations',
    icon: 'fa-solid fa-screwdriver-wrench',
    color: '#F59E0B', // Amber
    items: [
      { label: 'EC/PH', icon: 'fa-solid fa-droplet', to: '/data/ec-ph' },
      { label: 'Irrigation Scheduling', icon: 'fa-solid fa-water', to: '/data/irrigation' },
      { label: 'Harvest Logging', icon: 'fa-solid fa-tractor', to: '/data/harvest' },
      { label: 'QHIS', icon: 'fa-solid fa-shield-halved', to: '/data/qhis' },
      { label: 'Product & Selas Tracking', icon: 'fa-solid fa-boxes-stacked', to: '/data/production' },
    ]
  },
  {
    id: 'sensors',
    label: 'Sensors',
    icon: 'fa-solid fa-microchip',
    color: '#0EA5E9', // Sky
    items: [
      { label: 'Soil Sensors', icon: 'fa-solid fa-seedling', to: '/sensors/soil' },
      { label: 'Weather Sensors', icon: 'fa-solid fa-cloud-sun', to: '/sensors/weather' },
      { label: 'Irrigation Sensors', icon: 'fa-solid fa-faucet-drip', to: '/sensors/irrigation' },
      { label: 'Camera', icon: 'fa-solid fa-camera', to: '/sensors/camera' },
    ]
  },
  {
    id: 'master',
    label: 'Master Data',
    icon: 'fa-solid fa-gear',
    color: '#64748B',
    items: [
      { label: 'Workflow & Data Sources', icon: 'fa-solid fa-sliders', to: '/master/workflow-settings' },
      { label: 'GIS Content', icon: 'fa-solid fa-map', to: '/master/gis-content' },
    ]
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: 'fa-solid fa-user-shield',
    color: '#1E293B', // Dark
    items: [
      { label: 'User Management', icon: 'fa-solid fa-users', to: '/admin/users' },
      { label: 'GitHub Integration', icon: 'fa-brands fa-github', to: '/admin/github' },
    ]
  }
]

export default function Home() {
  const navigate = useNavigate()
  const location = useLocation()
  const [activeGroup, setActiveGroup] = useState<MenuItem | null>(null)
  const [sublistOpen, setSublistOpen] = useState(true)

  const getIconKey = (icon: string) => {
    const parts = icon.split(/\s+/).filter(Boolean)
    const specific = parts.find(p => p.startsWith('fa-') && p !== 'fa-solid' && p !== 'fa-regular' && p !== 'fa-brands')
    return (specific || '').replace(/^fa-/, '').replace(/[^a-z0-9-]/gi, '')
  }

  const handleMainClick = (item: MenuItem) => {
    if (item.items) {
      setActiveGroup(item)
      setSublistOpen(true)
    } else if (item.to) {
      navigate(item.to)
    }
  }

  const handleBack = () => {
    setActiveGroup(null)
  }

  useEffect(() => {
    const state = location.state as { openGroup?: string } | null
    if (!state?.openGroup) return
    const group = menuItems.find(i => i.id === state.openGroup && i.items)
    if (group) setActiveGroup(group)
  }, [location.state])

  useEffect(() => {
    if (activeGroup) setSublistOpen(true)
  }, [activeGroup?.id])

  useEffect(() => {
    const root = document.querySelector('.home-page')
    if (!root) return

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    for (let i = 0; i < items.length; i += 1) {
      const el = items[i]
      el.style.setProperty('--enter-delay', `${Math.min(900, i * 90)}ms`)
      el.classList.add('reveal-ready')
      el.classList.remove('is-visible')
    }

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (prefersReduced) {
      for (const el of items) el.classList.add('is-visible')
      return
    }

    if (!('IntersectionObserver' in window)) {
      requestAnimationFrame(() => {
        for (const el of items) el.classList.add('is-visible')
      })
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -10% 0px' }
    )

    for (const el of items) observer.observe(el)
    return () => observer.disconnect()
  }, [activeGroup])

  return (
    <div className="page home-page">
      {activeGroup ? (
        <div className="home-sublist-view fade-in">
          <div className="home-header">
            <div className="home-header-row">
              <button className="back-btn" onClick={handleBack} aria-label="Back">
                <i className="fa-solid fa-chevron-left" aria-hidden="true"></i>
              </button>
              <div className="header-title">
                <span className="header-icon" style={{ backgroundColor: activeGroup.color }}>
                  <i className={activeGroup.icon} aria-hidden="true"></i>
                </span>
                <h2>{activeGroup.label}</h2>
              </div>
              <button
                type="button"
                className="sublist-toggle"
                aria-expanded={sublistOpen}
                aria-controls={`home-sublist-${activeGroup.id}`}
                onClick={() => setSublistOpen(v => !v)}
              >
                <i className={`fa-solid ${sublistOpen ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true"></i>
              </button>
            </div>

            <div
              id={`home-sublist-${activeGroup.id}`}
              className={sublistOpen ? 'sublist-container' : 'sublist-container sublist-container-closed'}
              role="region"
              aria-label={`${activeGroup.label} submenu`}
              hidden={!sublistOpen}
            >
              {activeGroup.items?.map(subItem => (
                <button
                  key={subItem.to}
                  type="button"
                  className="sublist-item"
                  onClick={() => navigate(subItem.to)}
                  aria-label={subItem.label}
                  data-reveal="item"
                >
                  <div className={`sub-icon-wrapper sub-icon-${getIconKey(subItem.icon)}`}>
                    <i className={subItem.icon} aria-hidden="true"></i>
                  </div>
                  <span className="sub-label">{subItem.label}</span>
                  <i className="fa-solid fa-chevron-right chev-icon" aria-hidden="true"></i>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="home-grid-view fade-in">
          <div className="app-grid" aria-label="Applications">
            {menuItems.map((item) => (
              <button
                key={item.id} 
                type="button"
                className="app-icon-card"
                onClick={() => handleMainClick(item)}
                aria-label={item.label}
                data-reveal="item"
                style={
                  {
                    '--app-accent': item.color,
                    '--app-accent-rgb': toRgbTriplet(item.color),
                  } as React.CSSProperties
                }
              >
                <i className={`app-icon ${item.icon}`} aria-hidden="true"></i>
                <span className="app-label">{item.label}</span>
                {item.items && <i className="fa-solid fa-chevron-right mini-chev"></i>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function toRgbTriplet(hexColor: string) {
  const hex = hexColor.replace(/^#/, '')
  if (hex.length !== 6) return '0 0 0'

  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)

  return `${r} ${g} ${b}`
}
