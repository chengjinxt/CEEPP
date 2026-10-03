import { verifyAdmin, type AccessEnv } from './auth'

export interface Env extends AccessEnv {
  DB: D1Database
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

type AuthorizeAdmin = (request: Request, env: Env) => Promise<boolean>
type Scope = 'national' | 'regional'
type PaperStatus = 'draft' | 'published'

interface ResourceInput {
  format: string
  url: string
  linkType: 'source' | 'drive'
  sourceName: string | null
  sourceUrl: string | null
  accessCode: string | null
  verifiedAt: string | null
}

interface PaperInput {
  title: string
  year: number
  scope: Scope
  series: string
  subject: string
  regions: string[]
  resources: ResourceInput[]
}

interface PaperRow {
  id: number
  title: string
  year: number
  scope: Scope
  series: string
  subject: string
  status: PaperStatus
}

interface RegionRow {
  paper_id: number
  region: string
}

interface ResourceRow {
  id: number
  paper_id: number
  format: string
  url: string
  link_type: 'source' | 'drive'
  source_name: string | null
  source_url: string | null
  access_code: string | null
  verified_at: string | null
}

interface CandidateRow {
  id: number
  source_key: string
  external_key: string
  title: string
  year: number | null
  scope: Scope | null
  series: string | null
  subject: string | null
  regions_json: string
  format: string | null
  resource_url: string | null
  source_url: string
  classification: 'ordinary' | 'uncertain'
  review_status: 'pending' | 'approved' | 'rejected'
  paper_id: number | null
}

class HttpFailure extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  })
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpFailure('Expected a JSON object', 400)
  return value as Record<string, unknown>
}

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new HttpFailure('Content-Type must be application/json', 415)
  }
  const raw = await request.text()
  if (raw.length > 200_000) throw new HttpFailure('Request body is too large', 413)
  try {
    return object(JSON.parse(raw))
  } catch {
    throw new HttpFailure('Invalid JSON object', 400)
  }
}

function requiredText(value: unknown, name: string, maximum = 300): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new HttpFailure(`${name} is required`, 400)
  }
  return value.trim()
}

function optionalText(value: unknown, name: string, maximum = 300): string | null {
  if (value === undefined || value === null || value === '') return null
  return requiredText(value, name, maximum)
}

function httpUrl(value: unknown, name: string, required = true): string | null {
  if (!required && (value === undefined || value === null || value === '')) return null
  const input = requiredText(value, name, 2048)
  try {
    const parsed = new URL(input)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol')
    return parsed.toString()
  } catch {
    throw new HttpFailure(`${name} must be an HTTP(S) URL`, 400)
  }
}

function yearValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1950 || value > 2100) {
    throw new HttpFailure('year must be an integer between 1950 and 2100', 400)
  }
  return value
}

function scopeValue(value: unknown): Scope {
  if (value !== 'national' && value !== 'regional') throw new HttpFailure('scope must be national or regional', 400)
  return value
}

function regionsValue(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 40) throw new HttpFailure('regions must be an array', 400)
  return [...new Set(value.map((entry) => requiredText(entry, 'region', 40)))]
}

function resourceValue(value: unknown): ResourceInput {
  const input = object(value)
  const linkType = input.linkType
  if (linkType !== 'source' && linkType !== 'drive') throw new HttpFailure('linkType must be source or drive', 400)
  return {
    format: requiredText(input.format, 'format', 30).toUpperCase(),
    url: httpUrl(input.url, 'url')!,
    linkType,
    sourceName: optionalText(input.sourceName, 'sourceName', 120),
    sourceUrl: httpUrl(input.sourceUrl, 'sourceUrl', false),
    accessCode: optionalText(input.accessCode, 'accessCode', 80),
    verifiedAt: optionalText(input.verifiedAt, 'verifiedAt', 40),
  }
}

function paperValue(value: unknown): PaperInput {
  const input = object(value)
  if (!Array.isArray(input.resources) || input.resources.length > 30) throw new HttpFailure('resources must be an array', 400)
  return {
    title: requiredText(input.title, 'title'),
    year: yearValue(input.year),
    scope: scopeValue(input.scope),
    series: optionalText(input.series, 'series', 120) ?? '',
    subject: requiredText(input.subject, 'subject', 80),
    regions: regionsValue(input.regions),
    resources: input.resources.map(resourceValue),
  }
}

function candidateValue(value: unknown): Omit<CandidateRow, 'id' | 'review_status' | 'paper_id' | 'regions_json'> & { regions: string[], raw_json: string } {
  const input = object(value)
  const classification = input.classification ?? 'uncertain'
  if (classification !== 'ordinary' && classification !== 'uncertain') throw new HttpFailure('Invalid classification', 400)
  return {
    source_key: requiredText(input.sourceKey, 'sourceKey', 80),
    external_key: requiredText(input.externalKey, 'externalKey', 200),
    title: requiredText(input.title, 'title'),
    year: input.year === undefined || input.year === null ? null : yearValue(input.year),
    scope: input.scope === undefined || input.scope === null ? null : scopeValue(input.scope),
    series: optionalText(input.series, 'series', 120),
    subject: optionalText(input.subject, 'subject', 80),
    regions: regionsValue(input.regions ?? []),
    format: optionalText(input.format, 'format', 30)?.toUpperCase() ?? null,
    resource_url: httpUrl(input.resourceUrl, 'resourceUrl', false),
    source_url: httpUrl(input.sourceUrl, 'sourceUrl')!,
    classification,
    raw_json: JSON.stringify(input.raw ?? {}),
  }
}

function positiveId(value: string | undefined): number {
  const id = Number(value)
  if (!id || !Number.isSafeInteger(id) || id < 1) throw new HttpFailure('Invalid id', 404)
  return id
}

function pageValue(value: string | null): number {
  if (value === null || value === '') return 1
  const page = Number(value)
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new HttpFailure('Invalid page', 400)
  return page
}

function resourceDto(row: ResourceRow): Record<string, unknown> {
  return {
    id: row.id,
    format: row.format,
    url: row.url,
    linkType: row.link_type,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    accessCode: row.access_code,
    verifiedAt: row.verified_at,
  }
}

function candidateDto(row: CandidateRow): Record<string, unknown> {
  let regions: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.regions_json)
    if (Array.isArray(parsed)) regions = parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    // Keep a damaged crawl row in the review queue for manual correction.
  }
  return {
    id: row.id,
    sourceKey: row.source_key,
    externalKey: row.external_key,
    title: row.title,
    year: row.year,
    scope: row.scope,
    series: row.series,
    subject: row.subject,
    regions,
    format: row.format,
    resourceUrl: row.resource_url,
    sourceUrl: row.source_url,
    classification: row.classification,
    reviewStatus: row.review_status,
    paperId: row.paper_id,
  }
}

async function regionsFor(db: D1Database, ids: number[]): Promise<Map<number, string[]>> {
  const result = new Map(ids.map((id) => [id, [] as string[]]))
  if (!ids.length) return result
  const placeholders = ids.map(() => '?').join(',')
  const rows = await db.prepare(`SELECT paper_id, region FROM paper_regions WHERE paper_id IN (${placeholders}) ORDER BY rowid`).bind(...ids).all<RegionRow>()
  for (const row of rows.results) result.get(row.paper_id)?.push(row.region)
  return result
}

async function paperDetail(db: D1Database, id: number, includeDraft: boolean): Promise<Record<string, unknown> | null> {
  const row = await db.prepare(`SELECT id, title, year, scope, series, subject, status FROM papers WHERE id = ? ${includeDraft ? '' : "AND status = 'published'"}`).bind(id).first<PaperRow>()
  if (!row) return null
  const regions = await regionsFor(db, [id])
  const resources = await db.prepare('SELECT id, paper_id, format, url, link_type, source_name, source_url, access_code, verified_at FROM resources WHERE paper_id = ? ORDER BY id').bind(id).all<ResourceRow>()
  return { ...row, regions: regions.get(id) ?? [], resources: resources.results.map(resourceDto) }
}

async function paperList(db: D1Database, url: URL, publishedOnly: boolean): Promise<Record<string, unknown>> {
  const page = pageValue(url.searchParams.get('page'))
  const clauses: string[] = []
  const parameters: unknown[] = []
  if (publishedOnly) clauses.push("p.status = 'published'")
  else if (url.searchParams.has('status')) {
    const status = url.searchParams.get('status')
    if (status !== 'draft' && status !== 'published') throw new HttpFailure('Invalid status', 400)
    clauses.push('p.status = ?')
    parameters.push(status)
  }
  if (url.searchParams.has('year')) {
    clauses.push('p.year = ?')
    parameters.push(yearValue(Number(url.searchParams.get('year'))))
  }
  if (url.searchParams.has('scope')) {
    clauses.push('p.scope = ?')
    parameters.push(scopeValue(url.searchParams.get('scope')))
  }
  if (url.searchParams.has('subject')) {
    clauses.push('p.subject = ?')
    parameters.push(requiredText(url.searchParams.get('subject'), 'subject', 80))
  }
  if (url.searchParams.has('region')) {
    clauses.push('EXISTS (SELECT 1 FROM paper_regions AS pr WHERE pr.paper_id = p.id AND pr.region = ?)')
    parameters.push(requiredText(url.searchParams.get('region'), 'region', 40))
  }
  const query = url.searchParams.get('q')?.trim()
  if (query) {
    if (query.length > 100) throw new HttpFailure('Search text is too long', 400)
    if (Array.from(query).length >= 3) {
      clauses.push('p.id IN (SELECT rowid FROM paper_titles WHERE paper_titles MATCH ?)')
      parameters.push(`"${query.replaceAll('"', '""')}"`)
    } else {
      clauses.push('instr(p.title, ?) > 0')
      parameters.push(query)
    }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM papers AS p ${where}`).bind(...parameters).first<{ count: number }>()
  const rows = await db.prepare(`SELECT p.id, p.title, p.year, p.scope, p.series, p.subject, p.status FROM papers AS p ${where} ORDER BY p.year DESC, p.id DESC LIMIT 20 OFFSET ?`).bind(...parameters, (page - 1) * 20).all<PaperRow>()
  const regions = await regionsFor(db, rows.results.map((row) => row.id))
  return {
    items: rows.results.map((row) => ({ ...row, regions: regions.get(row.id) ?? [] })),
    page,
    pageSize: 20,
    total: count?.count ?? 0,
  }
}

function childStatements(db: D1Database, id: number, input: PaperInput): D1PreparedStatement[] {
  return [
    ...input.regions.map((region) => db.prepare('INSERT OR IGNORE INTO paper_regions (paper_id, region) VALUES (?, ?)').bind(id, region)),
    ...input.resources.map((resource) => db.prepare('INSERT OR IGNORE INTO resources (paper_id, format, url, link_type, source_name, source_url, access_code, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, resource.format, resource.url, resource.linkType, resource.sourceName, resource.sourceUrl, resource.accessCode, resource.verifiedAt)),
  ]
}

async function createPaper(db: D1Database, input: PaperInput): Promise<Record<string, unknown>> {
  const created = await db.prepare('INSERT INTO papers (title, year, scope, series, subject) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(input.title, input.year, input.scope, input.series, input.subject).first<{ id: number }>()
  if (!created) throw new Error('Could not create paper')
  const statements = childStatements(db, created.id, input)
  if (statements.length) await db.batch(statements)
  return (await paperDetail(db, created.id, true))!
}

async function updatePaper(db: D1Database, id: number, input: PaperInput): Promise<Record<string, unknown>> {
  const existing = await paperDetail(db, id, true)
  if (!existing) throw new HttpFailure('Paper not found', 404)
  await db.batch([
    db.prepare("UPDATE papers SET title = ?, year = ?, scope = ?, series = ?, subject = ?, updated_at = datetime('now') WHERE id = ?").bind(input.title, input.year, input.scope, input.series, input.subject, id),
    db.prepare('DELETE FROM paper_regions WHERE paper_id = ?').bind(id),
    db.prepare('DELETE FROM resources WHERE paper_id = ?').bind(id),
    ...childStatements(db, id, input),
  ])
  return (await paperDetail(db, id, true))!
}

async function candidateList(db: D1Database, url: URL): Promise<Record<string, unknown>> {
  const page = pageValue(url.searchParams.get('page'))
  const status = url.searchParams.get('status') ?? 'pending'
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw new HttpFailure('Invalid status', 400)
  const where = status === 'all' ? '' : 'WHERE review_status = ?'
  const parameters = status === 'all' ? [] : [status]
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM candidates ${where}`).bind(...parameters).first<{ count: number }>()
  const rows = await db.prepare(`SELECT * FROM candidates ${where} ORDER BY updated_at DESC, id DESC LIMIT 20 OFFSET ?`).bind(...parameters, (page - 1) * 20).all<CandidateRow>()
  const matchKey = (year: number, scope: Scope, series: string, subject: string) => JSON.stringify([year, scope, series, subject])
  const attributes = new Map<string, [number, Scope, string, string]>()
  for (const row of rows.results) {
    if (row.year !== null && row.scope && row.series !== null && row.subject) {
      attributes.set(matchKey(row.year, row.scope, row.series, row.subject), [row.year, row.scope, row.series, row.subject])
    }
  }
  const matches = new Map<string, number[]>()
  if (attributes.size) {
    const predicates = [...attributes].map(() => '(year = ? AND scope = ? AND series = ? AND subject = ?)').join(' OR ')
    const matchingPapers = await db.prepare(`SELECT id, year, scope, series, subject FROM papers WHERE ${predicates} ORDER BY id`).bind(...[...attributes.values()].flat()).all<PaperRow>()
    for (const paper of matchingPapers.results) {
      const key = matchKey(paper.year, paper.scope, paper.series, paper.subject)
      const ids = matches.get(key) ?? []
      ids.push(paper.id)
      matches.set(key, ids)
    }
  }
  return {
    items: rows.results.map((row) => ({
      ...candidateDto(row),
      possiblePaperIds: row.year !== null && row.scope && row.series !== null && row.subject
        ? matches.get(matchKey(row.year, row.scope, row.series, row.subject)) ?? []
        : [],
    })),
    page, pageSize: 20, total: count?.count ?? 0,
  }
}

async function createCandidate(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const candidate = candidateValue(body)
  const existing = await db.prepare('SELECT id FROM candidates WHERE source_key = ? AND external_key = ?').bind(candidate.source_key, candidate.external_key).first<{ id: number }>()
  if (existing) throw new HttpFailure('Candidate already exists', 409)
  const inserted = await db.prepare(`INSERT INTO candidates (source_key, external_key, title, year, scope, series, subject, regions_json, format, resource_url, source_url, classification, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(candidate.source_key, candidate.external_key, candidate.title, candidate.year, candidate.scope, candidate.series, candidate.subject, JSON.stringify(candidate.regions), candidate.format, candidate.resource_url, candidate.source_url, candidate.classification, candidate.raw_json).first<{ id: number }>()
  if (!inserted) throw new Error('Could not create candidate')
  const row = await db.prepare('SELECT * FROM candidates WHERE id = ?').bind(inserted.id).first<CandidateRow>()
  return candidateDto(row!)
}

async function reviewCandidate(db: D1Database, id: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const candidate = await db.prepare('SELECT * FROM candidates WHERE id = ?').bind(id).first<CandidateRow>()
  if (!candidate) throw new HttpFailure('Candidate not found', 404)
  if (candidate.review_status !== 'pending') throw new HttpFailure('Candidate has already been reviewed', 409)
  const action = body.action
  if (action === 'reject') {
    await db.prepare("UPDATE candidates SET review_status = 'rejected', reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(id).run()
    return { candidate: candidateDto({ ...candidate, review_status: 'rejected' }) }
  }
  if (action === 'create') {
    const suggestedPaper = body.paper ?? {
      title: candidate.title,
      year: candidate.year,
      scope: candidate.scope,
      series: candidate.series,
      subject: candidate.subject,
      regions: JSON.parse(candidate.regions_json),
      resources: candidate.resource_url ? [{
        format: candidate.format ?? 'LINK',
        url: candidate.resource_url,
        linkType: 'source',
        sourceName: candidate.source_key,
        sourceUrl: candidate.source_url,
      }] : [],
    }
    const paper = await createPaper(db, paperValue(suggestedPaper))
    await db.prepare("UPDATE candidates SET review_status = 'approved', paper_id = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(paper.id, id).run()
    return { candidate: candidateDto({ ...candidate, review_status: 'approved', paper_id: paper.id as number }), paper }
  }
  if (action === 'merge') {
    const paperId = typeof body.paperId === 'number' ? positiveId(String(body.paperId)) : 0
    if (!paperId) throw new HttpFailure('paperId is required', 400)
    const sourceUrl = httpUrl(candidate.source_url, 'sourceUrl')!
    const resourceUrl = httpUrl(candidate.resource_url, 'resourceUrl', false)
    const paper = await paperDetail(db, paperId, true)
    if (!paper) throw new HttpFailure('Paper not found', 404)
    if ((candidate.year && candidate.year !== paper.year) || (candidate.scope && candidate.scope !== paper.scope) || (candidate.subject && candidate.subject !== paper.subject)) {
      throw new HttpFailure('Candidate does not match the selected paper', 409)
    }
    const regions = candidateDto(candidate).regions as string[]
    const statements = regions.map((region) => db.prepare('INSERT OR IGNORE INTO paper_regions (paper_id, region) VALUES (?, ?)').bind(paperId, region))
    if (resourceUrl) statements.push(db.prepare('INSERT OR IGNORE INTO resources (paper_id, format, url, link_type, source_name, source_url) VALUES (?, ?, ?, ?, ?, ?)').bind(paperId, candidate.format ?? 'LINK', resourceUrl, 'source', candidate.source_key, sourceUrl))
    statements.push(db.prepare("UPDATE candidates SET review_status = 'approved', paper_id = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(paperId, id))
    await db.batch(statements)
    return { candidate: candidateDto({ ...candidate, review_status: 'approved', paper_id: paperId }), paper: await paperDetail(db, paperId, true) }
  }
  throw new HttpFailure('Invalid review action', 400)
}

async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname
  const method = request.method
  if (path === '/admin/api/papers') {
    if (method === 'GET') return json(await paperList(env.DB, url, false))
    if (method === 'POST') return json(await createPaper(env.DB, paperValue(await bodyObject(request))), 201)
  }
  const paperMatch = /^\/admin\/api\/papers\/(\d+)$/.exec(path)
  if (paperMatch) {
    const id = positiveId(paperMatch[1])
    if (method === 'GET') {
      const paper = await paperDetail(env.DB, id, true)
      return paper ? json(paper) : json({ error: 'Paper not found' }, 404)
    }
    if (method === 'PUT') return json(await updatePaper(env.DB, id, paperValue(await bodyObject(request))))
    return json({ error: 'Method not allowed' }, 405)
  }
  const statusMatch = /^\/admin\/api\/papers\/(\d+)\/status$/.exec(path)
  if (statusMatch && method === 'POST') {
    const id = positiveId(statusMatch[1])
    const body = await bodyObject(request)
    if (body.status !== 'draft' && body.status !== 'published') throw new HttpFailure('Invalid paper status', 400)
    const existing = await paperDetail(env.DB, id, true)
    if (!existing) throw new HttpFailure('Paper not found', 404)
    if (body.status === 'published' && !(existing.resources as unknown[]).length) throw new HttpFailure('A paper needs a resource before publication', 422)
    await env.DB.prepare("UPDATE papers SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(body.status, id).run()
    return json(await paperDetail(env.DB, id, true))
  }
  if (path === '/admin/api/candidates') {
    if (method === 'GET') return json(await candidateList(env.DB, url))
    if (method === 'POST') return json(await createCandidate(env.DB, await bodyObject(request)), 201)
  }
  const reviewMatch = /^\/admin\/api\/candidates\/(\d+)\/review$/.exec(path)
  if (reviewMatch && method === 'POST') return json(await reviewCandidate(env.DB, positiveId(reviewMatch[1]), await bodyObject(request)))
  return json({ error: 'Not found' }, 404)
}

async function handlePublicApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  if (url.pathname === '/api/papers') return json(await paperList(env.DB, url, true))
  const match = /^\/api\/papers\/(\d+)$/.exec(url.pathname)
  if (match) {
    const paper = await paperDetail(env.DB, positiveId(match[1]), false)
    return paper ? json(paper) : json({ error: 'Paper not found' }, 404)
  }
  return json({ error: 'Not found' }, 404)
}

export function createApp(authorizeAdmin: AuthorizeAdmin = verifyAdmin) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url)
      try {
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
          if (!await authorizeAdmin(request, env)) return json({ error: 'Forbidden' }, 403)
          if (url.pathname.startsWith('/admin/api/')) return await handleAdminApi(request, env, url)
          return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'Not found' }, 404)
        }
        if (url.pathname.startsWith('/api/')) return await handlePublicApi(request, env, url)
        return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'Not found' }, 404)
      } catch (error) {
        if (error instanceof HttpFailure) return json({ error: error.message }, error.status)
        console.error('Request failed', error)
        return json({ error: 'Internal server error' }, 500)
      }
    },
  }
}

export default createApp()
