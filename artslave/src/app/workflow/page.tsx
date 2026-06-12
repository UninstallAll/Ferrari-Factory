'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/ThemeContext'
import AppHeader from '@/components/AppHeader'
import {
  Play,
  Pause,
  Square,
  RefreshCw,
  Settings,
  Activity,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Workflow,
  Zap,
  Database,
  Send
} from 'lucide-react'

interface WorkflowStatus {
  id: string
  name: string
  status: 'running' | 'stopped' | 'error' | 'idle'
  lastRun?: string
  nextRun?: string
  executions: number
  description: string
}

interface ExecutionRecord {
  id: string
  workflowId: string
  workflowName: string
  status: 'running' | 'success' | 'error'
  startedAt: string
  stoppedAt?: string
  executionTime?: number
  mode: string
}

interface MonitorStats {
  totalExecutions: number
  activeWorkflows: number
  runningExecutions: number
  successfulExecutions: number
  failedExecutions: number
  averageExecutionTime: number
}

export default function WorkflowPage() {
  const { getThemeClasses } = useTheme()
  const themeClasses = getThemeClasses()
  const [workflows, setWorkflows] = useState<WorkflowStatus[]>([])
  const [executions, setExecutions] = useState<ExecutionRecord[]>([])
  const [monitorStats, setMonitorStats] = useState<MonitorStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [n8nStatus, setN8nStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [startingN8n, setStartingN8n] = useState(false)

  useEffect(() => {
    checkN8nStatus()
    loadWorkflows()
    loadMonitorData()
  }, [])

  useEffect(() => {
    if (autoRefresh) {
      const interval = setInterval(() => {
        loadMonitorData()
      }, 5000) // 每5秒刷新一次

      return () => clearInterval(interval)
    }
  }, [autoRefresh])

  const checkN8nStatus = async () => {
    try {
      const response = await fetch('/api/workflow/status')
      const data = await response.json()
      setN8nStatus(data.connected ? 'connected' : 'disconnected')
    } catch (error) {
      setN8nStatus('disconnected')
    }
  }

  const loadWorkflows = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/workflow/list')
      const data = await response.json()
      setWorkflows(data.workflows || [])
    } catch (error) {
      console.error('Failed to load workflows:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMonitorData = async () => {
    try {
      const response = await fetch('/api/workflow/monitor')
      const data = await response.json()
      if (data.success) {
        setExecutions(data.data.executions || [])
        setMonitorStats(data.data.stats || null)
      }
    } catch (error) {
      console.error('Failed to load monitor data:', error)
    }
  }

  const executeWorkflow = async (workflowId: string) => {
    try {
      const response = await fetch(`/api/workflow/execute/${workflowId}`, {
        method: 'POST'
      })
      const data = await response.json()
      if (data.success) {
        loadWorkflows() // 刷新状态
      }
    } catch (error) {
      console.error('Failed to execute workflow:', error)
    }
  }

  const startN8n = async () => {
    try {
      setStartingN8n(true)
      const response = await fetch('/api/workflow/start', {
        method: 'POST'
      })
      const data = await response.json()

      if (data.success) {
        // 启动成功，等待一下然后检查状态
        setTimeout(() => {
          checkN8nStatus()
          loadWorkflows()
        }, 2000)

        if (data.alreadyRunning) {
          alert('n8n 已经在运行中！')
        } else {
          alert('n8n 启动成功！请稍等片刻让服务完全启动。')
        }
      } else {
        alert(`启动失败：${data.message}\n建议：${data.suggestion || '请手动启动'}`)
      }
    } catch (error) {
      console.error('启动 n8n 失败:', error)
      alert('启动 n8n 失败，请手动在命令行中运行: npx n8n@latest start')
    } finally {
      setStartingN8n(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
        return <Activity className="w-5 h-5 text-green-500" />
      case 'stopped':
        return <Square className="w-5 h-5 text-gray-500" />
      case 'error':
        return <XCircle className="w-5 h-5 text-red-500" />
      default:
        return <Clock className="w-5 h-5 text-blue-500" />
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-green-100 text-green-800 border-green-200'
      case 'stopped':
        return 'bg-gray-100 text-gray-800 border-gray-200'
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200'
      default:
        return 'bg-blue-100 text-blue-800 border-blue-200'
    }
  }

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      <AppHeader
        titleKey="pages.workflow.title"
        subtitleKey="pages.workflow.subtitle"
        icon={Workflow}
        iconClassName="bg-emerald-600"
        right={
          <>
            <div className={`flex items-center space-x-2 px-4 py-2 rounded-2xl border-2 ${
              n8nStatus === 'connected'
                ? 'bg-green-100 text-green-800 border-green-200'
                : 'bg-red-100 text-red-800 border-red-200'
            }`}>
              <div className={`w-2 h-2 rounded-full ${n8nStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm font-medium">n8n {n8nStatus === 'connected' ? '已连接' : '未连接'}</span>
            </div>
            <Button
              onClick={() => setAutoRefresh(!autoRefresh)}
              variant={autoRefresh ? 'default' : 'outline'}
              className={`${themeClasses.button} rounded-2xl`}
            >
              <Activity className={`w-4 h-4 mr-2 ${autoRefresh ? 'animate-pulse' : ''}`} />
              {autoRefresh ? '自动刷新' : '手动模式'}
            </Button>
            <Button
              onClick={() => { checkN8nStatus(); loadMonitorData() }}
              className={`${themeClasses.button} rounded-2xl`}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新状态
            </Button>
          </>
        }
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* n8n 连接状态 */}
        {n8nStatus === 'disconnected' && (
          <div className={`mb-8 ${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 border-red-200`}>
            <div className="flex items-center space-x-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <h2 className="text-xl font-bold text-red-700">n8n 连接失败</h2>
            </div>
            <p className="text-red-600 mb-4">
              无法连接到 n8n 服务。请按照以下步骤启动 n8n：
            </p>

            <div className="space-y-4">
              {/* 方法一：推荐方法 */}
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <h3 className="font-bold text-blue-800 mb-2 flex items-center">
                  <Zap className="w-4 h-4 mr-2" />
                  方法一：使用 npx（推荐）
                </h3>
                <div className="bg-gray-900 p-3 rounded-xl font-mono text-sm text-green-400 mb-3">
                  <div>npx n8n@latest start</div>
                </div>
                <p className="text-blue-700 text-sm">
                  在任意命令行中运行上述命令，首次运行会自动下载最新版本的 n8n
                </p>
              </div>

              {/* 方法二：项目内启动 */}
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                <h3 className="font-bold text-green-800 mb-2 flex items-center">
                  <Settings className="w-4 h-4 mr-2" />
                  方法二：项目内启动
                </h3>
                <div className="bg-gray-900 p-3 rounded-xl font-mono text-sm text-green-400 mb-3">
                  <div>cd artslave</div>
                  <div>npm run n8n:start</div>
                </div>
                <p className="text-green-700 text-sm">
                  使用项目配置的 n8n 启动脚本，会自动配置数据目录和端口
                </p>
              </div>

              {/* 启动后的步骤 */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
                <h3 className="font-bold text-yellow-800 mb-2 flex items-center">
                  <CheckCircle className="w-4 h-4 mr-2" />
                  启动后的步骤
                </h3>
                <ol className="text-yellow-700 text-sm space-y-1 list-decimal list-inside">
                  <li>等待看到 &quot;Editor is now accessible&quot; 消息</li>
                  <li>访问 <a href="http://localhost:5678" target="_blank" className="text-blue-600 underline">http://localhost:5678</a> 设置管理员账户</li>
                  <li>返回此页面，点击&quot;刷新状态&quot;按钮</li>
                  <li>导入预设工作流文件（位于 artslave/n8n/workflows/ 目录）</li>
                </ol>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                onClick={startN8n}
                disabled={startingN8n}
                className="bg-green-600 hover:bg-green-700 text-white rounded-2xl"
              >
                {startingN8n ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    启动中...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 mr-2" />
                    一键启动 n8n
                  </>
                )}
              </Button>
              <Button
                onClick={checkN8nStatus}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-2xl"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                刷新状态
              </Button>
              <Button
                onClick={() => window.open('http://localhost:5678', '_blank')}
                variant="outline"
                className="rounded-2xl"
              >
                <Workflow className="w-4 h-4 mr-2" />
                打开 n8n
              </Button>
            </div>
          </div>
        )}

        {/* 实时监控面板 */}
        {monitorStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className={`${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 ${themeClasses.border}`}>
              <div className="flex items-center space-x-3 mb-2">
                <Activity className="w-6 h-6 text-green-600" />
                <h3 className={`text-lg font-bold ${themeClasses.textPrimary}`}>运行中</h3>
              </div>
              <div className={`text-3xl font-bold ${themeClasses.textPrimary}`}>
                {monitorStats.runningExecutions}
              </div>
              <p className={`text-sm ${themeClasses.textSecondary}`}>正在执行的工作流</p>
            </div>

            <div className={`${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 ${themeClasses.border}`}>
              <div className="flex items-center space-x-3 mb-2">
                <CheckCircle className="w-6 h-6 text-emerald-600" />
                <h3 className={`text-lg font-bold ${themeClasses.textPrimary}`}>成功执行</h3>
              </div>
              <div className={`text-3xl font-bold ${themeClasses.textPrimary}`}>
                {monitorStats.successfulExecutions}
              </div>
              <p className={`text-sm ${themeClasses.textSecondary}`}>成功完成的执行</p>
            </div>

            <div className={`${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 ${themeClasses.border}`}>
              <div className="flex items-center space-x-3 mb-2">
                <XCircle className="w-6 h-6 text-red-600" />
                <h3 className={`text-lg font-bold ${themeClasses.textPrimary}`}>执行失败</h3>
              </div>
              <div className={`text-3xl font-bold ${themeClasses.textPrimary}`}>
                {monitorStats.failedExecutions}
              </div>
              <p className={`text-sm ${themeClasses.textSecondary}`}>失败的执行</p>
            </div>

            <div className={`${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 ${themeClasses.border}`}>
              <div className="flex items-center space-x-3 mb-2">
                <Clock className="w-6 h-6 text-blue-600" />
                <h3 className={`text-lg font-bold ${themeClasses.textPrimary}`}>平均耗时</h3>
              </div>
              <div className={`text-3xl font-bold ${themeClasses.textPrimary}`}>
                {Math.round(monitorStats.averageExecutionTime / 1000)}s
              </div>
              <p className={`text-sm ${themeClasses.textSecondary}`}>平均执行时间</p>
            </div>
          </div>
        )}

        {/* 最近执行记录 */}
        {executions.length > 0 && (
          <div className={`${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 ${themeClasses.border} mb-8`}>
            <h2 className={`text-xl font-bold ${themeClasses.textPrimary} mb-6`}>最近执行记录</h2>
            <div className="space-y-3">
              {executions.slice(0, 5).map((execution) => (
                <div
                  key={execution.id}
                  className={`flex items-center justify-between p-4 rounded-2xl border ${themeClasses.border} ${themeClasses.cardBackground}`}
                >
                  <div className="flex items-center space-x-4">
                    {execution.status === 'running' && <Activity className="w-5 h-5 text-blue-500 animate-spin" />}
                    {execution.status === 'success' && <CheckCircle className="w-5 h-5 text-green-500" />}
                    {execution.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
                    <div>
                      <h4 className={`font-medium ${themeClasses.textPrimary}`}>
                        {execution.workflowName}
                      </h4>
                      <p className={`text-sm ${themeClasses.textSecondary}`}>
                        开始时间: {new Date(execution.startedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium border ${
                      execution.status === 'running' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                      execution.status === 'success' ? 'bg-green-100 text-green-800 border-green-200' :
                      'bg-red-100 text-red-800 border-red-200'
                    }`}>
                      {execution.status === 'running' ? '运行中' :
                       execution.status === 'success' ? '成功' : '失败'}
                    </span>
                    {execution.executionTime && (
                      <p className={`text-sm ${themeClasses.textSecondary} mt-1`}>
                        耗时: {Math.round(execution.executionTime / 1000)}s
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* n8n 连接成功状态 */}
        {n8nStatus === 'connected' && (
          <div className={`mb-8 ${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 border-green-200`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <CheckCircle className="w-6 h-6 text-green-500" />
                <div>
                  <h2 className="text-xl font-bold text-green-700">n8n 连接成功</h2>
                  <p className="text-green-600 text-sm">
                    工作流引擎正在运行，可以执行自动化任务
                  </p>
                </div>
              </div>
              <div className="flex space-x-3">
                <Button
                  onClick={() => window.open('http://localhost:5678', '_blank')}
                  className="bg-green-600 hover:bg-green-700 text-white rounded-2xl"
                >
                  <Workflow className="w-4 h-4 mr-2" />
                  打开 n8n 编辑器
                </Button>
                <Button
                  onClick={loadWorkflows}
                  variant="outline"
                  className="rounded-2xl"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  刷新工作流
                </Button>
              </div>
            </div>

            {/* 快速导入提示 */}
            <div className="mt-4 bg-green-50 border border-green-200 rounded-2xl p-4">
              <h3 className="font-bold text-green-800 mb-2 flex items-center">
                <Database className="w-4 h-4 mr-2" />
                导入预设工作流
              </h3>
              <p className="text-green-700 text-sm mb-2">
                在 n8n 编辑器中导入以下预设工作流文件：
              </p>
              <ul className="text-green-700 text-sm space-y-1 list-disc list-inside">
                <li>artslave/n8n/workflows/artslave-data-sync.json - 数据同步工作流</li>
                <li>artslave/n8n/workflows/submission-automation.json - 投递自动化工作流</li>
                <li>artslave/n8n/workflows/automated-crawler.json - 自动化爬虫工作流</li>
              </ul>
            </div>
          </div>
        )}

        {/* 工作流列表 */}
        <div className={`${themeClasses.cardBackground} rounded-3xl p-6 shadow-sm border-2 ${themeClasses.border}`}>
          <div className="flex items-center justify-between mb-6">
            <h2 className={`text-xl font-bold ${themeClasses.textPrimary}`}>工作流列表</h2>
            <Button
              onClick={loadWorkflows}
              className={`${themeClasses.button} rounded-2xl`}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>

          {loading ? (
            <div className="text-center py-8">
              <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-gray-400" />
              <p className={themeClasses.textSecondary}>加载工作流...</p>
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-8">
              <Workflow className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className={themeClasses.textSecondary}>暂无工作流</p>
            </div>
          ) : (
            <div className="space-y-4">
              {workflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className={`${themeClasses.cardBackground} rounded-2xl p-4 border-2 ${themeClasses.border} hover:shadow-md transition-all duration-200`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      {getStatusIcon(workflow.status)}
                      <div>
                        <h3 className={`font-bold ${themeClasses.textPrimary}`}>
                          {workflow.name}
                        </h3>
                        <p className={`text-sm ${themeClasses.textSecondary}`}>
                          {workflow.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(workflow.status)}`}>
                        {workflow.status === 'running' ? '运行中' : 
                         workflow.status === 'stopped' ? '已停止' : 
                         workflow.status === 'error' ? '错误' : '空闲'}
                      </span>
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          onClick={() => executeWorkflow(workflow.id)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl"
                          disabled={workflow.status === 'running'}
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                        >
                          <Settings className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  
                  {workflow.lastRun && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="flex justify-between text-sm text-gray-600">
                        <span>上次运行: {new Date(workflow.lastRun).toLocaleString()}</span>
                        <span>执行次数: {workflow.executions}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 快速操作 */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Button
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-2xl py-4 h-auto flex flex-col items-center space-y-2"
            onClick={() => window.open('http://localhost:5678', '_blank')}
          >
            <Settings className="w-6 h-6" />
            <span>打开 n8n 编辑器</span>
          </Button>

          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4 h-auto flex flex-col items-center space-y-2"
            onClick={() => executeWorkflow('data-sync')}
          >
            <Database className="w-6 h-6" />
            <span>数据同步</span>
          </Button>

          <Button
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-2xl py-4 h-auto flex flex-col items-center space-y-2"
            onClick={() => executeWorkflow('auto-submission')}
          >
            <Send className="w-6 h-6" />
            <span>自动投稿</span>
          </Button>

          <Button
            className="bg-orange-600 hover:bg-orange-700 text-white rounded-2xl py-4 h-auto flex flex-col items-center space-y-2"
            onClick={loadWorkflows}
          >
            <RefreshCw className="w-6 h-6" />
            <span>刷新状态</span>
          </Button>
        </div>
      </main>
    </div>
  )
}
