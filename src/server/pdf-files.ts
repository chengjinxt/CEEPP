import type { ResourceKind } from '../shared/exam'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const PAPER_STORAGE_SOFT_LIMIT_BYTES = 900 * 1024 * 1024

const RESOURCE_KINDS = [
  'question', 'answer', 'question_with_answer', 'analysis',
  'listening_paper', 'listening_audio', 'other',
] as const satisfies readonly ResourceKind[]

export class StoredFileFailure extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export interface StoredUpload {
  body: ReadableStream<Uint8Array>
  completion: Promise<void>
  cancel(reason?: unknown): Promise<void>
  sizeBytes: number
  filename: string
  kind: ResourceKind
  format: 'PDF' | 'MP3'
  mimeType: 'application/pdf' | 'audio/mpeg'
  extension: '.pdf' | '.mp3'
}

export interface StoredFile {
  storage_key: string
  filename: string
  mime_type: string
  size_bytes: number
  etag: string | null
}

interface UploadSpec {
  format: StoredUpload['format']
  mimeType: StoredUpload['mimeType']
  extension: StoredUpload['extension']
  label: 'PDF' | 'MP3'
}

function uploadSpec(kind: ResourceKind): UploadSpec {
  return kind === 'listening_audio'
    ? { format: 'MP3', mimeType: 'audio/mpeg', extension: '.mp3', label: 'MP3' }
    : { format: 'PDF', mimeType: 'application/pdf', extension: '.pdf', label: 'PDF' }
}

export function storedFileKey(paperId: number, extension: StoredUpload['extension']): string {
  return `papers/${paperId}/${crypto.randomUUID()}${extension}`
}

function uploadFilename(value: string | null, spec: UploadSpec): string {
  if (!value) throw new StoredFileFailure('filename is required', 400)
  const filename = value.trim()
  if (!filename || filename.length > 180 || filename.includes('/') || filename.includes('\\') || !filename.toLowerCase().endsWith(spec.extension)) {
    throw new StoredFileFailure(`filename must be a valid ${spec.extension} filename`, 400)
  }
  return filename
}

export function resourceKindValue(value: unknown, name = 'kind'): ResourceKind {
  const kind = value === undefined || value === null || value === '' ? 'question' : String(value).trim()
  if (!RESOURCE_KINDS.includes(kind as ResourceKind)) throw new StoredFileFailure(`Invalid ${name}`, 400)
  return kind as ResourceKind
}

function numericByteLength(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function readStoredUpload(request: Request, url: URL, usedBytes: number): Promise<StoredUpload> {
  const kind = resourceKindValue(url.searchParams.get('kind'))
  const spec = uploadSpec(kind)
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== spec.mimeType) {
    throw new StoredFileFailure(`Content-Type must be ${spec.mimeType}`, 415)
  }
  const filename = uploadFilename(url.searchParams.get('filename'), spec)
  const contentLengthHeader = request.headers.get('content-length')
  const browserSizeHeader = request.headers.get('x-ceepp-file-size')
  if (contentLengthHeader === null && browserSizeHeader === null) {
    throw new StoredFileFailure(`Content-Length or X-CEEPP-File-Size is required for ${spec.label} uploads`, 411)
  }
  const contentLength = numericByteLength(contentLengthHeader)
  const browserSize = numericByteLength(browserSizeHeader)
  if ((contentLengthHeader !== null && contentLength === null)
    || (browserSizeHeader !== null && browserSize === null)) {
    throw new StoredFileFailure(`${spec.label} byte length must be a non-negative integer`, 400)
  }
  if (contentLength !== null && browserSize !== null && contentLength !== browserSize) {
    throw new StoredFileFailure(`${spec.label} byte length headers do not match`, 400)
  }
  const declaredLength = contentLength ?? browserSize!
  if (declaredLength > MAX_FILE_BYTES) throw new StoredFileFailure(`${spec.label} exceeds the 20 MiB limit`, 413)
  if (usedBytes >= PAPER_STORAGE_SOFT_LIMIT_BYTES
    || usedBytes + declaredLength > PAPER_STORAGE_SOFT_LIMIT_BYTES) {
    throw new StoredFileFailure('File storage has reached the 900 MiB safety limit', 507)
  }

  if (!request.body) throw new StoredFileFailure(`${spec.label} body is required`, 400)
  const reader = request.body.getReader()
  const buffered: Uint8Array[] = []
  const signature = new Uint8Array(5)
  let signatureBytes = 0
  let receivedBytes = 0
  while (signatureBytes < signature.byteLength) {
    const result = await reader.read()
    if (result.done) break
    const chunk = result.value
    if (!chunk.byteLength) continue
    receivedBytes += chunk.byteLength
    if (receivedBytes > declaredLength) {
      await reader.cancel()
      throw new StoredFileFailure(`Declared ${spec.label} size does not match the ${spec.label} body`, 400)
    }
    buffered.push(chunk)
    const copied = Math.min(signature.byteLength - signatureBytes, chunk.byteLength)
    signature.set(chunk.subarray(0, copied), signatureBytes)
    signatureBytes += copied
  }
  const isPdf = String.fromCharCode(...signature) === '%PDF-'
  const isMp3 = signature[0] === 0x49 && signature[1] === 0x44 && signature[2] === 0x33
    || signature[0] === 0xff && (signature[1] & 0xe0) === 0xe0
      && ((signature[1] >> 3) & 0x03) !== 0x01 && ((signature[1] >> 1) & 0x03) !== 0x00
      && (signature[2] >> 4) !== 0x00 && (signature[2] >> 4) !== 0x0f
      && ((signature[2] >> 2) & 0x03) !== 0x03
  if (signatureBytes !== signature.byteLength || (spec.format === 'PDF' ? !isPdf : !isMp3)) {
    await reader.cancel()
    throw new StoredFileFailure(`File content is not ${spec.label}`, 400)
  }

  const fixed = new FixedLengthStream(declaredLength)
  const writer = fixed.writable.getWriter()
  const cancel = async (reason?: unknown): Promise<void> => {
    await Promise.allSettled([reader.cancel(reason), writer.abort(reason)])
  }
  const completion = (async (): Promise<void> => {
    try {
      for (const chunk of buffered) await writer.write(chunk)
      while (true) {
        const result = await reader.read()
        if (result.done) break
        receivedBytes += result.value.byteLength
        if (receivedBytes > declaredLength) throw new StoredFileFailure(`Declared ${spec.label} size does not match the ${spec.label} body`, 400)
        await writer.write(result.value)
      }
      if (receivedBytes !== declaredLength) throw new StoredFileFailure(`Declared ${spec.label} size does not match the ${spec.label} body`, 400)
      await writer.close()
    } catch (error) {
      const failure = error instanceof StoredFileFailure
        ? error
        : new StoredFileFailure(`Could not read the ${spec.label} upload stream`, 400)
      await cancel(failure)
      throw failure
    }
  })()
  return { body: fixed.readable, completion, cancel, sizeBytes: declaredLength, filename, kind, ...spec }
}

function encodedDisposition(filename: string, download: boolean): string {
  const safeFallback = filename.replaceAll(/[^\x20-\x7e]/g, '_').replaceAll(/["\\]/g, '') || 'resource'
  return `${download ? 'attachment' : 'inline'}; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

interface ByteRange {
  offset: number
  length: number
  end: number
}

function byteRange(value: string | null, size: number): ByteRange | null {
  if (!value) return null
  if (value.includes(',')) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || (!match[1] && !match[2]) || size < 1) throw new StoredFileFailure('Invalid byte range', 416)
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new StoredFileFailure('Invalid byte range', 416)
    const length = Math.min(suffix, size)
    return { offset: size - length, length, end: size - 1 }
  }
  const offset = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(requestedEnd) || offset < 0 || requestedEnd < offset || offset >= size) {
    throw new StoredFileFailure('Invalid byte range', 416)
  }
  const end = Math.min(requestedEnd, size - 1)
  return { offset, length: end - offset + 1, end }
}

function strongEtagMatches(value: string | null, etag: string): boolean {
  return value?.split(',').some((candidate) => {
    const token = candidate.trim()
    return token === '*' || token === etag
  }) ?? false
}

function weakEtagMatches(value: string | null, etag: string): boolean {
  const normalized = etag.replace(/^W\//u, '')
  return value?.split(',').some((candidate) => {
    const token = candidate.trim()
    return token === '*' || token.replace(/^W\//u, '') === normalized
  }) ?? false
}

async function cancelStream(stream: ReadableStream): Promise<void> {
  try {
    await stream.cancel()
  } catch {
    // The response decision is already known; a failed best-effort cancellation must not replace it.
  }
}

function rangedStream(source: ReadableStream, range: ByteRange): ReadableStream<Uint8Array> {
  const reader = (source as ReadableStream<Uint8Array>).getReader()
  let sourceOffset = 0
  let remaining = range.length
  let settled = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (remaining > 0) {
        const result = await reader.read()
        if (result.done) {
          settled = true
          controller.error(new Error('Stored file ended before its declared size'))
          return
        }

        const chunk = result.value
        const chunkOffset = sourceOffset
        sourceOffset += chunk.byteLength
        if (sourceOffset <= range.offset) continue

        const start = Math.max(0, range.offset - chunkOffset)
        const length = Math.min(chunk.byteLength - start, remaining)
        if (length > 0) {
          controller.enqueue(chunk.subarray(start, start + length))
          remaining -= length
        }
        if (remaining === 0) {
          settled = true
          controller.close()
          await reader.cancel()
        }
        return
      }
    },
    async cancel(reason) {
      if (settled) return
      settled = true
      await reader.cancel(reason)
    },
  })
}

export async function storedFileResponse(
  request: Request,
  namespace: KVNamespace,
  file: StoredFile,
  download: boolean,
  privateFile: boolean,
): Promise<Response> {
  const cacheControl = privateFile ? 'private, no-store' : 'public, max-age=0, must-revalidate'
  const rangeHeader = request.method === 'GET' ? request.headers.get('range') : null
  const stored = await namespace.getWithMetadata<{ etag?: unknown, sizeBytes?: unknown }>(file.storage_key, 'stream')
  const metadata = stored.metadata
  if (!stored.value
    || !metadata
    || typeof metadata.etag !== 'string'
    || !/^"[^"\r\n]+"$/u.test(metadata.etag)
    || !Number.isSafeInteger(metadata.sizeBytes)
    || (metadata.sizeBytes as number) < 1) {
    if (stored.value) await cancelStream(stored.value)
    throw new StoredFileFailure('Stored file is missing', 404)
  }
  const etag = metadata.etag
  const size = metadata.sizeBytes as number

  const precondition = (): Response | null => {
    if (request.headers.has('if-match') && !strongEtagMatches(request.headers.get('if-match'), etag)) {
      return new Response(null, { status: 412, headers: { etag, 'cache-control': cacheControl } })
    }
    if (weakEtagMatches(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': cacheControl } })
    }
    return null
  }
  const conditional = precondition()
  if (conditional) {
    await cancelStream(stored.value)
    return conditional
  }

  if (request.method === 'HEAD') {
    const headers = new Headers({
      'content-type': file.mime_type,
      'content-disposition': encodedDisposition(file.filename, download),
      'accept-ranges': 'bytes',
      'cache-control': cacheControl,
      etag,
      'content-length': String(size),
      'x-content-type-options': 'nosniff',
    })
    await cancelStream(stored.value)
    return new Response(null, { status: 200, headers })
  }

  let range: ByteRange | null = null
  if (rangeHeader) {
    const ifRange = request.headers.get('if-range')
    if (!ifRange || ifRange.trim() === etag) {
      try {
        range = byteRange(rangeHeader, size)
      } catch (error) {
        if (error instanceof StoredFileFailure && error.status === 416) {
          await cancelStream(stored.value)
          return new Response(null, {
            status: 416,
            headers: {
              'content-range': `bytes */${size}`,
              'accept-ranges': 'bytes',
              'cache-control': cacheControl,
              etag,
              'x-content-type-options': 'nosniff',
            },
          })
        }
        throw error
      }
    }
  }

  const headers = new Headers({
    'content-type': file.mime_type,
    'content-disposition': encodedDisposition(file.filename, download),
    'accept-ranges': 'bytes',
    'cache-control': cacheControl,
    etag,
    'x-content-type-options': 'nosniff',
  })
  let body: ReadableStream
  if (range) {
    headers.set('content-length', String(range.length))
    headers.set('content-range', `bytes ${range.offset}-${range.end}/${size}`)
    body = rangedStream(stored.value, range)
  } else {
    headers.set('content-length', String(size))
    body = stored.value
  }
  return new Response(body, { status: range ? 206 : 200, headers })
}
