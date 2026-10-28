const dns = require('node:dns/promises');
const net = require('node:net');

const MAX_BYTES = 2e6;
const TIMEOUT_MS = 6000;

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    return v4 ? isPrivate(v4[1]) : /^(::1?$|f[cd]|fe[89ab])/i.test(ip);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128);
}

// shortcut: DNS is checked before fetch, not pinned to the connection (rebinding gap); upgrade with a pinned agent if this goes multi-user
async function safeFetch(input) {
  let url = new URL(input);
  for (let hop = 0; hop < 4; hop++) {
    if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https URLs are allowed');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw new Error('Address not allowed');
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; Skim/1.0; +feed reader)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
      },
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url); continue; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let size = 0;
    const chunks = [];
    for await (const c of res.body) {
      if ((size += c.length) > MAX_BYTES) throw new Error('Response too large');
      chunks.push(c);
    }
    return { text: Buffer.concat(chunks).toString('utf8'), url: url.href };
  }
  throw new Error('Too many redirects');
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
    const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1);
    try { return String.fromCodePoint(n); } catch { return m; }
  })
  .replace(/\s+/g, ' ')
  .trim();

const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
};

// shortcut: regex parsing, fine for mainstream RSS/Atom; swap in a real XML parser if odd feeds show up
function parseFeed(xml, limit = 15) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  const items = [];
  for (const b of blocks) {
    const atom = [...b.matchAll(/<link\b([^>]*)>/gi)].map(m => m[1])
      .find(a => /\bhref=/i.test(a) && (!/\brel=/i.test(a) || /\brel=["']?alternate/i.test(a)));
    let url = atom ? decode(atom.match(/\bhref=["']([^"']+)["']/i)?.[1] || '') : tag(b, 'link');
    if (!url) { const g = tag(b, 'guid'); if (/^https?:\/\//i.test(g)) url = g; }
    const title = tag(b, 'title');
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const t = Date.parse(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    items.push({ title, url, publishedAt: isNaN(t) ? null : new Date(t).toISOString() });
    if (items.length >= limit) break;
  }
  return items;
}

const isFeed = text => /<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000));

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (status >= 400) res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = { safeFetch, parseFeed, isFeed, tag, send };
