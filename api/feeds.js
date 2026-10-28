const { safeFetch, parseFeed, send } = require('./_lib');
const defaults = require('../sources.json');

const str = v => (typeof v === 'string' ? v.trim().slice(0, 80) : '');

async function load(s) {
  const out = { source: s.name, category: s.category, url: s.url, site: s.site };
  try {
    const urls = { Latest: s.url, ...s.modes };
    const entries = await Promise.all(Object.entries(urls).map(async ([label, url]) =>
      [label, parseFeed((await safeFetch(url)).text)]));
    out.modes = Object.fromEntries(entries);
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

module.exports = async (req, res) => {
  let sources = defaults;
  const extra = new URL(req.url, 'http://x').searchParams.get('extra');
  if (extra) {
    try { sources = JSON.parse(extra); } catch { return send(res, 400, { error: 'Bad extra parameter' }); }
  }
  if (!Array.isArray(sources) || sources.length > 40) return send(res, 400, { error: 'Send at most 40 sources' });
  const clean = sources.filter(s => s && typeof s.url === 'string').map(s => ({
    name: str(s.name) || s.url, url: s.url, category: str(s.category) || 'Other', site: str(s.site) || undefined,
    modes: s.modes && typeof s.modes === 'object' ? s.modes : undefined,
  }));
  send(res, 200, await Promise.all(clean.map(load)));
};
