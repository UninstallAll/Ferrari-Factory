'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTheme } from '@/contexts/ThemeContext'
import AppHeader from '@/components/AppHeader'
import { 
  User,
  Mail,
  Phone,
  MapPin,
  Globe,
  Camera,
  Upload,
  Save,
  Edit,
  Folder,
  FileText,
  Image,
  ExternalLink
} from 'lucide-react'

export default function ProfilePage() {
  const { getThemeClasses } = useTheme()
  const themeClasses = getThemeClasses()
  
  const [isEditing, setIsEditing] = useState(false)
  const [profileData, setProfileData] = useState({
    name: '张艺术家',
    email: 'artist@example.com',
    phone: '+86 138 0000 0000',
    location: '北京市朝阳区',
    website: 'https://myartwork.com',
    bio: '专注于当代艺术创作，擅长装置艺术和数字媒体艺术。作品曾在多个国际展览中展出。',
    education: '中央美术学院 硕士',
    experience: '5年专业艺术创作经验'
  })

  const handleSave = () => {
    setIsEditing(false)
    // TODO: Save to database or CherryStudio integration
    console.log('保存个人资料:', profileData)
  }

  const handleInputChange = (field: string, value: string) => {
    setProfileData(prev => ({
      ...prev,
      [field]: value
    }))
  }

  return (
    <div className={`min-h-screen ${themeClasses.background}`}>
      <AppHeader
        titleKey="pages.profile.title"
        subtitleKey="pages.profile.subtitle"
        icon={User}
        iconClassName="bg-purple-600"
        right={
          <Button
            onClick={() => setIsEditing(!isEditing)}
            className={`${themeClasses.button} rounded-2xl px-6 transition-all duration-200`}
          >
            {isEditing ? <Save className="w-4 h-4 mr-2" /> : <Edit className="w-4 h-4 mr-2" />}
            {isEditing ? '保存' : '编辑'}
          </Button>
        }
      />

      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Profile Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6`}>
              <h2 className={`text-xl font-bold ${themeClasses.textPrimary} mb-6`}>基本信息</h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.textSecondary} mb-2`}>姓名</label>
                    {isEditing ? (
                      <Input
                        value={profileData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl border-2 ${themeClasses.border}`}
                      />
                    ) : (
                      <p className={`${themeClasses.textPrimary} py-2`}>{profileData.name}</p>
                    )}
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.textSecondary} mb-2`}>邮箱</label>
                    {isEditing ? (
                      <Input
                        value={profileData.email}
                        onChange={(e) => handleInputChange('email', e.target.value)}
                        className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl border-2 ${themeClasses.border}`}
                      />
                    ) : (
                      <p className={`${themeClasses.textPrimary} py-2`}>{profileData.email}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.textSecondary} mb-2`}>电话</label>
                    {isEditing ? (
                      <Input
                        value={profileData.phone}
                        onChange={(e) => handleInputChange('phone', e.target.value)}
                        className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl border-2 ${themeClasses.border}`}
                      />
                    ) : (
                      <p className={`${themeClasses.textPrimary} py-2`}>{profileData.phone}</p>
                    )}
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium ${themeClasses.textSecondary} mb-2`}>地址</label>
                    {isEditing ? (
                      <Input
                        value={profileData.location}
                        onChange={(e) => handleInputChange('location', e.target.value)}
                        className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl border-2 ${themeClasses.border}`}
                      />
                    ) : (
                      <p className={`${themeClasses.textPrimary} py-2`}>{profileData.location}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label className={`block text-sm font-medium ${themeClasses.textSecondary} mb-2`}>个人网站</label>
                  {isEditing ? (
                    <Input
                      value={profileData.website}
                      onChange={(e) => handleInputChange('website', e.target.value)}
                      className={`${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl border-2 ${themeClasses.border}`}
                    />
                  ) : (
                    <p className={`${themeClasses.textPrimary} py-2`}>{profileData.website}</p>
                  )}
                </div>

                <div>
                  <label className={`block text-sm font-medium ${themeClasses.textSecondary} mb-2`}>个人简介</label>
                  {isEditing ? (
                    <textarea
                      value={profileData.bio}
                      onChange={(e) => handleInputChange('bio', e.target.value)}
                      rows={4}
                      className={`w-full ${themeClasses.input} ${themeClasses.inputFocus} rounded-2xl border-2 ${themeClasses.border} p-3`}
                    />
                  ) : (
                    <p className={`${themeClasses.textPrimary} py-2`}>{profileData.bio}</p>
                  )}
                </div>
              </div>
            </div>

            {/* CherryStudio Integration */}
            <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6`}>
              <h2 className={`text-xl font-bold ${themeClasses.textPrimary} mb-4`}>CherryStudio 集成</h2>
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-gradient-to-r from-pink-500 to-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <ExternalLink className="w-8 h-8 text-white" />
                </div>
                <h3 className={`text-lg font-semibold ${themeClasses.textPrimary} mb-2`}>即将集成 CherryStudio</h3>
                <p className={`${themeClasses.textSecondary} mb-4`}>
                  将支持与 CherryStudio 的无缝集成，实现智能作品管理和 AI 辅助投稿
                </p>
                <Button 
                  className={`${themeClasses.button} rounded-2xl px-6 opacity-50 cursor-not-allowed`}
                  disabled
                >
                  连接 CherryStudio (开发中)
                </Button>
              </div>
            </div>
          </div>

          {/* Right Column - Portfolio & Actions */}
          <div className="space-y-6">
            {/* Profile Picture */}
            <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6`}>
              <h3 className={`text-lg font-bold ${themeClasses.textPrimary} mb-4`}>头像</h3>
              <div className="text-center">
                <div className="w-32 h-32 bg-gradient-to-br from-purple-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <User className="w-16 h-16 text-white" />
                </div>
                <Button 
                  variant="outline" 
                  className={`rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary}`}
                >
                  <Camera className="w-4 h-4 mr-2" />
                  更换头像
                </Button>
              </div>
            </div>

            {/* Portfolio Management */}
            <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6`}>
              <h3 className={`text-lg font-bold ${themeClasses.textPrimary} mb-4`}>作品集管理</h3>
              <div className="space-y-3">
                <Button 
                  variant="outline" 
                  className={`w-full rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} justify-start`}
                >
                  <Folder className="w-4 h-4 mr-3" />
                  作品分类管理
                </Button>
                <Button 
                  variant="outline" 
                  className={`w-full rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} justify-start`}
                >
                  <Upload className="w-4 h-4 mr-3" />
                  上传新作品
                </Button>
                <Button 
                  variant="outline" 
                  className={`w-full rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} justify-start`}
                >
                  <FileText className="w-4 h-4 mr-3" />
                  艺术家声明
                </Button>
                <Button 
                  variant="outline" 
                  className={`w-full rounded-2xl border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-all duration-200 ${themeClasses.textPrimary} justify-start`}
                >
                  <Image className="w-4 h-4 mr-3" />
                  作品展示页面
                </Button>
              </div>
            </div>

            {/* Quick Stats */}
            <div className={`${themeClasses.cardBackground} rounded-3xl border-2 ${themeClasses.border} p-6`}>
              <h3 className={`text-lg font-bold ${themeClasses.textPrimary} mb-4`}>统计信息</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className={`${themeClasses.textSecondary}`}>作品数量</span>
                  <span className={`font-semibold ${themeClasses.textPrimary}`}>24</span>
                </div>
                <div className="flex justify-between">
                  <span className={`${themeClasses.textSecondary}`}>投稿次数</span>
                  <span className={`font-semibold ${themeClasses.textPrimary}`}>12</span>
                </div>
                <div className="flex justify-between">
                  <span className={`${themeClasses.textSecondary}`}>成功入选</span>
                  <span className={`font-semibold ${themeClasses.textPrimary}`}>8</span>
                </div>
                <div className="flex justify-between">
                  <span className={`${themeClasses.textSecondary}`}>成功率</span>
                  <span className={`font-semibold text-green-600`}>67%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
