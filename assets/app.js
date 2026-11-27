/* Conflict Map of the World: front-end. Data lives in /data/*.json and is refreshed daily. */
(() => {
'use strict';

const TABS = {
  conflicts: { label: 'Conflicts', title: 'Armed conflicts around the world', key: 'cat', sort: 'cat',
    intro: 'Active wars, insurgencies and armed crises, coloured by intensity. Click a marker or a row for the background, the latest developments and sources.',
    types: { 1: ['Major war', '#c0261d'], 2: ['Serious conflict', '#e0731f'], 3: ['Lower intensity or fragile ceasefire', '#c49a12'] } },
  violence: { label: 'Day-to-day violence', title: 'Significant violent incidents', key: 'type',
    intro: 'Notable attacks, massacres and outbreaks of criminal or communal violence from the past few weeks, beyond the front lines of declared wars.',
    types: { attack: ['Attack on civilians', '#c0261d'], insurgent: ['Insurgent or terrorist attack', '#8b3fa3'], criminal: ['Gang or cartel violence', '#e0731f'], communal: ['Communal violence', '#8a6d1f'] } },
  disasters: { label: 'Natural disasters', title: 'Natural disasters', key: 'type', live: true,
    intro: 'Major recent earthquakes, storms and floods, plus live earthquakes of magnitude 5.5 and stronger from the US Geological Survey.',
    types: { earthquake: ['Earthquake', '#8a5a2b'], storm: ['Storm or cyclone', '#2f74c0'], flood: ['Flood', '#14918f'], other: ['Other hazard', '#6b6f6c'] } },
  politics: { label: 'Political changes', title: 'Political changes', key: 'type',
    intro: 'Elections, changes of leader, major court rulings and constitutional shifts, plus important votes coming up.',
    types: { election: ['Election', '#2f5aa8'], leadership: ['Change of leadership', '#7a45b0'], legal: ['Courts and constitutions', '#5d7a2a'], upcoming: ['Coming up', '#7d8580'] } },
  economy: { label: 'Economic ties', title: 'Economic ties', key: 'type',
    intro: 'Trade deals, tariffs, sanctions and energy deals between countries. Lines link the two sides of each relationship.',
    types: { 'trade-deal': ['Trade deal', '#1f8a55'], tariffs: ['Tariffs', '#d0561b'], sanctions: ['Sanctions', '#b0224a'], partnership: ['Partnership', '#2f6fd6'], energy: ['Energy', '#a77a0c'] } }
};
const ORDER = Object.keys(TABS);
const QUAKE_COLOR = '#8a5a2b';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => /^https?:\/\//i.test(String(u)) ? String(u) : '#';
const fmtDate = d => { const t = new Date(d + 'T12:00:00Z'); return isNaN(t) ? esc(d) : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); };
const cache = {};
let tab = 'conflicts', items = [], quakes = [], selected = null, filterType = 'all', query = '', world = null, zoomK = 1;

/* ---------- map setup ---------- */
const svg = d3.select('#map'), fig = $('fig'), tip = $('tip'), statusEl = $('status');
const root = svg.append('g'), gBase = root.append('g'), gLand = root.append('g'), gArc = root.append('g'), gQk = root.append('g'), gMk = root.append('g');
const projection = d3.geoNaturalEarth1(), path = d3.geoPath(projection);
const zoom = d3.zoom().scaleExtent([1, 10]).on('zoom', e => { root.attr('transform', e.transform); zoomK = e.transform.k; sizeMarks(); });
svg.call(zoom).on('dblclick.zoom', null);

const typeOf = d => String(TABS[tab].key === 'cat' ? d.cat : d.type);
const colorOf = d => (TABS[tab].types[typeOf(d)] || ['', '#6b6f6c'])[1];
const labelOf = d => (TABS[tab].types[typeOf(d)] || [d.type || ''])[0];
const visible = d => (filterType === 'all' || typeOf(d) === filterType) &&
  (!query || [d.title, d.where, d.region, d.parties, d.summary, d.toName].join(' ').toLowerCase().includes(query));
const R = d => tab === 'conflicts' ? ({ 1: 7.5, 2: 6, 3: 5 }[d.cat] || 6) : 6.5;
const qR = q => Math.max(3, (q.mag - 4) * 3.2);

function draw() {
  const W = fig.clientWidth, H = fig.clientHeight; if (!W || !H) return;
  projection.fitExtent([[4, 4], [W - 4, H - 4]], { type: 'Sphere' });
  zoom.translateExtent([[0, 0], [W, H]]).extent([[0, 0], [W, H]]);
  gBase.selectAll('path').data([{ type: 'Sphere' }, d3.geoGraticule10()]).join('path').attr('class', (d, i) => i ? 'grat' : 'sphere').attr('d', path);
  if (world) gLand.selectAll('path').data(world.features).join('path').attr('class', 'land').attr('d', path);

  const shown = items.filter(visible);
  gArc.selectAll('path').data(shown.filter(d => Array.isArray(d.to)), d => d.id).join('path')
    .attr('class', d => 'arc' + (d.id === selected ? ' sel' : ''))
    .attr('stroke', colorOf)
    .attr('d', d => path({ type: 'LineString', coordinates: [[d.lon, d.lat], d.to] }));

  const qs = TABS[tab].live && (filterType === 'all' || filterType === 'earthquake') ? quakes.filter(q => !query || q.place.toLowerCase().includes(query)) : [];
  gQk.selectAll('circle').data(qs, q => q.id).join(en => en.append('circle').attr('tabindex', 0).attr('role', 'button')
      .on('click', (e, q) => select(q.id, true))
      .on('keydown', (e, q) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(q.id, true); } })
      .on('mouseenter focus', (e, q) => showTip(q, `M${q.mag.toFixed(1)} · ${q.place}`))
      .on('mouseleave blur', hideTip))
    .attr('class', q => 'qk' + (q.id === selected ? ' sel' : ''))
    .attr('fill', QUAKE_COLOR).attr('stroke', QUAKE_COLOR)
    .attr('aria-label', q => `Live earthquake magnitude ${q.mag.toFixed(1)}, ${q.place}`)
    .attr('cx', q => projection([q.lon, q.lat])[0]).attr('cy', q => projection([q.lon, q.lat])[1]);

  const ends = shown.filter(d => Array.isArray(d.to));
  gMk.selectAll('circle.end').data(ends, d => d.id).join('circle').attr('class', 'end').attr('fill', colorOf)
    .attr('cx', d => projection(d.to)[0]).attr('cy', d => projection(d.to)[1]);

  const g = gMk.selectAll('g.m').data(shown.slice().sort((a, b) => (b.cat || 0) - (a.cat || 0)), d => d.id).join(en => {
    const m = en.append('g').attr('class', 'm');
    m.append('circle').attr('class', 'halo');
    m.append('circle').attr('class', 'mk').attr('tabindex', 0).attr('role', 'button')
      .on('click', (e, d) => select(d.id, true))
      .on('keydown', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(d.id, true); } })
      .on('mouseenter focus', (e, d) => showTip(d, d.title))
      .on('mouseleave blur', hideTip);
    return m;
  });
  g.attr('transform', d => { const p = projection([d.lon, d.lat]); return `translate(${p[0]},${p[1]})`; });
  g.select('circle.halo').attr('stroke', colorOf).attr('display', d => tab === 'conflicts' && d.cat === 1 ? null : 'none');
  g.select('circle.mk').attr('fill', colorOf).classed('sel', d => d.id === selected).attr('aria-label', d => `${d.title}, ${labelOf(d)}`);
  sizeMarks();
}

function sizeMarks() {
  const k = zoomK, s = Math.sqrt(k);
  gMk.selectAll('circle.mk').attr('r', d => (R(d) + (d.id === selected ? 2 : 0)) / s).attr('stroke-width', d => (d.id === selected ? 2.5 : 1.5) / k);
  gMk.selectAll('circle.halo').attr('r', d => R(d) / s).attr('stroke-width', 2 / k);
  gMk.selectAll('circle.end').attr('r', 3.5 / s).attr('stroke-width', 1 / k);
  gQk.selectAll('circle').attr('r', q => qR(q) / s).attr('stroke-width', (q => (q.id === selected ? 2.5 : 1.5) / k));
}

function showTip(d, text) {
  const p = projection([d.lon, d.lat]), t = d3.zoomTransform(svg.node());
  tip.textContent = text; tip.style.left = t.applyX(p[0]) + 'px'; tip.style.top = t.applyY(p[1]) + 'px'; tip.style.display = 'block';
}
function hideTip() { tip.style.display = 'none'; }
function paintDots(rootEl) { rootEl.querySelectorAll('[data-c]').forEach(el => { el.style.background = el.dataset.c; if (el.classList.contains('ring')) { el.style.background = 'transparent'; el.style.color = el.dataset.c; } }); }

/* ---------- panels, legend, list ---------- */
function legend() {
  const t = TABS[tab];
  let html = Object.values(t.types).map(([l, c]) => `<span><i class="dot" data-c="${esc(c)}"></i>${esc(l)}</span>`).join('');
  if (t.live) html += `<span><i class="ring" data-c="${QUAKE_COLOR}"></i>Live earthquake (USGS)</span>`;
  $('legend').innerHTML = html; paintDots($('legend'));
  $('chips').innerHTML = `<button class="chip" data-t="all" aria-pressed="${filterType === 'all'}">All</button>` +
    Object.entries(t.types).map(([k, [l, c]]) => `<button class="chip" data-t="${esc(k)}" aria-pressed="${filterType === k}"><i class="dot" data-c="${esc(c)}"></i>${esc(l)}</button>`).join('');
  paintDots($('chips'));
}

function panel() {
  const el = $('panel');
  const q = quakes.find(x => x.id === selected);
  if (q) {
    el.innerHTML = `<span class="tag"><i class="ring" data-c="${QUAKE_COLOR}"></i>Live earthquake</span>
      <h3>Magnitude ${esc(q.mag.toFixed(1))}</h3>
      <dl class="facts"><dt>Where</dt><dd>${esc(q.place)}</dd><dt>When</dt><dd>${esc(new Date(q.time).toUTCString().replace(' GMT', ' UTC'))}</dd><dt>Depth</dt><dd>${esc(q.depth.toFixed(0))} km</dd></dl>
      <p class="small">Automatic data from the US Geological Survey. Early magnitudes and locations can be revised.</p>
      <ul class="src"><li><a href="${esc(safeUrl(q.url))}" rel="noopener">USGS event page</a></li></ul>`;
    paintDots(el); return;
  }
  const d = items.find(x => x.id === selected);
  if (!d) { el.innerHTML = '<p class="small">Select a marker on the map or a row in the index.</p>'; return; }
  const facts = [['Where', d.where], tab === 'conflicts' ? ['Since', d.since] : ['Date', fmtDate(d.date)], d.parties ? ['Parties', d.parties] : null, d.toName ? ['Partner', d.toName] : null].filter(Boolean);
  el.innerHTML = `<span class="tag"><i class="dot" data-c="${esc(colorOf(d))}"></i>${esc(labelOf(d))}</span>
    <h3>${esc(d.title)}</h3>
    <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Date' ? v : esc(v)}</dd>`).join('')}</dl>
    <p>${esc(d.summary)}</p>
    <div><div class="small">Sources</div><ul class="src">${(d.src || []).map(s => `<li><a href="${esc(safeUrl(s[1]))}" rel="noopener">${esc(s[0])}</a></li>`).join('')}</ul></div>`;
  paintDots(el);
}

function table() {
  const t = TABS[tab];
  const rows = items.filter(visible).sort((a, b) => t.sort === 'cat' ? (a.cat - b.cat || a.title.localeCompare(b.title)) : String(b.date).localeCompare(String(a.date)));
  const heads = ['Item', 'Where', 'Type', tab === 'conflicts' ? 'Since' : 'Date', 'Summary'];
  $('tbl').tHead.rows[0].innerHTML = heads.map(h => `<th>${h}</th>`).join('');
  $('listTitle').textContent = `Index · ${t.label}`;
  $('rows').innerHTML = rows.length ? rows.map(d => `<tr tabindex="0" data-id="${esc(d.id)}" class="${d.id === selected ? 'sel' : ''}">
      <td class="nm" data-l="${heads[0]}">${esc(d.title)}</td><td data-l="${heads[1]}">${esc(d.where)}</td>
      <td class="nw" data-l="${heads[2]}"><i class="dot" data-c="${esc(colorOf(d))}"></i> ${esc(labelOf(d))}</td>
      <td class="nw" data-l="${heads[3]}">${tab === 'conflicts' ? esc(d.since) : fmtDate(d.date)}</td>
      <td data-l="${heads[4]}">${esc(String(d.summary).split(/(?<=\.)\s/)[0])}</td></tr>`).join('')
    : '<tr><td class="empty" colspan="5">Nothing matches this filter.</td></tr>';
  paintDots($('rows'));
}

function quakeList() {
  const box = $('live');
  box.hidden = !TABS[tab].live;
  if (box.hidden) return;
  $('quakes').innerHTML = quakes.length ? quakes.map(q => `<li><button data-q="${esc(q.id)}"><span class="mag">${esc(q.mag.toFixed(1))}</span><span>${esc(q.place)}<br><span class="small">${esc(new Date(q.time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }))} UTC</span></span></button></li>`).join('')
    : '<li class="small">No live data right now (the USGS feed could not be reached, or there were no quakes of this size).</li>';
}

/* ---------- selection & routing ---------- */
function select(id, fromMap) {
  const d = items.find(x => x.id === id) || quakes.find(x => x.id === id);
  if (!d) return;
  selected = id;
  try { history.replaceState(null, '', `#${tab}/${encodeURIComponent(id)}`); } catch (e) { /* ignore */ }
  draw(); panel(); table();
  if (!fromMap) {
    const p = projection([d.lon, d.lat]), W = fig.clientWidth, H = fig.clientHeight, k = Math.max(zoomK, 2.2);
    svg.transition().duration(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600)
      .call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * p[0], H / 2 - k * p[1]).scale(k));
  }
}

async function loadTab(name, itemId) {
  if (!TABS[name]) name = 'conflicts';
  tab = name; filterType = 'all'; query = ''; $('q').value = ''; selected = null;
  const t = TABS[name];
  $('title').textContent = t.title; $('intro').textContent = t.intro;
  document.title = `${t.label} · Conflict Map of the World`;
  $('tabs').innerHTML = ORDER.map(k => `<a href="#${k}" ${k === name ? 'aria-current="page"' : ''}>${esc(TABS[k].label)}</a>`).join('');
  legend();
  try {
    if (!cache[name]) { const r = await fetch(`data/${name}.json`, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); cache[name] = await r.json(); }
    items = (cache[name].items || []).filter(d => isFinite(d.lon) && isFinite(d.lat));
  } catch (e) { items = []; $('panel').innerHTML = '<p class="small">This section could not be loaded. Please refresh the page.</p>'; }
  if (t.live && !quakes.length) await loadQuakes();
  const today = new Date().toISOString().slice(0, 10);
  const pool = items.filter(d => tab === 'conflicts' || !d.date || d.date <= today);
  const sorted = (pool.length ? pool : items).slice().sort((a, b) => tab === 'conflicts' ? a.cat - b.cat : String(b.date).localeCompare(String(a.date)));
  const first = itemId && (items.some(d => d.id === itemId) || quakes.some(q => q.id === itemId)) ? itemId : (sorted[0] && sorted[0].id);
  svg.call(zoom.transform, d3.zoomIdentity);
  quakeList();
  if (first) select(first, !itemId); else { draw(); panel(); table(); }
}

async function loadQuakes() {
  try {
    const r = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson');
    const j = await r.json();
    quakes = (j.features || []).filter(f => f.properties && f.properties.mag >= 5.5 && f.geometry).map(f => ({
      id: 'usgs-' + f.id, mag: +f.properties.mag, place: String(f.properties.place || 'Unknown location'), time: f.properties.time,
      url: f.properties.url, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], depth: +f.geometry.coordinates[2] || 0
    })).sort((a, b) => b.time - a.time);
  } catch (e) { quakes = []; }
}

function route() {
  const [name, id] = location.hash.slice(1).split('/');
  const target = TABS[name] ? name : 'conflicts', itemId = id ? decodeURIComponent(id) : null;
  if (target !== tab || !items.length) loadTab(target, itemId);
  else if (itemId && itemId !== selected) select(itemId, false);
}

/* ---------- events ---------- */
$('rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) { select(tr.dataset.id, false); fig.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
$('rows').addEventListener('keydown', e => { const tr = e.target.closest('tr[data-id]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(tr.dataset.id, false); } });
$('quakes').addEventListener('click', e => { const b = e.target.closest('button[data-q]'); if (b) { select(b.dataset.q, false); fig.scrollIntoView({ behavior: 'smooth', block: 'center' }); } });
$('chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; filterType = b.dataset.t; $('chips').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === b))); draw(); table(); });
$('q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); draw(); table(); });
$('zin').addEventListener('click', () => svg.transition().duration(250).call(zoom.scaleBy, 1.6));
$('zout').addEventListener('click', () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.6));
$('zreset').addEventListener('click', () => svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity));
window.addEventListener('hashchange', route);
const ro = new ResizeObserver(() => draw()); ro.observe(fig);

/* ---------- world outlines ---------- */
function rewind(f) {
  const g = f.geometry; if (!g) return;
  const fix = poly => { if (d3.geoArea({ type: 'Polygon', coordinates: poly }) > 2 * Math.PI) poly.forEach(r => r.reverse()); };
  if (g.type === 'Polygon') fix(g.coordinates); else if (g.type === 'MultiPolygon') g.coordinates.forEach(fix);
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function loadWorld() {
  try { // 1. self-hosted copy (added automatically by the repository's setup workflow)
    if (window.topojson) { const r = await withTimeout(fetch('assets/countries-110m.json'), 8000); if (r.ok) { const t = await r.json(); return topojson.feature(t, t.objects.countries); } }
  } catch (e) { /* fall through */ }
  for (const u of ['https://cdn.jsdelivr.net/npm/@amcharts/amcharts5-geodata@5/worldLow.js', 'https://cdn.jsdelivr.net/npm/@amcharts/amcharts4-geodata@4/worldLow.js']) {
    try { const m = await withTimeout(import(u), 9000); const g = m.default || m; if (g && Array.isArray(g.features) && g.features.length > 50) return g; } catch (e) { /* next */ }
  }
  return null;
}

fetch('data/meta.json', { cache: 'no-cache' }).then(r => r.json()).then(m => { $('updated').textContent = m.updatedText || m.updated; }).catch(() => { $('updated').textContent = '—'; });
route();
loadWorld().then(g => {
  if (g) { g.features = g.features.filter(f => f.geometry && f.properties?.id !== 'AQ' && f.properties?.name !== 'Antarctica' && f.id !== '010'); g.features.forEach(rewind); world = g; statusEl.remove(); }
  else statusEl.textContent = 'Country outlines could not load; markers are shown on a plain grid.';
  draw();
});
})();
