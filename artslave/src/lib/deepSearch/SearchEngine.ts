import { 
  SearchNode, 
  SearchEdge, 
  SearchConfig, 
  SearchResult, 
  SearchProgress,
  SearchEvent,
  SearchProgressCallback,
  SearchEventCallback,
  RelevanceFactors,
  NodeType,
  EdgeType
} from './types'
import { LLMAnalyzer } from './LLMAnalyzer'
import { DataCollector } from './DataCollector'
import { GraphBuilder } from './GraphBuilder'
import { RelevanceScorer } from './RelevanceScorer'

export class DeepSearchEngine {
  private config: SearchConfig
  private llmAnalyzer: LLMAnalyzer
  private dataCollector: DataCollector
  private graphBuilder: GraphBuilder
  private relevanceScorer: RelevanceScorer
  
  private searchId: string = ''
  private isSearching: boolean = false
  private searchQueue: SearchNode[] = []
  private processedNodes: Set<string> = new Set()
  private discoveredNodes: Map<string, SearchNode> = new Map()
  private discoveredEdges: Map<string, SearchEdge> = new Map()
  
  private progressCallback?: SearchProgressCallback
  private eventCallback?: SearchEventCallback

  constructor(config: SearchConfig) {
    this.config = config
    this.llmAnalyzer = new LLMAnalyzer(config.llmConfig)
    this.dataCollector = new DataCollector(config.dataSourceConfig)
    this.graphBuilder = new GraphBuilder()
    this.relevanceScorer = new RelevanceScorer()
  }

  /**
   * 开始深度搜索
   */
  async startSearch(
    coreNode: SearchNode,
    progressCallback?: SearchProgressCallback,
    eventCallback?: SearchEventCallback
  ): Promise<SearchResult> {
    if (this.isSearching) {
      throw new DeepSearchError('Search already in progress', 'SEARCH_IN_PROGRESS')
    }

    this.searchId = this.generateSearchId()
    this.isSearching = true
    this.progressCallback = progressCallback
    this.eventCallback = eventCallback
    
    // 重置状态
    this.searchQueue = []
    this.processedNodes.clear()
    this.discoveredNodes.clear()
    this.discoveredEdges.clear()

    const startTime = Date.now()

    try {
      this.emitEvent('search_started', { coreNode })
      this.updateProgress(0, 'initializing', '初始化搜索...')

      // 添加核心节点
      coreNode.depth = 0
      coreNode.relevanceScore = 1.0
      this.discoveredNodes.set(coreNode.id, coreNode)
      this.searchQueue.push(coreNode)

      // 开始广度优先搜索
      await this.performBreadthFirstSearch()

      // 构建最终图结构
      this.updateProgress(90, 'building_graph', '构建知识图谱...')
      const graph = await this.buildFinalGraph()

      const searchDuration = Date.now() - startTime
      const result: SearchResult = {
        nodes: Array.from(this.discoveredNodes.values()),
        edges: Array.from(this.discoveredEdges.values()),
        metadata: {
          searchId: this.searchId,
          coreNodeId: coreNode.id,
          totalNodes: this.discoveredNodes.size,
          totalEdges: this.discoveredEdges.size,
          maxDepthReached: this.getMaxDepth(),
          searchDuration,
          timestamp: new Date()
        }
      }

      this.updateProgress(100, 'completed', '搜索完成')
      this.emitEvent('search_completed', result)
      
      return result

    } catch (error) {
      this.emitEvent('search_error', { error })
      throw error
    } finally {
      this.isSearching = false
    }
  }

  /**
   * 执行广度优先搜索
   */
  private async performBreadthFirstSearch(): Promise<void> {
    let currentDepth = 0

    while (this.searchQueue.length > 0 && currentDepth < this.config.maxDepth) {
      const currentLevelNodes = this.searchQueue.filter(node => node.depth === currentDepth)
      
      if (currentLevelNodes.length === 0) {
        currentDepth++
        continue
      }

      this.updateProgress(
        (currentDepth / this.config.maxDepth) * 80,
        'searching',
        `搜索第 ${currentDepth + 1} 层，发现 ${currentLevelNodes.length} 个节点`
      )

      // 并行处理当前层的节点
      const promises = currentLevelNodes.map(node => this.expandNode(node))
      await Promise.allSettled(promises)

      // 移除已处理的节点
      this.searchQueue = this.searchQueue.filter(node => node.depth !== currentDepth)
      
      this.emitEvent('depth_completed', { depth: currentDepth, nodesCount: currentLevelNodes.length })
      currentDepth++
    }
  }

  /**
   * 扩展单个节点
   */
  private async expandNode(node: SearchNode): Promise<void> {
    if (this.processedNodes.has(node.id)) {
      return
    }

    this.processedNodes.add(node.id)

    try {
      // 收集相关数据
      const collectedData = await this.dataCollector.collectData(node)
      
      // LLM 分析提取实体和关系
      const analysisResult = await this.llmAnalyzer.analyzeContent(
        collectedData,
        node,
        this.config.expansionStrategies
      )

      // 处理发现的实体
      for (const entity of analysisResult.entities) {
        const newNode = await this.createNodeFromEntity(entity, node)
        if (newNode && this.shouldAddNode(newNode)) {
          this.addDiscoveredNode(newNode)
        }
      }

      // 处理发现的关系
      for (const relationship of analysisResult.relationships) {
        const edge = await this.createEdgeFromRelationship(relationship)
        if (edge && this.shouldAddEdge(edge)) {
          this.addDiscoveredEdge(edge)
        }
      }

    } catch (error) {
      console.error(`Error expanding node ${node.id}:`, error)
    }
  }

  /**
   * 从实体创建节点
   */
  private async createNodeFromEntity(entity: any, parentNode: SearchNode): Promise<SearchNode | null> {
    const nodeId = this.generateNodeId(entity.name, entity.type)
    
    if (this.discoveredNodes.has(nodeId)) {
      return null // 节点已存在
    }

    const relevanceScore = await this.relevanceScorer.calculateRelevance(
      this.getCoreNode(),
      entity,
      parentNode
    )

    if (relevanceScore < this.config.relevanceThreshold) {
      return null // 相关性不足
    }

    const newNode: SearchNode = {
      id: nodeId,
      type: entity.type,
      name: entity.name,
      data: entity.properties || {},
      relevanceScore,
      depth: parentNode.depth + 1,
      parentId: parentNode.id,
      searchKeywords: this.generateSearchKeywords(entity),
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        source: entity.source || 'llm_extraction',
        confidence: entity.confidence || 0.8,
        searchDepth: parentNode.depth + 1,
        urls: entity.urls || []
      }
    }

    return newNode
  }

  /**
   * 从关系创建边
   */
  private async createEdgeFromRelationship(relationship: any): Promise<SearchEdge | null> {
    const sourceId = this.findNodeId(relationship.sourceEntity)
    const targetId = this.findNodeId(relationship.targetEntity)

    if (!sourceId || !targetId) {
      return null // 找不到对应的节点
    }

    const edgeId = `${sourceId}-${relationship.relationshipType}-${targetId}`
    
    if (this.discoveredEdges.has(edgeId)) {
      return null // 边已存在
    }

    const edge: SearchEdge = {
      id: edgeId,
      source: sourceId,
      target: targetId,
      type: relationship.relationshipType,
      weight: relationship.strength || 0.5,
      properties: {},
      metadata: {
        createdAt: new Date(),
        evidence: relationship.evidence || [],
        confidence: relationship.confidence || 0.8,
        source: 'llm_analysis'
      }
    }

    return edge
  }

  /**
   * 判断是否应该添加节点
   */
  private shouldAddNode(node: SearchNode): boolean {
    // 检查深度限制
    if (node.depth >= this.config.maxDepth) {
      return false
    }

    // 检查相关性阈值
    if (node.relevanceScore < this.config.relevanceThreshold) {
      return false
    }

    // 检查当前层节点数量限制
    const currentLevelNodes = Array.from(this.discoveredNodes.values())
      .filter(n => n.depth === node.depth)
    
    if (currentLevelNodes.length >= this.config.maxNodesPerLevel) {
      // 如果当前层已满，只添加相关性更高的节点
      const lowestRelevanceNode = currentLevelNodes
        .sort((a, b) => a.relevanceScore - b.relevanceScore)[0]
      
      if (node.relevanceScore <= lowestRelevanceNode.relevanceScore) {
        return false
      }
      
      // 移除相关性最低的节点
      this.discoveredNodes.delete(lowestRelevanceNode.id)
    }

    return true
  }

  /**
   * 判断是否应该添加边
   */
  private shouldAddEdge(edge: SearchEdge): boolean {
    // 检查源节点和目标节点是否都存在
    return this.discoveredNodes.has(edge.source) && this.discoveredNodes.has(edge.target)
  }

  /**
   * 添加发现的节点
   */
  private addDiscoveredNode(node: SearchNode): void {
    this.discoveredNodes.set(node.id, node)
    
    // 如果节点深度小于最大深度，添加到搜索队列
    if (node.depth < this.config.maxDepth - 1) {
      this.searchQueue.push(node)
    }

    this.emitEvent('node_discovered', { node })
  }

  /**
   * 添加发现的边
   */
  private addDiscoveredEdge(edge: SearchEdge): void {
    this.discoveredEdges.set(edge.id, edge)
    this.emitEvent('edge_discovered', { edge })
  }

  /**
   * 构建最终图结构
   */
  private async buildFinalGraph(): Promise<void> {
    // 图优化和清理
    await this.graphBuilder.optimizeGraph(
      Array.from(this.discoveredNodes.values()),
      Array.from(this.discoveredEdges.values())
    )
  }

  /**
   * 辅助方法
   */
  private getCoreNode(): SearchNode {
    return Array.from(this.discoveredNodes.values()).find(node => node.depth === 0)!
  }

  private getMaxDepth(): number {
    return Math.max(...Array.from(this.discoveredNodes.values()).map(node => node.depth))
  }

  private generateSearchId(): string {
    return `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private generateNodeId(name: string, type: NodeType): string {
    return `${type}_${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`
  }

  private generateSearchKeywords(entity: any): string[] {
    const keywords = [entity.name]
    
    if (entity.type === 'artist') {
      keywords.push(`${entity.name} artist`, `${entity.name} exhibition`)
    } else if (entity.type === 'exhibition') {
      keywords.push(`${entity.name} exhibition`, `${entity.name} gallery`)
    }
    
    return keywords
  }

  private findNodeId(entityName: string): string | null {
    for (const [id, node] of this.discoveredNodes) {
      if (node.name.toLowerCase() === entityName.toLowerCase()) {
        return id
      }
    }
    return null
  }

  private updateProgress(progress: number, status: string, message: string): void {
    if (this.progressCallback) {
      this.progressCallback({
        currentDepth: this.getMaxDepth(),
        nodesProcessed: this.processedNodes.size,
        totalNodes: this.discoveredNodes.size,
        edgesFound: this.discoveredEdges.size,
        status: status as any,
        message,
        progress
      })
    }
  }

  private emitEvent(type: string, data: any): void {
    if (this.eventCallback) {
      this.eventCallback({
        type: type as any,
        data,
        timestamp: new Date(),
        searchId: this.searchId
      })
    }
  }

  /**
   * 停止搜索
   */
  public stopSearch(): void {
    this.isSearching = false
    this.searchQueue = []
  }

  /**
   * 获取搜索状态
   */
  public getSearchStatus(): { isSearching: boolean; searchId: string } {
    return {
      isSearching: this.isSearching,
      searchId: this.searchId
    }
  }
}

class DeepSearchError extends Error {
  constructor(message: string, public code: string, public details?: any) {
    super(message)
    this.name = 'DeepSearchError'
    this.timestamp = new Date()
  }
  
  timestamp: Date
}
