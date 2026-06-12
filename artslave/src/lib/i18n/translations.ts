export type Locale = 'zh' | 'en'

export const translations = {
  zh: {
    common: {
      back: '返回',
      backHome: '返回主页',
      lang: '语言',
      zh: '中文',
      en: 'English',
      devMode: '开发模式',
      theme: '主题',
    },
    pages: {
      home: { title: 'Ferrari Factory', subtitle: '艺术投稿信息自动化平台' },
      deepSearch: { title: '深度搜索 · 知识图谱', subtitle: '多模态起点 · 力导向探索' },
      submissions: { title: '投稿信息展示', subtitle: '发现适合您的艺术机会' },
      workflow: { title: '投递工作流管理', subtitle: 'n8n 自动化工作流' },
      profile: { title: '我的资料', subtitle: '管理个人信息和作品集' },
      dataCollection: { title: '数据收集管理', subtitle: '管理爬虫和数据源' },
      dataManagement: { title: '数据库管理', subtitle: '管理投稿信息数据' },
      graph: { title: '知识图谱', subtitle: '探索艺术世界的关联网络' },
    },
    deepSearch: {
      inputText: '文本',
      inputUrl: '链接',
      inputFile: '文件',
      autoDetect: '自动检测',
      seedHint: '起点实体（自动识别名字与类型）',
      placeholder: '输入名字、描述或粘贴链接；拖入文件自动识别',
      crawlMode: '爬取模式',
      crawlDesc: '自动翻页抓取真实正文 → 批量抽取实体 → 重点实体继续深挖',
      crawlPages: '翻页数',
      uploadHint: '拖拽或点击上传：图片 · PDF · txt/md',
      resolvedAs: '识别为',
      depth: '深度',
      perLevel: '每层扩展',
      type: '类型',
      typeEditable: '（可改）',
      start: '开始搜索',
      resolving: '解析起点…',
      stop: '停止',
      viewRun: '单次',
      viewGlobal: '全局总图',
      history: '历史',
      filter: '筛选',
      reset: '重置',
      showDepth: '显示深度 ≤',
      depthAll: '（全部）',
      depthSliderMax: '深度上限',
      livePhysics: '灵动',
      arrange: '整理图谱',
      nodeSize: '节点',
      default: '默认',
      rank: '重要度排行',
      searchHighlight: '搜索并高亮节点 / 类别…',
      onlyMatched: '仅显示选择项',
      console: '进程控制台',
      emptyGraph: '输入一个起点，点击「开始搜索」',
      noFilterMatch: '没有符合筛选条件的节点',
      resetFilter: '重置筛选',
    },
  },
  en: {
    common: {
      back: 'Back',
      backHome: 'Home',
      lang: 'Language',
      zh: '中文',
      en: 'English',
      devMode: 'Dev Mode',
      theme: 'Theme',
    },
    pages: {
      home: { title: 'Ferrari Factory', subtitle: 'Art submission automation platform' },
      deepSearch: { title: 'Deep Search · Knowledge Graph', subtitle: 'Multimodal seeds · force-directed exploration' },
      submissions: { title: 'Submissions', subtitle: 'Discover art opportunities for you' },
      workflow: { title: 'Workflow Management', subtitle: 'n8n automation workflows' },
      profile: { title: 'My Profile', subtitle: 'Manage profile and portfolio' },
      dataCollection: { title: 'Data Collection', subtitle: 'Manage crawlers and data sources' },
      dataManagement: { title: 'Database Management', subtitle: 'Manage submission records' },
      graph: { title: 'Knowledge Graph', subtitle: 'Explore connections in the art world' },
    },
    deepSearch: {
      inputText: 'Text',
      inputUrl: 'URL',
      inputFile: 'File',
      autoDetect: 'Auto-detect',
      seedHint: 'Seed entity (auto-detect name & type)',
      placeholder: 'Enter name, description, or paste a URL; drop a file to auto-detect',
      crawlMode: 'Crawl mode',
      crawlDesc: 'Paginate & extract entities from real pages, then deep-dive',
      crawlPages: 'Pages',
      uploadHint: 'Drag or click: image · PDF · txt/md',
      resolvedAs: 'Resolved as',
      depth: 'Depth',
      perLevel: 'Per level',
      type: 'Type',
      typeEditable: '(editable)',
      start: 'Start search',
      resolving: 'Resolving seed…',
      stop: 'Stop',
      viewRun: 'Single run',
      viewGlobal: 'Global graph',
      history: 'History',
      filter: 'Filter',
      reset: 'Reset',
      showDepth: 'Show depth ≤',
      depthAll: '(all)',
      depthSliderMax: 'Depth cap',
      livePhysics: 'Live',
      arrange: 'Arrange',
      nodeSize: 'Nodes',
      default: 'Default',
      rank: 'Importance rank',
      searchHighlight: 'Search & highlight nodes / types…',
      onlyMatched: 'Show matches only',
      console: 'Process console',
      emptyGraph: 'Enter a seed and click Start search',
      noFilterMatch: 'No nodes match the current filters',
      resetFilter: 'Reset filters',
    },
  },
} as const

export type TranslationTree = typeof translations.zh

function getByPath(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function translate(locale: Locale, key: string): string {
  return getByPath(translations[locale] as unknown as Record<string, unknown>, key) ?? key
}
