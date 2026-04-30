/// <reference types="vite/client" />

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'calcite-action-group': import('react').DetailedHTMLProps<import('react').HTMLAttributes<HTMLElement>, HTMLElement> & {
        layout?: string
        'overlay-positioning'?: string
        scale?: string
        'selection-mode'?: string
        'calcite-hydrated'?: string
      }
    }
  }
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.jpeg' {
  const src: string
  export default src
}

declare module '*.gif' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

declare module 'leaflet/dist/images/marker-icon-2x.png' {
  const src: string
  export default src
}

declare module 'leaflet/dist/images/marker-icon.png' {
  const src: string
  export default src
}

declare module 'leaflet/dist/images/marker-shadow.png' {
  const src: string
  export default src
}

export {}
