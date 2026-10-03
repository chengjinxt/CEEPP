/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env as workerEnv } from 'cloudflare:test'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import worker, { createApp, type Env as ServerEnv } from '../../src/server/index'

type TestEnv = ServerEnv & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1]
}

const env = workerEnv as unknown as TestEnv
const database = env.DB
const adminApp = createApp(async () => true)

function request(path: string, method = 'GET', body?: unknown): Request {
  return new Request(`https://example.test${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function admin(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return adminApp.fetch(request(path, method, body), env)
}

const mathPaper = {
  title: '2025 年新高考数学真题',
  year: 2025,
  scope: 'national',
  series: '新高考一卷',
  subject: '数学',
  regions: ['广东', '山东'],
  resources: [
    {
      format: 'PDF',
      url: 'https://files.example.test/math.pdf',
      linkType: 'source',
      sourceName: '示例来源',
      sourceUrl: 'https://source.example.test/math',
      verifiedAt: '2026-10-03',
    },
    {
      format: 'HTML',
      url: 'https://files.example.test/math.html',
      linkType: 'source',
      sourceName: '示例来源',
      sourceUrl: 'https://source.example.test/math',
      verifiedAt: '2026-10-03',
    },
  ],
}

async function createPaper(paper: typeof mathPaper = mathPaper): Promise<number> {
  const response = await admin('/admin/api/papers', 'POST', paper)
  expect(response.status).toBe(201)
  const saved = await response.json() as { id: number }
  return saved.id
}

beforeAll(async () => {
  await applyD1Migrations(database, env.TEST_MIGRATIONS)
})

beforeEach(async () => {
  await database.exec('DELETE FROM candidates; DELETE FROM resources; DELETE FROM paper_regions; DELETE FROM papers;')
})

describe('public paper API', () => {
  it('hides drafts and returns only published papers with all regions and formats', async () => {
    const id = await createPaper()
    const draftList = await worker.fetch(request('/api/papers'), env)
    expect((await draftList.json() as { total: number }).total).toBe(0)
    expect((await worker.fetch(request(`/api/papers/${id}`), env)).status).toBe(404)

    const publication = await admin(`/admin/api/papers/${id}/status`, 'POST', { status: 'published' })
    expect(publication.status).toBe(200)

    const response = await worker.fetch(request('/api/papers?year=2025&scope=national&region=广东&subject=数学&q=新高考数学'), env)
    const list = await response.json() as { total: number, items: Array<{ id: number, regions: string[] }> }
    expect(list.total).toBe(1)
    expect(list.items[0]).toMatchObject({ id, regions: ['广东', '山东'] })

    const detailResponse = await worker.fetch(request(`/api/papers/${id}`), env)
    const detail = await detailResponse.json() as { resources: Array<{ format: string }> }
    expect(detail.resources.map((resource) => resource.format)).toEqual(['PDF', 'HTML'])
  })

  it('paginates and excludes records outside the selected subject', async () => {
    for (let index = 0; index < 21; index++) {
      const id = await createPaper({ ...mathPaper, title: `数学试卷 ${index}` })
      expect((await admin(`/admin/api/papers/${id}/status`, 'POST', { status: 'published' })).status).toBe(200)
    }
    const chineseId = await createPaper({ ...mathPaper, title: '语文真题', subject: '语文' })
    expect((await admin(`/admin/api/papers/${chineseId}/status`, 'POST', { status: 'published' })).status).toBe(200)

    const first = await (await worker.fetch(request('/api/papers?subject=数学&page=1'), env)).json() as { total: number, items: unknown[] }
    const second = await (await worker.fetch(request('/api/papers?subject=数学&page=2'), env)).json() as { total: number, items: unknown[] }
    expect(first.total).toBe(21)
    expect(first.items).toHaveLength(20)
    expect(second.items).toHaveLength(1)
  })

  it('treats search text as data rather than SQL or FTS syntax', async () => {
    const id = await createPaper()
    await admin(`/admin/api/papers/${id}/status`, 'POST', { status: 'published' })
    const response = await worker.fetch(request('/api/papers?q=%22)%20OR%201%3D1%20--'), env)
    expect(response.status).toBe(200)
    expect((await response.json() as { total: number }).total).toBe(0)
  })

  it('updates the searchable title index when an administrator renames a paper', async () => {
    const id = await createPaper()
    await admin(`/admin/api/papers/${id}/status`, 'POST', { status: 'published' })
    await admin(`/admin/api/papers/${id}`, 'PUT', { ...mathPaper, title: '2025 年高考数学修订卷' })
    expect((await (await worker.fetch(request('/api/papers?q=新高考数学'), env)).json() as { total: number }).total).toBe(0)
    expect((await (await worker.fetch(request('/api/papers?q=高考数学修订'), env)).json() as { total: number }).total).toBe(1)
  })
})

describe('admin paper and candidate API', () => {
  it('denies a missing or forged Access JWT before any management read or write', async () => {
    expect((await worker.fetch(request('/admin/api/papers'), env)).status).toBe(403)
    const forged = request('/admin/api/papers', 'POST', mathPaper)
    forged.headers.set('Cf-Access-Jwt-Assertion', 'forged.token.value')
    expect((await worker.fetch(forged, env)).status).toBe(403)
    expect((await database.prepare('SELECT COUNT(*) AS count FROM papers').first<{ count: number }>())?.count).toBe(0)
  })

  it('updates a draft, publishes it, then removes it from public results when unpublished', async () => {
    const id = await createPaper()
    const update = await admin(`/admin/api/papers/${id}`, 'PUT', { ...mathPaper, title: '修订后的数学真题', regions: ['上海'] })
    expect(update.status).toBe(200)
    expect((await update.json() as { regions: string[] }).regions).toEqual(['上海'])
    await admin(`/admin/api/papers/${id}/status`, 'POST', { status: 'published' })
    expect((await (await worker.fetch(request('/api/papers?region=上海'), env)).json() as { total: number }).total).toBe(1)
    await admin(`/admin/api/papers/${id}/status`, 'POST', { status: 'draft' })
    expect((await (await worker.fetch(request('/api/papers?region=上海'), env)).json() as { total: number }).total).toBe(0)
  })

  it('does not hard-delete papers through the management API', async () => {
    const id = await createPaper()
    const response = await admin(`/admin/api/papers/${id}`, 'DELETE')
    expect(response.status).toBe(405)
    expect((await admin(`/admin/api/papers/${id}`)).status).toBe(200)
  })

  it('rejects a non-HTTP resource URL before writing a paper', async () => {
    const response = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      resources: [{ ...mathPaper.resources[0], url: 'javascript:alert(1)' }],
    })
    expect(response.status).toBe(400)
    expect((await database.prepare('SELECT COUNT(*) AS count FROM papers').first<{ count: number }>())?.count).toBe(0)
  })

  it('creates a draft from an approved candidate and prevents a second review', async () => {
    const response = await admin('/admin/api/candidates', 'POST', {
      sourceKey: 'manual', externalKey: 'math-draft', title: mathPaper.title,
      year: 2025, scope: 'national', series: '新高考一卷', subject: '数学',
      regions: ['广东'], format: 'PDF', resourceUrl: mathPaper.resources[0].url,
      sourceUrl: 'https://source.example.test/math', classification: 'ordinary',
    })
    const candidate = await response.json() as { id: number }
    const reviewed = await admin(`/admin/api/candidates/${candidate.id}/review`, 'POST', { action: 'create', paper: mathPaper })
    expect(reviewed.status).toBe(200)
    const result = await reviewed.json() as { candidate: { reviewStatus: string }, paper: { id: number, status: string } }
    expect(result.candidate.reviewStatus).toBe('approved')
    expect(result.paper.status).toBe('draft')
    expect((await worker.fetch(request(`/api/papers/${result.paper.id}`), env)).status).toBe(404)
    expect((await admin(`/admin/api/candidates/${candidate.id}/review`, 'POST', { action: 'create', paper: mathPaper })).status).toBe(409)
  })

  it('suggests papers with the same year, scope, series and subject for candidate merging', async () => {
    const paperId = await createPaper()
    await admin('/admin/api/candidates', 'POST', {
      sourceKey: 'manual', externalKey: 'maybe-duplicate', title: '另一份数学资料',
      year: 2025, scope: 'national', series: '新高考一卷', subject: '数学',
      regions: ['广东'], sourceUrl: 'https://source.example.test/maybe',
    })
    const list = await (await admin('/admin/api/candidates')).json() as { items: Array<{ possiblePaperIds: number[] }> }
    expect(list.items[0].possiblePaperIds).toEqual([paperId])
  })

  it('merges a reviewed candidate into an existing paper without publishing it', async () => {
    const paperId = await createPaper()
    const candidateResponse = await admin('/admin/api/candidates', 'POST', {
      sourceKey: 'manual',
      externalKey: '2025-math-html',
      title: '2025 数学真题',
      year: 2025,
      scope: 'national',
      series: '新高考一卷',
      subject: '数学',
      regions: ['浙江'],
      format: 'PDF',
      resourceUrl: 'https://files.example.test/math-alt.pdf',
      sourceUrl: 'https://source.example.test/math-alt',
      classification: 'ordinary',
    })
    expect(candidateResponse.status).toBe(201)
    const candidate = await candidateResponse.json() as { id: number }
    const merge = await admin(`/admin/api/candidates/${candidate.id}/review`, 'POST', { action: 'merge', paperId })
    expect(merge.status).toBe(200)

    const detail = await (await admin(`/admin/api/papers/${paperId}`)).json() as { status: string, regions: string[], resources: Array<{ url: string }> }
    expect(detail.status).toBe('draft')
    expect(detail.regions).toEqual(['广东', '山东', '浙江'])
    expect(detail.resources.map((resource) => resource.url)).toContain('https://files.example.test/math-alt.pdf')
    const pending = await (await admin('/admin/api/candidates?status=pending')).json() as { total: number }
    expect(pending.total).toBe(0)
  })

  it('keeps a crawled resource private until an administrator merges it into a published paper', async () => {
    const paperId = await createPaper()
    await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })
    const inserted = await database.prepare(`INSERT INTO candidates
      (source_key, external_key, title, year, scope, series, subject, regions_json, format, resource_url, source_url, classification, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind('crawler', 'new-html', mathPaper.title, 2025, 'national', mathPaper.series, '数学', '["广东"]', 'HTML', 'https://files.example.test/new.html', 'https://source.example.test/new', 'ordinary', '{}')
      .first<{ id: number }>()
    const before = await (await worker.fetch(request(`/api/papers/${paperId}`), env)).json() as { resources: Array<{ url: string }> }
    expect(before.resources.map((resource) => resource.url)).not.toContain('https://files.example.test/new.html')

    expect((await admin(`/admin/api/candidates/${inserted!.id}/review`, 'POST', { action: 'merge', paperId })).status).toBe(200)
    const after = await (await worker.fetch(request(`/api/papers/${paperId}`), env)).json() as { resources: Array<{ url: string }> }
    expect(after.resources.map((resource) => resource.url)).toContain('https://files.example.test/new.html')
  })

  it('rejects unsafe crawled links before merging them into a paper', async () => {
    const paperId = await createPaper()
    const inserted = await database.prepare(`INSERT INTO candidates
      (source_key, external_key, title, year, scope, subject, regions_json, format, resource_url, source_url, classification, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind('crawler', 'unsafe-link', '2025 数学真题', 2025, 'national', '数学', '[]', 'PDF', 'javascript:alert(1)', 'https://source.example.test/', 'ordinary', '{}')
      .first<{ id: number }>()
    const response = await admin(`/admin/api/candidates/${inserted!.id}/review`, 'POST', { action: 'merge', paperId })
    expect(response.status).toBe(400)
    const candidate = await database.prepare('SELECT review_status FROM candidates WHERE id = ?').bind(inserted!.id).first<{ review_status: string }>()
    expect(candidate?.review_status).toBe('pending')
  })
})
