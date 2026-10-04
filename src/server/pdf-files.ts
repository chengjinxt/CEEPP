import type { ResourceKind } from '../shared/exam'

export const MAX_PDF_BYTES = 50 * 1024 * 1024
export const PAPER_BUCKET_SOFT_LIMIT_BYTES = 9 * 1024 * 1024 * 1024

const RESOURCE_KINDS = [
  'question', 'answer', 'question_with_answer', 'analysis',
  'listening_paper', 'listening_audio', 'other',
] as const satisfies readonly ResourceKind[]

export class PdfFileFailure extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export interface PdfUpload {
  body: ReadableStream<Uint8Array>
  completion: Promise<void>
  cancel(reason?: unknown): Promise<void>
  sizeBytes: number
  filename: string
  kind: ResourceKind
}

export interface StoredPdf {
  storage_key: string
  filename: string
  mime_type: string
  size_bytes: number
  etag: string | null
}

export function pdfStorageKey(paperId: number): string {
  return `papers/${paperId}/${crypto.randomUUID()}.pdf`
}

function uploadFilename(value: string | null): string {
  if (!value) throw new PdfFileFailure('filename is required', 400)
  const filename = value.trim()
  if (!filename || filename.length > 180 || filename.includes('/') || filename.includes('\\') || !filename.toLowerCase().endsWith('.pdf')) {
    throw new PdfFileFailure('filename must be a valid .pdf filename', 400)
  }
  return filename
}

export function resourceKindValue(value: unknown, name = 'kind'): ResourceKind {
  const kind = value === undefined || value === null || value === '' ? 'question' : String(value).trim()
  if (!RESOURCE_KINDS.includes(kind as ResourceKind)) throw new PdfFileFailure(`Invalid ${name}`, 400)
  return kind as ResourceKind
}

function numericByteLength(value: string | null): number | null {
  if (value === null) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export async function readPdfUpload(request: Request, url: URL, usedBytes: number): Promise<PdfUpload> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/pdf') {
    throw new PdfFileFailure('Content-Type must be application/pdf', 415)
  }
  const filename = uploadFilename(url.searchParams.get('filename'))
  const kind = resourceKindValue(url.searchParams.get('kind'))
  const contentLengthHeader = request.headers.get('content-length')
  const browserSizeHeader = request.headers.get('x-ceepp-file-size')
  if (contentLengthHeader === null && browserSizeHeader === null) {
    throw new PdfFileFailure('Content-Length or X-CEEPP-File-Size is required for PDF uploads', 411)
  }
  const contentLength = numericByteLength(contentLengthHeader)
  const browserSize = numericByteLength(browserSizeHeader)
  if ((contentLengthHeader !== null && contentLength === null)
    || (browserSizeHeader !== null && browserSize === null)) {
    throw new PdfFileFailure('PDF byte length must be a non-negative integer', 400)
  }
  if (contentLength !== null && browserSize !== null && contentLength !== browserSize) {
    throw new PdfFileFailure('PDF byte length headers do not match', 400)
  }
  const declaredLength = contentLength ?? browserSize!
  if (declaredLength > MAX_PDF_BYTES) throw new PdfFileFailure('PDF exceeds the 50 MiB limit', 413)
  if (usedBytes >= PAPER_BUCKET_SOFT_LIMIT_BYTES
    || usedBytes + declaredLength > PAPER_BUCKET_SOFT_LIMIT_BYTES) {
    throw new PdfFileFailure('PDF storage has reached the 9 GiB safety limit', 507)
  }

  if (!request.body) throw new PdfFileFailure('PDF body is required', 400)
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
      throw new PdfFileFailure('Declared PDF size does not match the PDF body', 400)
    }
    buffered.push(chunk)
    const copied = Math.min(signature.byteLength - signatureBytes, chunk.byteLength)
    signature.set(chunk.subarray(0, copied), signatureBytes)
    signatureBytes += copied
  }
  if (signatureBytes !== signature.byteLength || String.fromCharCode(...signature) !== '%PDF-') {
    await reader.cancel()
    throw new PdfFileFailure('File content is not a PDF', 400)
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
        if (receivedBytes > declaredLength) throw new PdfFileFailure('Declared PDF size does not match the PDF body', 400)
        await writer.write(result.value)
      }
      if (receivedBytes !== declaredLength) throw new PdfFileFailure('Declared PDF size does not match the PDF body', 400)
      await writer.close()
    } catch (error) {
      const failure = error instanceof PdfFileFailure
        ? error
        : new PdfFileFailure('Could not read the PDF upload stream', 400)
      await cancel(failure)
      throw failure
    }
  })()
  return { body: fixed.readable, completion, cancel, sizeBytes: declaredLength, filename, kind }
}

function encodedDisposition(filename: string, download: boolean): string {
  const safeFallback = filename.replaceAll(/[^\x20-\x7e]/g, '_').replaceAll(/["\\]/g, '') || 'paper.pdf'
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
  if (!match || (!match[1] && !match[2]) || size < 1) throw new PdfFileFailure('Invalid byte range', 416)
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new PdfFileFailure('Invalid byte range', 416)
    const length = Math.min(suffix, size)
    return { offset: size - length, length, end: size - 1 }
  }
  const offset = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(requestedEnd) || offset < 0 || requestedEnd < offset || offset >= size) {
    throw new PdfFileFailure('Invalid byte range', 416)
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

export async function pdfFileResponse(
  request: Request,
  bucket: R2Bucket,
  file: StoredPdf,
  download: boolean,
  privateFile: boolean,
): Promise<Response> {
  const cacheControl = privateFile ? 'private, no-store' : 'public, max-age=0, must-revalidate'
  const rangeHeader = request.method === 'GET' ? request.headers.get('range') : null
  const needsMetadata = request.method === 'HEAD'
    || rangeHeader !== null
    || request.headers.has('if-match')
    || request.headers.has('if-none-match')
    || request.headers.has('if-range')
  const metadata = needsMetadata ? await bucket.head(file.storage_key) : null
  if (needsMetadata && !metadata) throw new PdfFileFailure('PDF file is missing', 404)

  const precondition = (etag: string): Response | null => {
    if (request.headers.has('if-match') && !strongEtagMatches(request.headers.get('if-match'), etag)) {
      return new Response(null, { status: 412, headers: { etag, 'cache-control': cacheControl } })
    }
    if (weakEtagMatches(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers: { etag, 'cache-control': cacheControl } })
    }
    return null
  }
  if (metadata) {
    const conditional = precondition(metadata.httpEtag)
    if (conditional) return conditional
  }

  if (request.method === 'HEAD') {
    const headers = new Headers({
      'content-type': file.mime_type,
      'content-disposition': encodedDisposition(file.filename, download),
      'accept-ranges': 'bytes',
      'cache-control': cacheControl,
      'etag': metadata!.httpEtag,
      'content-length': String(metadata!.size),
      'x-content-type-options': 'nosniff',
    })
    return new Response(null, { status: 200, headers })
  }

  let range: ByteRange | null = null
  if (rangeHeader) {
    const ifRange = request.headers.get('if-range')
    if (!ifRange || ifRange.trim() === metadata!.httpEtag) {
      try {
        range = byteRange(rangeHeader, metadata!.size)
      } catch (error) {
        if (error instanceof PdfFileFailure && error.status === 416) {
          return new Response(null, {
            status: 416,
            headers: {
              'content-range': `bytes */${metadata!.size}`,
              'accept-ranges': 'bytes',
              'cache-control': cacheControl,
              etag: metadata!.httpEtag,
              'x-content-type-options': 'nosniff',
            },
          })
        }
        throw error
      }
    }
  }

  let object = await bucket.get(file.storage_key, range ? { range: { offset: range.offset, length: range.length } } : undefined)
  if (!object) throw new PdfFileFailure('PDF file is missing', 404)
  if (metadata && range && object.httpEtag !== metadata.httpEtag) {
    object = await bucket.get(file.storage_key)
    range = null
    if (!object) throw new PdfFileFailure('PDF file is missing', 404)
  }

  if (!metadata || object.httpEtag !== metadata.httpEtag) {
    const conditional = precondition(object.httpEtag)
    if (conditional) return conditional
  }

  const headers = new Headers({
    'content-type': file.mime_type,
    'content-disposition': encodedDisposition(file.filename, download),
    'accept-ranges': 'bytes',
    'cache-control': cacheControl,
    'etag': object.httpEtag,
    'x-content-type-options': 'nosniff',
  })
  if (range) {
    headers.set('content-length', String(range.length))
    headers.set('content-range', `bytes ${range.offset}-${range.end}/${metadata!.size}`)
  } else {
    headers.set('content-length', String(object.size))
  }
  return new Response((object as R2ObjectBody).body, { status: range ? 206 : 200, headers })
}
