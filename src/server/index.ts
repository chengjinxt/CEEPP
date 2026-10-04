import { verifyAdmin, type AccessEnv } from './auth'
import {
  normalizeRegion,
  normalizeSeries,
  normalizeSubject,
  type OriginType,
  type ResourceKind,
  type SubjectRole,
} from '../shared/exam'
import {
  PdfFileFailure,
  PAPER_STORAGE_SOFT_LIMIT_BYTES,
  pdfFileResponse,
  pdfStorageKey,
  readPdfUpload,
  resourceKindValue,
  type StoredPdf,
} from './pdf-files'

export interface Env extends AccessEnv {
  DB: D1Database
  PAPER_FILES: KVNamespace
  ASSETS?: { fetch(request: Request): Promise<Response> }
}

type AuthorizeAdmin = (request: Request, env: Env) => Promise<boolean>
type Scope = 'national' | 'regional'
type PaperStatus = 'draft' | 'published'
type StorageType = 'external' | 'upload'

interface ResourceInput {
  format: string
  kind: ResourceKind
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
  originType: OriginType
  subjectRole: SubjectRole
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
  origin_type: OriginType
  subject_role: SubjectRole
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
  kind: ResourceKind
  storage_type: StorageType
  url: string | null
  link_type: 'source' | 'drive' | null
  source_name: string | null
  source_url: string | null
  access_code: string | null
  verified_at: string | null
  storage_key: string | null
  filename: string | null
  mime_type: string | null
  size_bytes: number | null
  etag: string | null
}

interface CandidateRow {
  id: number
  source_key: string
  external_key: string
  title: string
  year: number | null
  scope: Scope | null
  origin_type: OriginType | null
  subject_role: SubjectRole | null
  series: string | null
  subject: string | null
  regions_json: string
  format: string | null
  resource_kind: ResourceKind
  resource_link_type: 'source' | 'drive'
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

function originTypeValue(value: unknown, fallbackScope?: Scope | null): OriginType {
  if (value === undefined || value === null || value === '') {
    return fallbackScope === 'national' ? 'national' : 'unknown'
  }
  if (!['national', 'provincial', 'joint', 'unknown'].includes(String(value))) {
    throw new HttpFailure('Invalid originType', 400)
  }
  return value as OriginType
}

function subjectRoleValue(value: unknown): SubjectRole {
  if (value === undefined || value === null || value === '') return 'other'
  if (!['unified', 'first_choice', 'second_choice', 'elective', 'integrated', 'other'].includes(String(value))) {
    throw new HttpFailure('Invalid subjectRole', 400)
  }
  return value as SubjectRole
}

function scopeForOrigin(originType: OriginType, fallback?: Scope | null): Scope {
  if (originType === 'national') return 'national'
  if (originType === 'provincial' || originType === 'joint') return 'regional'
  return fallback ?? 'regional'
}

function candidateScopeForOrigin(originType: OriginType, fallback: Scope | null): Scope | null {
  if (originType === 'national') return 'national'
  if (originType === 'provincial' || originType === 'joint') return 'regional'
  return fallback
}

function regionsValue(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 40) throw new HttpFailure('regions must be an array', 400)
  return [...new Set(value.map((entry) => {
    const input = requiredText(entry, 'region', 40)
    const region = normalizeRegion(input)
    if (!region) throw new HttpFailure(`Unsupported region: ${input}`, 400)
    return region
  }))]
}

function seriesValue(value: unknown): string {
  const series = optionalText(value, 'series', 120) ?? ''
  return series ? normalizeSeries(series) : ''
}

function subjectValue(value: unknown, required: true): string
function subjectValue(value: unknown, required: false): string | null
function subjectValue(value: unknown, required: boolean): string | null {
  const subject = required ? requiredText(value, 'subject', 80) : optionalText(value, 'subject', 80)
  return subject ? normalizeSubject(subject) ?? subject : null
}

function resourceValue(value: unknown): ResourceInput {
  const input = object(value)
  if (input.storageType === 'upload' || 'storageKey' in input || 'sizeBytes' in input || 'mimeType' in input) {
    throw new HttpFailure('Uploaded resources can only be created through the PDF upload endpoint', 400)
  }
  const linkType = input.linkType
  if (linkType !== 'source' && linkType !== 'drive') throw new HttpFailure('linkType must be source or drive', 400)
  return {
    format: requiredText(input.format, 'format', 30).toUpperCase(),
    kind: resourceKindValue(input.kind),
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
  const legacyScope = input.scope === undefined || input.scope === null ? null : scopeValue(input.scope)
  const originType = originTypeValue(input.originType, legacyScope)
  return {
    title: requiredText(input.title, 'title'),
    year: yearValue(input.year),
    scope: scopeForOrigin(originType, legacyScope),
    originType,
    subjectRole: subjectRoleValue(input.subjectRole),
    series: seriesValue(input.series),
    subject: subjectValue(input.subject, true),
    regions: regionsValue(input.regions),
    resources: input.resources.map(resourceValue),
  }
}

function candidateValue(value: unknown): Omit<CandidateRow, 'id' | 'review_status' | 'paper_id' | 'regions_json'> & { regions: string[], raw_json: string } {
  const input = object(value)
  const classification = input.classification ?? 'uncertain'
  if (classification !== 'ordinary' && classification !== 'uncertain') throw new HttpFailure('Invalid classification', 400)
  const legacyScope = input.scope === undefined || input.scope === null ? null : scopeValue(input.scope)
  const originType = originTypeValue(input.originType, legacyScope)
  const resourceLinkType = input.resourceLinkType ?? 'source'
  if (resourceLinkType !== 'source' && resourceLinkType !== 'drive') {
    throw new HttpFailure('resourceLinkType must be source or drive', 400)
  }
  return {
    source_key: requiredText(input.sourceKey, 'sourceKey', 80),
    external_key: requiredText(input.externalKey, 'externalKey', 200),
    title: requiredText(input.title, 'title'),
    year: input.year === undefined || input.year === null ? null : yearValue(input.year),
    scope: candidateScopeForOrigin(originType, legacyScope),
    origin_type: originType,
    subject_role: subjectRoleValue(input.subjectRole),
    series: input.series === undefined || input.series === null || input.series === '' ? null : seriesValue(input.series),
    subject: subjectValue(input.subject, false),
    regions: regionsValue(input.regions ?? []),
    format: optionalText(input.format, 'format', 30)?.toUpperCase() ?? null,
    resource_kind: resourceKindValue(input.resourceKind, 'resourceKind'),
    resource_link_type: resourceLinkType,
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

function resourceDto(row: ResourceRow, admin: boolean): Record<string, unknown> {
  const uploadedUrl = `${admin ? '/admin' : ''}/api/resources/${row.id}/file`
  return {
    id: row.id,
    format: row.format,
    kind: row.kind,
    storageType: row.storage_type,
    url: row.storage_type === 'upload' ? uploadedUrl : row.url,
    linkType: row.storage_type === 'upload' ? 'upload' : row.link_type,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    accessCode: row.access_code,
    verifiedAt: row.verified_at,
    fileName: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    downloadUrl: row.storage_type === 'upload' ? `${uploadedUrl}?download=1` : null,
  }
}

function paperDto(row: PaperRow): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    year: row.year,
    scope: row.scope,
    originType: row.origin_type,
    subjectRole: row.subject_role,
    series: row.series,
    subject: row.subject,
    status: row.status,
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
    originType: row.origin_type,
    subjectRole: row.subject_role,
    series: row.series,
    subject: row.subject,
    regions,
    format: row.format,
    resourceKind: row.resource_kind,
    resourceLinkType: row.resource_link_type,
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
  const row = await db.prepare(`SELECT id, title, year, scope, origin_type, subject_role, series, subject, status FROM papers WHERE id = ? ${includeDraft ? '' : "AND status = 'published'"}`).bind(id).first<PaperRow>()
  if (!row) return null
  const regions = await regionsFor(db, [id])
  const resources = await db.prepare(`SELECT id, paper_id, format, kind, storage_type, url, link_type,
    source_name, source_url, access_code, verified_at, storage_key, filename, mime_type, size_bytes, etag
    FROM resources WHERE paper_id = ? ORDER BY id`).bind(id).all<ResourceRow>()
  return { ...paperDto(row), regions: regions.get(id) ?? [], resources: resources.results.map((resource) => resourceDto(resource, includeDraft)) }
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
  if (url.searchParams.has('originType')) {
    clauses.push('p.origin_type = ?')
    parameters.push(originTypeValue(url.searchParams.get('originType')))
  }
  if (url.searchParams.has('subjectRole')) {
    clauses.push('p.subject_role = ?')
    parameters.push(subjectRoleValue(url.searchParams.get('subjectRole')))
  }
  if (url.searchParams.has('subject')) {
    clauses.push('p.subject = ?')
    parameters.push(subjectValue(url.searchParams.get('subject'), true))
  }
  if (url.searchParams.has('region')) {
    clauses.push('EXISTS (SELECT 1 FROM paper_regions AS pr WHERE pr.paper_id = p.id AND pr.region = ?)')
    parameters.push(regionsValue([url.searchParams.get('region')])[0])
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
  const rows = await db.prepare(`SELECT p.id, p.title, p.year, p.scope, p.origin_type, p.subject_role, p.series, p.subject, p.status FROM papers AS p ${where} ORDER BY p.year DESC, p.id DESC LIMIT 20 OFFSET ?`).bind(...parameters, (page - 1) * 20).all<PaperRow>()
  const regions = await regionsFor(db, rows.results.map((row) => row.id))
  return {
    items: rows.results.map((row) => ({ ...paperDto(row), regions: regions.get(row.id) ?? [] })),
    page,
    pageSize: 20,
    total: count?.count ?? 0,
  }
}

function childStatements(db: D1Database, id: number, input: PaperInput): D1PreparedStatement[] {
  return [
    ...input.regions.map((region) => db.prepare('INSERT OR IGNORE INTO paper_regions (paper_id, region) VALUES (?, ?)').bind(id, region)),
    ...input.resources.map((resource) => db.prepare(`INSERT OR IGNORE INTO resources
      (paper_id, format, kind, storage_type, url, link_type, source_name, source_url, access_code, verified_at)
      VALUES (?, ?, ?, 'external', ?, ?, ?, ?, ?, ?)`)
      .bind(id, resource.format, resource.kind, resource.url, resource.linkType, resource.sourceName, resource.sourceUrl, resource.accessCode, resource.verifiedAt)),
  ]
}

async function createPaper(db: D1Database, input: PaperInput): Promise<Record<string, unknown>> {
  const created = await db.prepare(`INSERT INTO papers
    (title, year, scope, origin_type, subject_role, series, subject)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(input.title, input.year, input.scope, input.originType, input.subjectRole, input.series, input.subject).first<{ id: number }>()
  if (!created) throw new Error('Could not create paper')
  const statements = childStatements(db, created.id, input)
  if (statements.length) await db.batch(statements)
  return (await paperDetail(db, created.id, true))!
}

async function updatePaper(db: D1Database, id: number, input: PaperInput): Promise<Record<string, unknown>> {
  const existing = await paperDetail(db, id, true)
  if (!existing) throw new HttpFailure('Paper not found', 404)
  await db.batch([
    db.prepare(`UPDATE papers SET title = ?, year = ?, scope = ?, origin_type = ?, subject_role = ?,
      series = ?, subject = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(input.title, input.year, input.scope, input.originType, input.subjectRole, input.series, input.subject, id),
    db.prepare('DELETE FROM paper_regions WHERE paper_id = ?').bind(id),
    db.prepare("DELETE FROM resources WHERE paper_id = ? AND storage_type = 'external'").bind(id),
    ...childStatements(db, id, input),
  ])
  return (await paperDetail(db, id, true))!
}

async function uploadPaperPdf(request: Request, env: Env, url: URL, paperId: number): Promise<Record<string, unknown>> {
  const paper = await env.DB.prepare('SELECT status FROM papers WHERE id = ?').bind(paperId).first<{ status: PaperStatus }>()
  if (!paper) throw new HttpFailure('Paper not found', 404)
  if (paper.status !== 'draft') throw new HttpFailure('PDF files can only be uploaded to draft papers', 409)
  const usage = await env.DB.prepare(`SELECT
      COALESCE((SELECT SUM(size_bytes) FROM resources WHERE storage_type = 'upload'), 0)
      + COALESCE((SELECT SUM(size_bytes) FROM r2_cleanup_queue), 0) AS bytes`)
    .first<{ bytes: number }>()
  const upload = await readPdfUpload(request, url, usage?.bytes ?? 0)
  const storageKey = pdfStorageKey(paperId)
  try {
    const reserved = await env.DB.prepare(`INSERT INTO r2_cleanup_queue (storage_key, size_bytes, reason)
      SELECT ?, ?, 'upload_pending'
      WHERE COALESCE((SELECT SUM(size_bytes) FROM resources WHERE storage_type = 'upload'), 0)
        + COALESCE((SELECT SUM(size_bytes) FROM r2_cleanup_queue), 0) + ? <= ?
      RETURNING storage_key`)
      .bind(storageKey, upload.sizeBytes, upload.sizeBytes, PAPER_STORAGE_SOFT_LIMIT_BYTES)
      .first<{ storage_key: string }>()
    if (!reserved) throw new PdfFileFailure('PDF storage has reached the 900 MiB safety limit', 507)
    const etag = `"${crypto.randomUUID()}"`
    await Promise.all([
      env.PAPER_FILES.put(storageKey, upload.body, {
        metadata: {
          etag,
          sizeBytes: upload.sizeBytes,
        },
      }),
      upload.completion,
    ])
    const inserted = await env.DB.prepare(`INSERT INTO resources
      (paper_id, format, kind, storage_type, storage_key, filename, mime_type, size_bytes, etag)
      SELECT p.id, 'PDF', ?, 'upload', ?, ?, 'application/pdf', ?, ?
      FROM papers AS p
      WHERE p.id = ? AND p.status = 'draft'
        AND EXISTS (SELECT 1 FROM r2_cleanup_queue
          WHERE storage_key = ? AND reason = 'upload_pending' AND claimed_at IS NULL)
        AND COALESCE((SELECT SUM(size_bytes) FROM resources WHERE storage_type = 'upload'), 0)
          + COALESCE((SELECT SUM(size_bytes) FROM r2_cleanup_queue WHERE storage_key <> ?), 0)
          + ? <= ?
      RETURNING id, paper_id, format, kind, storage_type, url, link_type,
        source_name, source_url, access_code, verified_at, storage_key, filename, mime_type, size_bytes, etag`)
      .bind(upload.kind, storageKey, upload.filename, upload.sizeBytes, etag,
        paperId, storageKey, storageKey, upload.sizeBytes, PAPER_STORAGE_SOFT_LIMIT_BYTES)
      .first<ResourceRow>()
    if (!inserted) {
      const latestPaper = await env.DB.prepare('SELECT status FROM papers WHERE id = ?').bind(paperId).first<{ status: PaperStatus }>()
      if (!latestPaper) throw new HttpFailure('Paper not found', 404)
      if (latestPaper.status !== 'draft') throw new HttpFailure('PDF files can only be uploaded to draft papers', 409)
      const latestUsage = await env.DB.prepare(`SELECT
          COALESCE((SELECT SUM(size_bytes) FROM resources WHERE storage_type = 'upload'), 0)
          + COALESCE((SELECT SUM(size_bytes) FROM r2_cleanup_queue WHERE storage_key <> ?), 0) AS bytes`)
        .bind(storageKey).first<{ bytes: number }>()
      if ((latestUsage?.bytes ?? 0) + upload.sizeBytes > PAPER_STORAGE_SOFT_LIMIT_BYTES) {
        throw new PdfFileFailure('PDF storage has reached the 900 MiB safety limit', 507)
      }
      throw new HttpFailure('Paper changed while the PDF was uploading; retry from the current draft', 409)
    }
    return resourceDto(inserted, true)
  } catch (error) {
    await upload.cancel(error)
    await Promise.allSettled([upload.completion])
    try {
      const committed = await env.DB.prepare(`SELECT id, paper_id, format, kind, storage_type, url, link_type,
        source_name, source_url, access_code, verified_at, storage_key, filename, mime_type, size_bytes, etag
        FROM resources WHERE storage_key = ?`).bind(storageKey).first<ResourceRow>()
      if (committed) return resourceDto(committed, true)
    } catch (lookupError) {
      console.error('Could not determine whether the PDF resource was committed', lookupError)
      throw error
    }
    await cleanupStoredObject(env, storageKey, { sizeBytes: upload.sizeBytes, reason: 'upload_pending' })
    throw error
  }
}

interface CleanupMarker {
  sizeBytes: number
  reason: 'upload_pending' | 'deleted_resource'
}

async function recordCleanupFailure(
  db: D1Database,
  storageKey: string,
  marker: CleanupMarker,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  try {
    await db.prepare(`INSERT INTO r2_cleanup_queue
      (storage_key, size_bytes, reason, attempts, claimed_at, last_error)
      VALUES (?, ?, ?, 1, NULL, ?)
      ON CONFLICT(storage_key) DO UPDATE SET
        size_bytes = MAX(r2_cleanup_queue.size_bytes, excluded.size_bytes),
        reason = excluded.reason,
        attempts = r2_cleanup_queue.attempts + 1,
        claimed_at = NULL,
        last_error = excluded.last_error,
        updated_at = datetime('now')`)
      .bind(storageKey, marker.sizeBytes, marker.reason, message.slice(0, 500)).run()
  } catch (queueError) {
    console.error('Could not update the PDF cleanup queue', queueError)
  }
}

async function cleanupStoredObject(env: Env, storageKey: string, marker: CleanupMarker): Promise<boolean> {
  try {
    await env.PAPER_FILES.delete(storageKey)
  } catch (error) {
    await recordCleanupFailure(env.DB, storageKey, marker, error)
    console.error('Could not remove a queued PDF object', error)
    return false
  }
  try {
    await env.DB.prepare('DELETE FROM r2_cleanup_queue WHERE storage_key = ?').bind(storageKey).run()
  } catch (error) {
    console.error('Removed a PDF object but could not clear its cleanup marker', error)
    return false
  }
  return true
}

export async function cleanupPendingObjects(env: Env): Promise<void> {
  const pending = await env.DB.prepare(`UPDATE r2_cleanup_queue
    SET claimed_at = datetime('now'), updated_at = datetime('now')
    WHERE storage_key IN (
      SELECT storage_key FROM r2_cleanup_queue
      WHERE (claimed_at IS NULL AND (reason = 'deleted_resource' OR created_at <= datetime('now', '-2 hours')))
        OR claimed_at <= datetime('now', '-30 minutes')
      ORDER BY COALESCE(claimed_at, created_at), storage_key
      LIMIT 40
    )
    RETURNING storage_key, size_bytes, reason`).all<{
      storage_key: string
      size_bytes: number
      reason: CleanupMarker['reason']
    }>()
  for (const item of pending.results) {
    await cleanupStoredObject(env, item.storage_key, { sizeBytes: item.size_bytes, reason: item.reason })
  }
}

interface FileResourceRow extends StoredPdf {
  id: number
  paper_id: number
  storage_type: StorageType
  status: PaperStatus
}

async function servePdf(request: Request, env: Env, resourceId: number, admin: boolean, url: URL): Promise<Response> {
  const row = await env.DB.prepare(`SELECT r.id, r.paper_id, r.storage_type, r.storage_key, r.filename,
    r.mime_type, r.size_bytes, r.etag, p.status
    FROM resources AS r JOIN papers AS p ON p.id = r.paper_id
    WHERE r.id = ? AND r.storage_type = 'upload' ${admin ? '' : "AND p.status = 'published'"}`)
    .bind(resourceId).first<FileResourceRow>()
  if (!row) throw new HttpFailure('PDF resource not found', 404)
  return pdfFileResponse(request, env.PAPER_FILES, row, url.searchParams.get('download') === '1', admin)
}

async function deletePaperResource(env: Env, paperId: number, resourceId: number): Promise<Response> {
  const deleted = await env.DB.prepare(`DELETE FROM resources
    WHERE id = ? AND paper_id = ?
      AND EXISTS (SELECT 1 FROM papers WHERE id = ? AND status = 'draft')
    RETURNING storage_type, storage_key, size_bytes`)
    .bind(resourceId, paperId, paperId)
    .first<{ storage_type: StorageType, storage_key: string | null, size_bytes: number | null }>()
  if (!deleted) {
    const current = await env.DB.prepare(`SELECT p.status
      FROM resources AS r JOIN papers AS p ON p.id = r.paper_id
      WHERE r.id = ? AND r.paper_id = ?`).bind(resourceId, paperId).first<{ status: PaperStatus }>()
    if (!current) throw new HttpFailure('Resource not found', 404)
    throw new HttpFailure('Resources can only be removed from draft papers', 409)
  }
  if (deleted.storage_type === 'upload' && deleted.storage_key) {
    if (!await cleanupStoredObject(env, deleted.storage_key, {
      sizeBytes: deleted.size_bytes ?? 0,
      reason: 'deleted_resource',
    })) {
      return json({ cleanupPending: true }, 202)
    }
  }
  return new Response(null, { status: 204 })
}

async function candidateList(db: D1Database, url: URL): Promise<Record<string, unknown>> {
  const page = pageValue(url.searchParams.get('page'))
  const status = url.searchParams.get('status') ?? 'pending'
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw new HttpFailure('Invalid status', 400)
  const where = status === 'all' ? '' : 'WHERE review_status = ?'
  const parameters = status === 'all' ? [] : [status]
  const count = await db.prepare(`SELECT COUNT(*) AS count FROM candidates ${where}`).bind(...parameters).first<{ count: number }>()
  const rows = await db.prepare(`SELECT * FROM candidates ${where} ORDER BY updated_at DESC, id DESC LIMIT 20 OFFSET ?`).bind(...parameters, (page - 1) * 20).all<CandidateRow>()
  const matchKey = (year: number, scope: Scope, originType: OriginType, subjectRole: SubjectRole, series: string, subject: string) =>
    JSON.stringify([year, scope, originType, subjectRole, series, subject])
  const attributes = new Map<string, [number, Scope, OriginType, SubjectRole, string, string]>()
  for (const row of rows.results) {
    if (row.year !== null && row.scope && row.origin_type && row.subject_role && row.series !== null && row.subject) {
      attributes.set(
        matchKey(row.year, row.scope, row.origin_type, row.subject_role, row.series, row.subject),
        [row.year, row.scope, row.origin_type, row.subject_role, row.series, row.subject],
      )
    }
  }
  const matches = new Map<string, number[]>()
  const attributeValues = [...attributes.values()]
  for (let offset = 0; offset < attributeValues.length; offset += 16) {
    const batch = attributeValues.slice(offset, offset + 16)
    const predicates = batch.map(() =>
      '(year = ? AND scope = ? AND origin_type = ? AND subject_role = ? AND series = ? AND subject = ?)').join(' OR ')
    const matchingPapers = await db.prepare(`SELECT id, year, scope, origin_type, subject_role, series, subject, status FROM papers WHERE ${predicates} ORDER BY id`).bind(...batch.flat()).all<PaperRow>()
    for (const paper of matchingPapers.results) {
      const key = matchKey(paper.year, paper.scope, paper.origin_type, paper.subject_role, paper.series, paper.subject)
      const ids = matches.get(key) ?? []
      ids.push(paper.id)
      matches.set(key, ids)
    }
  }
  return {
    items: rows.results.map((row) => ({
      ...candidateDto(row),
      possiblePaperIds: row.year !== null && row.scope && row.origin_type && row.subject_role && row.series !== null && row.subject
        ? matches.get(matchKey(row.year, row.scope, row.origin_type, row.subject_role, row.series, row.subject)) ?? []
        : [],
    })),
    page, pageSize: 20, total: count?.count ?? 0,
  }
}

async function createCandidate(db: D1Database, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const candidate = candidateValue(body)
  const existing = await db.prepare('SELECT id FROM candidates WHERE source_key = ? AND external_key = ?').bind(candidate.source_key, candidate.external_key).first<{ id: number }>()
  if (existing) throw new HttpFailure('Candidate already exists', 409)
  const inserted = await db.prepare(`INSERT INTO candidates
    (source_key, external_key, title, year, scope, origin_type, subject_role, series, subject,
     regions_json, format, resource_kind, resource_link_type, resource_url, source_url, classification, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(candidate.source_key, candidate.external_key, candidate.title, candidate.year, candidate.scope,
      candidate.origin_type, candidate.subject_role, candidate.series, candidate.subject,
      JSON.stringify(candidate.regions), candidate.format, candidate.resource_kind, candidate.resource_link_type, candidate.resource_url,
      candidate.source_url, candidate.classification, candidate.raw_json).first<{ id: number }>()
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
      originType: candidate.origin_type,
      subjectRole: candidate.subject_role,
      series: candidate.series,
      subject: candidate.subject,
      regions: JSON.parse(candidate.regions_json),
      resources: candidate.resource_url ? [{
        format: candidate.format ?? 'LINK',
        kind: candidate.resource_kind,
        url: candidate.resource_url,
        linkType: candidate.resource_link_type,
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
    if ((candidate.year && candidate.year !== paper.year)
      || (candidate.scope && candidate.scope !== paper.scope)
      || (candidate.series && candidate.series !== paper.series)
      || (candidate.subject && candidate.subject !== paper.subject)
      || (candidate.origin_type && candidate.origin_type !== 'unknown' && candidate.origin_type !== paper.originType)
      || (candidate.subject_role && candidate.subject_role !== 'other' && candidate.subject_role !== paper.subjectRole)) {
      throw new HttpFailure('Candidate does not match the selected paper', 409)
    }
    const regions = regionsValue(candidateDto(candidate).regions)
    const statements = regions.map((region) => db.prepare('INSERT OR IGNORE INTO paper_regions (paper_id, region) VALUES (?, ?)').bind(paperId, region))
    if (resourceUrl) statements.push(db.prepare(`INSERT OR IGNORE INTO resources
      (paper_id, format, kind, storage_type, url, link_type, source_name, source_url)
      VALUES (?, ?, ?, 'external', ?, ?, ?, ?)`)
      .bind(paperId, candidate.format ?? 'LINK', candidate.resource_kind, resourceUrl, candidate.resource_link_type, candidate.source_key, sourceUrl))
    statements.push(db.prepare("UPDATE candidates SET review_status = 'approved', paper_id = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(paperId, id))
    await db.batch(statements)
    return { candidate: candidateDto({ ...candidate, review_status: 'approved', paper_id: paperId }), paper: await paperDetail(db, paperId, true) }
  }
  throw new HttpFailure('Invalid review action', 400)
}

async function handleAdminApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname
  const method = request.method
  const uploadMatch = /^\/admin\/api\/papers\/(\d+)\/resources\/pdf$/.exec(path)
  if (uploadMatch) {
    if (method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    return json(await uploadPaperPdf(request, env, url, positiveId(uploadMatch[1])), 201)
  }
  const adminFileMatch = /^\/admin\/api\/resources\/(\d+)\/file$/.exec(path)
  if (adminFileMatch) {
    if (method !== 'GET' && method !== 'HEAD') return json({ error: 'Method not allowed' }, 405)
    return servePdf(request, env, positiveId(adminFileMatch[1]), true, url)
  }
  const deleteResourceMatch = /^\/admin\/api\/papers\/(\d+)\/resources\/(\d+)$/.exec(path)
  if (deleteResourceMatch) {
    if (method !== 'DELETE') return json({ error: 'Method not allowed' }, 405)
    return deletePaperResource(env, positiveId(deleteResourceMatch[1]), positiveId(deleteResourceMatch[2]))
  }
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
    if (body.status === 'published') {
      const published = await env.DB.prepare(`UPDATE papers SET status = 'published', updated_at = datetime('now')
        WHERE id = ? AND EXISTS (SELECT 1 FROM resources WHERE paper_id = ?)
        RETURNING id`).bind(id, id).first<{ id: number }>()
      if (!published) throw new HttpFailure('A paper needs a resource before publication', 422)
    } else {
      await env.DB.prepare("UPDATE papers SET status = 'draft', updated_at = datetime('now') WHERE id = ?").bind(id).run()
    }
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
  const fileMatch = /^\/api\/resources\/(\d+)\/file$/.exec(url.pathname)
  if (fileMatch) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405)
    return servePdf(request, env, positiveId(fileMatch[1]), false, url)
  }
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
        if (error instanceof PdfFileFailure) return json({ error: error.message }, error.status)
        console.error('Request failed', error)
        return json({ error: 'Internal server error' }, 500)
      }
    },
    scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
      ctx.waitUntil(cleanupPendingObjects(env))
    },
  }
}

export default createApp()
