import { NextResponse } from 'next/server'
import { execSync, spawn } from 'child_process'
import path from 'path'

const PORT = parseInt(process.env.FAKE_LLM_PORT || '8787', 10)

async function isAlive(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

function killPort(port: number) {
  try {
    // lsof -ti 拿到 PID 列表，逐个 SIGKILL
    const out = execSync(`lsof -ti tcp:${port} 2>/dev/null`, { encoding: 'utf8' }).trim()
    const pids = out.split('\n').map(s => parseInt(s)).filter(n => !isNaN(n) && n > 0)
    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL') } catch { /* 已退出，忽略 */ }
    }
    return pids.length
  } catch {
    return 0
  }
}

export async function GET() {
  const alive = await isAlive()
  return NextResponse.json({ alive, port: PORT })
}

export async function POST() {
  // 1. 干掉旧进程
  const killed = killPort(PORT)

  // 2. 等端口释放
  if (killed > 0) await new Promise(r => setTimeout(r, 500))

  // 3. 启动新进程
  const scriptPath = path.join(process.cwd(), 'scripts', 'fake-llm.js')
  const child = spawn(process.execPath, [scriptPath, 'serve'], {
    env: { ...process.env, FAKE_LLM_MODE: 'cli' },
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()

  // 4. 等待就绪（最多 6s）
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 400))
    if (await isAlive()) {
      return NextResponse.json({ success: true, message: 'fake-llm 已重启' })
    }
  }

  return NextResponse.json({ success: false, message: '启动超时，请检查终端' }, { status: 500 })
}
