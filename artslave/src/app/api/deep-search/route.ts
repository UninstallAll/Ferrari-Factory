import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runDeepSearch } from '@/lib/graphSearch/engine'
import { NODE_TYPES } from '@/lib/graphSearch/types'

// POST: 启动一次深度搜索(异步，立即返回 runId；引擎在后台跑并增量写库)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const seedName = String(body.seedName || '').trim()
    const seedType = String(body.seedType || 'artist').trim()

    if (!seedName) {
      return NextResponse.json({ success: false, error: '缺少 seedName' }, { status: 400 })
    }
    if (!(NODE_TYPES as string[]).includes(seedType)) {
      return NextResponse.json(
        { success: false, error: `seedType 必须是: ${NODE_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const maxDepth = Math.min(Math.max(parseInt(body.maxDepth) || 2, 1), 4)
    const maxPerLevel = Math.min(Math.max(parseInt(body.maxPerLevel) || 6, 1), 15)

    const run = await prisma.graphRun.create({
      data: { seedName, seedType, maxDepth, maxPerLevel, status: 'pending' },
    })

    // 后台执行(不 await)。dev 环境下 Node 进程常驻，promise 会继续跑。
    runDeepSearch(run.id).catch((err) => console.error('runDeepSearch error:', err))

    return NextResponse.json({ success: true, runId: run.id })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// GET: 最近的搜索运行列表
export async function GET() {
  try {
    const runs = await prisma.graphRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    return NextResponse.json({ success: true, runs })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
