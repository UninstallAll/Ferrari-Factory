'use client'

import { type ReactNode } from 'react'
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { useLocale } from '@/contexts/LocaleContext'
import { useTheme } from '@/contexts/ThemeContext'
import ThemeSelector from '@/components/ThemeSelector'

interface AppHeaderProps {
  titleKey: string
  subtitleKey?: string
  icon?: LucideIcon
  iconClassName?: string
  showBack?: boolean
  backHref?: string
  onBack?: () => void
  right?: ReactNode
  showTheme?: boolean
  showLanguage?: boolean
  className?: string
  compact?: boolean
}

export default function AppHeader({
  titleKey,
  subtitleKey,
  icon: Icon,
  iconClassName = 'bg-slate-900',
  showBack = true,
  backHref = '/',
  onBack,
  right,
  showTheme = true,
  showLanguage = true,
  className = '',
  compact = false,
}: AppHeaderProps) {
  const { t, locale, setLocale } = useLocale()
  const { getThemeClasses } = useTheme()
  const themeClasses = getThemeClasses()

  const handleBack = () => {
    if (onBack) onBack()
    else window.location.href = backHref
  }

  return (
    <header className={`${themeClasses.cardBackground} border-b-2 ${themeClasses.border} px-6 ${compact ? 'py-3' : 'py-4'} flex items-center justify-between ${className}`}>
      <div className="flex items-center gap-3 min-w-0">
        {showBack && (
          <button
            onClick={handleBack}
            className={`shrink-0 p-2 rounded-xl border-2 ${themeClasses.border} ${themeClasses.buttonHover} transition-colors`}
            title={t('common.backHome')}
          >
            <ArrowLeft className={`w-5 h-5 ${themeClasses.textPrimary}`} />
          </button>
        )}
        {Icon && (
          <div className={`shrink-0 ${compact ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-xl'} flex items-center justify-center ${iconClassName}`}>
            <Icon className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-white`} />
          </div>
        )}
        <div className="min-w-0">
          <h1 className={`${compact ? 'text-lg' : 'text-xl'} font-bold ${themeClasses.textPrimary} truncate`}>
            {t(titleKey)}
          </h1>
          {subtitleKey && (
            <p className={`text-xs ${themeClasses.textSecondary} truncate`}>{t(subtitleKey)}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {right}
        {showLanguage && (
          <div className={`flex items-center rounded-xl border-2 ${themeClasses.border} overflow-hidden text-xs font-medium`}>
            <button
              onClick={() => setLocale('zh')}
              className={`px-3 py-1.5 transition-colors ${locale === 'zh' ? 'bg-slate-900 text-white' : `${themeClasses.textSecondary} hover:bg-slate-50`}`}
            >
              {t('common.zh')}
            </button>
            <button
              onClick={() => setLocale('en')}
              className={`px-3 py-1.5 transition-colors ${locale === 'en' ? 'bg-slate-900 text-white' : `${themeClasses.textSecondary} hover:bg-slate-50`}`}
            >
              {t('common.en')}
            </button>
          </div>
        )}
        {showTheme && <ThemeSelector />}
      </div>
    </header>
  )
}
