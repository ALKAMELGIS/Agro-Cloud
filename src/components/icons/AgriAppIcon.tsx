import * as React from 'react'

type AgriAppIconId = 'dashboard' | 'satellite' | 'data' | 'sensors' | 'master' | 'admin'

export function AgriAppIcon({ id, className }: { id: string; className?: string }) {
  const rid = React.useId()
  const safeId = (id as AgriAppIconId) || 'dashboard'

  switch (safeId) {
    case 'satellite':
      return (
        <svg
          className={className ? `agri-app-svg ${className}` : 'agri-app-svg'}
          width="40"
          height="40"
          viewBox="0 0 48 48"
          fill="none"
          role="img"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${rid}-sat-a`} x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#60A5FA" />
              <stop offset="0.55" stopColor="#22C55E" />
              <stop offset="1" stopColor="#F59E0B" />
            </linearGradient>
          </defs>
          <path
            d="M14 30c5.5-5.8 14.5-5.8 20 0"
            stroke={`url(#${rid}-sat-a)`}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M18.2 26c3.2-3.4 8.4-3.4 11.6 0"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M23.4 22.7c.8-.9 2.4-.9 3.2 0"
            stroke="rgba(255,255,255,0.9)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M10.5 17.2l8.6 5 2.6-4.6-8.7-5a2 2 0 0 0-2.5.6l-.7 1.1a2 2 0 0 0 .7 2.9Z"
            fill="rgba(255,255,255,0.92)"
          />
          <path
            d="M37.5 17.2l-8.6 5-2.6-4.6 8.7-5a2 2 0 0 1 2.5.6l.7 1.1a2 2 0 0 1-.7 2.9Z"
            fill="rgba(255,255,255,0.92)"
          />
          <circle cx="24" cy="33.5" r="3.2" fill="rgba(255,255,255,0.95)" />
        </svg>
      )
    case 'data':
      return (
        <svg
          className={className ? `agri-app-svg ${className}` : 'agri-app-svg'}
          width="40"
          height="40"
          viewBox="0 0 48 48"
          fill="none"
          role="img"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${rid}-ops-a`} x1="10" y1="8" x2="38" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22C55E" />
              <stop offset="0.55" stopColor="#B45309" />
              <stop offset="1" stopColor="#F59E0B" />
            </linearGradient>
          </defs>
          <path
            d="M19 14c3.4-2.3 6.6-2.3 10 0 1.2.8 2.2 2 2.7 3.4l2.2 6.2c.9 2.4-.4 5-2.8 5.9l-5.3 1.9c-1.2.4-2.5.4-3.7 0l-5.3-1.9c-2.4-.9-3.7-3.5-2.8-5.9l2.2-6.2c.5-1.4 1.5-2.6 2.8-3.4Z"
            stroke={`url(#${rid}-ops-a)`}
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M16 35.2c2.8-2.4 6.7-3.7 8-3.7s5.2 1.3 8 3.7"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M24 18v8.5"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M20 22h8"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'sensors':
      return (
        <svg
          className={className ? `agri-app-svg ${className}` : 'agri-app-svg'}
          width="40"
          height="40"
          viewBox="0 0 48 48"
          fill="none"
          role="img"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${rid}-sen-a`} x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#60A5FA" />
              <stop offset="0.6" stopColor="#22C55E" />
              <stop offset="1" stopColor="#0EA5E9" />
            </linearGradient>
          </defs>
          <rect x="14" y="14" width="20" height="20" rx="6" stroke={`url(#${rid}-sen-a)`} strokeWidth="3" />
          <path
            d="M24 18v12"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M18 24h12"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M10.5 20.5h3M34.5 20.5h3M10.5 27.5h3M34.5 27.5h3"
            stroke="rgba(255,255,255,0.65)"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <circle cx="24" cy="24" r="4" fill="rgba(255,255,255,0.92)" />
        </svg>
      )
    case 'master':
      return (
        <svg
          className={className ? `agri-app-svg ${className}` : 'agri-app-svg'}
          width="40"
          height="40"
          viewBox="0 0 48 48"
          fill="none"
          role="img"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${rid}-mdm-a`} x1="10" y1="8" x2="38" y2="40" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22C55E" />
              <stop offset="0.55" stopColor="#F59E0B" />
              <stop offset="1" stopColor="#60A5FA" />
            </linearGradient>
          </defs>
          <path
            d="M14 16.5c0-1.4 1.1-2.5 2.5-2.5h15c1.4 0 2.5 1.1 2.5 2.5v15c0 1.4-1.1 2.5-2.5 2.5h-15c-1.4 0-2.5-1.1-2.5-2.5v-15Z"
            stroke={`url(#${rid}-mdm-a)`}
            strokeWidth="3"
          />
          <path
            d="M18 20h12M18 24h12M18 28h8"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M29.5 29.5l3.8 3.8"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="28.6" cy="28.6" r="4.2" stroke="rgba(255,255,255,0.92)" strokeWidth="3" />
        </svg>
      )
    case 'admin':
      return (
        <svg
          className={className ? `agri-app-svg ${className}` : 'agri-app-svg'}
          width="40"
          height="40"
          viewBox="0 0 48 48"
          fill="none"
          role="img"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${rid}-adm-a`} x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22C55E" />
              <stop offset="0.6" stopColor="#0EA5E9" />
              <stop offset="1" stopColor="#B45309" />
            </linearGradient>
          </defs>
          <path
            d="M24 12.5c4.2 0 7.5 3.4 7.5 7.6 0 4.2-3.3 7.6-7.5 7.6s-7.5-3.4-7.5-7.6c0-4.2 3.3-7.6 7.5-7.6Z"
            stroke={`url(#${rid}-adm-a)`}
            strokeWidth="3"
          />
          <path
            d="M13.8 36.5c2.6-5 6.4-7.4 10.2-7.4s7.6 2.4 10.2 7.4"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M33.5 18.8l3.7 3.7m-3.7 0 3.7-3.7"
            stroke="rgba(255,255,255,0.75)"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'dashboard':
    default:
      return (
        <svg
          className={className ? `agri-app-svg ${className}` : 'agri-app-svg'}
          width="40"
          height="40"
          viewBox="0 0 48 48"
          fill="none"
          role="img"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${rid}-dash-a`} x1="10" y1="10" x2="38" y2="38" gradientUnits="userSpaceOnUse">
              <stop stopColor="#22C55E" />
              <stop offset="0.55" stopColor="#F59E0B" />
              <stop offset="1" stopColor="#60A5FA" />
            </linearGradient>
          </defs>
          <path
            d="M14.5 34V14.5c0-1.1.9-2 2-2H34"
            stroke={`url(#${rid}-dash-a)`}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M18.8 30.2l4.6-4.8 3.6 3.6 6.2-7"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="18.8" cy="30.2" r="2" fill="rgba(255,255,255,0.92)" />
          <circle cx="23.4" cy="25.4" r="2" fill="rgba(255,255,255,0.92)" />
          <circle cx="27" cy="29" r="2" fill="rgba(255,255,255,0.92)" />
          <circle cx="33.2" cy="22" r="2" fill="rgba(255,255,255,0.92)" />
        </svg>
      )
  }
}

