import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

// 简单问答接口：用于测试后台 LLM 调用(当前指向本地假 API / Codex CLI)
// 请求: { messages: [{role, content}] } 或 { message: string }
// 返回: { success, reply, elapsedMs }

export async function POST(request: NextRequest) {
  const start = Date.now()
  try {
    const body = await request.json()

    let messages = body.messages
    if (!messages && typeof body.message === 'string') {
      messages = [{ role: 'user', content: body.message }]
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { success: false, error: '缺少 messages 或 message 字段' },
        { status: 400 }
      )
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'fake-local-key',
      baseURL: process.env.OPENAI_BASE_URL || undefined,
      timeout: 180000, // Codex CLI 调用较慢，给足超时
    })

    const completion = await client.chat.completions.create({
      model: body.model || 'deepseek-chat',
      messages,
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
    })

    const reply = completion.choices?.[0]?.message?.content ?? ''

    return NextResponse.json({
      success: true,
      reply,
      model: completion.model,
      elapsedMs: Date.now() - start,
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        elapsedMs: Date.now() - start,
      },
      { status: 500 }
    )
  }
}
