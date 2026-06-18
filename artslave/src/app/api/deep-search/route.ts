import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { runDeepSearch } from '@/lib/graphSearch/engine'
import { NODE_TYPES } from '@/lib/graphSearch/types'

function parseHttpUrls(input: unknown): string[] {
  const candidates: string[] = []
  if (Array.isArray(input)) {
    for (const item of input) candidates.push(String(item || '').trim())
  } else if (typeof input === 'string') {
    candidates.push(...input.split(/[\n\s]+/).map((s) => s.trim()).filter(Boolean))
  }
  const valid: string[] = []
  for (const raw of candidates) {
    const s = raw.replace(/^[,;，；、。！？""''…【】《》（）]+/, '').replace(/[,;，；、。！？""''…【】《》（）]+$/, '').trim()
    try {
      const u = new URL(s)
      if (u.protocol === 'http:' || u.protocol === 'https:') valid.push(u.href)
    } catch { /* 忽略非法 URL */ }
  }
  return [...new Set(valid)].slice(0, 20)
}

function crawlRunLabel(urls: string[]): string {
  if (urls.length === 1) {
    try {
      return new URL(urls[0]).hostname
    } catch {
      return urls[0]
    }
  }
  const hosts = urls
    .map((u) => {
      try {
        return new URL(u).hostname
      } catch {
        return u
      }
    })
    .slice(0, 3)
  const suffix = urls.length > 3 ? ` 等 ${urls.length} 站` : ''
  return hosts.join(' · ') + suffix
}

// POST: 启动一次深度搜索(异步，立即返回 runId；引擎在后台跑并增量写库)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const seedUrls = parseHttpUrls(body.seedUrls ?? body.seedUrl)
    const maxDepth = Math.min(Math.max(parseInt(body.maxDepth) || 2, 1), 10)
    const maxPerLevel = Math.min(Math.max(parseInt(body.maxPerLevel) || 6, 1), 10)

    // 爬取模式：给定网址 → 自动翻页抓取真实正文 → 批量抽取实体 → 深挖
    if (seedUrls.length > 0) {
      const crawlPageMode = body.crawlPageMode === 'fixed' ? 'fixed' : 'auto'
      const crawlPages = crawlPageMode === 'auto'
        ? Math.min(Math.max(parseInt(body.crawlPages) || 50, 1), 50)
        : Math.min(Math.max(parseInt(body.crawlPages) || 4, 1), 20)
      const crawlGoal = String(body.crawlGoal || '').trim().slice(0, 500) || null
      const crawlBackend = body.crawlBackend === 'firecrawl' ? 'firecrawl' : 'agentic'
      const label = String(body.seedName || '').trim() || crawlRunLabel(seedUrls)
      const run = await prisma.graphRun.create({
        data: {
          seedName: label,
          seedType: 'institution',
          seedUrl: seedUrls[0],
          seedUrls: JSON.stringify(seedUrls),
          crawlPageMode,
          crawlPages,
          crawlGoal,
          crawlBackend,
          maxDepth,
          maxPerLevel,
          status: 'pending',
        },
      })
      runDeepSearch(run.id).catch((err) => console.error('runDeepSearch error:', err))
      return NextResponse.json({ success: true, runId: run.id })
    }

    // 定点深挖：从用户选中的若干现有节点出发，按名字检索真实资料继续向下深搜
    const seedNodes = Array.isArray(body.seedNodes)
      ? body.seedNodes
          .map((n: any) => ({
            name: String(n?.name || '').trim(),
            type: String(n?.type || '').toLowerCase().trim(),
            identity: n?.identity && typeof n.identity === 'object' ? n.identity : null,
          }))
          .filter((n: { name: string; type: string }) => n.name && (NODE_TYPES as string[]).includes(n.type))
      : []
    if (seedNodes.length > 0) {
      const seen = new Set<string>()
      const uniq = seedNodes.filter((n: { name: string; type: string; identity?: any }) => {
        const wd = n.identity?.wikidataId ? `:${String(n.identity.wikidataId).toLowerCase()}` : ''
        const k = `${n.type}:${n.name.toLowerCase()}${wd}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      const label =
        `定点深挖：` +
        uniq.slice(0, 3).map((n: { name: string }) => n.name).join('、') +
        (uniq.length > 3 ? ` 等 ${uniq.length} 点` : '')
      const run = await prisma.graphRun.create({
        data: {
          seedName: label,
          seedType: uniq[0].type,
          seedNodes: JSON.stringify(uniq),
          maxDepth,
          maxPerLevel,
          status: 'pending',
        },
      })
      runDeepSearch(run.id).catch((err) => console.error('runDeepSearch error:', err))
      return NextResponse.json({ success: true, runId: run.id })
    }

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
