'use client';

import React, { useState } from 'react';
import KnowledgeGraph from '@/components/KnowledgeGraph';
import { Search, Filter, Download, Maximize2, Settings, Network } from 'lucide-react';
import AppHeader from '@/components/AppHeader';

export default function GraphPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const handleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  const handleExport = () => {
    // TODO: 实现图谱导出功能
    alert('导出功能开发中...');
  };

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white">
        <div className="absolute top-4 right-4 z-10 flex gap-2">
          <button
            onClick={handleFullscreen}
            className="p-2 bg-white rounded-lg shadow-lg border hover:bg-gray-50"
            title="退出全屏"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
        <KnowledgeGraph className="w-full h-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        titleKey="pages.graph.title"
        subtitleKey="pages.graph.subtitle"
        icon={Network}
        iconClassName="bg-indigo-600"
        right={
          <div className="flex items-center gap-3">
            {/* 搜索框 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="搜索艺术家、作品、展览..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
              />
            </div>

            {/* 过滤器按钮 */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg border ${
                showFilters 
                  ? 'bg-blue-50 border-blue-200 text-blue-600' 
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
              title="过滤器"
            >
              <Filter className="w-4 h-4" />
            </button>

            {/* 设置按钮 */}
            <button
              className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              title="设置"
            >
              <Settings className="w-4 h-4" />
            </button>

            {/* 导出按钮 */}
            <button
              onClick={handleExport}
              className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              title="导出图谱"
            >
              <Download className="w-4 h-4" />
            </button>

            {/* 全屏按钮 */}
            <button
              onClick={handleFullscreen}
              className="p-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
              title="全屏模式"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        }
      />

      <div className="px-6 py-4">
        {/* 过滤器面板 */}
        {showFilters && (
          <div className="mb-4 p-4 bg-gray-50 rounded-lg border">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  节点类型
                </label>
                <div className="space-y-1">
                  {[
                    { key: 'artist', label: '艺术家', color: 'red' },
                    { key: 'exhibition', label: '展览', color: 'purple' },
                    { key: 'institution', label: '机构', color: 'cyan' },
                    { key: 'artwork', label: '作品', color: 'amber' },
                    { key: 'movement', label: '艺术运动', color: 'emerald' },
                  ].map((type) => (
                    <label key={type.key} className="flex items-center gap-2">
                      <input type="checkbox" defaultChecked className="rounded" />
                      <span className="text-sm">{type.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  时间范围
                </label>
                <div className="space-y-2">
                  <input
                    type="number"
                    placeholder="开始年份"
                    className="w-full px-3 py-1 border border-gray-300 rounded text-sm"
                  />
                  <input
                    type="number"
                    placeholder="结束年份"
                    className="w-full px-3 py-1 border border-gray-300 rounded text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  地理位置
                </label>
                <select className="w-full px-3 py-1 border border-gray-300 rounded text-sm">
                  <option value="">所有地区</option>
                  <option value="europe">欧洲</option>
                  <option value="america">美洲</option>
                  <option value="asia">亚洲</option>
                  <option value="africa">非洲</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  布局算法
                </label>
                <select className="w-full px-3 py-1 border border-gray-300 rounded text-sm">
                  <option value="force">力导向布局</option>
                  <option value="hierarchical">层次布局</option>
                  <option value="circular">环形布局</option>
                  <option value="grid">网格布局</option>
                </select>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
                重置
              </button>
              <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                应用过滤器
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 主要内容区域 */}
      <div className="flex-1 p-6">
        <div className="bg-white rounded-lg shadow-sm border h-[calc(100vh-200px)]">
          <KnowledgeGraph />
        </div>
      </div>

      {/* 底部状态栏 */}
      <div className="bg-white border-t border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center gap-4">
            <span>节点: 5</span>
            <span>连接: 4</span>
            <span>最后更新: 2024-01-15</span>
          </div>
          <div className="flex items-center gap-2">
            <span>缩放: 100%</span>
            <span>|</span>
            <span>选中: 无</span>
          </div>
        </div>
      </div>
    </div>
  );
}
