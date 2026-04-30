type Update = { topic: string; payload: unknown }

export function connectRealtime(url: string, onUpdate: (u: Update) => void) {
  const ws = new WebSocket(url)
  ws.onmessage = e => {
    try {
      const m = JSON.parse(e.data as string)
      onUpdate(m)
    } catch {}
  }
  return () => ws.close()
}
