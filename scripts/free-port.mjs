import { execSync } from 'node:child_process'

const portArg = process.argv.find((a) => /^\d+$/.test(a))
const port = portArg ? Number(portArg) : 5173

const isWindows = process.platform === 'win32'

function tryExec(cmd) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
  } catch {
    return ''
  }
}

if (!isWindows) process.exit(0)

const out = tryExec('netstat -ano -p tcp')
const lines = out.split(/\r?\n/)
const pids = new Set()
for (const line of lines) {
  const m = line.match(new RegExp(`\\sTCP\\s+[^\\s]+:${port}\\s+[^\\s]+\\s+LISTENING\\s+(\\d+)\\s*$`, 'i'))
  if (m && m[1]) pids.add(m[1])
}

for (const pid of pids) {
  tryExec(`taskkill /PID ${pid} /F`)
}

