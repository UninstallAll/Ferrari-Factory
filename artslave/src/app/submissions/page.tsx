'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTheme } from '@/contexts/ThemeContext'
import ThemeSelector from '@/components/ThemeSelector'
import { 
  Search,
  Filter,
  MapPin,
  Calendar,
  Clock,
  Star,
  Award,
  Globe,
  ArrowLeft,
  ExternalLink,
  Heart,
  Share2,
  Eye,
  DollarSign,
  Users,
  Bookmark
} from 'lucide-react'

interface SubmissionInfo {
  id: string
  title: string
  organizer: string
  type: 'EXHIBITION' | 'RESIDENCY' | 'COMPETITION' | 'GRANT' | 'CONFERENCE'
  location: string
  country: string
  deadline: string
  eventDate?: string
  fee?: number
  prize?: string
  yearsRunning: number
  description: string
  website: string
  tags: string[]
  isGold?: boolean
  isFeatured?: boolean
  logo?: string
  rating?: number
  applicants?: number
}

export default function SubmissionsPage() {
  const { getThemeClasses } = useTheme()
  const themeClasses = getThemeClasses()

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedType, setSelectedType] = useState('all')
  const [selectedCountry, setSelectedCountry] = useState('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sortBy, setSortBy] = useState('deadline')
  const [loading, setLoading] = useState(true)

  const [submissions, setSubmissions] = useState<SubmissionInfo[]>([])

  // 获取投稿数据
  useEffect(() => {
    fetchSubmissions()
  }, [])

  const fetchSubmissions = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/submissions')
      const result = await response.json()

      if (result.success && Array.isArray(result.data)) {
        setSubmissions(result.data)
      } else {
        console.error('获取投稿数据失败:', result.error)
        setSubmissions([]) // 确保设置为空数组
      }
    } catch (error) {
      console.error('获取投稿数据失败:', error)
      setSubmissions([]) // 确保设置为空数组
    } finally {
      setLoading(false)
    }
  }

  const getTypeLabel = (type: string) => {
    const labels = {
      'EXHIBITION': '艺术展览',
      'RESIDENCY': '驻地项目',
      'COMPETITION': '比赛征集',
      'GRANT': '资助项目',
      'CONFERENCE': '学术会议'
    }
    return labels[type as keyof typeof labels] || type
  }

  const getTypeColor = (type: string) => {
    const colors = {
      'EXHIBITION': 'bg-blue-100 text-blue-800',
      'RESIDENCY': 'bg-green-100 text-green-800',
      'COMPETITION': 'bg-orange-100 text-orange-800',
      'GRANT': 'bg-purple-100 text-purple-800',
      'CONFERENCE': 'bg-gray-100 text-gray-800'
    }
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }

  const formatDeadline = (deadline: string) => {
    const date = new Date(deadline)
    const now = new Date()
    const diffTime = date.getTime() - now.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays < 0) return '已截止'
    if (diffDays === 0) return '今天截止'
    if (diffDays === 1) return '明天截止'
    if (diffDays <= 7) return `${diffDays}天后截止`
    
    return date.toLocaleDateString('zh-CN', { 
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    })
  }

  const filteredSubmissions = (submissions || []).filter(submission => {
    const matchesSearch = submission.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         submission.organizer.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (submission.tags || []).some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase()))

    const matchesType = selectedType === 'all' || submission.type === selectedType
    const matchesCountry = selectedCountry === 'all' || submission.country === selectedCountry

    return matchesSearch && matchesType && matchesCountry
  })

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      {/* Header */}
      <header className={`${themeClasses.cardBackground} border-b-2 ${themeClasses.border}`}>
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = '/'}
                className={`p-2 ${themeClasses.cardBackground} border-2 ${themeClasses.border} ${themeClasses.buttonHover} rounded-lg transition-all duration-200`}
                title="返回主页"
              >
                <ArrowLeft className={`w-4 h-4 ${themeClasses.textPrimary}`} />
              </Button>
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <Eye className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h1 className={`text-lg font-bold ${themeClasses.textPrimary}`}>投稿信息展示</h1>
                  <p className={`text-xs ${themeClasses.textSecondary}`}>发现适合您的艺术机会</p>
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <ThemeSelector />
              <Button variant="outline" size="sm" className={`rounded-lg border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary}`}>
                <Heart className="w-3 h-3 mr-1" />
                收藏
              </Button>
              <Button variant="outline" size="sm" className={`rounded-lg border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary}`}>
                <Share2 className="w-3 h-3 mr-1" />
                分享
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Featured Categories */}
      <div className="bg-white border-b-2 border-black">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center space-x-1 cursor-pointer hover:shadow-md transition-all duration-200">
              <Award className="w-3 h-3" />
              <span>金牌推荐</span>
            </div>
            <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center space-x-1 cursor-pointer hover:shadow-md transition-all duration-200">
              <Star className="w-3 h-3" />
              <span>热门推荐</span>
            </div>
            <div className="bg-gradient-to-r from-green-500 to-teal-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center space-x-1 cursor-pointer hover:shadow-md transition-all duration-200">
              <Clock className="w-3 h-3" />
              <span>即将截止</span>
            </div>
            <div className="bg-gradient-to-r from-pink-500 to-rose-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center space-x-1 cursor-pointer hover:shadow-md transition-all duration-200">
              <Globe className="w-3 h-3" />
              <span>国际机会</span>
            </div>
            <div className="bg-gradient-to-r from-indigo-500 to-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center space-x-1 cursor-pointer hover:shadow-md transition-all duration-200">
              <DollarSign className="w-3 h-3" />
              <span>免费申请</span>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex gap-4">
          {/* Left Sidebar - Filters */}
          <div className="w-64 flex-shrink-0">
            <div className={`${themeClasses.cardBackground} rounded-2xl border-2 ${themeClasses.border} p-4 sticky top-4`}>
              <h3 className={`text-base font-bold ${themeClasses.textPrimary} mb-4`}>筛选条件</h3>

              {/* Search */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">搜索</label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 w-3 h-3" />
                  <Input
                    placeholder="搜索标题、机构..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-7 py-1.5 text-sm rounded-lg border-2 border-gray-200 hover:border-gray-300 focus:border-cyan-500 focus:outline-none transition-all duration-200"
                  />
                </div>
              </div>

              {/* Type Filter */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">类型</label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border-2 border-gray-200 bg-white hover:border-gray-300 focus:border-cyan-500 focus:outline-none transition-all duration-200"
                  data-testid="type-filter"
                >
                  <option value="all">所有类型</option>
                  <option value="EXHIBITION">艺术展览</option>
                  <option value="RESIDENCY">驻地项目</option>
                  <option value="COMPETITION">比赛征集</option>
                  <option value="GRANT">资助项目</option>
                  <option value="CONFERENCE">学术会议</option>
                </select>
              </div>

              {/* Country Filter */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-700 mb-1">国家/地区</label>
                <select
                  value={selectedCountry}
                  onChange={(e) => setSelectedCountry(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm rounded-lg border-2 border-gray-200 bg-white hover:border-gray-300 focus:border-cyan-500 focus:outline-none transition-all duration-200"
                >
                  <option value="all">所有国家</option>
                  <option value="中国">中国</option>
                  <option value="美国">美国</option>
                  <option value="英国">英国</option>
                  <option value="法国">法国</option>
                  <option value="德国">德国</option>
                </select>
              </div>

              {/* Sort */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">排序方式</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full px-4 py-2 rounded-2xl border-2 border-gray-200 bg-white hover:border-gray-300 focus:border-cyan-500 focus:outline-none transition-all duration-200"
                >
                  <option value="deadline">截止日期</option>
                  <option value="rating">评分最高</option>
                  <option value="popular">最受欢迎</option>
                  <option value="newest">最新发布</option>
                  <option value="fee_low">费用最低</option>
                </select>
              </div>

              {/* Quick Filters */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-700">快速筛选</h4>
                <div className="space-y-2">
                  <label className="flex items-center">
                    <input type="checkbox" className="rounded mr-2" />
                    <span className="text-sm text-gray-600">免费申请</span>
                  </label>
                  <label className="flex items-center">
                    <input type="checkbox" className="rounded mr-2" />
                    <span className="text-sm text-gray-600">有奖金</span>
                  </label>
                  <label className="flex items-center">
                    <input type="checkbox" className="rounded mr-2" />
                    <span className="text-sm text-gray-600">国际认可</span>
                  </label>
                  <label className="flex items-center">
                    <input type="checkbox" className="rounded mr-2" />
                    <span className="text-sm text-gray-600">新手友好</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            {/* Results Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <h2 className="text-base font-bold text-gray-900">
                  找到 {filteredSubmissions.length} 个机会
                </h2>
                <div className="flex items-center space-x-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200 text-xs px-2 py-1"
                  >
                    <Filter className="w-3 h-3 mr-1" />
                    筛选
                  </Button>
                </div>
              </div>
            </div>

            {/* Submissions Grid */}
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                    <p className={`text-sm ${themeClasses.textSecondary}`}>正在加载投稿信息...</p>
                  </div>
                </div>
              ) : filteredSubmissions.length === 0 ? (
                <div className="text-center py-8">
                  <p className={`text-base ${themeClasses.textSecondary}`}>暂无投稿信息</p>
                  <p className={`text-xs ${themeClasses.textSecondary} mt-1`}>请尝试调整筛选条件或稍后再试</p>
                </div>
              ) : (
                filteredSubmissions.map((submission) => (
                <div key={submission.id} className={`${themeClasses.cardBackground} rounded-xl border-2 ${themeClasses.border} p-3 hover:shadow-md transition-all duration-200`}>
                  <div className="flex gap-3">
                    {/* Logo/Image */}
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
                      <div className="text-white text-sm font-bold">
                        {submission.title.charAt(0)}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <h3 className={`text-sm font-bold ${themeClasses.textPrimary} ${themeClasses.accent} cursor-pointer truncate`}>
                              {submission.title}
                            </h3>
                            {submission.isGold && (
                              <div className="bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-1 py-0.5 rounded text-xs font-semibold flex-shrink-0">
                                GOLD
                              </div>
                            )}
                            {submission.isFeatured && (
                              <div className="bg-gradient-to-r from-pink-500 to-rose-600 text-white px-1 py-0.5 rounded text-xs font-semibold flex-shrink-0">
                                推荐
                              </div>
                            )}
                          </div>
                          <p className={`text-xs ${themeClasses.textSecondary} mb-1 truncate`}>{submission.organizer}</p>
                          <div className={`flex items-center space-x-3 text-xs ${themeClasses.textSecondary} mb-2`}>
                            <div className="flex items-center space-x-1">
                              <MapPin className="w-3 h-3" />
                              <span className="truncate">{submission.location}</span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <Calendar className="w-3 h-3" />
                              <span>{submission.yearsRunning}年</span>
                            </div>
                            {submission.rating && (
                              <div className="flex items-center space-x-1">
                                <Star className="w-3 h-3 text-yellow-500 fill-current" />
                                <span>{submission.rating}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 ml-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className={`p-1 rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200`}
                          >
                            <Bookmark className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className={`p-1 rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200`}
                          >
                            <Share2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Type and Tags */}
                      <div className="flex items-center space-x-2 mb-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getTypeColor(submission.type)}`}>
                          {getTypeLabel(submission.type)}
                        </span>
                        {submission.tags.slice(0, 2).map((tag, index) => (
                          <span key={index} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Bottom Info */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 text-xs">
                          <div className="flex items-center space-x-1 text-red-600 font-medium">
                            <Clock className="w-3 h-3" />
                            <span>{formatDeadline(submission.deadline)}</span>
                          </div>
                          {submission.fee !== undefined && (
                            <div className="flex items-center space-x-1 text-gray-600">
                              <DollarSign className="w-3 h-3" />
                              <span>{submission.fee === 0 ? '免费' : `¥${submission.fee}`}</span>
                            </div>
                          )}
                          {submission.prize && (
                            <div className="flex items-center space-x-1 text-green-600">
                              <Award className="w-3 h-3" />
                              <span className="truncate max-w-20">{submission.prize}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} text-xs px-2 py-1`}
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            详情
                          </Button>
                          <Button size="sm" className={`${themeClasses.button} rounded-lg px-3 py-1 text-xs transition-all duration-200`}>
                            申请
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                ))
              )}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-center mt-6 space-x-1">
              <Button variant="outline" size="sm" className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} text-xs px-2 py-1`}>
                上一页
              </Button>
              <Button size="sm" className={`${themeClasses.button} rounded-lg px-2 py-1 text-xs`}>1</Button>
              <Button variant="outline" size="sm" className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} text-xs px-2 py-1`}>2</Button>
              <Button variant="outline" size="sm" className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} text-xs px-2 py-1`}>3</Button>
              <Button variant="outline" size="sm" className={`rounded-lg border ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} text-xs px-2 py-1`}>
                下一页
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
