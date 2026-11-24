// Prévia de links: busca a página e devolve título, descrição e imagem (tags og:/twitter:).
// GET /api/preview?url=https://...
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 600 * 1024;
const TIMEOUT_MS = 7000;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('::ffff:');
}
async function safeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) return null;
  try {
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some(a => privateIp(a.address))) return null;
  } catch { return null; }
  return u;
}
// print da página (serviço gratuito do WordPress; a primeira vez pode demorar uns segundos pra gerar)
const shot = url => `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=1200&h=750`;
function decode(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
}
function firstImg(html, base) { // primeira imagem "de verdade" do corpo da página
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = attr(tag, 'src') || attr(tag, 'data-src');
    if (!src || /^data:|\.svg(\?|$)|sprite|logo|icon|avatar|pixel|1x1/i.test(src)) continue;
    const w = +(attr(tag, 'width') || 0), h = +(attr(tag, 'height') || 0);
    if ((w && w < 200) || (h && h < 120)) continue;
    try { return new URL(decode(src), base).href; } catch {}
  }
  return null;
}
function parse(html, base) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (key && content && !(key in meta)) meta[key] = decode(content);
  }
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  let icon = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    if (/\bicon\b/.test(rel) && attr(tag, 'href')) { icon = attr(tag, 'href'); if (rel.includes('apple')) break; }
  }
  const abs = v => { if (!v) return null; try { return new URL(decode(v), base).href; } catch { return null; } };
  return {
    url: base,
    title: meta['og:title'] || meta['twitter:title'] || decode(titleTag) || null,
    description: meta['og:description'] || meta['twitter:description'] || meta['description'] || null,
    image: abs(meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src']) || firstImg(html, base),
    site: meta['og:site_name'] || new URL(base).hostname.replace(/^www\./, ''),
    favicon: abs(icon) || new URL('/favicon.ico', base).href,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const raw = (req.query && req.query.url) || new URL(req.url, 'http://x').searchParams.get('url');
  let u = await safeUrl(raw);
  if (!u) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'url inválida' })); }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let r;
    for (let hop = 0; hop < 4; hop++) { // segue redirecionamentos checando cada destino
      r = await fetch(u.href, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; meu-canto-preview/1.0; +https://bianqian-phi.vercel.app)', 'accept': 'text/html,application/xhtml+xml', 'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8' },
      });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        u = await safeUrl(new URL(r.headers.get('location'), u).href);
        if (!u) throw new Error('redirecionamento bloqueado');
        continue;
      }
      break;
    }
    const type = r.headers.get('content-type') || '';
    if (type.startsWith('image/')) {
      res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
      return res.end(JSON.stringify({ url: u.href, title: null, description: null, image: u.href, site: u.hostname.replace(/^www\./, ''), favicon: null }));
    }
    if (!type.includes('html')) throw new Error('não é uma página');
    const reader = r.body.getReader();
    let html = '', bytes = 0;
    const dec = new TextDecoder();
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length; html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html) && /og:image|twitter:image/i.test(html)) break;
      if (bytes > 250 * 1024) break;
    }
    try { reader.cancel(); } catch {}
    const out = parse(html, u.href);
    if (!out.image){ // sem imagem de capa: usa um print da própria página
      out.image = shot(u.href); out.shot = true;
    }
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.end(JSON.stringify(out));
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Cache-Control', 's-maxage=600');
    res.end(JSON.stringify({ error: String(e.message || e) }));
  } finally { clearTimeout(timer); }
};
module.exports._parse = parse; // usado nos testes
