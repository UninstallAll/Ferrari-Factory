'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

export default function BackendStatus() {
  const [alive, setAlive] = useState<boolean | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [msg, setMsg] = useState('')

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/backend-status')
      const data = await res.json()
      setAlive(data.alive)
    } catch {
      setAlive(false)
    }
  }, [])

  useEffect(() => {
    check()
    const t = setInterval(check, 8000)
    return () => clearInterval(t)
  }, [check])

  const restart = async () => {
    setRestarting(true)
    setMsg('')
    try {
      const res = await fetch('/api/backend-status', { method: 'POST' })
      const data = await res.json()
      setAlive(data.success)
      setMsg(data.message || '')
    } catch {
      setAlive(false)
      setMsg('请求失败')
    } finally {
      setRestarting(false)
    }
  }

  const dot = restarting ? 'bg-amber-400 animate-pulse' : alive ? 'bg-emerald-400' : alive === false ? 'bg-red-500' : 'bg-slate-300'
  const label = restarting ? '启动中…' : alive ? 'LLM 在线' : alive === false ? 'LLM 离线' : '检测中'

  return (
    <button
      onClick={restart}
      disabled={restarting}
      title={msg || (alive ? '点击重启 fake-llm' : '点击启动 fake-llm')}
      className="fixed top-3 right-4 z-[9999] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium bg-white/90 backdrop-blur border border-slate-200 shadow-md hover:shadow-lg transition-shadow disabled:opacity-70 select-none"
    >
      {restarting
        ? <RefreshCw className="w-3 h-3 text-amber-500 animate-spin" />
        : <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      }
      <span className={restarting ? 'text-amber-600' : alive ? 'text-emerald-700' : alive === false ? 'text-red-600' : 'text-slate-500'}>
        {label}
      </span>
    </button>
  )
}
