'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Database,
  Plus,
  Search,
  Edit,
  Trash2,
  Eye,
  Filter,
  Download,
  Upload,
  RefreshCw,
  CheckSquare,
  Square,
  Trash,
  FileDown,
  Star,
  Archive,
  Bot,
  Zap
} from 'lucide-react'
import ThemeSelector from '@/components/ThemeSelector'
import SubmissionForm from '@/components/SubmissionForm'
import { getDatabaseAPI } from '@/lib/database'
import type { SubmissionData } from '@/lib/database'

export default function DataManagementPage() {
  const { getThemeClasses } = useTheme()
  const themeClasses = getThemeClasses()
  const [submissions, setSubmissions] = useState<SubmissionData[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingSubmission, setEditingSubmission] = useState<SubmissionData | null>(null)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showBatchActions, setShowBatchActions] = useState(false)

  const db = getDatabaseAPI()

  useEffect(() => {
    loadSubmissions()
  }, [])

  const loadSubmissions = async () => {
    setLoading(true)
    try {
      const data = await db.getAllSubmissions()
      setSubmissions(data)
    } catch (error) {
      console.error('Failed to load submissions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadSubmissions()
      return
    }
    
    setLoading(true)
    try {
      const data = await db.searchSubmissions(searchQuery)
      setSubmissions(data)
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFilter = async () => {
    if (!selectedType) {
      loadSubmissions()
      return
    }
    
    setLoading(true)
    try {
      const data = await db.getSubmissionsByType(selectedType)
      setSubmissions(data)
    } catch (error) {
      console.error('Filter failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条投稿信息吗？')) return

    try {
      const success = await db.deleteSubmission(id)
      if (success) {
        setSubmissions((submissions || []).filter(s => s.id !== id))
      } else {
        alert('删除失败')
      }
    } catch (error) {
      console.error('Delete failed:', error)
      alert('删除失败')
    }
  }

  const handleSaveSubmission = (savedSubmission: SubmissionData) => {
    if (editingSubmission) {
      // Update existing submission
      setSubmissions((submissions || []).map(s =>
        s.id === savedSubmission.id ? savedSubmission : s
      ))
    } else {
      // Add new submission
      setSubmissions([savedSubmission, ...(submissions || [])])
    }
    setEditingSubmission(null)
    setShowAddForm(false)
  }

  // Batch management functions
  const handleSelectAll = () => {
    if (selectedItems.size === (submissions || []).length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set((submissions || []).map(s => s.id)))
    }
  }

  const handleSelectItem = (id: string) => {
    const newSelected = new Set(selectedItems)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedItems(newSelected)
  }

  const handleBatchDelete = async () => {
    if (selectedItems.size === 0) return

    const confirmed = confirm(`确定要删除选中的 ${selectedItems.size} 条投稿信息吗？`)
    if (!confirmed) return

    try {
      const deletePromises = Array.from(selectedItems).map(id => db.deleteSubmission(id))
      await Promise.all(deletePromises)

      setSubmissions((submissions || []).filter(s => !selectedItems.has(s.id)))
      setSelectedItems(new Set())
      alert(`成功删除 ${selectedItems.size} 条记录`)
    } catch (error) {
      console.error('Batch delete failed:', error)
      alert('批量删除失败')
    }
  }

  const handleBatchExport = () => {
    if (selectedItems.size === 0) return

    const selectedSubmissions = submissions.filter(s => selectedItems.has(s.id))
    const csvContent = generateCSV(selectedSubmissions)
    downloadCSV(csvContent, `submissions_${new Date().toISOString().split('T')[0]}.csv`)
  }

  const generateCSV = (data: SubmissionData[]) => {
    const headers = ['标题', '类型', '主办方', '地点', '截止日期', '网址', '描述', '金牌推荐']
    const rows = data.map(item => [
      item.title,
      getTypeLabel(item.type),
      item.organizer,
      item.location,
      item.deadline,
      item.website || '',
      item.description || '',
      item.isGold ? '是' : '否'
    ])

    return [headers, ...rows].map(row =>
      row.map(field => `"${field}"`).join(',')
    ).join('\n')
  }

  const downloadCSV = (content: string, filename: string) => {
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleBatchMarkGold = async () => {
    if (selectedItems.size === 0) return

    const confirmed = confirm(`确定要将选中的 ${selectedItems.size} 条投稿信息标记为金牌推荐吗？`)
    if (!confirmed) return

    try {
      const updatedSubmissions = submissions.map(submission => {
        if (selectedItems.has(submission.id)) {
          return { ...submission, isGold: true }
        }
        return submission
      })

      // Update in database (assuming we have batch update API)
      const updatePromises = Array.from(selectedItems).map(id => {
        const submission = submissions.find(s => s.id === id)
        if (submission) {
          return db.updateSubmission(id, { ...submission, isGold: true })
        }
      })

      await Promise.all(updatePromises.filter(Boolean))
      setSubmissions(updatedSubmissions)
      setSelectedItems(new Set())
      alert(`成功标记 ${selectedItems.size} 条记录为金牌推荐`)
    } catch (error) {
      console.error('Batch mark gold failed:', error)
      alert('批量标记失败')
    }
  }

  const handleBatchUnmarkGold = async () => {
    if (selectedItems.size === 0) return

    const confirmed = confirm(`确定要取消选中的 ${selectedItems.size} 条投稿信息的金牌推荐标记吗？`)
    if (!confirmed) return

    try {
      const updatedSubmissions = submissions.map(submission => {
        if (selectedItems.has(submission.id)) {
          return { ...submission, isGold: false }
        }
        return submission
      })

      // Update in database
      const updatePromises = Array.from(selectedItems).map(id => {
        const submission = submissions.find(s => s.id === id)
        if (submission) {
          return db.updateSubmission(id, { ...submission, isGold: false })
        }
      })

      await Promise.all(updatePromises.filter(Boolean))
      setSubmissions(updatedSubmissions)
      setSelectedItems(new Set())
      alert(`成功取消 ${selectedItems.size} 条记录的金牌推荐标记`)
    } catch (error) {
      console.error('Batch unmark gold failed:', error)
      alert('批量取消标记失败')
    }
  }

  const getTypeLabel = (type: string) => {
    const typeMap: Record<string, string> = {
      'EXHIBITION': '艺术展览',
      'RESIDENCY': '驻地项目',
      'COMPETITION': '比赛征集',
      'GRANT': '资助项目',
      'CONFERENCE': '学术会议'
    }
    return typeMap[type] || type
  }

  const getTypeColor = (type: string) => {
    const colorMap: Record<string, string> = {
      'EXHIBITION': 'bg-blue-100 text-blue-800',
      'RESIDENCY': 'bg-green-100 text-green-800',
      'COMPETITION': 'bg-purple-100 text-purple-800',
      'GRANT': 'bg-orange-100 text-orange-800',
      'CONFERENCE': 'bg-gray-100 text-gray-800'
    }
    return colorMap[type] || 'bg-gray-100 text-gray-800'
  }

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      {/* Header */}
      <div className={`${themeClasses.cardBackground} border-b-2 ${themeClasses.border} sticky top-0 z-10`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-purple-600 rounded-2xl flex items-center justify-center">
                <Database className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className={`text-2xl font-bold ${themeClasses.textPrimary}`}>数据库管理</h1>
                <p className={`text-sm ${themeClasses.textSecondary}`}>管理投稿信息数据</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <ThemeSelector />
              <Button 
                variant="outline" 
                className={`rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200`}
                onClick={() => window.location.href = '/'}
                title="返回主页"
              >
                返回主页
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* InfoReceiver 测试按钮 */}
        <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6 mb-6`}>
          <div className="text-center">
            <div className="mb-4">
              <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-4">
                <Bot className="w-8 h-8 text-white" />
              </div>
              <h3 className={`text-xl font-bold ${themeClasses.textPrimary} mb-2`}>InfoReceiver 智能信息处理系统</h3>
              <p className={`${themeClasses.textSecondary} mb-6`}>
                测试 AI 驱动的信息接收、解析和处理功能
              </p>
            </div>
            <Button
              onClick={() => window.open('/test-info-receiver', '_blank')}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-8 py-4 rounded-2xl text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105"
            >
              <Zap className="w-6 h-6 mr-3" />
              启动 InfoReceiver 测试
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6 mb-6`}>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            {/* Search */}
            <div className="md:col-span-2">
              <div className="flex space-x-2">
                <Input
                  placeholder="搜索投稿信息..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                />
                <Button
                  onClick={handleSearch}
                  className={`${themeClasses.button} rounded-2xl px-4`}
                >
                  <Search className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Type Filter */}
            <div>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className={`w-full ${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl px-3 py-2`}
              >
                <option value="">所有类型</option>
                <option value="EXHIBITION">艺术展览</option>
                <option value="RESIDENCY">驻地项目</option>
                <option value="COMPETITION">比赛征集</option>
                <option value="GRANT">资助项目</option>
                <option value="CONFERENCE">学术会议</option>
              </select>
            </div>

            {/* Actions */}
            <div className="flex space-x-2">
              <Button
                onClick={handleFilter}
                className={`${themeClasses.button} rounded-2xl px-4`}
              >
                <Filter className="w-4 h-4" />
              </Button>
              <Button
                onClick={loadSubmissions}
                className={`${themeClasses.button} rounded-2xl px-4`}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => setShowAddForm(true)}
              className={`${themeClasses.button} rounded-2xl`}
            >
              <Plus className="w-4 h-4 mr-2" />
              添加投稿
            </Button>
            <Button
              variant="outline"
              className={`rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover}`}
            >
              <Upload className="w-4 h-4 mr-2" />
              导入数据
            </Button>
            <Button
              variant="outline"
              className={`rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover}`}
            >
              <Download className="w-4 h-4 mr-2" />
              导出全部
            </Button>

            {/* Batch Management Toggle */}
            <Button
              variant={showBatchActions ? "default" : "outline"}
              onClick={() => {
                setShowBatchActions(!showBatchActions)
                setSelectedItems(new Set())
              }}
              className={`rounded-2xl border-2 ${themeClasses.border} ${showBatchActions ? themeClasses.button : themeClasses.buttonHover}`}
            >
              <CheckSquare className="w-4 h-4 mr-2" />
              批量管理
            </Button>
          </div>

          {/* Batch Actions Bar */}
          {showBatchActions && (
            <div className={`mt-4 p-4 ${themeClasses.cardBackground} border-2 ${themeClasses.border} rounded-2xl`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSelectAll}
                    className="rounded-lg"
                  >
                    {selectedItems.size === submissions.length ? (
                      <CheckSquare className="w-4 h-4 mr-2" />
                    ) : (
                      <Square className="w-4 h-4 mr-2" />
                    )}
                    {selectedItems.size === submissions.length ? '取消全选' : '全选'}
                  </Button>
                  <span className={`text-sm ${themeClasses.textSecondary}`}>
                    已选择 {selectedItems.size} 项
                  </span>
                </div>

                {selectedItems.size > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBatchExport}
                      className="rounded-lg"
                    >
                      <FileDown className="w-4 h-4 mr-2" />
                      导出选中
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBatchMarkGold}
                      className="rounded-lg text-yellow-600 hover:text-yellow-700 border-yellow-200 hover:border-yellow-300"
                    >
                      <Star className="w-4 h-4 mr-2" />
                      标记金牌
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBatchUnmarkGold}
                      className="rounded-lg text-gray-600 hover:text-gray-700 border-gray-200 hover:border-gray-300"
                    >
                      <Archive className="w-4 h-4 mr-2" />
                      取消金牌
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBatchDelete}
                      className="rounded-lg text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                    >
                      <Trash className="w-4 h-4 mr-2" />
                      删除选中
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Statistics Summary */}
        {showBatchActions && submissions.length > 0 && (
          <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6 mb-6`}>
            <h3 className={`text-lg font-semibold ${themeClasses.textPrimary} mb-4`}>数据统计</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="text-center">
                <div className={`text-2xl font-bold ${themeClasses.textPrimary}`}>{submissions.length}</div>
                <div className={`text-sm ${themeClasses.textSecondary}`}>总计</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold text-yellow-600`}>
                  {submissions.filter(s => s.isGold).length}
                </div>
                <div className={`text-sm ${themeClasses.textSecondary}`}>金牌推荐</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold text-blue-600`}>
                  {submissions.filter(s => s.type === 'EXHIBITION').length}
                </div>
                <div className={`text-sm ${themeClasses.textSecondary}`}>艺术展览</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold text-green-600`}>
                  {submissions.filter(s => s.type === 'RESIDENCY').length}
                </div>
                <div className={`text-sm ${themeClasses.textSecondary}`}>驻地项目</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold text-purple-600`}>
                  {submissions.filter(s => s.type === 'COMPETITION').length}
                </div>
                <div className={`text-sm ${themeClasses.textSecondary}`}>比赛征集</div>
              </div>
            </div>
          </div>
        )}

        {/* Data Table */}
        <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} overflow-hidden`}>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className={`text-lg font-semibold ${themeClasses.textPrimary}`}>
                投稿信息列表 ({(submissions || []).length} 条)
              </h2>
              {showBatchActions && selectedItems.size > 0 && (
                <div className={`text-sm ${themeClasses.textSecondary} bg-blue-50 px-3 py-1 rounded-full`}>
                  已选择 {selectedItems.size} / {(submissions || []).length} 条
                </div>
              )}
            </div>
            
            {loading ? (
              <div className="text-center py-8">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2 text-gray-400" />
                <p className={themeClasses.textSecondary}>加载中...</p>
              </div>
            ) : (submissions || []).length === 0 ? (
              <div className="text-center py-8">
                <Database className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                <p className={themeClasses.textSecondary}>暂无数据</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className={`border-b ${themeClasses.border}`}>
                      {showBatchActions && (
                        <th className={`text-left py-3 px-4 font-medium ${themeClasses.textPrimary} w-12`}>
                          <button
                            onClick={handleSelectAll}
                            className="p-1 hover:bg-gray-100 rounded"
                          >
                            {selectedItems.size === submissions.length ? (
                              <CheckSquare className="w-4 h-4" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </th>
                      )}
                      <th className={`text-left py-3 px-4 font-medium ${themeClasses.textPrimary}`}>标题</th>
                      <th className={`text-left py-3 px-4 font-medium ${themeClasses.textPrimary}`}>类型</th>
                      <th className={`text-left py-3 px-4 font-medium ${themeClasses.textPrimary}`}>主办方</th>
                      <th className={`text-left py-3 px-4 font-medium ${themeClasses.textPrimary}`}>地点</th>
                      <th className={`text-left py-3 px-4 font-medium ${themeClasses.textPrimary}`}>截止日期</th>
                      <th className={`text-left py-3 px-4 font-medium ${themeClasses.textPrimary}`}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((submission) => (
                      <tr
                        key={submission.id}
                        className={`border-b ${themeClasses.border} hover:bg-gray-50 ${
                          selectedItems.has(submission.id) ? 'bg-blue-50' : ''
                        }`}
                      >
                        {showBatchActions && (
                          <td className="py-3 px-4">
                            <button
                              onClick={() => handleSelectItem(submission.id)}
                              className="p-1 hover:bg-gray-100 rounded"
                            >
                              {selectedItems.has(submission.id) ? (
                                <CheckSquare className="w-4 h-4 text-blue-600" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>
                        )}
                        <td className={`py-3 px-4 ${themeClasses.textPrimary}`}>
                          <div className="font-medium">{submission.title}</div>
                          {submission.isGold && (
                            <span className="inline-block bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full mt-1">
                              金牌推荐
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-block px-2 py-1 rounded-full text-xs ${getTypeColor(submission.type)}`}>
                            {getTypeLabel(submission.type)}
                          </span>
                        </td>
                        <td className={`py-3 px-4 ${themeClasses.textSecondary}`}>{submission.organizer}</td>
                        <td className={`py-3 px-4 ${themeClasses.textSecondary}`}>{submission.location}</td>
                        <td className={`py-3 px-4 ${themeClasses.textSecondary}`}>{submission.deadline}</td>
                        <td className="py-3 px-4">
                          <div className="flex space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg"
                              onClick={() => {/* View details */}}
                            >
                              <Eye className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg"
                              onClick={() => setEditingSubmission(submission)}
                            >
                              <Edit className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg text-red-600 hover:text-red-700"
                              onClick={() => handleDelete(submission.id)}
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
            )}
          </div>
        </div>
      </div>

      {/* Add/Edit Form Modal */}
      {(showAddForm || editingSubmission) && (
        <SubmissionForm
          submission={editingSubmission}
          onClose={() => {
            setShowAddForm(false)
            setEditingSubmission(null)
          }}
          onSave={handleSaveSubmission}
        />
      )}
    </div>
  )
}
