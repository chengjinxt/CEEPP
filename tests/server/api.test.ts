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

function rawRequest(path: string, method: string, body?: BodyInit, headers?: HeadersInit): Request {
  const normalizedHeaders = new Headers(headers)
  if (!normalizedHeaders.has('content-length') && ArrayBuffer.isView(body)) {
    normalizedHeaders.set('content-length', String(body.byteLength))
  }
  return new Request(`https://example.test${path}`, { method, body, headers: normalizedHeaders })
}

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

async function adminRaw(path: string, method: string, body?: BodyInit, headers?: HeadersInit): Promise<Response> {
  return adminApp.fetch(rawRequest(path, method, body, headers), env)
}

async function cleanupScheduled(workerEnv: ServerEnv): Promise<void> {
  let scheduledWork: Promise<unknown> | undefined
  const context = {
    waitUntil(promise: Promise<unknown>) { scheduledWork = promise },
    passThroughOnException() {},
  } as ExecutionContext
  const scheduledWorker = worker as unknown as {
    scheduled(controller: ScheduledController, scheduledEnv: ServerEnv, ctx: ExecutionContext): void
  }
  scheduledWorker.scheduled({} as ScheduledController, workerEnv, context)
  await scheduledWork
}

const mathPaper = {
  title: '2025 年新高考数学真题',
  year: 2025,
  scope: 'national',
  originType: 'national',
  series: '新高考一卷',
  subject: '数学',
  subjectRole: 'unified',
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
  await database.exec('DELETE FROM candidates; DELETE FROM resources; DELETE FROM r2_cleanup_queue; DELETE FROM paper_regions; DELETE FROM papers;')
  const objects = await env.PAPER_FILES.list()
  if (objects.objects.length) await env.PAPER_FILES.delete(objects.objects.map((object) => object.key))
})

describe('public paper API', () => {
  it('keeps a legacy regional scope but leaves its authoring authority unclassified', async () => {
    const response = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      scope: 'regional',
      originType: undefined,
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ scope: 'regional', originType: 'unknown' })
  })

  it('exposes unambiguous origin and subject-role taxonomy while retaining scope compatibility', async () => {
    const response = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      scope: 'national',
      originType: 'joint',
      subjectRole: 'elective',
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      originType: 'joint',
      subjectRole: 'elective',
      scope: 'regional',
    })
  })

  it('canonicalizes known series, subjects and province-level region names at the API boundary', async () => {
    const created = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      series: '新高考Ⅰ卷',
      regions: ['北京市', '广西壮族自治区'],
    })
    expect(created.status).toBe(201)
    const paper = await created.json() as { id: number, series: string, subject: string, regions: string[] }
    expect(paper).toMatchObject({ series: '全国一卷', subject: '数学', regions: ['北京', '广西'] })

    await admin('/admin/api/candidates', 'POST', {
      sourceKey: 'manual', externalKey: 'canonical-match', title: '同一份数学资料',
      year: 2025, scope: 'national', originType: 'national', subjectRole: 'unified',
      series: '全国1卷', subject: '数学', regions: ['北京'],
      sourceUrl: 'https://source.example.test/canonical-match',
    })
    const candidates = await (await admin('/admin/api/candidates')).json() as {
      items: Array<{ externalKey: string, possiblePaperIds: number[] }>
    }
    expect(candidates.items.find((item) => item.externalKey === 'canonical-match')?.possiblePaperIds).toEqual([paper.id])

    const invalidRegion = await admin('/admin/api/papers', 'POST', { ...mathPaper, regions: ['台湾'] })
    expect(invalidRegion.status).toBe(400)

    const biology = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      title: '2025 年北京高考生物试卷',
      subject: '生物',
      regions: ['北京市'],
    })
    const biologyPaper = await biology.json() as { id: number, subject: string, regions: string[] }
    expect(biologyPaper).toMatchObject({ subject: '生物学', regions: ['北京'] })
    await admin(`/admin/api/papers/${biologyPaper.id}/status`, 'POST', { status: 'published' })
    const aliasQuery = await worker.fetch(request('/api/papers?subject=%E7%94%9F%E7%89%A9&region=%E5%8C%97%E4%BA%AC%E5%B8%82'), env)
    expect(aliasQuery.status).toBe(200)
    expect((await aliasQuery.json() as { total: number }).total).toBe(1)
  })

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
  it('keeps unknown candidate scope unset instead of misclassifying it as regional', async () => {
    const response = await admin('/admin/api/candidates', 'POST', {
      sourceKey: 'manual',
      externalKey: 'unknown-origin',
      title: '待核试卷',
      regions: [],
      sourceUrl: 'https://source.example.test/unknown',
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ originType: 'unknown', scope: null })
  })

  it('rejects JSON resources that try to forge uploaded-file metadata', async () => {
    const response = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      resources: [{
        format: 'PDF',
        kind: 'question',
        storageType: 'upload',
        storageKey: 'papers/forged.pdf',
        url: 'https://files.example.test/forged.pdf',
        linkType: 'source',
      }],
    })
    expect(response.status).toBe(400)
    expect((await response.json() as { error: string }).error).toContain('upload')
  })

  it('rejects unsupported resource kinds in external links and PDF uploads', async () => {
    const external = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      resources: [{ ...mathPaper.resources[0], kind: 'marking-scheme' }],
    })
    expect(external.status).toBe(400)

    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const upload = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=math.pdf&kind=marking-scheme`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf' },
    )
    expect(upload.status).toBe(400)
  })

  it('uploads a PDF to a draft and preserves it when external links are replaced', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const pdf = new TextEncoder().encode('%PDF-1.7\nCEEPP test')
    const upload = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=2025-math.pdf&kind=question`,
      'POST',
      pdf,
      { 'content-type': 'application/pdf' },
    )
    expect(upload.status).toBe(201)
    const resource = await upload.json() as Record<string, unknown>
    expect(resource).toMatchObject({
      format: 'PDF',
      kind: 'question',
      storageType: 'upload',
      linkType: 'upload',
      fileName: '2025-math.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf.byteLength,
    })
    expect(resource.url).toMatch(/^\/admin\/api\/resources\/\d+\/file$/)
    expect(resource.downloadUrl).toMatch(/^\/admin\/api\/resources\/\d+\/file\?download=1$/)
    expect(resource).not.toHaveProperty('storageKey')

    const update = await admin(`/admin/api/papers/${paperId}`, 'PUT', {
      ...mathPaper,
      resources: [{ ...mathPaper.resources[0], kind: 'question' }],
    })
    expect(update.status).toBe(200)
    const resources = (await update.json() as { resources: Array<{ storageType: string }> }).resources
    expect(resources.map((item) => item.storageType).sort()).toEqual(['external', 'upload'])
  })

  it('does not attach a PDF when the paper is published while the object is being stored', async () => {
    const paperId = await createPaper()
    let publicationStatus = 0
    let deletedKey = ''
    const racingBucket = {
      put: async (_key: string, value: unknown) => {
        if (value instanceof ReadableStream) await new Response(value).arrayBuffer()
        publicationStatus = (await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })).status
        return { etag: 'race-etag' }
      },
      delete: async (key: string) => { deletedKey = key },
    } as unknown as R2Bucket
    const racingEnv = { DB: database, PAPER_FILES: racingBucket } as ServerEnv
    const response = await createApp(async () => true).fetch(rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=race.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\nrace'),
      { 'content-type': 'application/pdf' },
    ), racingEnv)

    expect(publicationStatus).toBe(200)
    expect(response.status).toBe(409)
    expect(deletedKey).toMatch(new RegExp(`^papers/${paperId}/.+\\.pdf$`))
    const uploaded = await database.prepare("SELECT COUNT(*) AS count FROM resources WHERE paper_id = ? AND storage_type = 'upload'")
      .bind(paperId).first<{ count: number }>()
    expect(uploaded?.count).toBe(0)
  })

  it('keeps a durable cleanup marker when an uncommitted upload cannot be removed immediately', async () => {
    const paperId = await createPaper()
    let storageKey = ''
    const unavailableCleanupBucket = {
      put: async (key: string, value: ReadableStream<Uint8Array>, options: R2PutOptions) => {
        storageKey = key
        const stored = await env.PAPER_FILES.put(key, value, options)
        expect((await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })).status).toBe(200)
        return stored
      },
      delete: async () => { throw new Error('R2 temporarily unavailable') },
    } as unknown as R2Bucket
    const unavailableEnv = { DB: database, PAPER_FILES: unavailableCleanupBucket } as ServerEnv
    const response = await createApp(async () => true).fetch(rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=orphan-retry.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\norphan retry'),
      { 'content-type': 'application/pdf' },
    ), unavailableEnv)

    expect(response.status).toBe(409)
    expect(storageKey).toMatch(new RegExp(`^papers/${paperId}/.+\\.pdf$`))
    expect(await env.PAPER_FILES.head(storageKey)).not.toBeNull()
    expect(await database.prepare('SELECT reason, attempts FROM r2_cleanup_queue WHERE storage_key = ?')
      .bind(storageKey).first()).toMatchObject({ reason: 'upload_pending', attempts: 1 })

    await database.prepare("UPDATE r2_cleanup_queue SET created_at = datetime('now', '-1 day') WHERE storage_key = ?")
      .bind(storageKey).run()
    await cleanupScheduled(env)
    expect(await env.PAPER_FILES.head(storageKey)).toBeNull()
    expect(await database.prepare('SELECT storage_key FROM r2_cleanup_queue WHERE storage_key = ?')
      .bind(storageKey).first()).toBeNull()
  })

  it('never commits a live PDF resource after scheduled cleanup has claimed its pending upload', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    let storageKey = ''
    let releasePut!: () => void
    let releaseFirstDelete!: () => void
    let signalStored!: () => void
    let signalCleanupStarted!: () => void
    const putRelease = new Promise<void>((resolve) => { releasePut = resolve })
    const firstDeleteRelease = new Promise<void>((resolve) => { releaseFirstDelete = resolve })
    const stored = new Promise<void>((resolve) => { signalStored = resolve })
    const cleanupStarted = new Promise<void>((resolve) => { signalCleanupStarted = resolve })
    let deleteCalls = 0
    const barrierBucket = {
      put: async (key: string, value: ReadableStream<Uint8Array>, options: R2PutOptions) => {
        storageKey = key
        const result = await env.PAPER_FILES.put(key, value, options)
        signalStored()
        await putRelease
        return result
      },
      delete: async (key: string) => {
        deleteCalls += 1
        if (deleteCalls === 1) {
          signalCleanupStarted()
          await firstDeleteRelease
        }
        await env.PAPER_FILES.delete(key)
      },
    } as unknown as R2Bucket
    const barrierEnv = { DB: database, PAPER_FILES: barrierBucket } as ServerEnv

    const uploadPromise = createApp(async () => true).fetch(rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=claimed-race.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\nclaimed race'),
      { 'content-type': 'application/pdf' },
    ), barrierEnv)
    await stored
    await database.prepare("UPDATE r2_cleanup_queue SET created_at = datetime('now', '-1 day') WHERE storage_key = ?")
      .bind(storageKey).run()
    const cleanupPromise = cleanupScheduled(barrierEnv)
    await cleanupStarted
    releasePut()
    const upload = await uploadPromise
    releaseFirstDelete()
    await cleanupPromise

    expect(upload.status).toBe(409)
    expect(deleteCalls).toBeGreaterThanOrEqual(1)
    expect(await database.prepare('SELECT id FROM resources WHERE storage_key = ?')
      .bind(storageKey).first()).toBeNull()
    expect(await database.prepare('SELECT storage_key FROM r2_cleanup_queue WHERE storage_key = ?')
      .bind(storageKey).first()).toBeNull()
    expect(await env.PAPER_FILES.head(storageKey)).toBeNull()
  })

  it('recreates an upload cleanup marker if an object appears after an earlier empty cleanup', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    let storageKey = ''
    let signalPutStarted!: () => void
    let releasePut!: () => void
    const putStarted = new Promise<void>((resolve) => { signalPutStarted = resolve })
    const putRelease = new Promise<void>((resolve) => { releasePut = resolve })
    let deleteCalls = 0
    const lateObjectBucket = {
      put: async (key: string, value: ReadableStream<Uint8Array>, options: R2PutOptions) => {
        storageKey = key
        signalPutStarted()
        await putRelease
        return env.PAPER_FILES.put(key, value, options)
      },
      delete: async (key: string) => {
        deleteCalls += 1
        if (deleteCalls === 1) return env.PAPER_FILES.delete(key)
        throw new Error('R2 unavailable after the late upload completed')
      },
    } as unknown as R2Bucket
    const lateObjectEnv = { DB: database, PAPER_FILES: lateObjectBucket } as ServerEnv
    const uploadPromise = createApp(async () => true).fetch(rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=late-object.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\nlate object'),
      { 'content-type': 'application/pdf' },
    ), lateObjectEnv)

    await putStarted
    await database.prepare("UPDATE r2_cleanup_queue SET created_at = datetime('now', '-1 day') WHERE storage_key = ?")
      .bind(storageKey).run()
    await cleanupScheduled(lateObjectEnv)
    expect(await database.prepare('SELECT storage_key FROM r2_cleanup_queue WHERE storage_key = ?')
      .bind(storageKey).first()).toBeNull()

    releasePut()
    const upload = await uploadPromise
    expect(upload.status).toBe(409)
    expect(await env.PAPER_FILES.head(storageKey)).not.toBeNull()
    expect(await database.prepare(`SELECT size_bytes, reason, attempts, claimed_at
      FROM r2_cleanup_queue WHERE storage_key = ?`).bind(storageKey).first()).toMatchObject({
      size_bytes: 20, reason: 'upload_pending', attempts: 1, claimed_at: null,
    })

    await database.prepare("UPDATE r2_cleanup_queue SET created_at = datetime('now', '-1 day') WHERE storage_key = ?")
      .bind(storageKey).run()
    await cleanupScheduled(env)
    expect(await env.PAPER_FILES.head(storageKey)).toBeNull()
    expect(await database.prepare('SELECT storage_key FROM r2_cleanup_queue WHERE storage_key = ?')
      .bind(storageKey).first()).toBeNull()
  })

  it('rechecks the storage limit atomically after the R2 write', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const otherPaperId = await createPaper({ ...mathPaper, title: '另一份草稿', resources: [] })
    let deleted = false
    const racingBucket = {
      put: async (_key: string, value: unknown) => {
        if (value instanceof ReadableStream) await new Response(value).arrayBuffer()
        await database.prepare(`INSERT INTO resources
          (paper_id, format, kind, storage_type, storage_key, filename, mime_type, size_bytes)
          VALUES (?, 'PDF', 'question', 'upload', ?, 'existing.pdf', 'application/pdf', ?)`)
          .bind(otherPaperId, 'test/concurrent-existing.pdf', 9 * 1024 * 1024 * 1024)
          .run()
        return { etag: 'race-etag' }
      },
      delete: async () => { deleted = true },
    } as unknown as R2Bucket
    const racingEnv = { DB: database, PAPER_FILES: racingBucket } as ServerEnv
    const response = await createApp(async () => true).fetch(rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=over-limit-race.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\nrace'),
      { 'content-type': 'application/pdf' },
    ), racingEnv)

    expect(response.status).toBe(507)
    expect(deleted).toBe(true)
    const usage = await database.prepare("SELECT SUM(size_bytes) AS bytes FROM resources WHERE storage_type = 'upload'")
      .first<{ bytes: number }>()
    expect(usage?.bytes).toBe(9 * 1024 * 1024 * 1024)
  })

  it('reserves PDF capacity atomically before concurrent uploads write to R2', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const limit = 9 * 1024 * 1024 * 1024
    const pdf = new TextEncoder().encode('%PDF-1.7')
    await database.prepare(`INSERT INTO resources
      (paper_id, format, kind, storage_type, storage_key, filename, mime_type, size_bytes)
      VALUES (?, 'PDF', 'question', 'upload', 'test/almost-full.pdf', 'almost-full.pdf', 'application/pdf', ?)`)
      .bind(paperId, limit - pdf.byteLength).run()

    let releaseUsageReads!: () => void
    const bothUsageReads = new Promise<void>((resolve) => { releaseUsageReads = resolve })
    let usageReads = 0
    const barrierDb = new Proxy(database, {
      get(target, property) {
        if (property !== 'prepare') {
          const value = Reflect.get(target, property)
          return typeof value === 'function' ? value.bind(target) : value
        }
        return (query: string) => {
          const statement = target.prepare(query)
          if (!query.includes('COALESCE((SELECT SUM(size_bytes) FROM r2_cleanup_queue), 0) AS bytes')) {
            return statement
          }
          return new Proxy(statement, {
            get(statementTarget, statementProperty) {
              if (statementProperty !== 'first') {
                const value = Reflect.get(statementTarget, statementProperty)
                return typeof value === 'function' ? value.bind(statementTarget) : value
              }
              return async () => {
                const result = await statementTarget.first()
                usageReads += 1
                if (usageReads === 2) releaseUsageReads()
                await bothUsageReads
                return result
              }
            },
          })
        }
      },
    }) as D1Database
    const barrierEnv = { DB: barrierDb, PAPER_FILES: env.PAPER_FILES } as ServerEnv
    const app = createApp(async () => true)
    const upload = (name: string) => app.fetch(rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=${name}&kind=question`,
      'POST', pdf, { 'content-type': 'application/pdf' },
    ), barrierEnv)

    const responses = await Promise.all([upload('concurrent-a.pdf'), upload('concurrent-b.pdf')])
    expect(responses.map((response) => response.status).sort()).toEqual([201, 507])
    expect((await database.prepare("SELECT SUM(size_bytes) AS bytes FROM resources WHERE storage_type = 'upload'")
      .first<{ bytes: number }>())?.bytes).toBe(limit)
    expect((await database.prepare('SELECT COUNT(*) AS count FROM r2_cleanup_queue')
      .first<{ count: number }>())?.count).toBe(0)
    expect((await env.PAPER_FILES.list()).objects).toHaveLength(1)
  })

  it('keeps draft PDF private, then supports online viewing, HEAD, download and byte ranges after publication', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const pdf = new TextEncoder().encode('%PDF-1.7\n0123456789')
    const uploaded = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=%E6%95%B0%E5%AD%A6.pdf&kind=question`,
      'POST',
      pdf,
      { 'content-type': 'application/pdf' },
    )
    const resourceId = (await uploaded.json() as { id: number }).id

    expect((await worker.fetch(request(`/api/resources/${resourceId}/file`), env)).status).toBe(404)
    const preview = await adminRaw(`/admin/api/resources/${resourceId}/file`, 'GET')
    expect(preview.status).toBe(200)
    expect(preview.headers.get('content-type')).toBe('application/pdf')
    const disposition = preview.headers.get('content-disposition')!
    expect(disposition).toContain('inline')
    expect(disposition).toContain("filename*=UTF-8''%E6%95%B0%E5%AD%A6.pdf")
    expect([...disposition].every((character) => character.charCodeAt(0) < 128)).toBe(true)
    expect(preview.headers.get('cache-control')).toBe('private, no-store')
    const etag = preview.headers.get('etag')!
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(pdf)

    expect((await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })).status).toBe(200)
    const detail = await (await worker.fetch(request(`/api/papers/${paperId}`), env)).json() as {
      resources: Array<Record<string, unknown>>
    }
    expect(detail.resources[0]).toMatchObject({
      id: resourceId,
      storageType: 'upload',
      url: `/api/resources/${resourceId}/file`,
    })
    expect(detail.resources[0]).not.toHaveProperty('storageKey')

    const publicFile = await worker.fetch(request(`/api/resources/${resourceId}/file`), env)
    expect(publicFile.status).toBe(200)
    expect(publicFile.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(new Uint8Array(await publicFile.arrayBuffer())).toEqual(pdf)

    const notModified = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'GET', undefined, { 'if-none-match': etag },
    ), env)
    expect(notModified.status).toBe(304)

    const head = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'HEAD', undefined, { range: 'bytes=5-8' },
    ), env)
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe(String(pdf.byteLength))
    expect((await head.arrayBuffer()).byteLength).toBe(0)

    const range = await worker.fetch(rawRequest(`/api/resources/${resourceId}/file`, 'GET', undefined, { range: 'bytes=5-8' }), env)
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toBe(`bytes 5-8/${pdf.byteLength}`)
    expect(new TextDecoder().decode(await range.arrayBuffer())).toBe('1.7\n')

    const ifRangeMismatch = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'GET', undefined,
      { range: 'bytes=5-8', 'if-range': '"different-etag"' },
    ), env)
    expect(ifRangeMismatch.status).toBe(200)
    expect(new Uint8Array(await ifRangeMismatch.arrayBuffer())).toEqual(pdf)

    const multipleRanges = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'GET', undefined, { range: 'bytes=0-1,5-8' },
    ), env)
    expect(multipleRanges.status).toBe(200)
    expect(new Uint8Array(await multipleRanges.arrayBuffer())).toEqual(pdf)

    const invalidPublicRange = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'GET', undefined, { range: 'bytes=999-' },
    ), env)
    expect(invalidPublicRange.status).toBe(416)
    expect(invalidPublicRange.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')

    const invalidAdminRange = await adminRaw(
      `/admin/api/resources/${resourceId}/file`, 'GET', undefined, { range: 'bytes=999-' },
    )
    expect(invalidAdminRange.status).toBe(416)
    expect(invalidAdminRange.headers.get('cache-control')).toBe('private, no-store')

    const download = await worker.fetch(request(`/api/resources/${resourceId}/file?download=1`), env)
    expect(download.headers.get('content-disposition')).toContain('attachment')
  })

  it('uses current R2 metadata for conditional requests and never serves stale ranges', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const firstPdf = new TextEncoder().encode('%PDF-1.7\nfirst-version')
    const uploaded = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=replace.pdf&kind=question`,
      'POST',
      firstPdf,
      { 'content-type': 'application/pdf' },
    )
    const resourceId = (await uploaded.json() as { id: number }).id
    await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })
    const first = await worker.fetch(request(`/api/resources/${resourceId}/file`), env)
    const oldEtag = first.headers.get('etag')!
    await first.arrayBuffer()
    const stored = await database.prepare('SELECT storage_key FROM resources WHERE id = ?').bind(resourceId)
      .first<{ storage_key: string }>()

    const secondPdf = new TextEncoder().encode('%PDF-1.7\nsecond-version-is-longer')
    await env.PAPER_FILES.put(stored!.storage_key, secondPdf, { httpMetadata: { contentType: 'application/pdf' } })

    const changed = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'GET', undefined, { 'if-none-match': oldEtag },
    ), env)
    expect(changed.status).toBe(200)
    expect(changed.headers.get('etag')).not.toBe(oldEtag)
    expect(changed.headers.get('content-length')).toBe(String(secondPdf.byteLength))
    expect(new Uint8Array(await changed.arrayBuffer())).toEqual(secondPdf)

    const staleRange = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'GET', undefined,
      { range: 'bytes=5-8', 'if-range': oldEtag },
    ), env)
    expect(staleRange.status).toBe(200)
    expect(new Uint8Array(await staleRange.arrayBuffer())).toEqual(secondPdf)

    await env.PAPER_FILES.delete(stored!.storage_key)
    const missing = await worker.fetch(rawRequest(
      `/api/resources/${resourceId}/file`, 'GET', undefined, { 'if-none-match': oldEtag },
    ), env)
    expect(missing.status).toBe(404)
  })

  it('validates PDF uploads and only accepts them while a paper is a draft', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const missingLengthRequest = rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=missing-length.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf' },
    )
    missingLengthRequest.headers.delete('content-length')
    const missingLength = await adminApp.fetch(missingLengthRequest, env)
    expect(missingLength.status).toBe(411)

    const browserLengthRequest = rawRequest(
      `/admin/api/papers/${paperId}/resources/pdf?filename=browser-size.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf', 'x-ceepp-file-size': '8' },
    )
    browserLengthRequest.headers.delete('content-length')
    const browserLength = await adminApp.fetch(browserLengthRequest, env)
    expect(browserLength.status).toBe(201)

    const mismatchedBrowserLength = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=mismatched-size.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf', 'content-length': '8', 'x-ceepp-file-size': '9' },
    )
    expect(mismatchedBrowserLength.status).toBe(400)

    const wrongMagic = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=fake.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('not a PDF'),
      { 'content-type': 'application/pdf' },
    )
    expect(wrongMagic.status).toBe(400)

    const wrongExtension = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=fake.txt&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf' },
    )
    expect(wrongExtension.status).toBe(400)

    const tooLarge = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=large.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf', 'content-length': String(50 * 1024 * 1024 + 1) },
    )
    expect(tooLarge.status).toBe(413)

    await admin(`/admin/api/papers/${paperId}`, 'PUT', mathPaper)
    await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })
    const publishedUpload = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=late.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf' },
    )
    expect(publishedUpload.status).toBe(409)
  })

  it('stops uploads before the private bucket exceeds the 9 GiB free-tier safety limit', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    await database.prepare(`INSERT INTO resources
      (paper_id, format, kind, storage_type, storage_key, filename, mime_type, size_bytes)
      VALUES (?, 'PDF', 'question', 'upload', ?, 'existing.pdf', 'application/pdf', ?)`)
      .bind(paperId, 'test/existing.pdf', 9 * 1024 * 1024 * 1024)
      .run()

    const response = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=over-limit.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf' },
    )
    expect(response.status).toBe(507)
    expect((await response.json() as { error: string }).error).toContain('9 GiB')
    expect((await env.PAPER_FILES.list()).objects).toHaveLength(0)
  })

  it('counts queued orphan objects toward the PDF storage safety limit', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    await database.prepare(`INSERT INTO r2_cleanup_queue (storage_key, size_bytes, reason)
      VALUES ('orphan/full.pdf', ?, 'upload_pending')`).bind(9 * 1024 * 1024 * 1024).run()

    const response = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=over-queued-limit.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7'),
      { 'content-type': 'application/pdf' },
    )
    expect(response.status).toBe(507)
  })

  it('deletes both uploaded PDF content and its resource record from a draft', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const uploaded = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=remove.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\nremove me'),
      { 'content-type': 'application/pdf' },
    )
    const resourceId = (await uploaded.json() as { id: number }).id
    expect((await env.PAPER_FILES.list()).objects).toHaveLength(1)

    const removed = await admin(`/admin/api/papers/${paperId}/resources/${resourceId}`, 'DELETE')
    expect(removed.status).toBe(204)
    expect((await env.PAPER_FILES.list()).objects).toHaveLength(0)
    expect((await admin(`/admin/api/resources/${resourceId}/file`)).status).toBe(404)
  })

  it('prevents publication from racing past an uploaded-resource deletion', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const uploaded = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=delete-race.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\ndelete race'),
      { 'content-type': 'application/pdf' },
    )
    const resourceId = (await uploaded.json() as { id: number }).id
    let publicationStatus = 0
    const racingBucket = {
      delete: async (key: string) => {
        publicationStatus = (await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })).status
        await env.PAPER_FILES.delete(key)
      },
    } as unknown as R2Bucket
    const racingEnv = { DB: database, PAPER_FILES: racingBucket } as ServerEnv
    const response = await createApp(async () => true).fetch(
      request(`/admin/api/papers/${paperId}/resources/${resourceId}`, 'DELETE'),
      racingEnv,
    )

    expect(response.status).toBe(204)
    expect(publicationStatus).toBe(422)
    const paper = await database.prepare('SELECT status FROM papers WHERE id = ?').bind(paperId).first<{ status: string }>()
    expect(paper?.status).toBe('draft')
  })

  it('retries an uploaded-object deletion durably when R2 is temporarily unavailable', async () => {
    const paperId = await createPaper({ ...mathPaper, resources: [] })
    const uploaded = await adminRaw(
      `/admin/api/papers/${paperId}/resources/pdf?filename=retry-delete.pdf&kind=question`,
      'POST',
      new TextEncoder().encode('%PDF-1.7\nretry delete'),
      { 'content-type': 'application/pdf' },
    )
    const resourceId = (await uploaded.json() as { id: number }).id
    const stored = await database.prepare('SELECT storage_key FROM resources WHERE id = ?').bind(resourceId)
      .first<{ storage_key: string }>()

    const unavailableBucket = {
      delete: async () => { throw new Error('R2 temporarily unavailable') },
    } as unknown as R2Bucket
    const unavailableEnv = { DB: database, PAPER_FILES: unavailableBucket } as ServerEnv
    const deletion = await createApp(async () => true).fetch(
      request(`/admin/api/papers/${paperId}/resources/${resourceId}`, 'DELETE'),
      unavailableEnv,
    )

    expect(deletion.status).toBe(202)
    expect(await deletion.json()).toMatchObject({ cleanupPending: true })
    expect(await database.prepare('SELECT id FROM resources WHERE id = ?').bind(resourceId).first()).toBeNull()
    const queued = await database.prepare(`SELECT storage_key, size_bytes, reason, attempts
      FROM r2_cleanup_queue WHERE storage_key = ?`).bind(stored!.storage_key)
      .first<{ storage_key: string, size_bytes: number, reason: string, attempts: number }>()
    expect(queued).toMatchObject({
      storage_key: stored!.storage_key,
      size_bytes: 21,
      reason: 'deleted_resource',
      attempts: 1,
    })
    expect(await env.PAPER_FILES.head(stored!.storage_key)).not.toBeNull()

    await database.prepare("UPDATE r2_cleanup_queue SET created_at = datetime('now', '-1 day') WHERE storage_key = ?")
      .bind(stored!.storage_key).run()
    await cleanupScheduled(env)

    expect(await database.prepare('SELECT storage_key FROM r2_cleanup_queue WHERE storage_key = ?')
      .bind(stored!.storage_key).first()).toBeNull()
    expect(await env.PAPER_FILES.head(stored!.storage_key)).toBeNull()
  })

  it('blocks every documented admin entry without Access while keeping the public API open', async () => {
    for (const path of ['/admin', '/admin/candidates', '/admin/papers', '/admin/api/papers', '/admin/api/candidates']) {
      expect((await worker.fetch(request(path), env)).status).toBe(403)
    }
    expect((await worker.fetch(request('/api/papers'), env)).status).toBe(200)
  })

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

  it('only suggests and merges papers with the same full taxonomy', async () => {
    const paperId = await createPaper()
    await admin('/admin/api/candidates', 'POST', {
      sourceKey: 'manual', externalKey: 'maybe-duplicate', title: '另一份数学资料',
      year: 2025, scope: 'national', series: '新高考一卷', subject: '数学',
      originType: 'national', subjectRole: 'unified',
      regions: ['广东'], sourceUrl: 'https://source.example.test/maybe',
    })
    const list = await (await admin('/admin/api/candidates')).json() as { items: Array<{ possiblePaperIds: number[] }> }
    expect(list.items[0].possiblePaperIds).toEqual([paperId])

    await admin('/admin/api/candidates', 'POST', {
      sourceKey: 'manual', externalKey: 'different-origin', title: '省际同卷数学资料',
      year: 2025, scope: 'regional', originType: 'joint', subjectRole: 'unified',
      series: '新高考一卷', subject: '数学', regions: ['广东'],
      sourceUrl: 'https://source.example.test/different-origin',
    })
    const provincialPaper = await admin('/admin/api/papers', 'POST', {
      ...mathPaper,
      scope: 'regional',
      originType: 'provincial',
      subjectRole: 'unified',
    })
    const provincialPaperId = (await provincialPaper.json() as { id: number }).id
    const different = await (await admin('/admin/api/candidates')).json() as {
      items: Array<{ id: number, externalKey: string, possiblePaperIds: number[] }>
    }
    const jointCandidate = different.items.find((item) => item.externalKey === 'different-origin')!
    expect(jointCandidate.possiblePaperIds).not.toContain(provincialPaperId)
    expect((await admin(`/admin/api/candidates/${jointCandidate.id}/review`, 'POST', {
      action: 'merge', paperId: provincialPaperId,
    })).status).toBe(409)
  })

  it('matches a full candidate page without exceeding the D1 parameter limit', async () => {
    const expected = new Map<string, number>()
    for (let index = 0; index < 17; index++) {
      const year = 2000 + index
      const series = `参数边界卷 ${index}`
      const paperResponse = await admin('/admin/api/papers', 'POST', {
        ...mathPaper,
        title: `${year} 年参数边界测试卷 ${index}`,
        year,
        series,
        resources: [],
      })
      const paper = await paperResponse.json() as { id: number }
      const externalKey = `parameter-limit-${index}`
      expected.set(externalKey, paper.id)
      expect((await admin('/admin/api/candidates', 'POST', {
        sourceKey: 'parameter-limit', externalKey, title: `${year} 年参数边界候选 ${index}`,
        year, scope: 'national', originType: 'national', subjectRole: 'unified',
        series, subject: '数学', regions: [], sourceUrl: `https://source.example.test/${index}`,
      })).status).toBe(201)
    }

    const response = await admin('/admin/api/candidates')
    expect(response.status).toBe(200)
    const page = await response.json() as { items: Array<{ externalKey: string, possiblePaperIds: number[] }> }
    expect(page.items).toHaveLength(17)
    for (const candidate of page.items) {
      expect(candidate.possiblePaperIds).toEqual([expected.get(candidate.externalKey)])
    }
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
      resourceLinkType: 'drive',
      resourceUrl: 'https://files.example.test/math-alt.pdf',
      sourceUrl: 'https://source.example.test/math-alt',
      classification: 'ordinary',
    })
    expect(candidateResponse.status).toBe(201)
    const candidate = await candidateResponse.json() as { id: number }
    const merge = await admin(`/admin/api/candidates/${candidate.id}/review`, 'POST', { action: 'merge', paperId })
    expect(merge.status).toBe(200)

    const detail = await (await admin(`/admin/api/papers/${paperId}`)).json() as { status: string, regions: string[], resources: Array<{ url: string, linkType: string }> }
    expect(detail.status).toBe('draft')
    expect(detail.regions).toEqual(['广东', '山东', '浙江'])
    expect(detail.resources.map((resource) => resource.url)).toContain('https://files.example.test/math-alt.pdf')
    expect(detail.resources.find((resource) => resource.url === 'https://files.example.test/math-alt.pdf')?.linkType).toBe('drive')
    const pending = await (await admin('/admin/api/candidates?status=pending')).json() as { total: number }
    expect(pending.total).toBe(0)
  })

  it('keeps a crawled resource private until an administrator merges it into a published paper', async () => {
    const paperId = await createPaper()
    await admin(`/admin/api/papers/${paperId}/status`, 'POST', { status: 'published' })
    const inserted = await database.prepare(`INSERT INTO candidates
      (source_key, external_key, title, year, scope, series, subject, regions_json, format, resource_url, source_url, classification, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind('crawler', 'new-html', mathPaper.title, 2025, 'national', '全国一卷', '数学', '["广东"]', 'HTML', 'https://files.example.test/new.html', 'https://source.example.test/new', 'ordinary', '{}')
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

  it('rejects unsupported legacy candidate regions before merging', async () => {
    const paperId = await createPaper()
    const inserted = await database.prepare(`INSERT INTO candidates
      (source_key, external_key, title, year, scope, origin_type, subject_role, series, subject,
       regions_json, source_url, classification, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind('legacy', 'unsupported-region', mathPaper.title, 2025, 'national', 'national', 'unified',
        '全国一卷', '数学', '["台湾"]', 'https://source.example.test/legacy', 'ordinary', '{}')
      .first<{ id: number }>()

    const response = await admin(`/admin/api/candidates/${inserted!.id}/review`, 'POST', { action: 'merge', paperId })
    expect(response.status).toBe(400)
    expect((await database.prepare("SELECT COUNT(*) AS count FROM paper_regions WHERE paper_id = ? AND region = '台湾'").bind(paperId).first<{ count: number }>())?.count).toBe(0)
  })
})
