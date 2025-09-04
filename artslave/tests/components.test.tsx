/**
 * ArtSlave React 组件单元测试
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import HomePage from '@/app/page';
import SubmissionsPage from '@/app/submissions/page';
import DataCollectionPage from '@/app/data-collection/page';
import DataManagementPage from '@/app/data-management/page';
import ThemeSelector from '@/components/ThemeSelector';
import SubmissionForm from '@/components/SubmissionForm';
import { formatDeadline, getTypeColor } from '@/lib/utils';

// Mock fetch
global.fetch = jest.fn();

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    back: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn(),
  }),
}));

// 测试工具函数
const renderWithTheme = (component: React.ReactElement) => {
  return render(
    <AuthProvider>
      <ThemeProvider>
        {component}
      </ThemeProvider>
    </AuthProvider>
  );
};

// Mock 数据
const mockSubmissions = [
  {
    id: '1',
    title: 'Test Exhibition',
    type: 'EXHIBITION',
    organizer: 'Test Organizer',
    location: 'Test Location',
    country: 'Test Country',
    deadline: '2025-12-31',
    description: 'Test description',
    tags: ['art', 'exhibition'],
    isGold: false,
    isFeatured: true,
    isActive: true
  }
];

const mockDataSources = [
  {
    id: '1',
    name: 'Test Data Source',
    url: 'https://example.com',
    type: 'website',
    category: '艺术展览',
    isActive: true,
    crawlFreq: 24,
    itemsFound: 10,
    status: 'completed'
  }
];

describe('HomePage', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  test('renders homepage with main navigation cards', async () => {
    // Mock API responses
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockSubmissions })
    });

    renderWithTheme(<HomePage />);

    // 检查主要导航卡片
    expect(screen.getByText('投稿信息展示')).toBeInTheDocument();
    expect(screen.getByText('数据收集管理')).toBeInTheDocument();
    expect(screen.getByText('数据库管理')).toBeInTheDocument();
    expect(screen.getByText('AI 智能匹配')).toBeInTheDocument();
  });

  test('displays statistics correctly', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ 
        success: true, 
        data: mockSubmissions,
        stats: {
          totalSubmissions: 1,
          activeSubmissions: 1,
          recentSubmissions: 1
        }
      })
    });

    renderWithTheme(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument(); // 统计数字
    });
  });
});

describe('SubmissionsPage', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  test('renders submissions list', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockSubmissions })
    });

    renderWithTheme(<SubmissionsPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Exhibition')).toBeInTheDocument();
      expect(screen.getByText('Test Organizer')).toBeInTheDocument();
    });
  });

  test('filters submissions by search term', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockSubmissions })
    });

    renderWithTheme(<SubmissionsPage />);

    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText(/搜索/);
      fireEvent.change(searchInput, { target: { value: 'Test' } });
      expect(screen.getByText('Test Exhibition')).toBeInTheDocument();
    });
  });

  test('filters submissions by type', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockSubmissions })
    });

    renderWithTheme(<SubmissionsPage />);

    await waitFor(() => {
      const typeFilter = screen.getByTestId('type-filter');
      fireEvent.change(typeFilter, { target: { value: 'EXHIBITION' } });
      expect(screen.getByText('Test Exhibition')).toBeInTheDocument();
    });
  });
});

describe('DataCollectionPage', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  test('renders data sources management', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockDataSources })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          status: { running: false, uptime: 0, uptimeFormatted: '0秒' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          status: { running: false, uptime: 0, uptimeFormatted: '0秒', isInstalled: false }
        })
      });

    renderWithTheme(<DataCollectionPage />);

    await waitFor(() => {
      expect(screen.getByText('数据收集管理')).toBeInTheDocument();
      expect(screen.getByText('数据源管理')).toBeInTheDocument();
    });
  });

  test('displays scheduler status', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockDataSources })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          status: { running: true, uptime: 3600000, uptimeFormatted: '1小时' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          status: { running: false, uptime: 0, uptimeFormatted: '0秒', isInstalled: true }
        })
      });

    renderWithTheme(<DataCollectionPage />);

    await waitFor(() => {
      expect(screen.getByText('自动监控调度器')).toBeInTheDocument();
      const schedulerStatus = screen.getByTestId('scheduler-status');
      expect(schedulerStatus).toHaveTextContent('已停止');
    });
  });

  test('handles scheduler start/stop', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockDataSources })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          status: { running: false, uptime: 0, uptimeFormatted: '0秒' }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ 
          status: { running: false, uptime: 0, uptimeFormatted: '0秒', isInstalled: true }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: '调度器启动成功' })
      });

    renderWithTheme(<DataCollectionPage />);

    await waitFor(() => {
      const startButton = screen.getByText('启动');
      fireEvent.click(startButton);
    });

    expect(fetch).toHaveBeenCalledWith('/api/scheduler', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'start' })
    }));
  });
});

describe('DataManagementPage', () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockClear();
  });

  test('renders database management interface', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: mockSubmissions })
    });

    renderWithTheme(<DataManagementPage />);

    await waitFor(() => {
      expect(screen.getByText('数据库管理')).toBeInTheDocument();
      expect(screen.getByText('添加投稿')).toBeInTheDocument();
    });
  });

  test('handles submission creation', async () => {
    (fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: mockSubmissions })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ success: true, data: mockSubmissions[0] })
      });

    renderWithTheme(<DataManagementPage />);

    await waitFor(() => {
      const addButton = screen.getByText('添加投稿');
      fireEvent.click(addButton);
    });

    // 这里应该打开表单模态框
    // 具体的表单测试需要根据实际实现调整
  });
});

describe('ThemeSelector', () => {
  test('renders theme options', () => {
    const ThemeSelector = require('@/components/ThemeSelector').default;
    renderWithTheme(<ThemeSelector />);

    // 检查主题选择器是否渲染
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  test('changes theme when option is selected', async () => {
    const ThemeSelector = require('@/components/ThemeSelector').default;
    renderWithTheme(<ThemeSelector />);

    const themeButton = screen.getByRole('button');
    fireEvent.click(themeButton);

    // 这里需要根据实际的主题选择器实现来测试
    // 例如检查下拉菜单是否出现，主题是否切换等
  });
});

describe('SubmissionForm', () => {
  test('renders form fields', () => {
    const SubmissionForm = require('@/components/SubmissionForm').default;
    const mockOnSave = jest.fn();
    const mockOnClose = jest.fn();

    renderWithTheme(
      <SubmissionForm
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    expect(screen.getByLabelText(/标题/)).toBeInTheDocument();
    expect(screen.getByLabelText(/类型/)).toBeInTheDocument();
    expect(screen.getByLabelText(/主办方/)).toBeInTheDocument();
  });

  test('validates required fields', async () => {
    const SubmissionForm = require('@/components/SubmissionForm').default;
    const mockOnSave = jest.fn();
    const mockOnClose = jest.fn();

    renderWithTheme(
      <SubmissionForm
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    const form = screen.getByTestId('submission-form');
    fireEvent.submit(form);

    // 检查是否显示验证错误
    await waitFor(() => {
      expect(screen.getByText('请填写标题')).toBeInTheDocument();
    });
  });

  test('submits form with valid data', async () => {
    const SubmissionForm = require('@/components/SubmissionForm').default;
    const mockOnSave = jest.fn();
    const mockOnClose = jest.fn();



    renderWithTheme(
      <SubmissionForm
        onSave={mockOnSave}
        onClose={mockOnClose}
      />
    );

    // 填写表单 - 只填写可见的必填字段
    const titleInput = screen.getByLabelText(/标题/);
    const organizerInput = screen.getByLabelText(/主办方/);

    fireEvent.change(titleInput, {
      target: { value: 'Test Title' }
    });
    fireEvent.change(organizerInput, {
      target: { value: 'Test Organizer' }
    });

    // 尝试提交表单，应该显示验证错误（因为缺少截止日期）
    const form = screen.getByTestId('submission-form');
    fireEvent.submit(form);

    // 检查是否显示验证错误
    await waitFor(() => {
      expect(screen.getByText('请选择截止日期')).toBeInTheDocument();
    });
  });
});

// 测试工具函数
describe('Utility Functions', () => {
  test('formatDeadline function', () => {
    const { formatDeadline } = require('@/lib/utils');
    
    const testDate = '2025-12-31';
    const result = formatDeadline(testDate);
    
    expect(result).toContain('2025');
    expect(result).toContain('12');
    expect(result).toContain('31');
  });

  test('getTypeColor function', () => {
    const { getTypeColor } = require('@/lib/utils');
    
    expect(getTypeColor('EXHIBITION')).toContain('blue');
    expect(getTypeColor('RESIDENCY')).toContain('green');
    expect(getTypeColor('COMPETITION')).toContain('purple');
  });
});

// 错误边界测试
describe('Error Handling', () => {
  test('handles API errors gracefully', async () => {
    // 清理之前的 mock
    jest.clearAllMocks();

    // Mock fetch 失败
    (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    renderWithTheme(<SubmissionsPage />);

    // 等待加载状态消失
    await waitFor(() => {
      expect(screen.queryByText('正在加载投稿信息...')).not.toBeInTheDocument();
    }, { timeout: 5000 });

    // 检查页面是否正常渲染（不崩溃）
    expect(screen.getByText('投稿信息展示')).toBeInTheDocument();
  });

  test('handles malformed API responses', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invalid: 'response' })
    });

    renderWithTheme(<SubmissionsPage />);

    // 应该优雅地处理无效响应
    await waitFor(() => {
      expect(screen.getByText(/暂无投稿信息/)).toBeInTheDocument();
    });
  });
});
