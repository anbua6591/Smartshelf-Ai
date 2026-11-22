'use strict';
/* SmartShelf AI – inventory optimisation. Data lives in LocalStorage. */
const KEY = 'smartshelf.v1', DAYS = 90;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const todayISO = () => iso(new Date());
const daysUntil = s => Math.round((new Date(s + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 864e5);
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const sum = a => a.reduce((x, y) => x + y, 0);
const shortDate = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/* ---------- Sample data (history generated from a seeded pattern: weekday/weekend + trend + noise) ---------- */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// id, name, category, stock, min, price, expiry (days from today), base daily sales, growth (+ rising / - falling), days with no sales
const SAMPLE = [
  ['P001', 'Whole Milk 1L', 'Dairy', 24, 20, 1.2, 5, 18, 0.3],
  ['P002', 'Greek Yogurt 150g', 'Dairy', 40, 15, 0.9, 12, 8, 0.1],
  ['P003', 'Cheddar Cheese 200g', 'Dairy', 12, 10, 4.5, 25, 5, 0],
  ['P004', 'Sourdough Bread', 'Bakery', 15, 15, 1.5, 3, 14, -0.2],
  ['P005', 'Basmati Rice 5kg', 'Grocery', 60, 20, 12, null, 4, 0.1],
  ['P006', 'Sunflower Oil 1L', 'Grocery', 8, 10, 3.8, 200, 5, 0.3],
  ['P007', 'Instant Noodles', 'Grocery', 150, 40, 0.5, 120, 20, 0.4],
  ['P008', 'Orange Juice 1L', 'Beverages', 0, 15, 2.5, 40, 9, 0.2],
  ['P009', 'Cola 500ml', 'Beverages', 90, 40, 1, 180, 22, 0.35],
  ['P010', 'Mineral Water 1L', 'Beverages', 200, 60, 0.4, null, 30, 0.3],
  ['P011', 'Potato Chips 150g', 'Snacks', 70, 30, 1.1, 90, 12, -0.3],
  ['P012', 'Chocolate Bar', 'Snacks', 55, 25, 1.3, 150, 10, 0.1],
  ['P013', 'Hand Soap', 'Personal Care', 35, 12, 2.2, null, 3, 0],
  ['P014', 'Shampoo 200ml', 'Personal Care', 28, 10, 4.8, 300, 2, 0, 20],
  ['P015', 'Notebook A5', 'Stationery', 100, 20, 1.6, null, 3, 0],
  ['P016', 'Eggs (12 pack)', 'Dairy', 18, 15, 3.2, 10, 12, 0.25],
  ['P017', 'Laundry Detergent 1kg', 'Household', 25, 10, 5.5, null, 2, 0, 18]
];
function seedProducts() {
  return SAMPLE.map((r, i) => {
    const [id, name, category, stock, min, price, exp, base, growth, stop] = r, rnd = rng(i + 7), sales = [];
    for (let k = 0; k < DAYS; k++) {
      const wk = [0, 6].includes(addDays(k - DAYS + 1).getDay()) ? 1.25 : 1;
      let v = Math.round(base * (1 + growth * (k / (DAYS - 1) - 1)) * wk * (0.75 + rnd() * 0.5));
      if (stop && k >= DAYS - stop) v = 0;
      sales.push(Math.max(0, v));
    }
    return { id, name, category, stock, min, price, expiry: exp == null ? '' : iso(addDays(exp)), sales };
  });
}

/* ---------- State ---------- */
let state;
const pad = a => Array(Math.max(0, DAYS - a.length)).fill(0).concat(a).slice(-DAYS);
function load() {
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) { state = null; }
  if (!state || !Array.isArray(state.products)) state = { date: todayISO(), products: seedProducts(), settings: { lead: 3, cover: 14 } };
  const gap = Math.round((new Date(todayISO()) - new Date(state.date)) / 864e5);
  if (gap > 0) { state.products.forEach(p => p.sales = pad(p.sales.concat(Array(Math.min(gap, DAYS)).fill(0)))); state.date = todayISO(); }
  save();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { toast('Could not save: browser storage is full or blocked.', 'danger'); } }
function toast(msg, type = '') { const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; $('#toasts').append(t); setTimeout(() => t.remove(), 3500); }
function nextId() { let n = 1; const ids = new Set(state.products.map(p => p.id.toUpperCase())); while (ids.has('P' + String(n).padStart(3, '0'))) n++; return 'P' + String(n).padStart(3, '0'); }

/* ---------- Forecasting & reorder logic ---------- */
function forecast(p) {
  const h = p.sales.slice(-28), n = h.length, mx = (n - 1) / 2, my = avg(h);
  let nu = 0, de = 0; h.forEach((y, i) => { nu += (i - mx) * (y - my); de += (i - mx) ** 2; });
  const slope = de ? nu / de : 0, m7 = avg(h.slice(-7));
  const preds = [1, 2, 3, 4, 5, 6, 7].map(k => Math.max(0, m7 + slope * (k + 3))); // 7-day mean is centred 3 days ago
  return { m7, m28: my, slope, preds, daily: avg(preds), sd: Math.sqrt(avg(h.map(y => (y - my) ** 2))), total: sum(preds) };
}
function classes() {
  const arr = state.products.map(p => ({ id: p.id, v: avg(p.sales.slice(-28)) })).sort((a, b) => a.v - b.v), m = {};
  arr.forEach((x, i) => { const r = i / Math.max(1, arr.length - 1); m[x.id] = x.v === 0 || r <= 0.33 ? 'Slow' : r >= 0.67 ? 'Fast' : 'Medium'; });
  return m;
}
function reorder(p) {
  const f = forecast(p), { lead, cover } = state.settings;
  const safety = Math.ceil(1.65 * f.sd * Math.sqrt(lead)), rop = Math.ceil(f.daily * lead + safety), target = Math.ceil(f.daily * (lead + cover) + safety);
  const cov = f.daily > 0.05 ? p.stock / f.daily : Infinity;
  const needs = f.daily > 0.05 ? (p.stock <= rop || p.stock <= p.min) : p.stock <= p.min;
  const qty = needs ? Math.max(target - p.stock, p.min * 2 - p.stock, 0) : 0;
  const urgency = p.stock === 0 ? 'Critical' : cov < lead ? 'High' : 'Medium';
  const calc = `${f.daily.toFixed(1)}/day × (${lead}d lead + ${cover}d cover) + ${safety} safety = ${target} target − ${p.stock} on hand → order ${qty}`;
  return { f, safety, rop, target, cov, needs, qty, urgency, calc };
}
const status = p => p.stock <= 0 ? 'out' : p.stock <= p.min ? 'low' : 'ok';
function getAlerts() {
  const out = [];
  state.products.forEach(p => {
    const r = reorder(p), d = p.expiry ? daysUntil(p.expiry) : null;
    if (p.stock <= 0) out.push({ lvl: 'danger', icon: 'fa-ban', t: `${p.name} is out of stock`, m: `Suggested order: ${r.qty} units.` });
    else if (r.needs) out.push({ lvl: 'warn', icon: 'fa-triangle-exclamation', t: `${p.name} needs restocking`, m: `${p.stock} left (about ${isFinite(r.cov) ? r.cov.toFixed(1) : '∞'} days). Reorder point ${r.rop}. Order ${r.qty}.` });
    if (d !== null && p.stock > 0 && d < 0) out.push({ lvl: 'danger', icon: 'fa-skull-crossbones', t: `${p.name} has expired`, m: `${p.stock} units expired ${-d} day(s) ago. Remove from shelf.` });
    else if (d !== null && p.stock > 0 && d <= 30) out.push({ lvl: 'warn', icon: 'fa-hourglass-half', t: `${p.name} expires in ${d} day(s)`, m: `${p.stock} units at risk (${money(p.stock * p.price)}). Consider a discount.` });
    if (p.stock > 0 && sum(p.sales.slice(-14)) === 0) out.push({ lvl: 'info', icon: 'fa-box-archive', t: `Dead stock: ${p.name}`, m: `No sales in 14 days; ${money(p.stock * p.price)} tied up. Try a discount or bundle.` });
    else if (p.stock > 0 && r.cov > 60 && isFinite(r.cov)) out.push({ lvl: 'info', icon: 'fa-layer-group', t: `Overstock: ${p.name}`, m: `${r.cov.toFixed(0)} days of stock at the forecast rate. Pause reordering.` });
  });
  const rank = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.lvl] - rank[b.lvl]);
}

/* ---------- Charts ---------- */
const charts = {}, BLUES = ['#2563eb', '#60a5fa', '#1e3a8a', '#93c5fd', '#0ea5e9', '#6366f1', '#38bdf8', '#a5b4fc'];
function chart(id, cfg) {
  const el = $('#' + id); if (!el) return;
  if (typeof Chart === 'undefined') { el.parentElement.innerHTML = '<div class="empty">Charts need an internet connection to load Chart.js.</div>'; return; }
  if (charts[id]) charts[id].destroy();
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
  charts[id] = new Chart(el, cfg);
}
const unitsSeries = n => Array.from({ length: n }, (_, i) => state.products.reduce((s, p) => s + (p.sales[p.sales.length - n + i] || 0), 0));
const revSeries = () => Array.from({ length: DAYS }, (_, i) => state.products.reduce((s, p) => s + (p.sales[i] || 0) * p.price, 0));
const blocks = (a, size, count) => Array.from({ length: count }, (_, i) => +sum(a.slice(a.length - (count - i) * size, a.length - (count - i - 1) * size)).toFixed(2));
const lastDays = n => Array.from({ length: n }, (_, i) => shortDate(addDays(i - n + 1)));
function lineForecast(id, actual, preds) {
  const L = []; for (let i = -13; i <= 7; i++) L.push(i === 0 ? 'Today' : shortDate(addDays(i)));
  chart(id, { type: 'line', data: { labels: L, datasets: [
    { label: 'Actual', data: [...actual.slice(-14), ...Array(7).fill(null)], borderColor: '#2563eb', backgroundColor: '#2563eb22', fill: true, tension: .3 },
    { label: 'Predicted', data: [...Array(13).fill(null), actual[actual.length - 1], ...preds.map(x => +x.toFixed(1))], borderColor: '#f59e0b', borderDash: [6, 4], tension: .3 }] }, options: { scales: { y: { beginAtZero: true } } } });
}

/* ---------- Pages ---------- */
const TITLES = { dashboard: 'Dashboard', inventory: 'Inventory', forecast: 'Demand Forecast', restock: 'Smart Restock', alerts: 'Alerts', analytics: 'Analytics' };
let page = 'dashboard';
function go(p) {
  page = p; $$('.page').forEach(s => s.classList.toggle('active', s.id === 'page-' + p));
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === p));
  $('#title').textContent = TITLES[p]; $('#sidebar').classList.remove('open'); render();
}
function alertHTML(a) { return `<div class="alert ${a.lvl}"><i class="fa-solid ${a.icon}"></i><div><b>${esc(a.t)}</b><small>${esc(a.m)}</small></div></div>`; }
function render() {
  const al = getAlerts(); $('#alertCount').textContent = al.length; $('#alertCount').style.display = al.length ? '' : 'none';
  fillCategories(); ({ dashboard, inventory, forecastPage, restock, alertsPage, analytics })[{ forecast: 'forecastPage', alerts: 'alertsPage' }[page] || page](al);
}
function dashboard(al) {
  const P = state.products, st = P.map(status);
  const cards = [['fa-box', 'Total products', P.length, ''], ['fa-cubes', 'Available stock (units)', sum(P.map(p => p.stock)).toLocaleString(), ''], ['fa-triangle-exclamation', 'Low stock', st.filter(s => s === 'low').length, 'amber'], ['fa-ban', 'Out of stock', st.filter(s => s === 'out').length, 'red'], ['fa-dollar-sign', 'Inventory value', money(sum(P.map(p => p.stock * p.price))), ''], ['fa-receipt', 'Revenue (7 days)', money(sum(revSeries().slice(-7))), '']];
  $('#cards').innerHTML = cards.map(c => `<div class="stat ${c[3]}"><i class="fa-solid ${c[0]}"></i><div><small>${c[1]}</small><b>${c[2]}</b></div></div>`).join('');
  $('#dashAlerts').innerHTML = al.length ? al.slice(0, 5).map(alertHTML).join('') : '<div class="empty">All clear. Nothing needs attention.</div>';
  chart('cDash', { type: 'bar', data: { labels: lastDays(14), datasets: [{ label: 'Units sold', data: unitsSeries(14), backgroundColor: '#2563eb', borderRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
}
function fillCategories() {
  const cats = [...new Set(state.products.map(p => p.category))].sort(), sel = $('#fCat'), cur = sel.value;
  sel.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option>${esc(c)}</option>`).join(''); sel.value = cats.includes(cur) ? cur : '';
  $('#cats').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
}
function inventory() {
  const q = $('#search').value.trim().toLowerCase(), c = $('#fCat').value, s = $('#fStatus').value;
  const rows = state.products.filter(p => (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) && (!c || p.category === c) && (!s || status(p) === s));
  const lbl = { ok: 'In stock', low: 'Low', out: 'Out' };
  $('#invBody').innerHTML = rows.length ? rows.map(p => {
    const d = p.expiry ? daysUntil(p.expiry) : null, ex = p.expiry ? `${p.expiry}${d < 0 ? ' (expired)' : d <= 30 ? ` (${d}d)` : ''}` : '—';
    return `<tr><td>${esc(p.id)}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.category)}</td><td>${p.stock}</td><td>${p.min}</td><td>${money(p.price)}</td><td>${avg(p.sales.slice(-7)).toFixed(1)}</td><td>${ex}</td><td><span class="badge b-${status(p)}">${lbl[status(p)]}</span></td>
    <td><button class="act" title="Record sale" data-act="sale" data-id="${esc(p.id)}"><i class="fa-solid fa-cart-shopping"></i></button><button class="act" title="Edit" data-act="edit" data-id="${esc(p.id)}"><i class="fa-solid fa-pen"></i></button><button class="act del" title="Delete" data-act="del" data-id="${esc(p.id)}"><i class="fa-solid fa-trash"></i></button></td></tr>`;
  }).join('') : `<tr><td colspan="10" class="empty">${state.products.length ? 'No products match your filters.' : 'No products yet. Add one or import a CSV.'}</td></tr>`;
}
function forecastPage() {
  const sel = $('#fcProduct'), cur = sel.value;
  sel.innerHTML = state.products.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (!state.products.length) { $('#fcExplain').textContent = 'Add products to see forecasts.'; $('#fcBody').innerHTML = '<tr><td colspan="5" class="empty">No data yet.</td></tr>'; return; }
  if (state.products.some(p => p.id === cur)) sel.value = cur;
  const p = state.products.find(x => x.id === sel.value), f = forecast(p), cls = classes();
  lineForecast('cForecast', p.sales, f.preds);
  $('#fcExplain').textContent = `Why: ${p.name} sold ${f.m7.toFixed(1)} units/day over the last 7 days (28-day average ${f.m28.toFixed(1)}). The 28-day trend is ${Math.abs(f.slope) < 0.01 ? 'flat' : f.slope > 0 ? 'rising' : 'falling'} (${f.slope >= 0 ? '+' : ''}${f.slope.toFixed(2)} units per day). Projecting that forward gives about ${Math.round(f.total)} units over the next 7 days. It is a ${cls[p.id].toLowerCase()}-moving product.`;
  $('#fcBody').innerHTML = state.products.map(x => { const g = forecast(x); return `<tr><td><b>${esc(x.name)}</b></td><td>${g.m7.toFixed(1)}</td><td>${g.slope >= 0 ? '+' : ''}${g.slope.toFixed(2)}</td><td>${Math.round(g.total)} units</td><td><span class="badge b-${cls[x.id]}">${cls[x.id]}</span></td></tr>`; }).join('');
}
function restock() {
  $('#lead').value = state.settings.lead; $('#cover').value = state.settings.cover;
  const rows = state.products.map(p => ({ p, r: reorder(p) })).filter(x => x.r.needs).sort((a, b) => (a.r.cov - b.r.cov));
  $('#rsBody').innerHTML = rows.length ? rows.map(({ p, r }) => `<tr><td><b>${esc(p.name)}</b></td><td>${p.stock}</td><td>${isFinite(r.cov) ? r.cov.toFixed(1) : '—'}</td><td>${r.rop}</td><td><b>${r.qty}</b></td><td><span class="badge b-${r.urgency}">${r.urgency}</span></td><td class="wrap">${esc(r.calc)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No restocking needed. Every product has enough stock.</td></tr>';
}
function alertsPage(al) { $('#alertList').innerHTML = al.length ? al.map(alertHTML).join('') : '<div class="card empty">No alerts. Your inventory looks healthy.</div>'; }
function analytics() {
  const rev = revSeries(), byCat = {}; state.products.forEach(p => byCat[p.category] = (byCat[p.category] || 0) + p.stock * p.price);
  chart('cDaily', { type: 'line', data: { labels: lastDays(14), datasets: [{ label: 'Units', data: unitsSeries(14), borderColor: '#2563eb', backgroundColor: '#2563eb22', fill: true, tension: .3 }] }, options: { plugins: { legend: { display: false } } } });
  chart('cWeekly', { type: 'bar', data: { labels: Array.from({ length: 12 }, (_, i) => i === 11 ? 'This wk' : `${11 - i}w ago`), datasets: [{ label: 'Revenue ($)', data: blocks(rev, 7, 12), backgroundColor: '#2563eb', borderRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
  chart('cMonthly', { type: 'bar', data: { labels: ['60–90 days ago', '30–60 days ago', 'Last 30 days'], datasets: [{ label: 'Revenue ($)', data: blocks(rev, 30, 3), backgroundColor: ['#93c5fd', '#60a5fa', '#2563eb'], borderRadius: 4 }] }, options: { plugins: { legend: { display: false } } } });
  chart('cDist', { type: 'doughnut', data: { labels: Object.keys(byCat), datasets: [{ data: Object.values(byCat).map(v => +v.toFixed(2)), backgroundColor: BLUES }] }, options: { plugins: { legend: { position: 'right' } } } });
  const preds = Array(7).fill(0); state.products.forEach(p => forecast(p).preds.forEach((v, i) => preds[i] += v));
  lineForecast('cTotalFc', unitsSeries(14), preds);
}

/* ---------- Product form ---------- */
let editId = null;
function openForm(id) {
  editId = id || null; const f = $('#pform'); f.reset(); $('#formErr').hidden = true;
  const p = id && state.products.find(x => x.id === id);
  $('#dlgTitle').textContent = p ? 'Edit product' : 'Add product';
  f.daily.disabled = !!p; $('#dailyNote').textContent = p ? 'Daily sales is calculated from the sales history. Use the cart button in Inventory to record sales.' : 'New products start with this average as their sales history. Record real sales to improve forecasts.';
  if (p) { f.id.value = p.id; f.name.value = p.name; f.category.value = p.category; f.stock.value = p.stock; f.min.value = p.min; f.price.value = p.price; f.daily.value = avg(p.sales.slice(-7)).toFixed(1); f.expiry.value = p.expiry; }
  $('#dlg').showModal();
}
function submitForm(e) {
  e.preventDefault(); const f = e.target, errs = [];
  const name = f.name.value.trim(), category = f.category.value.trim(), id = (f.id.value.trim() || (editId ? editId : nextId()));
  const num = el => el.value.trim() === '' ? NaN : Number(el.value);
  const stock = num(f.stock), min = num(f.min), price = num(f.price), daily = editId ? 0 : num(f.daily), expiry = f.expiry.value;
  if (!name) errs.push('Product name is required.'); if (!category) errs.push('Category is required.');
  if (!Number.isInteger(stock) || stock < 0) errs.push('Current stock must be a whole number, 0 or more.');
  if (!Number.isInteger(min) || min < 0) errs.push('Minimum stock must be a whole number, 0 or more.');
  if (!(price >= 0)) errs.push('Price must be 0 or more.');
  if (!editId && !(daily >= 0)) errs.push('Daily sales must be 0 or more.');
  if (state.products.some(p => p.id.toLowerCase() === id.toLowerCase() && p.id !== editId)) errs.push(`Product ID "${id}" already exists.`);
  if (errs.length) { const b = $('#formErr'); b.innerHTML = errs.map(esc).join('<br>'); b.hidden = false; return; }
  if (editId) Object.assign(state.products.find(p => p.id === editId), { id, name, category, stock, min, price, expiry });
  else state.products.push({ id, name, category, stock, min, price, expiry, sales: Array(DAYS).fill(daily) });
  save(); $('#dlg').close(); toast(editId ? 'Product updated' : 'Product added', 'success'); render();
}
function onInvClick(e) {
  const b = e.target.closest('[data-act]'); if (!b) return; const p = state.products.find(x => x.id === b.dataset.id); if (!p) return;
  if (b.dataset.act === 'edit') openForm(p.id);
  if (b.dataset.act === 'del' && confirm(`Delete "${p.name}"? This cannot be undone.`)) { state.products = state.products.filter(x => x !== p); save(); toast('Product deleted'); render(); }
  if (b.dataset.act === 'sale') {
    const v = prompt(`Units of "${p.name}" sold today (in stock: ${p.stock}):`, '1'); if (v === null) return;
    const q = Number(v);
    if (!Number.isInteger(q) || q < 1) return toast('Enter a whole number of 1 or more.', 'danger');
    if (q > p.stock) return toast(`Only ${p.stock} in stock.`, 'danger');
    p.stock -= q; p.sales[p.sales.length - 1] += q; save(); toast(`Recorded ${q} sold`, 'success'); render();
  }
}

/* ---------- CSV ---------- */
function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
function importCSV(text) {
  const rows = parseCSV(text.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one product row.');
  const h = rows[0].map(x => x.trim().toLowerCase().replace(/[\s_]/g, '')), col = n => h.indexOf(n);
  if (col('name') < 0) throw new Error('Missing required column "name". Expected: id,name,category,stock,min_stock,price,expiry,daily_sales');
  let added = 0, updated = 0; const bad = [];
  rows.slice(1).forEach((r, i) => {
    const g = n => col(n) < 0 ? '' : (r[col(n)] || '').trim(), N = (n, d) => g(n) === '' ? d : Number(g(n));
    const name = g('name'), stock = N('stock', 0), min = N('minstock', 0), price = N('price', 0), daily = N('dailysales', 0), expiry = g('expiry');
    if (!name || ![stock, min, price, daily].every(v => isFinite(v) && v >= 0) || (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))) { bad.push(i + 2); return; }
    const hist = g('history') ? pad(g('history').split('|').map(Number).map(v => isFinite(v) && v >= 0 ? v : 0)) : null;
    const id = g('id') || nextId(), ex = state.products.find(p => p.id.toLowerCase() === id.toLowerCase());
    const data = { name, category: g('category') || 'General', stock: Math.round(stock), min: Math.round(min), price, expiry };
    if (ex) { Object.assign(ex, data); if (hist) ex.sales = hist; updated++; }
    else { state.products.push({ id, ...data, sales: hist || Array(DAYS).fill(daily) }); added++; }
  });
  save(); return { added, updated, bad };
}
function csvCell(v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function download(name, rows) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportInventory() {
  if (!state.products.length) return toast('Nothing to export yet.', 'danger');
  download('smartshelf-inventory.csv', [['id', 'name', 'category', 'stock', 'min_stock', 'price', 'expiry', 'daily_sales', 'history'], ...state.products.map(p => [p.id, p.name, p.category, p.stock, p.min, p.price, p.expiry, avg(p.sales.slice(-7)).toFixed(1), p.sales.join('|')])]);
  toast('Inventory exported', 'success');
}
function exportRestock() {
  const rows = state.products.map(p => ({ p, r: reorder(p) })).filter(x => x.r.needs);
  if (!rows.length) return toast('No restocking needed, so there is nothing to export.', 'danger');
  download('smartshelf-reorder-list.csv', [['id', 'name', 'stock', 'reorder_point', 'order_qty', 'urgency', 'calculation'], ...rows.map(({ p, r }) => [p.id, p.name, p.stock, r.rop, r.qty, r.urgency, r.calc])]);
  toast('Reorder list exported', 'success');
}

/* ---------- Init ---------- */
function busy(on) { $('#loader').classList.toggle('hide', !on); }
document.addEventListener('DOMContentLoaded', () => {
  load();
  $$('nav button').forEach(b => b.onclick = () => go(b.dataset.page));
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#addTop').onclick = () => { go('inventory'); openForm(); };
  $('#cancel').onclick = () => $('#dlg').close();
  $('#pform').addEventListener('submit', submitForm);
  $('#invBody').addEventListener('click', onInvClick);
  ['search', 'fCat', 'fStatus'].forEach(id => $('#' + id).addEventListener('input', inventory));
  $('#fcProduct').onchange = forecastPage;
  $('#exportInv').onclick = exportInventory; $('#exportRestock').onclick = exportRestock;
  ['lead', 'cover'].forEach(id => $('#' + id).addEventListener('change', e => {
    const v = Number(e.target.value); if (!Number.isInteger(v) || v < 1) { toast('Enter a whole number of 1 or more.', 'danger'); e.target.value = state.settings[id]; return; }
    state.settings[id] = v; save(); render();
  }));
  $('#csvFile').onchange = e => {
    const file = e.target.files[0]; if (!file) return; busy(true);
    const rd = new FileReader();
    rd.onload = () => setTimeout(() => {
      try { const r = importCSV(rd.result); toast(`Imported: ${r.added} added, ${r.updated} updated${r.bad.length ? `, ${r.bad.length} skipped (rows ${r.bad.slice(0, 5).join(', ')})` : ''}`, r.bad.length ? '' : 'success'); render(); }
      catch (err) { toast(err.message, 'danger'); }
      busy(false); e.target.value = '';
    }, 400);
    rd.onerror = () => { busy(false); toast('Could not read that file.', 'danger'); };
    rd.readAsText(file);
  };
  $('#resetBtn').onclick = () => { if (confirm('Reset to the sample data? Your changes will be lost.')) { state = { date: todayISO(), products: seedProducts(), settings: { lead: 3, cover: 14 } }; save(); toast('Sample data restored', 'success'); render(); } };
  go('dashboard'); setTimeout(() => busy(false), 600);
});
