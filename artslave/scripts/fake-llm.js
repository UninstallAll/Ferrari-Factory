#!/usr/bin/env node
/**
 * 本地“假 API” —— OpenAI 兼容的 LLM 服务器
 * ===========================================
 * 让项目在不接真实付费 API 的情况下，把 LLM 请求接到本地处理，用于先跑通核心算法/流程。
 *
 * 项目里所有 LLM 调用都走 OpenAI 兼容接口 (openai SDK + baseURL)，
 * 因此只要把 OPENAI_BASE_URL / DEEPSEEK_BASE_URL 指向本服务器，业务代码无需改动。
 *
 * 三种工作模式 (用环境变量 FAKE_LLM_MODE 切换)：
 *   - mock   : 自动返回结构化假数据(基于 prompt 启发式生成合理 JSON)。最快、纯本地、零交互。
 *   - manual : 把 prompt 复制到剪贴板并打印出来，你粘贴进 Claude Code / Codex，
 *              拿到回复后运行 `node scripts/fake-llm.js reply` 把回复贴回来。真实模型、零成本。
 *   - cli    : 自动 shell 调用本地 claude / codex CLI(用订阅登录)拿结果。全自动、真实模型。
 *
 * 用法：
 *   node scripts/fake-llm.js serve      # 启动服务器(默认 mock 模式)
 *   FAKE_LLM_MODE=manual node scripts/fake-llm.js serve
 *   node scripts/fake-llm.js reply      # (manual 模式)把剪贴板内容作为回复交给最早的等待请求
 *   node scripts/fake-llm.js reply <id> # 指定请求 id
 *   node scripts/fake-llm.js reply -f answer.txt  # 从文件读取回复
 *
 * 环境变量：
 *   FAKE_LLM_MODE     mock | manual | cli      (默认 mock)
 *   FAKE_LLM_PORT     监听端口                  (默认 8787)
 *   FAKE_LLM_CLI_CMD  cli 模式自定义命令模板，支持占位符 {file}(prompt 文件) / {prompt}
 *                     例如: "claude -p" 或 "codex exec" 或 "ollama run llama3"
 *   FAKE_LLM_TIMEOUT  manual 模式等待回复的超时毫秒数 (默认 600000 = 10 分钟)
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const PORT = parseInt(process.env.FAKE_LLM_PORT || '8787', 10)
const MODE = (process.env.FAKE_LLM_MODE || 'mock').toLowerCase()
const MANUAL_TIMEOUT = parseInt(process.env.FAKE_LLM_TIMEOUT || '600000', 10)
const WORK_DIR = path.join(__dirname, '..', '.fake-llm')
const REQ_DIR = path.join(WORK_DIR, 'requests')
const RES_DIR = path.join(WORK_DIR, 'responses')

// ---------- 工具函数 ----------

function ensureDirs() {
  for (const d of [WORK_DIR, REQ_DIR, RES_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
  }
}

function color(c, s) {
  const codes = { gray: 90, red: 31, green: 32, yellow: 33, blue: 34, cyan: 36, bold: 1 }
  return `\x1b[${codes[c] || 0}m${s}\x1b[0m`
}

function log(...args) {
  console.log(color('cyan', '[fake-llm]'), ...args)
}

/** 把多条 messages 拼成一段方便粘贴的纯文本 prompt */
function messagesToText(messages) {
  if (!Array.isArray(messages)) return ''
  return messages
    .map((m) => {
      const role = (m.role || 'user').toUpperCase()
      const content = typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('\n')
          : JSON.stringify(m.content)
      return `### ${role}\n${content}`
    })
    .join('\n\n')
}

/** 从 messages 里提取 OpenAI image_url 内容，落地成临时文件，返回文件路径数组 */
function extractImages(messages) {
  if (!Array.isArray(messages)) return []
  ensureDirs()
  const files = []
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue
    for (const part of m.content) {
      if (part && part.type === 'image_url' && part.image_url && part.image_url.url) {
        const url = part.image_url.url
        const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(url)
        if (match) {
          const ext = (match[1].split('/')[1] || 'png').replace('jpeg', 'jpg')
          const file = path.join(REQ_DIR, `img-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.${ext}`)
          fs.writeFileSync(file, Buffer.from(match[2], 'base64'))
          files.push(file)
        }
      }
    }
  }
  return files
}

/** 从可能含 markdown 代码块/多余文字的文本中提取出 JSON 对象字符串 */
function extractJson(text) {
  if (!text) return null
  let t = String(text).trim()
  // 去掉 ```json ... ``` 围栏
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  // 直接尝试
  try {
    JSON.parse(t)
    return t
  } catch (_) { /* fallthrough */ }
  // 取第一个 { 到匹配的最后一个 } (平衡括号)
  const start = t.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < t.length; i++) {
    if (t[i] === '{') depth++
    else if (t[i] === '}') {
      depth--
      if (depth === 0) {
        const candidate = t.slice(start, i + 1)
        try {
          JSON.parse(candidate)
          return candidate
        } catch (_) { return null }
      }
    }
  }
  return null
}

function clipboardCopy(text) {
  try {
    const r = spawnSync('pbcopy', { input: text })
    return r.status === 0
  } catch (_) { return false }
}

function clipboardPaste() {
  try {
    const r = spawnSync('pbpaste', { encoding: 'utf8' })
    if (r.status === 0) return r.stdout
  } catch (_) { /* ignore */ }
  return null
}

// ---------- mock 模式：基于 prompt 生成合理的假 JSON ----------

function guessCategory(text) {
  const t = text.toLowerCase()
  if (/(驻地|residency|residence)/.test(t)) return 'RESIDENCY'
  if (/(比赛|大赛|竞赛|奖项|competition|award|prize)/.test(t)) return 'COMPETITION'
  if (/(基金|资助|funding|grant|fellowship)/.test(t)) return 'FUNDING'
  if (/(会议|论坛|研讨|conference|symposium|forum)/.test(t)) return 'CONFERENCE'
  if (/(展览|个展|群展|双年展|exhibition|biennale|biennial|gallery|museum)/.test(t)) return 'EXHIBITION'
  return 'EXHIBITION'
}

function findDeadline(text) {
  let m = text.match(/(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/)
  if (m) {
    const [_, y, mo, d] = m
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

/** 取出业务 prompt 里 "内容：" 与 "请提取" 之间的真实输入内容 */
function extractInputContent(userText) {
  const m = userText.match(/内容[：:]\s*([\s\S]*?)(?:\n请提取|\n相关链接|$)/)
  if (m) return m[1].trim()
  return userText.trim()
}

function buildMockContent(body) {
  const userMsg = [...(body.messages || [])].reverse().find((m) => m.role === 'user')
  const userText = userMsg ? (typeof userMsg.content === 'string' ? userMsg.content : JSON.stringify(userMsg.content)) : ''
  const wantsJson = body.response_format && body.response_format.type === 'json_object'

  if (!wantsJson) {
    const snippet = userText.replace(/\s+/g, ' ').slice(0, 160)
    return `[MOCK 回复] 这是本地假 API 的模拟回答。收到的内容片段：${snippet}`
  }

  // 业务侧大多期望投稿信息抽取的 JSON 结构，按其 schema 生成
  const content = extractInputContent(userText)
  const firstLine = (content.split('\n').find((l) => l.trim()) || '未命名活动').trim().slice(0, 80)
  const result = {
    title: firstLine,
    category: guessCategory(content),
    deadline: findDeadline(content),
    location: (content.match(/(北京|上海|广州|深圳|杭州|纽约|伦敦|巴黎|柏林|东京|香港)/) || [null])[0],
    organizer: (content.match(/主办[方人]?[：:]\s*([^\n，。]+)/) || [null, null])[1],
    description: content.replace(/\s+/g, ' ').slice(0, 200) || null,
    requirements: null,
    fee: (content.match(/(免费|无费用|free|报名费[：:]?\s*[^\n]+|\$\d+|￥\d+|\d+元)/i) || [null])[0],
    contact: (content.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [null])[0],
    originalUrl: (content.match(/https?:\/\/[^\s)）"']+/) || [null])[0],
    confidence: 0.72,
    reasoning: '[MOCK] 本地假 API 基于关键词启发式生成的测试数据，非真实模型输出。'
  }
  return JSON.stringify(result)
}

// ---------- cli 模式：调用本地 codex / claude / ollama ----------

// Codex 桌面客户端捆绑的 CLI(macOS)，未单独安装 codex 时也能用
const CODEX_BUNDLED = '/Applications/Codex.app/Contents/Resources/codex'

function hasBin(bin) {
  return spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).status === 0
}

/** 探测可用的本地 CLI，返回 { kind, bin } 或 null */
function detectCli() {
  if (hasBin('codex')) return { kind: 'codex', bin: 'codex' }
  if (fs.existsSync(CODEX_BUNDLED)) return { kind: 'codex', bin: CODEX_BUNDLED }
  if (hasBin('claude')) return { kind: 'claude', bin: 'claude' }
  if (hasBin('ollama')) return { kind: 'ollama', bin: 'ollama' }
  return null
}

const q = (s) => JSON.stringify(s) // 简单 shell 转义

function runCli(promptText, imageFiles = []) {
  ensureDirs()
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const promptFile = path.join(REQ_DIR, `cli-${stamp}.txt`)
  const outFile = path.join(RES_DIR, `cli-out-${stamp}.txt`)
  fs.writeFileSync(promptFile, promptText)

  let shellCmd
  let useStdin = true
  let readFromOut = false

  // 图片参数(仅 codex 支持 -i)
  const imageArgs = imageFiles.map((f) => `-i ${q(f)}`).join(' ')

  const tmpl = process.env.FAKE_LLM_CLI_CMD
  try {
    if (tmpl) {
      // 自定义命令模板，支持占位符 {file}=prompt文件, {out}=输出文件
      shellCmd = tmpl
      if (shellCmd.includes('{out}')) { shellCmd = shellCmd.replace(/\{out\}/g, q(outFile)); readFromOut = true }
      if (shellCmd.includes('{file}')) { shellCmd = shellCmd.replace(/\{file\}/g, q(promptFile)); useStdin = false }
    } else {
      const cli = detectCli()
      if (!cli) {
        return { error: '未检测到 codex / claude / ollama。请安装其一(或装 Codex 桌面客户端)，或设置 FAKE_LLM_CLI_CMD。' }
      }
      if (cli.kind === 'codex') {
        // 非交互、只读沙箱、把最终回复写到文件(stdout 含 agent 日志，不干净)；有图片则用 -i
        shellCmd = `${q(cli.bin)} exec --skip-git-repo-check -s read-only ${imageArgs} -o ${q(outFile)} -`
        readFromOut = true
      } else if (cli.kind === 'claude') {
        shellCmd = `${q(cli.bin)} -p`
      } else {
        shellCmd = `${q(cli.bin)} run llama3`
      }
    }

    const opts = { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 }
    if (useStdin) opts.input = promptText
    const r = spawnSync('sh', ['-c', shellCmd], opts)

    if (readFromOut && fs.existsSync(outFile)) {
      const out = fs.readFileSync(outFile, 'utf8')
      if (out.trim()) return { text: out }
    }
    if (r.status !== 0) {
      return { error: `CLI 执行失败 (exit ${r.status}): ${(r.stderr || r.stdout || '').slice(0, 500)}` }
    }
    return { text: r.stdout }
  } finally {
    try { fs.unlinkSync(promptFile) } catch (_) {}
    try { fs.unlinkSync(outFile) } catch (_) {}
    for (const f of imageFiles) { try { fs.unlinkSync(f) } catch (_) {} }
  }
}

// ---------- manual 模式：剪贴板/文件 人工桥接 ----------

function handleManual(promptText, callback) {
  ensureDirs()
  const id = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const reqFile = path.join(REQ_DIR, `${id}.txt`)
  const resFile = path.join(RES_DIR, `${id}.txt`)
  fs.writeFileSync(reqFile, promptText)
  const copied = clipboardCopy(promptText)

  console.log('\n' + color('yellow', '─'.repeat(64)))
  console.log(color('bold', `📋 待处理请求 ${id}`))
  console.log(copied
    ? color('green', '   prompt 已复制到剪贴板 ✓ 直接粘贴进 Claude Code / Codex')
    : color('red', '   (剪贴板复制失败) 请从此文件复制: ' + reqFile))
  console.log(color('gray', `   request 文件: ${reqFile}`))
  console.log(color('cyan', '   拿到回复后运行: ') + color('bold', 'npm run fake-llm:reply'))
  console.log(color('gray', `   或: node scripts/fake-llm.js reply ${id}`))
  console.log(color('yellow', '─'.repeat(64)) + '\n')

  const start = Date.now()
  const timer = setInterval(() => {
    if (fs.existsSync(resFile)) {
      clearInterval(timer)
      const answer = fs.readFileSync(resFile, 'utf8')
      try { fs.unlinkSync(resFile) } catch (_) {}
      try { fs.unlinkSync(reqFile) } catch (_) {}
      log(color('green', `✓ 收到请求 ${id} 的回复，返回给应用`))
      callback(null, answer)
    } else if (Date.now() - start > MANUAL_TIMEOUT) {
      clearInterval(timer)
      try { fs.unlinkSync(reqFile) } catch (_) {}
      callback(new Error(`等待人工回复超时 (${MANUAL_TIMEOUT}ms)`))
    }
  }, 500)
}

// ---------- OpenAI 兼容响应封装 ----------

function chatCompletionResponse(model, content) {
  return {
    id: 'chatcmpl-' + crypto.randomBytes(12).toString('hex'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: model || 'fake-local',
    choices: [
      { index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  }
}

/** 若客户端要求 json_object，则确保返回的是合法 JSON 字符串 */
function normalizeContent(rawText, body) {
  const wantsJson = body.response_format && body.response_format.type === 'json_object'
  if (!wantsJson) return rawText
  const json = extractJson(rawText)
  if (json) return json
  // 兜底：把原文包进一个对象，避免业务侧 JSON.parse 崩溃
  return JSON.stringify({ confidence: 0, reasoning: '无法从回复中解析出 JSON，原文：' + String(rawText).slice(0, 300) })
}

// ---------- HTTP 服务器 ----------

function startServer() {
  ensureDirs()
  let reqCount = 0

  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      res.end(JSON.stringify(obj))
    }

    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { status: 'ok', mode: MODE })
    }
    if (req.method === 'GET' && (req.url === '/v1/models' || req.url === '/models')) {
      return send(200, { object: 'list', data: [{ id: 'fake-local', object: 'model', owned_by: 'fake-llm' }, { id: 'deepseek-chat', object: 'model', owned_by: 'fake-llm' }] })
    }

    const isChat = req.method === 'POST' && /\/(v1\/)?chat\/completions$/.test(req.url)
    if (!isChat) {
      return send(404, { error: { message: `Not found: ${req.method} ${req.url}`, type: 'invalid_request_error' } })
    }

    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      let body
      try { body = JSON.parse(raw || '{}') } catch (e) {
        return send(400, { error: { message: 'Invalid JSON body', type: 'invalid_request_error' } })
      }
      const n = ++reqCount
      const model = body.model
      const promptText = messagesToText(body.messages)
      const imageFiles = MODE === 'cli' ? extractImages(body.messages) : []
      log(`#${n} ${color('bold', MODE)} 模式  model=${model}  ${promptText.length} chars${imageFiles.length ? `  🖼 ${imageFiles.length} 图` : ''}`)

      const finish = (content) => send(200, chatCompletionResponse(model, normalizeContent(content, body)))
      const fail = (msg) => send(500, { error: { message: msg, type: 'fake_llm_error' } })

      if (MODE === 'mock') {
        return finish(buildMockContent(body))
      }
      if (MODE === 'cli') {
        const r = runCli(promptText, imageFiles)
        if (r.error) { log(color('red', '✗ ' + r.error)); return fail(r.error) }
        return finish(r.text)
      }
      if (MODE === 'manual') {
        return handleManual(promptText, (err, answer) => {
          if (err) return fail(err.message)
          finish(answer)
        })
      }
      return fail(`未知模式: ${MODE} (可选 mock|manual|cli)`)
    })
  })

  server.listen(PORT, () => {
    console.log('\n' + color('green', '🤖 本地假 API (OpenAI 兼容) 已启动'))
    console.log(color('cyan', '   地址: ') + `http://localhost:${PORT}/v1`)
    console.log(color('cyan', '   模式: ') + color('bold', MODE) + color('gray', '  (FAKE_LLM_MODE 可切换 mock|manual|cli)'))
    if (MODE === 'manual') console.log(color('gray', '   manual: 收到请求后会复制到剪贴板，用 `npm run fake-llm:reply` 回填'))
    if (MODE === 'cli') {
      const cli = process.env.FAKE_LLM_CLI_CMD ? { kind: 'custom', bin: process.env.FAKE_LLM_CLI_CMD } : detectCli()
      if (cli) console.log(color('gray', `   cli: 将调用 ${color('bold', cli.kind)} (${cli.bin})`))
      else console.log(color('red', '   cli: ⚠ 未检测到 codex/claude/ollama，请安装或设置 FAKE_LLM_CLI_CMD'))
    }
    console.log(color('gray', '   .env 里 OPENAI_BASE_URL / DEEPSEEK_BASE_URL 应指向上面地址') + '\n')
  })
}

// ---------- reply 子命令 (manual 模式回填) ----------

function doReply(args) {
  ensureDirs()
  let answer = null
  let targetId = null

  const fIdx = args.indexOf('-f')
  if (fIdx !== -1 && args[fIdx + 1]) {
    answer = fs.readFileSync(args[fIdx + 1], 'utf8')
  } else {
    const idArg = args.find((a) => !a.startsWith('-'))
    if (idArg) targetId = idArg
  }
  if (answer === null) {
    answer = clipboardPaste()
    if (answer === null || answer.trim() === '') {
      console.error(color('red', '✗ 剪贴板为空。请先复制回复，或用 -f <文件> 指定。'))
      process.exit(1)
    }
    log('已从剪贴板读取回复 (' + answer.length + ' chars)')
  }

  const pending = fs.readdirSync(REQ_DIR).filter((f) => f.endsWith('.txt')).sort()
  if (pending.length === 0) {
    console.error(color('red', '✗ 当前没有等待回复的请求。'))
    process.exit(1)
  }
  let file = targetId ? pending.find((f) => f.startsWith(targetId)) : pending[0]
  if (!file) {
    console.error(color('red', `✗ 找不到请求 id: ${targetId}`))
    console.error(color('gray', '   等待中的请求: ' + pending.map((f) => f.replace('.txt', '')).join(', ')))
    process.exit(1)
  }
  const id = file.replace('.txt', '')
  fs.writeFileSync(path.join(RES_DIR, `${id}.txt`), answer)
  console.log(color('green', `✓ 已回填请求 ${id}，服务器会自动取走并返回给应用。`))
}

// ---------- 入口 ----------

const [, , cmd, ...rest] = process.argv
if (cmd === 'reply') {
  doReply(rest)
} else if (cmd === 'serve' || cmd === undefined) {
  startServer()
} else {
  console.log('用法: node scripts/fake-llm.js [serve|reply]')
  process.exit(1)
}
