'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Save, Calendar } from 'lucide-react'
import { getDatabaseAPI } from '@/lib/database'
import type { SubmissionData } from '@/lib/database'

interface SubmissionFormProps {
  submission?: SubmissionData | null
  onClose: () => void
  onSave: (submission: SubmissionData) => void
}

export default function SubmissionForm({ submission, onClose, onSave }: SubmissionFormProps) {
  const { getThemeClasses } = useTheme()
  const themeClasses = getThemeClasses()
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [formData, setFormData] = useState({
    title: '',
    type: 'EXHIBITION' as 'EXHIBITION' | 'RESIDENCY' | 'COMPETITION' | 'GRANT' | 'CONFERENCE',
    organizer: '',
    location: '',
    country: '',
    deadline: '',
    eventDate: '',
    fee: '',
    prize: '',
    yearsRunning: '1',
    description: '',
    website: '',
    email: '',
    phone: '',
    tags: '',
    isGold: false,
    isFeatured: false,
    isActive: true
  })

  const db = getDatabaseAPI()

  useEffect(() => {
    if (submission) {
      setFormData({
        title: submission.title || '',
        type: (submission.type || 'EXHIBITION') as 'EXHIBITION' | 'RESIDENCY' | 'COMPETITION' | 'GRANT' | 'CONFERENCE',
        organizer: submission.organizer || '',
        location: submission.location || '',
        country: submission.country || '',
        deadline: submission.deadline || '',
        eventDate: submission.eventDate || '',
        fee: submission.fee?.toString() || '',
        prize: submission.prize || '',
        yearsRunning: submission.yearsRunning?.toString() || '1',
        description: submission.description || '',
        website: submission.website || '',
        email: submission.email || '',
        phone: submission.phone || '',
        tags: submission.tags?.join(', ') || '',
        isGold: submission.isGold || false,
        isFeatured: submission.isFeatured || false,
        isActive: submission.isActive !== false
      })
    }
  }, [submission])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // 验证必填字段
    const validationErrors: string[] = []
    if (!formData.title.trim()) {
      validationErrors.push('请填写标题')
    }
    if (!formData.organizer.trim()) {
      validationErrors.push('请填写主办方')
    }
    if (!formData.deadline) {
      validationErrors.push('请选择截止日期')
    }

    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    setErrors([])
    setLoading(true)

    try {
      const submissionData = {
        title: formData.title,
        type: formData.type,
        organizer: formData.organizer,
        location: formData.location,
        country: formData.country,
        deadline: formData.deadline,
        eventDate: formData.eventDate || undefined,
        fee: formData.fee ? parseFloat(formData.fee) : undefined,
        prize: formData.prize || undefined,
        yearsRunning: parseInt(formData.yearsRunning) || 1,
        description: formData.description,
        website: formData.website,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        tags: formData.tags.split(',').map(tag => tag.trim()).filter(tag => tag),
        isGold: formData.isGold,
        isFeatured: formData.isFeatured,
        isActive: formData.isActive
      }

      let result
      if (submission) {
        // Update existing submission
        result = await db.updateSubmission(submission.id, submissionData)
      } else {
        // Add new submission
        result = await db.addSubmission(submissionData)
      }

      if (result) {
        onSave(result)
        onClose()
      } else {
        alert('保存失败')
      }
    } catch (error) {
      console.error('Save failed:', error)
      alert('保存失败')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className={`w-full max-w-4xl max-h-[90vh] overflow-y-auto ${themeClasses.cardBackground}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className={themeClasses.textPrimary}>
              {submission ? '编辑投稿信息' : '添加投稿信息'}
            </CardTitle>
            <CardDescription className={themeClasses.textSecondary}>
              {submission ? '修改现有投稿信息' : '创建新的投稿信息'}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="rounded-lg"
          >
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6" data-testid="submission-form">
            {/* 错误信息显示 */}
            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="text-red-800 text-sm">
                  {errors.map((error, index) => (
                    <div key={index}>{error}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Basic Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="title" className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  标题 *
                </label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入投稿信息标题"
                  required
                />
              </div>

              <div>
                <label htmlFor="type" className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  类型 *
                </label>
                <select
                  id="type"
                  value={formData.type}
                  onChange={(e) => handleChange('type', e.target.value)}
                  className={`w-full ${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl px-3 py-2`}
                  required
                >
                  <option value="EXHIBITION">艺术展览</option>
                  <option value="RESIDENCY">驻地项目</option>
                  <option value="COMPETITION">比赛征集</option>
                  <option value="GRANT">资助项目</option>
                  <option value="CONFERENCE">学术会议</option>
                </select>
              </div>

              <div>
                <label htmlFor="organizer" className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  主办方 *
                </label>
                <Input
                  id="organizer"
                  value={formData.organizer}
                  onChange={(e) => handleChange('organizer', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入主办方名称"
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  地点 *
                </label>
                <Input
                  value={formData.location}
                  onChange={(e) => handleChange('location', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入举办地点"
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  国家 *
                </label>
                <Input
                  value={formData.country}
                  onChange={(e) => handleChange('country', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入国家"
                  required
                />
              </div>

              <div>
                <label htmlFor="deadline" className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  截止日期 *
                </label>
                <Input
                  id="deadline"
                  type="date"
                  value={formData.deadline}
                  onChange={(e) => handleChange('deadline', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  required
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  活动日期
                </label>
                <Input
                  type="date"
                  value={formData.eventDate}
                  onChange={(e) => handleChange('eventDate', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  费用
                </label>
                <Input
                  type="number"
                  value={formData.fee}
                  onChange={(e) => handleChange('fee', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入费用（数字）"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  奖项
                </label>
                <Input
                  value={formData.prize}
                  onChange={(e) => handleChange('prize', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入奖项信息"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  举办年数
                </label>
                <Input
                  type="number"
                  value={formData.yearsRunning}
                  onChange={(e) => handleChange('yearsRunning', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入举办年数"
                  min="1"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  网站
                </label>
                <Input
                  type="url"
                  value={formData.website}
                  onChange={(e) => handleChange('website', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入官方网站"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  邮箱
                </label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入联系邮箱"
                />
              </div>

              <div>
                <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                  电话
                </label>
                <Input
                  value={formData.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                  placeholder="输入联系电话"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                描述
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                className={`w-full ${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl px-3 py-2 min-h-[100px]`}
                placeholder="输入详细描述"
              />
            </div>

            {/* Tags */}
            <div>
              <label className={`block text-sm font-medium ${themeClasses.textPrimary} mb-2`}>
                标签
              </label>
              <Input
                value={formData.tags}
                onChange={(e) => handleChange('tags', e.target.value)}
                className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl`}
                placeholder="输入标签，用逗号分隔"
              />
            </div>

            {/* Flags */}
            <div className="flex space-x-6">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isGold}
                  onChange={(e) => handleChange('isGold', e.target.checked)}
                  className="rounded"
                />
                <span className={`text-sm ${themeClasses.textPrimary}`}>金牌推荐</span>
              </label>

              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isFeatured}
                  onChange={(e) => handleChange('isFeatured', e.target.checked)}
                  className="rounded"
                />
                <span className={`text-sm ${themeClasses.textPrimary}`}>特色推荐</span>
              </label>

              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => handleChange('isActive', e.target.checked)}
                  className="rounded"
                />
                <span className={`text-sm ${themeClasses.textPrimary}`}>启用状态</span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className={`rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover}`}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className={`${themeClasses.button} rounded-2xl`}
              >
                {loading ? (
                  <>保存中...</>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    保存
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
