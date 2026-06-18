/** @jest-environment node */
// 结构优先抽取管线的确定性层离线单测(不联网、不调 LLM、不连库)。
// 屏蔽 openai(ESM) 与 prisma，使 recipe.ts 的纯函数可被独立导入测试。
jest.mock('openai', () => ({ __esModule: true, default: class OpenAI {} }))
jest.mock('@/lib/prisma', () => ({ prisma: {} }))

import * as cheerio from 'cheerio'
import { harvestStructured } from '@/lib/graphSearch/structured'
import { shouldRenderWithJs } from '@/lib/graphSearch/render'
import { extractReadable } from '@/lib/graphSearch/readability'
import {
  applyRecipe,
  recordsToGraph,
  buildSkeleton,
  type ExtractionRecipe,
} from '@/lib/graphSearch/recipe'
import {
  registrableDomain,
  sameSite,
  filterCandidates,
} from '@/lib/graphSearch/navigator'
import { canonicalKey } from '@/lib/graphSearch/types'
import { compareEntries } from '@/lib/graphSearch/identity'
import { parseSeedNodes } from '@/lib/graphSearch/engine'

describe('structured.ts — JSON-LD 直采', () => {
  it('解析 schema.org Person/Organization 并抽出关系', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Person","name":"Zhang Wei",
       "affiliation":{"@type":"Organization","name":"M+ Museum"}}
      </script></head><body></body></html>`
    const { entities, relations } = harvestStructured(html, 'https://x.com/p')
    const names = entities.map((e) => `${e.type}:${e.name}`)
    expect(names).toContain('artist:Zhang Wei')
    expect(names).toContain('institution:M+ Museum')
    expect(relations.some((r) => r.relationship === 'belongs_to' && r.target === 'M+ Museum')).toBe(true)
  })
})

describe('recipe.ts — Phase B 确定性套用', () => {
  const recipe: ExtractionRecipe = {
    origin: 'https://x.com',
    urlPattern: 'list',
    recordSelector: 'li.card',
    recordType: 'artist',
    fields: {
      name: { selector: '.name' },
      link: { selector: 'a', attr: 'href' },
      role: { selector: '.role' },
    },
    pagination: { type: 'query', param: 'page' },
    needsJs: false,
  }
  const html = `<ul class="artist-list">
    <li class="card"><h3 class="name">Alice</h3><a href="/a/alice">x</a><span class="role">Curator</span></li>
    <li class="card"><h3 class="name">Bob</h3><a href="/a/bob">x</a><span class="role">Artist</span></li>
    <li class="card"><h3 class="name">Carol</h3><a href="/a/carol">x</a></li>
  </ul>`

  it('按配方抽出每条记录的字段并把链接转绝对', () => {
    const $ = cheerio.load(html)
    const records = applyRecipe($, recipe, 'https://x.com/list')
    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({ name: 'Alice', role: 'Curator', link: 'https://x.com/a/alice' })
  })

  it('recordsToGraph 按 role 把 Alice 细化为 curator', () => {
    const $ = cheerio.load(html)
    const { nodes } = recordsToGraph(applyRecipe($, recipe, 'https://x.com/list'), 'artist', 'https://x.com/list')
    const alice = nodes.find((n) => n.name === 'Alice')
    const bob = nodes.find((n) => n.name === 'Bob')
    expect(alice?.type).toBe('curator')
    expect(bob?.type).toBe('artist')
  })
})

describe('recipe.ts — buildSkeleton 折叠重复块', () => {
  it('把 5 个同构兄弟折叠成示例 + 计数标记', () => {
    const cards = Array.from({ length: 5 }, (_, i) => `<li class="card"><span>n${i}</span></li>`).join('')
    const $ = cheerio.load(`<ul>${cards}</ul>`)
    const skeleton = buildSkeleton($)
    expect(skeleton).toMatch(/×5/)
  })
})

describe('readability.ts — 主正文(保留链接)', () => {
  it('挑出正文段落并把锚点 URL 内联保留', () => {
    const html = `<html><body>
      <nav><a href="/home">Home</a><a href="/about">About</a></nav>
      <main><article>
        <h2>About the Artist</h2>
        <p>This is a long descriptive paragraph about the artist and the exhibition it relates to, with enough text to score well.</p>
        <p>It mentions <a href="https://museum.org/x">the museum</a> explicitly.</p>
      </article></main>
    </body></html>`
    const $ = cheerio.load(html)
    const { text, links } = extractReadable($, 'https://x.com/bio')
    expect(text).toContain('descriptive paragraph about the artist')
    expect(text).toContain('https://museum.org/x') // 链接 URL 被内联进正文
    expect(links.some((l) => l.url === 'https://museum.org/x')).toBe(true)
  })
})

describe('render.ts — shouldRenderWithJs 判定', () => {
  it('SPA 空骨架 + bundle 脚本 → 需要渲染', () => {
    const html = `<html><body>
      <div id="root"></div>
      <script src="/_next/static/js/main.bundle.js"></script>
      <script src="/_next/static/js/vendor.js"></script>
    </body></html>`
    const $ = cheerio.load(html)
    const structured = harvestStructured($, 'https://spa.com')
    expect(shouldRenderWithJs(html, $, structured)).toBe(true)
  })

  it('内容充足的静态页 → 不渲染', () => {
    const paras = Array.from({ length: 8 }, (_, i) =>
      `<p>Paragraph ${i} with a fair amount of real readable content about art and exhibitions for scoring.</p>`
    ).join('')
    const html = `<html><body><main>${paras}</main></body></html>`
    const $ = cheerio.load(html)
    const structured = harvestStructured($, 'https://static.com')
    expect(shouldRenderWithJs(html, $, structured)).toBe(false)
  })

  it('已含 JSON-LD 结构化数据 → 不渲染(数据已在静态 HTML)', () => {
    const html = `<html><body><div id="root"></div>
      <script type="application/ld+json">
      [{"@type":"Person","name":"Artist Alpha"},{"@type":"Person","name":"Artist Beta"},{"@type":"Organization","name":"Org Gamma"}]
      </script></body></html>`
    const $ = cheerio.load(html)
    const structured = harvestStructured($, 'https://j.com')
    expect(structured.entities.length).toBeGreaterThanOrEqual(3)
    expect(shouldRenderWithJs(html, $, structured)).toBe(false)
  })
})

describe('identity disambiguation — 离线去重规则', () => {
  it('canonicalKey 把 Wikidata QID 纳入消歧符，避免重名合并', () => {
    expect(canonicalKey('artist', 'John Smith', { wikidataId: 'Q1' }))
      .toBe('artist:john_smith__q1')
    expect(canonicalKey('artist', 'John Smith', { wikidataId: 'Q2' }))
      .toBe('artist:john_smith__q2')
  })

  it('canonicalKey 无 QID 时用生卒年/国籍作为次级消歧', () => {
    expect(canonicalKey('artist', 'Zhang Wei', { birthYear: 1952, country: 'China' }))
      .toBe('artist:zhang_wei__b1952_china')
  })

  it('compareEntries 用 QID 或生卒年判断词条是否同一身份', () => {
    expect(compareEntries({ wikidataId: 'Q42' }, { wikidataId: 'Q42' }).sameIdentity).toBe(true)
    expect(compareEntries({ wikidataId: 'Q42' }, { wikidataId: 'Q43' }).sameIdentity).toBe(false)
    expect(compareEntries({ birthYear: 1881, deathYear: 1973, country: 'Spain' }, { birthYear: 1881, deathYear: 1973, country: 'Spain' }).sameIdentity).toBe(true)
  })

  it('parseSeedNodes 保留前端传入的 identity，并过滤非法类型', () => {
    const nodes = parseSeedNodes({
      seedNodes: JSON.stringify([
        { name: 'Pablo Picasso', type: 'artist', identity: { wikidataId: 'Q5593', birthYear: 1881 } },
        { name: 'Bad Type', type: 'unknown' },
      ]),
    })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].identity?.wikidataId).toBe('Q5593')
  })
})

describe('navigator.ts — 同站判定与候选收敛', () => {
  it('registrableDomain 取 eTLD+1(含子域与多段 TLD)', () => {
    expect(registrableDomain('programme.annecyfestival.com')).toBe('annecyfestival.com')
    expect(registrableDomain('www.annecyfestival.com')).toBe('annecyfestival.com')
    expect(registrableDomain('shop.gallery.co.uk')).toBe('gallery.co.uk')
  })

  it('sameSite 放行同主域子域、拦截跨主域', () => {
    expect(sameSite('https://www.annecyfestival.com/en', 'https://programme.annecyfestival.com/x')).toBe(true)
    expect(sameSite('https://www.annecyfestival.com/en', 'https://facebook.com/annecy')).toBe(false)
  })

  it('filterCandidates 去重/去 chrome/限同站/去已访问', () => {
    const visited = new Set<string>(['https://www.annecyfestival.com/en/visited'])
    const cands = [
      { text: 'Feature Films', url: 'https://www.annecyfestival.com/en/the-festival/official-selection/feature-films' },
      { text: 'Feature Films dup', url: 'https://www.annecyfestival.com/en/the-festival/official-selection/feature-films/' }, // 尾斜杠重复
      { text: 'Login', url: 'https://www.annecyfestival.com/en/account/login' }, // chrome
      { text: 'Facebook', url: 'https://facebook.com/annecy' }, // 跨站
      { text: 'Programme', url: 'https://programme.annecyfestival.com/' }, // 子域放行
      { text: 'Visited', url: 'https://www.annecyfestival.com/en/visited' }, // 已访问
    ]
    const out = filterCandidates(cands, 'https://www.annecyfestival.com/en', {
      siteHost: 'annecyfestival.com',
      visited,
    })
    const urls = out.map((c) => c.url)
    expect(urls).toContain('https://www.annecyfestival.com/en/the-festival/official-selection/feature-films')
    expect(urls).toContain('https://programme.annecyfestival.com/')
    expect(urls.some((u) => u.includes('/login'))).toBe(false)
    expect(urls.some((u) => u.includes('facebook'))).toBe(false)
    expect(urls.some((u) => u.includes('/visited'))).toBe(false)
    // 尾斜杠重复被归并
    expect(urls.filter((u) => u.includes('feature-films')).length).toBe(1)
  })
})

describe('recipe.ts — work(作品) 记录映射', () => {
  it('recordsToGraph 把记录映射为 type=work 节点', () => {
    const records = [
      { name: 'Spider-Man: Beyond', link: 'https://x.com/f/1', role: 'Feature Film' },
      { name: 'Flow', link: 'https://x.com/f/2' },
    ]
    const { nodes } = recordsToGraph(records, 'work', 'https://x.com/list')
    const works = nodes.filter((n) => n.type === 'work')
    expect(works.map((n) => n.name)).toEqual(expect.arrayContaining(['Spider-Man: Beyond', 'Flow']))
  })
})
