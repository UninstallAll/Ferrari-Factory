import { NextRequest, NextResponse } from 'next/server'
import { resolveSeed, ResolveInput } from '@/lib/graphSearch/resolver'

// 上传体积上限(图片/PDF base64)
export const maxDuration = 300

// POST: 把多模态起点输入解析成 {seedName, seedType, summary}
export async function POST(request: NextRequest) {
  const start = Date.now()
  try {
    const body = await request.json()
    const kind = body.kind as ResolveInput['kind']

    let input: ResolveInput
    switch (kind) {
      case 'text':
        input = { kind: 'text', text: String(body.text || '') }
        break
      case 'url':
        input = { kind: 'url', url: String(body.url || '').trim() }
        if (!/^https?:\/\//i.test((input as any).url)) {
          return NextResponse.json({ success: false, error: '请输入有效的 http(s) 链接' }, { status: 400 })
        }
        break
      case 'pdf':
        input = { kind: 'pdf', dataBase64: String(body.dataBase64 || ''), filename: body.filename }
        break
      case 'image':
        input = { kind: 'image', dataUrl: String(body.dataUrl || ''), filename: body.filename }
        break
      default:
        return NextResponse.json({ success: false, error: 'kind 必须是 text|url|pdf|image' }, { status: 400 })
    }

    const resolved = await resolveSeed(input)
    return NextResponse.json({ success: true, ...resolved, elapsedMs: Date.now() - start })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error', elapsedMs: Date.now() - start },
      { status: 500 }
    )
  }
}
