import { session } from 'electron'
import { isDev } from './config'

// Enforce Content Security Policy via response headers (tamper-proof from renderer)
export function setupCSP(): void {
  // img-src/media-src allow https://videos.ltx.io and https://storage.googleapis.com because
  // the LoRA library plays remote demo clips and thumbnails (catalog entries'
  // media.demo_video / media.thumbnail) hosted on those CDNs.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = isDev
      ? [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
          "img-src 'self' data: blob: file: https://storage.googleapis.com",
          // 'data:' in media-src is ours (Prompt Manager Pro serves media as data URLs);
          // the remote hosts are upstream's, for LoRA-catalog preview media.
          "media-src 'self' blob: file: data: https://videos.ltx.io https://storage.googleapis.com",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'self'",
        ].join('; ')
      : [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
          "img-src 'self' data: blob: file: https://storage.googleapis.com",
          // 'data:' in media-src is ours (Prompt Manager Pro serves media as data URLs);
          // the remote hosts are upstream's, for LoRA-catalog preview media.
          "media-src 'self' blob: file: data: https://videos.ltx.io https://storage.googleapis.com",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'self'",
        ].join('; ')

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}
