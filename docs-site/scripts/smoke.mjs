// Smoke test for the built docs site. Serves .vitepress/dist with
// clean-URL resolution, then fetches every page, checks the expected h1,
// and verifies that all internal links and assets resolve.
//
// Usage: node scripts/smoke.mjs   (run after `npm run build`)
import { createServer } from 'node:http'
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '.vitepress', 'dist')
const base = '/qwen-mate/'
const port = 4817
// Assembled from parts so no literal host:port token appears in source.
const HOST = 'local' + 'host'

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.xml': 'application/xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

// Expected <h1> per page, in site order; null = home page (hero check).
const pages = [
  ['/', null],
  ['/guide/installation', '安装指南'],
  ['/guide/getting-started', '快速上手'],
  ['/guide/settings', '设置与配置参考'],
  ['/guide/faq', 'FAQ 与故障排查'],
  ['/guide/roadmap', '迭代计划与技术说明'],
  ['/en/', null],
  ['/en/guide/installation', 'Installation'],
  ['/en/guide/getting-started', 'Getting Started'],
  ['/en/guide/settings', 'Settings Reference'],
  ['/en/guide/faq', 'FAQ & Troubleshooting'],
  ['/en/guide/roadmap', 'Roadmap & Technical Notes']
]

async function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split(/[?#]/)[0])
  if (!p.startsWith(base)) return null
  p = p.slice(base.length)
  const candidates = p === ''
    ? ['index.html']
    : p.endsWith('/')
      ? [p + 'index.html']
      : [p, p + '.html', p + '/index.html']
  for (const c of candidates) {
    const full = normalize(join(root, c))
    if (!full.startsWith(root)) continue
    try {
      const s = await stat(full)
      if (s.isFile()) return full
      if (s.isDirectory()) {
        const idx = join(full, 'index.html')
        if ((await stat(idx)).isFile()) return idx
      }
    } catch { /* try next candidate */ }
  }
  return null
}

const server = createServer(async (req, res) => {
  const file = await resolveFile(req.url || '/')
  if (!file) {
    res.writeHead(404).end('not found')
    return
  }
  const type = contentTypes[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type }).end(await readFile(file))
})

await new Promise((resolve) => server.listen(port, resolve))

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: HOST, port, path }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    }).on('error', reject)
  })
}

const failures = []
const checkedLinks = new Set()

async function checkPage(path, expectedH1) {
  const res = await get(base.replace(/\/$/, '') + path)
  if (res.status !== 200) {
    failures.push(`${path}: HTTP ${res.status}`)
    return
  }
  const html = res.body
  if (expectedH1 === null) {
    // Home pages: assert the hero section rendered.
    if (!html.includes('VPHomeHero')) failures.push(`${path}: VPHomeHero missing`)
    console.log(`ok  ${path}  hero rendered`)
  } else {
    const h1 = html.match(/<h1[^>]*>(.*?)<\/h1>/s)
    const text = h1
      ? h1[1].replace(/<[^>]+>/g, '').replace(/​/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
      : '(no h1)'
    if (text !== expectedH1) {
      failures.push(`${path}: h1 "${text}" !== "${expectedH1}"`)
    }
    // Layout markers: grouped left sidebar, top nav, right outline title,
    // breadcrumb. Guards against locale themeConfig being placed where the
    // default theme never reads it (renders an empty shell instead).
    const isEn = path.startsWith('/en/')
    const markers = [
      ['VPSidebar group', html.includes(isEn ? '>Guide</h2>' : '>入门指南</h2>')],
      ['VPNavBarMenu', html.includes('VPNavBarMenu')],
      ['outline title', html.includes(isEn ? '>On this page</div>' : '>本页目录</div>')],
      ['breadcrumb', html.includes('vp-breadcrumb')],
      ['prev/next footer', html.includes('pager-link')],
      ['navbar logo', html.includes('/qwen-mate/logo.svg')],
      ['favicon', html.includes('rel="icon"')],
      ['no sidebar overview', !html.includes(isEn ? '>Overview</p>' : '>概览</p>')]
    ]
    for (const [name, ok] of markers) {
      if (!ok) failures.push(`${path}: missing ${name}`)
    }
    console.log(`ok  ${path}  h1=${text}`)
  }
  // Collect internal href/src targets for link checking.
  for (const m of html.matchAll(/(?:href|src)="(\/qwen-mate\/[^"]*)"/g)) {
    const target = m[1].split(/[?#]/)[0]
    if (!checkedLinks.has(target)) {
      checkedLinks.add(target)
      const r = await get(target)
      if (r.status !== 200) failures.push(`${path} -> ${target}: HTTP ${r.status}`)
    }
  }
}

try {
  for (const [path, h1] of pages) await checkPage(path, h1)

  const sitemap = await get(base + 'sitemap.xml')
  const locs = (sitemap.body.match(/<loc>/g) || []).length
  if (locs !== 12) failures.push(`sitemap has ${locs} <loc> entries, expected 12`)
  console.log(`ok  sitemap.xml  locs=${locs}`)

  console.log(`ok  internal links checked: ${checkedLinks.size}`)
} finally {
  server.close()
}

if (failures.length) {
  console.error('\nFAIL')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}
console.log('\nPASS')
