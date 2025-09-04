'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ThemeSelector from '@/components/ThemeSelector'
import {
  Database,
  Play,
  Pause,
  Plus,
  Search,
  Globe,
  Activity,
  CheckCircle,
  ArrowLeft,
  RefreshCw,
  Edit,
  Trash2,
  BarChart3
} from 'lucide-react'

interface DataSource {
  id: string
  name: string
  url: string
  type: 'website' | 'api' | 'rss'
  category: string
  isActive: boolean
  lastCrawled?: string
  crawlFreq: number
  itemsFound: number
  status: 'idle' | 'running' | 'completed' | 'failed'
}

interface CrawlJob {
  id: string
  dataSourceName: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  itemsFound: number
  itemsAdded: number
}

interface CrawlerStats {
  totalSources: number
  activeSources: number
  totalJobs: number
  successfulJobs: number
  totalItemsCollected: number
  lastUpdate: string
}

interface SchedulerStatus {
  running: boolean
  startTime: string | null
  lastCheck: string | null
  error: string | null
  uptime: number
  uptimeFormatted: string
}

interface N8nStatus {
  running: boolean
  startTime: string | null
  port: number
  url: string
  error: string | null
  pid: number | null
  uptime: number
  uptimeFormatted: string
  isInstalled: boolean
}

export default function DataCollectionPage() {
  const { getThemeClasses } = useTheme()
  const themeClasses = getThemeClasses()
  
  const [dataSources, setDataSources] = useState<DataSource[]>([])
  const [crawlJobs, setCrawlJobs] = useState<CrawlJob[]>([])
  const [stats, setStats] = useState<CrawlerStats>({
    totalSources: 0,
    activeSources: 0,
    totalJobs: 0,
    successfulJobs: 0,
    totalItemsCollected: 0,
    lastUpdate: new Date().toISOString()
  })
  
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus>({
    running: false,
    startTime: null,
    lastCheck: null,
    error: null,
    uptime: 0,
    uptimeFormatted: '0秒'
  })
  const [n8nStatus, setN8nStatus] = useState<N8nStatus>({
    running: false,
    startTime: null,
    port: 5678,
    url: 'http://localhost:5678',
    error: null,
    pid: null,
    uptime: 0,
    uptimeFormatted: '0秒',
    isInstalled: false
  })

  useEffect(() => {
    loadDataSources()
    loadCrawlJobs()
    loadStats()
    loadSchedulerStatus()
    loadN8nStatus()

    // 每30秒更新一次状态
    const interval = setInterval(() => {
      loadSchedulerStatus()
      loadN8nStatus()
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadDataSources = async () => {
    try {
      const response = await fetch('/api/datasources')
      const data = await response.json()
      if (data.success) {
        setDataSources(data.data)
      } else {
        console.error('Failed to load data sources:', data.error)
      }
    } catch (error) {
      console.error('Failed to load data sources:', error)
      // Fallback to mock data
      setDataSources([
        {
          id: '1',
          name: 'FilmFreeway 艺术节',
          url: 'https://filmfreeway.com/festivals',
          type: 'website',
          category: '艺术展览',
          isActive: true,
          lastCrawled: '2025-01-08 10:30',
          crawlFreq: 24,
          itemsFound: 156,
          status: 'completed'
        },
        {
          id: '2',
          name: '中国美术馆展览',
          url: 'http://www.namoc.org',
          type: 'website',
          category: '艺术展览',
          isActive: true,
          lastCrawled: '2025-01-08 09:15',
          crawlFreq: 12,
          itemsFound: 23,
          status: 'completed'
        },
        {
          id: '3',
          name: 'Artsy 展览信息',
          url: 'https://www.artsy.net',
          type: 'api',
          category: '艺术展览',
          isActive: false,
          crawlFreq: 6,
          itemsFound: 0,
          status: 'idle'
        }
      ])
    }
  }

  const loadCrawlJobs = async () => {
    setCrawlJobs([
      {
        id: '1',
        dataSourceName: 'FilmFreeway 艺术节',
        status: 'completed',
        startedAt: '2025-01-08 10:30',
        completedAt: '2025-01-08 10:45',
        itemsFound: 156,
        itemsAdded: 12
      },
      {
        id: '2',
        dataSourceName: '中国美术馆展览',
        status: 'completed', 
        startedAt: '2025-01-08 09:15',
        completedAt: '2025-01-08 09:25',
        itemsFound: 23,
        itemsAdded: 5
      }
    ])
  }

  const loadStats = async () => {
    try {
      const response = await fetch('/api/datasources')
      const data = await response.json()
      if (data.success) {
        const sources = data.data
        setStats({
          totalSources: sources.length,
          activeSources: sources.filter((s: any) => s.isActive).length,
          totalJobs: 15,
          successfulJobs: 13,
          totalItemsCollected: sources.reduce((sum: number, s: any) => sum + s.itemsFound, 0),
          lastUpdate: new Date().toISOString()
        })
      }
    } catch (error) {
      console.error('Failed to load stats:', error)
      // Fallback to mock data
      setStats({
        totalSources: 3,
        activeSources: 2,
        totalJobs: 15,
        successfulJobs: 13,
        totalItemsCollected: 1250,
        lastUpdate: new Date().toISOString()
      })
    }
  }

  const loadSchedulerStatus = async () => {
    try {
      const response = await fetch('/api/scheduler?action=status')
      const data = await response.json()
      if (response.ok && data.status) {
        setSchedulerStatus(data.status)
      } else {
        // 设置默认状态
        setSchedulerStatus({
          running: false,
          startTime: null,
          lastCheck: null,
          error: null,
          uptime: 0,
          uptimeFormatted: '0秒'
        })
      }
    } catch (error) {
      console.error('Failed to load scheduler status:', error)
      // 设置默认状态
      setSchedulerStatus({
        running: false,
        startTime: null,
        lastCheck: null,
        error: null,
        uptime: 0,
        uptimeFormatted: '0秒'
      })
    }
  }

  const handleStartScheduler = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      })
      const data = await response.json()
      if (response.ok) {
        await loadSchedulerStatus()
        console.log('调度器启动成功')
      } else {
        console.error('启动调度器失败:', data.error)
      }
    } catch (error) {
      console.error('启动调度器失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleStopScheduler = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      })
      const data = await response.json()
      if (response.ok) {
        await loadSchedulerStatus()
        console.log('调度器停止成功')
      } else {
        console.error('停止调度器失败:', data.error)
      }
    } catch (error) {
      console.error('停止调度器失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleForceCheck = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'force-check' })
      })
      const data = await response.json()
      if (response.ok) {
        console.log('强制检查完成')
        await loadCrawlJobs()
      } else {
        console.error('强制检查失败:', data.error)
      }
    } catch (error) {
      console.error('强制检查失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // n8n 管理函数
  const loadN8nStatus = async () => {
    try {
      const response = await fetch('/api/n8n?action=status')
      const data = await response.json()
      if (response.ok && data.status) {
        setN8nStatus(data.status)
      } else {
        // 设置默认状态
        setN8nStatus({
          running: false,
          startTime: null,
          port: 5678,
          url: 'http://localhost:5678',
          error: null,
          pid: null,
          uptime: 0,
          uptimeFormatted: '0秒',
          isInstalled: false
        })
      }
    } catch (error) {
      console.error('Failed to load n8n status:', error)
      // 设置默认状态
      setN8nStatus({
        running: false,
        startTime: null,
        port: 5678,
        url: 'http://localhost:5678',
        error: null,
        pid: null,
        uptime: 0,
        uptimeFormatted: '0秒',
        isInstalled: false
      })
    }
  }

  const handleStartN8n = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/n8n', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      })
      const data = await response.json()
      if (response.ok) {
        await loadN8nStatus()
        console.log('n8n 启动脚本已执行')
        alert(
          'n8n 启动脚本已执行！\n\n' +
          '请查看新打开的命令行窗口：\n' +
          '1. 如果 n8n 已安装，将直接启动（几秒钟）\n' +
          '2. 如果是首次运行，需要下载安装（5-10分钟）\n' +
          '3. 看到 "n8n should be available" 表示启动成功\n' +
          '4. 然后点击"打开 n8n"按钮访问界面\n\n' +
          '脚本会自动检测最佳启动方式，无需重复下载。'
        )
      } else {
        console.error('启动 n8n 失败:', data.error)
        const shouldCheckEnv = confirm(
          'n8n 启动脚本执行失败。\n\n' +
          '可能的原因：\n' +
          '1. Node.js 未安装或未添加到 PATH\n' +
          '2. 网络连接问题\n' +
          '3. 端口被占用\n\n' +
          '是否要查看环境检查和安装指南？'
        )
        if (shouldCheckEnv) {
          window.open('/scripts/NODEJS_INSTALL_GUIDE.md', '_blank')
        }
      }
    } catch (error) {
      console.error('启动 n8n 失败:', error)
      alert(
        'n8n 启动失败。\n\n' +
        '请尝试手动启动：\n' +
        '1. 运行: scripts/n8n-quick-start.ps1 (推荐)\n' +
        '2. 或双击: scripts/start-n8n.bat (兼容版)\n' +
        '3. 或命令行: npx n8n@latest start\n' +
        '4. 访问: http://localhost:5678'
      )
    } finally {
      setLoading(false)
    }
  }

  const handleStopN8n = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/n8n', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      })
      const data = await response.json()
      if (response.ok) {
        await loadN8nStatus()
        console.log('n8n 停止成功')
      } else {
        console.error('停止 n8n 失败:', data.error)
      }
    } catch (error) {
      console.error('停止 n8n 失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleInstallN8n = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/n8n', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'install' })
      })
      const data = await response.json()
      if (response.ok) {
        await loadN8nStatus()
        console.log('n8n 安装成功')
        alert('n8n 安装成功！')
      } else {
        console.error('安装 n8n 失败:', data.error)
        if (data.manualInstall) {
          const manualInstall = confirm(
            'n8n 自动安装失败。是否要查看手动安装说明？\n\n' +
            '手动安装步骤：\n' +
            '1. 打开命令行（以管理员身份运行）\n' +
            '2. 运行: npm install -g n8n\n' +
            '3. 等待安装完成后刷新页面'
          )
          if (manualInstall) {
            window.open('https://docs.n8n.io/getting-started/installation/', '_blank')
          }
        } else {
          alert(`安装失败: ${data.error}`)
        }
      }
    } catch (error) {
      console.error('安装 n8n 失败:', error)
      alert('安装失败，请检查网络连接或手动安装 n8n')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenN8n = () => {
    if (n8nStatus?.running && n8nStatus?.url) {
      window.open(n8nStatus.url, '_blank')
    }
  }

  const handleRunCrawler = async (sourceId: string) => {
    setLoading(true)
    try {
      console.log('Running crawler for source:', sourceId)
      await new Promise(resolve => setTimeout(resolve, 1000))
      await loadCrawlJobs()
    } catch (error) {
      console.error('Failed to run crawler:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRunAllCrawlers = async () => {
    setLoading(true)
    try {
      console.log('Running all crawlers')
      await new Promise(resolve => setTimeout(resolve, 2000))
      await loadCrawlJobs()
    } catch (error) {
      console.error('Failed to run all crawlers:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-blue-600 bg-blue-100'
      case 'completed': return 'text-green-600 bg-green-100'
      case 'failed': return 'text-red-600 bg-red-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'website': return <Globe className="w-4 h-4" />
      case 'api': return <Database className="w-4 h-4" />
      case 'rss': return <Activity className="w-4 h-4" />
      default: return <Database className="w-4 h-4" />
    }
  }

  const filteredSources = dataSources.filter(source => {
    const matchesSearch = source.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         source.url.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesFilter = filterType === 'all' || source.type === filterType
    return matchesSearch && matchesFilter
  })

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      {/* Header */}
      <div className={`${themeClasses.cardBackground} border-b-2 ${themeClasses.border} sticky top-0 z-10`}>
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = '/'}
                className={`rounded-lg border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary}`}
              >
                <ArrowLeft className="w-3 h-3 mr-1" />
                返回
              </Button>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center">
                  <Database className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className={`text-lg font-bold ${themeClasses.textPrimary}`}>数据收集管理</h1>
                  <p className={`text-xs ${themeClasses.textSecondary}`}>管理爬虫和数据源</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <ThemeSelector />
              <Button
                className={`${themeClasses.button} rounded-lg text-xs px-3 py-1`}
              >
                <Plus className="w-3 h-3 mr-1" />
                添加数据源
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Scheduler Status */}
        <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border} mb-6`}>
          <CardHeader className="pb-3">
            <CardTitle className={`text-base ${themeClasses.textPrimary} flex items-center space-x-2`}>
              <Activity className="w-5 h-5" />
              <span>自动监控调度器</span>
            </CardTitle>
            <CardDescription className={`text-xs ${themeClasses.textSecondary}`}>
              定时监控网站并自动执行爬虫任务
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${
                  schedulerStatus?.running
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`} data-testid="scheduler-status">
                  <div className={`w-2 h-2 rounded-full ${
                    schedulerStatus?.running ? 'bg-green-500' : 'bg-gray-500'
                  }`} />
                  <span>{schedulerStatus?.running ? '运行中' : '已停止'}</span>
                </div>
                {schedulerStatus?.running && (
                  <div className={`text-xs ${themeClasses.textSecondary}`}>
                    运行时间: {schedulerStatus?.uptimeFormatted || '0秒'}
                  </div>
                )}
                {schedulerStatus.error && (
                  <div className="text-xs text-red-600">
                    错误: {schedulerStatus.error}
                  </div>
                )}
              </div>
              <div className="flex space-x-2">
                {schedulerStatus.running ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleStopScheduler}
                    disabled={loading}
                    className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} text-xs px-3 py-1`}
                  >
                    <Pause className="w-3 h-3 mr-1" />
                    停止
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleStartScheduler}
                    disabled={loading}
                    className={`${themeClasses.button} rounded-lg text-xs px-3 py-1`}
                  >
                    <Play className="w-3 h-3 mr-1" />
                    启动
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleForceCheck}
                  disabled={loading}
                  className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} text-xs px-3 py-1`}
                >
                  <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  立即检查
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* n8n Workflow Management */}
        <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border} mb-6`}>
          <CardHeader className="pb-3">
            <CardTitle className={`text-base ${themeClasses.textPrimary} flex items-center space-x-2`}>
              <Activity className="w-5 h-5" />
              <span>n8n 工作流自动化</span>
            </CardTitle>
            <CardDescription className={`text-xs ${themeClasses.textSecondary}`}>
              管理和运行 n8n 工作流，实现数据收集和投稿流程自动化
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className={`flex items-center space-x-2 px-3 py-1 rounded-full text-sm ${
                  n8nStatus?.running
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    n8nStatus?.running ? 'bg-green-500' : 'bg-gray-500'
                  }`} />
                  <span>{n8nStatus?.running ? '运行中' : '已停止'}</span>
                </div>
                {n8nStatus?.running && (
                  <div className={`text-xs ${themeClasses.textSecondary}`}>
                    运行时间: {n8nStatus?.uptimeFormatted || '0秒'} | 端口: {n8nStatus?.port || 5678}
                  </div>
                )}
                {!n8nStatus?.isInstalled && (
                  <div className="text-xs text-orange-600 flex items-center space-x-2">
                    <span>建议手动启动 n8n</span>
                    <button
                      onClick={() => window.open('/n8n/MANUAL_START.md', '_blank')}
                      className="text-blue-600 hover:text-blue-800 underline"
                      title="查看手动启动指南"
                    >
                      启动指南
                    </button>
                  </div>
                )}
                {n8nStatus?.error && (
                  <div className="text-xs text-red-600">
                    错误: {n8nStatus.error}
                  </div>
                )}
              </div>
              <div className="flex space-x-2">
                {n8nStatus?.running ? (
                  <>
                    <Button
                      size="sm"
                      onClick={handleOpenN8n}
                      className={`${themeClasses.button} rounded-lg text-xs px-3 py-1`}
                    >
                      <Globe className="w-3 h-3 mr-1" />
                      打开 n8n
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStopN8n}
                      disabled={loading}
                      className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} text-xs px-3 py-1`}
                    >
                      <Pause className="w-3 h-3 mr-1" />
                      停止
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleStartN8n}
                    disabled={loading}
                    className={`${themeClasses.button} rounded-lg text-xs px-3 py-1`}
                  >
                    <Play className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
                    {loading ? '执行中...' : '启动 n8n (新窗口)'}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs ${themeClasses.textSecondary}`}>数据源总数</p>
                  <p className={`text-lg font-bold ${themeClasses.textPrimary}`}>{stats.totalSources}</p>
                </div>
                <Database className="w-6 h-6 text-cyan-600" />
              </div>
            </CardContent>
          </Card>

          <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs ${themeClasses.textSecondary}`}>活跃数据源</p>
                  <p className={`text-lg font-bold ${themeClasses.textPrimary}`}>{stats.activeSources}</p>
                </div>
                <Activity className="w-6 h-6 text-green-600" />
              </div>
            </CardContent>
          </Card>

          <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs ${themeClasses.textSecondary}`}>成功任务</p>
                  <p className={`text-lg font-bold ${themeClasses.textPrimary}`}>{stats.successfulJobs}/{stats.totalJobs}</p>
                </div>
                <CheckCircle className="w-6 h-6 text-blue-600" />
              </div>
            </CardContent>
          </Card>

          <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border}`}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-xs ${themeClasses.textSecondary}`}>收集数据</p>
                  <p className={`text-lg font-bold ${themeClasses.textPrimary}`}>{stats.totalItemsCollected}</p>
                </div>
                <BarChart3 className="w-6 h-6 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3" />
                <Input
                  placeholder="搜索数据源..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className={`pl-7 py-1.5 text-sm rounded-lg border-2 ${themeClasses.border} ${themeClasses.inputFocus}`}
                />
              </div>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className={`px-2 py-1.5 text-sm rounded-lg border-2 ${themeClasses.border} ${themeClasses.input} ${themeClasses.inputFocus}`}
              >
                <option value="all">所有类型</option>
                <option value="website">网站</option>
                <option value="api">API</option>
                <option value="rss">RSS</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleRunAllCrawlers}
              disabled={loading}
              className={`${themeClasses.button} rounded-lg text-xs px-3 py-1.5`}
            >
              {loading ? (
                <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Play className="w-3 h-3 mr-1" />
              )}
              运行全部
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                loadDataSources()
                loadCrawlJobs()
                loadStats()
              }}
              className={`rounded-lg border-2 ${themeClasses.border} ${themeClasses.buttonHover} text-xs px-3 py-1.5`}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              刷新
            </Button>
          </div>
        </div>

        {/* Data Sources Table */}
        <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border} mb-6`}>
          <CardHeader className="pb-3">
            <CardTitle className={`text-base ${themeClasses.textPrimary}`}>数据源管理</CardTitle>
            <CardDescription className={`text-xs ${themeClasses.textSecondary}`}>
              管理和监控所有数据源 ({filteredSources.length} 个)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`border-b ${themeClasses.border}`}>
                    <th className={`text-left py-2 px-4 text-xs font-medium ${themeClasses.textPrimary}`}>数据源</th>
                    <th className={`text-left py-2 px-4 text-xs font-medium ${themeClasses.textPrimary}`}>类型</th>
                    <th className={`text-left py-2 px-4 text-xs font-medium ${themeClasses.textPrimary}`}>状态</th>
                    <th className={`text-left py-2 px-4 text-xs font-medium ${themeClasses.textPrimary}`}>最后爬取</th>
                    <th className={`text-left py-2 px-4 text-xs font-medium ${themeClasses.textPrimary}`}>数据量</th>
                    <th className={`text-left py-2 px-4 text-xs font-medium ${themeClasses.textPrimary}`}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSources.map((source) => (
                    <tr key={source.id} className={`border-b ${themeClasses.border} hover:bg-gray-50`}>
                      <td className="py-2 px-4">
                        <div>
                          <div className={`text-sm font-medium ${themeClasses.textPrimary}`}>{source.name}</div>
                          <div className={`text-xs ${themeClasses.textSecondary} truncate max-w-48`}>{source.url}</div>
                        </div>
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex items-center space-x-1">
                          {getTypeIcon(source.type)}
                          <span className={`text-xs ${themeClasses.textSecondary}`}>{source.type}</span>
                        </div>
                      </td>
                      <td className="py-2 px-4">
                        <span className={`inline-block px-2 py-1 rounded-full text-xs ${getStatusColor(source.status)}`}>
                          {source.status}
                        </span>
                      </td>
                      <td className="py-2 px-4">
                        <span className={`text-xs ${themeClasses.textSecondary}`}>
                          {source.lastCrawled || '从未'}
                        </span>
                      </td>
                      <td className="py-2 px-4">
                        <span className={`text-xs ${themeClasses.textPrimary} font-medium`}>
                          {source.itemsFound}
                        </span>
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex space-x-1">
                          <Button
                            size="sm"
                            onClick={() => handleRunCrawler(source.id)}
                            disabled={loading || source.status === 'running'}
                            className={`${themeClasses.button} rounded-lg px-2 py-1 text-xs`}
                          >
                            {source.status === 'running' ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} px-2 py-1`}
                          >
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} px-2 py-1 text-red-600 hover:text-red-700`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent Jobs */}
        <Card className={`${themeClasses.cardBackground} border-2 ${themeClasses.border}`}>
          <CardHeader className="pb-3">
            <CardTitle className={`text-base ${themeClasses.textPrimary}`}>最近任务</CardTitle>
            <CardDescription className={`text-xs ${themeClasses.textSecondary}`}>
              最近的爬虫执行记录
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="space-y-3">
              {crawlJobs.slice(0, 5).map((job) => (
                <div key={job.id} className={`flex items-center justify-between p-3 rounded-lg border ${themeClasses.border}`}>
                  <div className="flex items-center space-x-3">
                    <div className={`w-2 h-2 rounded-full ${
                      job.status === 'completed' ? 'bg-green-500' :
                      job.status === 'running' ? 'bg-blue-500' :
                      job.status === 'failed' ? 'bg-red-500' : 'bg-gray-500'
                    }`} />
                    <div>
                      <p className={`text-sm font-medium ${themeClasses.textPrimary}`}>{job.dataSourceName}</p>
                      <p className={`text-xs ${themeClasses.textSecondary}`}>
                        {job.startedAt} - 收集 {job.itemsAdded} 条数据
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(job.status)}`}>
                    {job.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
