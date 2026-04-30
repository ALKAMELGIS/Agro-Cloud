export async function analyzePlantHealth(endpoint: string, payload: unknown) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  })
  if (!res.ok) throw new Error('AI analysis failed')
  return res.json() as Promise<{ score: number; advisories: string[] }>
}
