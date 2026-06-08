'use client'

import React, { createContext, useContext, useState, useEffect } from 'react'

export type ThemeMode = 'professional' | 'dark'

interface ThemeContextType {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  getThemeClasses: () => {
    background: string
    cardBackground: string
    textPrimary: string
    textSecondary: string
    border: string
    accent: string
    button: string
    buttonHover: string
    input: string
    inputFocus: string
  }
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export const useTheme = () => {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

const themeConfigs = {
  professional: {
    // 浅灰背景让白色卡片浮起来，避免卡片与背景同色
    background: 'bg-slate-100',
    cardBackground: 'bg-white',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-600',
    border: 'border-slate-200',
    accent: 'text-blue-600',
    // 深色实心按钮，在白卡上对比清晰
    button: 'bg-slate-900 text-white hover:bg-slate-700',
    buttonHover: 'hover:bg-slate-100',
    input: 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400',
    inputFocus: 'focus:border-blue-500'
  },
  dark: {
    // 更深的背景 + 稍亮的卡片，层次分明
    background: 'bg-slate-950',
    cardBackground: 'bg-slate-800',
    textPrimary: 'text-slate-50',
    textSecondary: 'text-slate-300',
    border: 'border-slate-700',
    accent: 'text-blue-400',
    button: 'bg-blue-600 text-white hover:bg-blue-500',
    buttonHover: 'hover:bg-slate-700',
    input: 'bg-slate-700 border-slate-600 text-white placeholder:text-slate-400',
    inputFocus: 'focus:border-blue-400'
  }
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<ThemeMode>('professional')

  useEffect(() => {
    const savedTheme = localStorage.getItem('artslave-theme') as ThemeMode
    if (savedTheme && themeConfigs[savedTheme]) {
      setTheme(savedTheme)
    }
  }, [])

  const handleSetTheme = (newTheme: ThemeMode) => {
    setTheme(newTheme)
    localStorage.setItem('artslave-theme', newTheme)
  }

  const getThemeClasses = () => themeConfigs[theme]

  return (
    <ThemeContext.Provider value={{ theme, setTheme: handleSetTheme, getThemeClasses }}>
      {children}
    </ThemeContext.Provider>
  )
}
