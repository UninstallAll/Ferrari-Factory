import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// GET: 取某次运行的完整图(run + nodes + edges)，前端轮询用
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params
    const run = await prisma.graphRun.findUnique({ where: { id: runId } })
    if (!run) {
      return NextResponse.json({ success: false, error: '运行不存在' }, { status: 404 })
    }

    const [nodes, edges, logs] = await Promise.all([
      prisma.graphNode.findMany({ where: { runId }, orderBy: { importance: 'desc' } }),
      prisma.graphEdge.findMany({ where: { runId } }),
      prisma.graphLog.findMany({ where: { runId }, orderBy: { seq: 'asc' } }),
    ])

    return NextResponse.json({
      success: true,
      run,
      nodes: nodes.map((n) => ({
        ...n,
        data: safeParse(n.data),
      })),
      edges: edges.map((e) => ({
        ...e,
        evidence: safeParse(e.evidence),
      })),
      logs: logs.map((l) => ({ seq: l.seq, level: l.level, message: l.message, createdAt: l.createdAt })),
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// PATCH: 停止运行 / 删除运行
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params
    const body = await request.json()
    if (body.action === 'stop') {
      await prisma.graphRun.update({ where: { id: runId }, data: { status: 'stopped', message: '已手动停止' } })
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ success: false, error: '未知 action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params
    await prisma.graphRun.delete({ where: { id: runId } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

function safeParse(s: string | null): any {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
