'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Send, Bot, User, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  elapsedMs?: number
  error?: boolean
}

export default function ChatBox() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return

    const history = [...messages, { role: 'user' as const, content: text }]
    setMessages(history)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (data.success) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.reply || '(空回复)', elapsedMs: data.elapsedMs },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `❌ 调用失败：${data.error}`, error: true },
        ])
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `❌ 网络错误：${err instanceof Error ? err.message : '未知'}`, error: true },
      ])
    } finally {
      setLoading(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm border-2 border-black overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b-2 border-black bg-gray-900">
        <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center">
          <Bot className="w-5 h-5 text-gray-900" />
        </div>
        <div>
          <h3 className="text-white font-bold">AI 对话测试窗口</h3>
          <p className="text-gray-400 text-xs">后台经本地假 API 调用（当前：Codex CLI）</p>
        </div>
      </div>

      <div ref={scrollRef} className="h-80 overflow-y-auto px-6 py-4 space-y-4 bg-gray-50">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm text-center">
            输入任意问题，测试后台 LLM 调用是否正常。<br />（Enter 发送，Shift+Enter 换行）
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`w-8 h-8 shrink-0 rounded-2xl flex items-center justify-center ${
                m.role === 'user' ? 'bg-blue-600' : m.error ? 'bg-red-500' : 'bg-gray-900'
              }`}
            >
              {m.role === 'user' ? (
                <User className="w-4 h-4 text-white" />
              ) : (
                <Bot className="w-4 h-4 text-white" />
              )}
            </div>
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : m.error
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-white text-gray-800 border-2 border-gray-200'
              }`}
            >
              {m.content}
              {m.elapsedMs != null && (
                <div className="text-[10px] text-gray-400 mt-1">耗时 {(m.elapsedMs / 1000).toFixed(1)}s</div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 shrink-0 rounded-2xl bg-gray-900 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div className="rounded-2xl px-4 py-2 bg-white border-2 border-gray-200 flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> 思考中…（Codex 约需 10-20 秒）
            </div>
          </div>
        )}
      </div>

      <div className="flex items-end gap-2 p-4 border-t-2 border-black bg-white">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="输入消息…"
          className="flex-1 resize-none rounded-2xl border-2 border-gray-300 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-black max-h-32"
        />
        <Button
          onClick={send}
          disabled={loading || !input.trim()}
          className="bg-gray-900 hover:bg-black text-white rounded-2xl px-4 py-2 h-auto"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  )
}
