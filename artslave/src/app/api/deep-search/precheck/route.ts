import { NextRequest, NextResponse } from 'next/server'
import { precheckQuery } from '@/lib/graphSearch/precheck'

export const maxDuration = 60

export async function POST(request: NextRequest) {
  const start = Date.now()
  try {
    const body = await request.json()
    const query = String(body.query || body.text || '').trim()
    if (!query) {
      return NextResponse.json({ success: false, error: 'query 不能为空' }, { status: 400 })
    }
    const precheck = await precheckQuery(query, body.typeHint)
    return NextResponse.json({ success: true, ...precheck, elapsedMs: Date.now() - start })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error', elapsedMs: Date.now() - start },
      { status: 500 }
    )
  }
}

