const { safeFetch, isFeed, tag, send } = require('./_lib');

const COMMON = ['/feed', '/rss', '/feed.xml', '/rss.xml', '/atom.xml'];

module.exports = async (req, res) => {
  const input = new URL(req.url, 'http://x').searchParams.get('url');
  const probe = async c => {
    const r = await safeFetch(c);
    if (!isFeed(r.text)) throw new Error('not a feed');
    return { feed: r.url, title: tag(r.text, 'title') };
  };
  try {
    const page = await safeFetch(input);
    if (isFeed(page.text)) return send(res, 200, { feed: page.url, title: tag(page.text, 'title') });
    const declared = [...page.text.matchAll(/<link\b[^>]*>/gi)].map(m => m[0])
      .filter(t => /rel=["']?alternate/i.test(t) && /type=["']?application\/(rss|atom)\+xml/i.test(t))
      .map(t => t.match(/href=["']([^"']+)["']/i)?.[1]).filter(Boolean)
      .map(h => new URL(h.replace(/&amp;/g, '&'), page.url).href);
    for (const c of declared) try { return send(res, 200, await probe(c)); } catch {}
    try { return send(res, 200, await Promise.any(COMMON.map(p => probe(new URL(p, page.url).href)))); } catch {}
    send(res, 404, { error: "No feed found. Try pasting the feed URL directly." });
  } catch (e) {
    send(res, 400, { error: e.message });
  }
};
