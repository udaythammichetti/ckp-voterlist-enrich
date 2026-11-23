import crypto from 'node:crypto'

const COOKIE = 'ckp_session'
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14 // 14 days

function envUser() {
  return String(process.env.AUTH_USER || process.env.APP_USERNAME || '').trim()
}

function envPass() {
  return String(process.env.AUTH_PASSWORD || process.env.APP_PASSWORD || '')
}

export function authEnabled() {
  return Boolean(envUser() && envPass())
}

function secret() {
  const extra = process.env.AUTH_SECRET || ''
  return crypto
    .createHash('sha256')
    .update(`ckp:${envUser()}:${envPass()}:${extra}`)
    .digest()
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  if (aa.length !== bb.length) return false
  return crypto.timingSafeEqual(aa, bb)
}

export function createSessionToken(username) {
  const exp = Date.now() + MAX_AGE_MS
  const body = `${username}.${exp}`
  return `${body}.${sign(body)}`
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [username, expStr, sig] = parts
  const body = `${username}.${expStr}`
  if (!timingSafeEqualStr(sign(body), sig)) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  if (!timingSafeEqualStr(username, envUser())) return false
  return true
}

export function parseCookies(req) {
  const header = req.headers.cookie || ''
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (!k) continue
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

export function isAuthenticated(req) {
  if (!authEnabled()) return true
  const cookies = parseCookies(req)
  return verifySessionToken(cookies[COOKIE])
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ]
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true'
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

export function checkCredentials(username, password) {
  if (!authEnabled()) return true
  return timingSafeEqualStr(username, envUser()) && timingSafeEqualStr(password, envPass())
}

export function loginPageHtml({ error = '', next = '/' } = {}) {
  const safeNext = String(next || '/').startsWith('/') ? String(next || '/') : '/'
  const err = error
    ? `<p class="err">${escapeHtml(error)}</p>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#0b1410" />
  <title>Sign in · Damalacheruvu</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; display: grid; place-items: center;
      font-family: Figtree, system-ui, sans-serif; color: #e8f0e9;
      background:
        radial-gradient(900px 480px at 10% -10%, rgba(47,143,116,.28), transparent 55%),
        radial-gradient(700px 400px at 90% 0%, rgba(212,163,92,.16), transparent 50%),
        #0b1410;
      padding: 1.25rem;
    }
    .card {
      width: min(24rem, 100%);
      border: 1px solid rgba(214,227,214,.12);
      border-radius: 16px;
      padding: 1.35rem 1.25rem 1.2rem;
      background: linear-gradient(180deg, #15241d, #0e1813);
      box-shadow: 0 18px 50px rgba(0,0,0,.35);
    }
    .kicker { margin: 0; font-size: .72rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #d4a35c; }
    h1 { margin: .35rem 0 .2rem; font-size: 1.45rem; letter-spacing: -.02em; }
    .sub { margin: 0 0 1rem; color: #9aada1; font-size: .9rem; }
    label { display: block; margin: .7rem 0 .3rem; font-size: .82rem; color: #9aada1; font-weight: 600; }
    input {
      width: 100%; border: 1px solid rgba(214,227,214,.16); border-radius: 10px;
      background: rgba(0,0,0,.28); color: #e8f0e9; font: inherit; font-size: 16px;
      padding: .7rem .75rem;
    }
    button {
      width: 100%; margin-top: 1.1rem; border: 0; border-radius: 10px;
      background: #2f8f74; color: #0d1612; font: inherit; font-weight: 800;
      min-height: 2.85rem; cursor: pointer;
    }
    button:active { transform: translateY(1px); }
    .err { margin: 0 0 .75rem; color: #f0a0a0; font-size: .88rem; font-weight: 600; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/login" autocomplete="on">
    <p class="kicker">Sarpanch 2026</p>
    <h1>Damalacheruvu</h1>
    <p class="sub">Sign in to open the campaign desk</p>
    ${err}
    <input type="hidden" name="next" value="${escapeHtml(safeNext)}" />
    <label for="username">Username</label>
    <input id="username" name="username" required autocomplete="username" autofocus />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
