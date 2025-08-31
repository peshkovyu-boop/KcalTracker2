// ========= КЛЮЧИ/КОНСТАНТЫ =========
const STORE_KEY = 'calctracker:v13';
const CACHE_KEY = 'calctracker:offCache:v6';
const LIMIT_KEY = 'calctracker:limitKcal'; // "Предел ккал";
const AI_WORKER_URL = 'https://red-resonance-f66e.peshkov-yu.workers.dev'

// ========= МИНИ-БАЗА (подстраховка, на 100 г) =========
const FOOD_DB = [
  {name:'Овсяные хлопья (сухие)', kcal:370, p:13, f:7, c:62},
  {name:'Рис варёный',            kcal:130, p:2.7, f:0.3, c:28},
  {name:'Гречка варёная',         kcal:110, p:3.6, f:1.1, c:20},
  {name:'Куриная грудка (варёная)',kcal:165, p:31, f:3.6, c:0},
  {name:'Творог 5%',              kcal:121, p:17, f:5, c:3},
  {name:'Оливковое масло',        kcal:884, p:0,  f:100, c:0},
  {name:'Яичница (жареные яйца)', kcal:196, p:13, f:15, c:1.2}
];
const BUILTIN_INDEX = new Map(FOOD_DB.map(f => [f.name.toLowerCase(), f]));

// ========= УТИЛИТЫ =========
const $ = s => document.querySelector(s);
const todayISO = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
};
const fmt = n => Number.isFinite(+n) ? String(Math.round(+n*100)/100) : '';
const loadAll = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
const saveAll = d => localStorage.setItem(STORE_KEY, JSON.stringify(d));
const loadCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } };
const saveCache = c => localStorage.setItem(CACHE_KEY, JSON.stringify(c));

// ========= СОСТОЯНИЕ =========
const state = { date: todayISO(), rows: [] };
let offCache = loadCache();

// ========= PWA SW =========
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(console.warn);
}

// ========= ВНЕШНИЕ БАЗЫ =========
let DRINKS = [], DRINKS_BY_CODE = new Map();
let FOODS = [], FOODS_BY_NAME = new Map();

async function safeFetchJSON(path) {
  try {
    // к каждому JSON-URL добавляем уникальный параметр, чтобы обойти кэш
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${sep}cb=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn('fetch JSON fail', path, e);
    return null;
  }
}

async function loadDrinks(){
  const list = await safeFetchJSON('/drinks.json');
  if(Array.isArray(list)){
    DRINKS = list;
    DRINKS_BY_CODE = new Map();
    DRINKS.forEach(item => (item.codes||[]).forEach(code => DRINKS_BY_CODE.set(String(code), item)));
  } else { DRINKS=[]; DRINKS_BY_CODE=new Map(); }
}
async function loadFoods(){
  const list = await safeFetchJSON('/foods.json');
  if (Array.isArray(list)) {
    FOODS = list;
    FOODS_BY_NAME = new Map(list.map(it => [it.name.toLowerCase(), it]));
  } else {
    FOODS = [];
    FOODS_BY_NAME = new Map();
  }
}

// ========= Open Food Facts =========
function extractNutrients(p){
  if(!p || !p.nutriments) return null;
  const n = p.nutriments;
  let kcal = n['energy-kcal_100g'];
  if(!Number.isFinite(+kcal)){
    const kJ = n['energy_100g'];
    if(Number.isFinite(+kJ)) kcal = +kJ/4.184;
  }
  const proteins = n['proteins_100g'], fat = n['fat_100g'], carbs = n['carbohydrates_100g'];
  if([kcal, proteins, fat, carbs].some(v => !Number.isFinite(+v))) return null;
  return { kcal:+(+kcal).toFixed(1), p:+(+proteins).toFixed(2), f:+(+fat).toFixed(2), c:+(+carbs).toFixed(2) };
}
async function searchOFF(query, limit=20){
  const q = String(query||'').trim(); if(!q) return [];
  const key = `q:${q.toLowerCase()}`; if(offCache[key]) return offCache[key];
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${limit}&fields=product_name,brands,nutriments,code`;
  const res = await fetch(url); const data = await res.json();
  const out = (data.products||[]).map(p=>{
    const nut = extractNutrients(p); if(!nut) return null;
    const name = [p.product_name, p.brands].filter(Boolean).join(' • ');
    return { name: name || 'Без названия', code: p.code, ...nut };
  }).filter(Boolean);
  offCache[key] = out; saveCache(offCache); return out;
}
async function fetchByBarcode(code){
  const c = String(code||'').replace(/\D/g,'');
  if(!c) return null;
  const key = `barcode:${c}`; if(offCache[key]) return offCache[key];

  // 0) Локальная база напитков
  const local = DRINKS_BY_CODE.get(c);
  if(local?.per100){
    const out = { name: local.name, code:c, ...local.per100 };
    offCache[key]=out; saveCache(offCache); return out;
  }

  // 1) OFF /product
  try{
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${c}.json`);
    const data = await res.json();
    if(data?.product){
      const nut = extractNutrients(data.product);
      if(nut){
        const name = [data.product.product_name, data.product.brands].filter(Boolean).join(' • ') || c;
        const out = { name, code:c, ...nut };
        offCache[key]=out; saveCache(offCache); return out;
      }
    }
  }catch{}

  // 2) OFF search by code
  try{
    const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${c}&search_simple=1&action=process&json=1&page_size=5&fields=product_name,brands,nutriments,code`);
    const data = await res.json();
    const prod = (data.products||[]).find(p => extractNutrients(p));
    if(prod){
      const nut = extractNutrients(prod);
      const name = [prod.product_name, prod.brands].filter(Boolean).join(' • ') || c;
      const out = { name, code:c, ...nut };
      offCache[key]=out; saveCache(offCache); return out;
    }
  }catch{}
  return null;
}

// ========= РЕНДЕР / ТАБЛИЦА =========
function renderDatalist(options){
  const dl = $('#foods'); if(!dl) return;
  dl.innerHTML='';
  const base = [...FOOD_DB.map(b=>b.name), ...FOODS.map(d=>d.name)];
  const list = options?.length ? [...new Set([...options.map(o=>o.name), ...base])] : base;
  list.sort((a,b)=>a.localeCompare(b,'ru')).forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; dl.appendChild(opt);
  });
}
function buildRow(r,i){
  const tr = document.createElement('tr'); tr.dataset.i = i;
  tr.innerHTML = `
    <td>${i+1}</td>
    <td><input list="foods" value="${r.product??''}" data-k="product" placeholder="например: Окрошка" /></td>
    <td><input type="number" step="1" min="0" value="${r.weight??''}" data-k="weight" /></td>
    <td><input type="number" step="0.1" min="0" value="${r.kcal??''}" data-k="kcal" /></td>
    <td><input type="number" step="0.1" min="0" value="${r.p??''}" data-k="p" /></td>
    <td><input type="number" step="0.1" min="0" value="${r.f??''}" data-k="f" /></td>
    <td><input type="number" step="0.1" min="0" value="${r.c??''}" data-k="c" /></td>
    <td style="text-align:center"><input type="checkbox" ${r.auto!==false?'checked':''} data-k="auto" /></td>
    <td><button class="secondary" data-del="${i}" type="button">Удалить</button></td>
  `;
  return tr;
}
function renderTable(){
  const tbody = $('#tbl tbody'); tbody.innerHTML='';
  state.rows.forEach((r,i)=> tbody.appendChild(buildRow(r,i)));
  recalcTotals();
}
function addEntry(){
  state.rows.push({product:'',weight:'',kcal:'',p:'',f:'',c:'',auto:true, source:null});
  $('#tbl tbody').appendChild(buildRow(state.rows[state.rows.length-1], state.rows.length-1));
  recalcTotals();
}
window.__addEntry = () => addEntry();

function loadDay(date){
  const all = loadAll();
  state.date = date;
  state.rows = (all[date] || []).map(r=>({auto:true, source:null, ...r}));
  const dateEl = $('#date'); if(dateEl) dateEl.value = date;
  renderTable();
}
function saveDay(){
  const all = loadAll();
  all[state.date] = state.rows
    .filter(r => (r.product||'').trim() || r.kcal || r.p || r.f || r.c || r.weight)
    .map(({auto, source, ...rest}) => rest);
  saveAll(all);
}

// ========= ПОДБОР ПРОДУКТА И АВТОПОДСЧЁТ =========
function findLocalByName(name){
  const key = (name||'').toLowerCase().trim();
  if(!key) return null;
  const byExact = FOODS_BY_NAME.get(key);
  if(byExact?.per100) return byExact.per100;

  const hit = FOODS.find(f => f.name.toLowerCase()===key)
          || FOODS.find(f => f.name.toLowerCase().startsWith(key))
          || FOODS.find(f => f.name.toLowerCase().includes(key));
  if(hit?.per100) return hit.per100;

  return BUILTIN_INDEX.get(key)
      || FOOD_DB.find(f => f.name.toLowerCase()===key)
      || FOOD_DB.find(f => f.name.toLowerCase().startsWith(key))
      || FOOD_DB.find(f => f.name.toLowerCase().includes(key))
      || null;
}
function applyAutoToRow(i){
  const r = state.rows[i]; if(!r || r.auto===false) return;

  const w = +r.weight || 0;
  if(r._per100){
    const k = w/100;
    r.kcal = +(r._per100.kcal * k).toFixed(1);
    r.p    = +(r._per100.p    * k).toFixed(2);
    r.f    = +(r._per100.f    * k).toFixed(2);
    r.c    = +(r._per100.c    * k).toFixed(2);
  } else {
    const f = findLocalByName(r.product);
    if(f && w>0){
      const k = w/100;
      r.kcal = +(f.kcal * k).toFixed(1);
      r.p    = +(f.p    * k).toFixed(2);
      r.f    = +(f.f    * k).toFixed(2);
      r.c    = +(f.c    * k).toFixed(2);
    }
  }
  const tr = $('#tbl tbody').children[i];
  if(tr){
    tr.querySelector('input[data-k="kcal"]').value = fmt(r.kcal);
    tr.querySelector('input[data-k="p"]').value    = fmt(r.p);
    tr.querySelector('input[data-k="f"]').value    = fmt(r.f);
    tr.querySelector('input[data-k="c"]').value    = fmt(r.c);
  }
}
function recalcTotals(){
  const sum = state.rows.reduce((a,r)=>({
    weight:a.weight+(+r.weight||0),
    kcal:a.kcal+(+r.kcal||0),
    p:a.p+(+r.p||0), f:a.f+(+r.f||0), c:a.c+(+r.c||0)
  }), {weight:0,kcal:0,p:0,f:0,c:0});
  $('#tWeight').textContent = fmt(sum.weight);
  $('#tKcal').textContent   = fmt(sum.kcal);
  $('#tP').textContent      = fmt(sum.p);
  $('#tF').textContent      = fmt(sum.f);
  $('#tC').textContent      = fmt(sum.c);
  return sum;
}

// ========= CSV =========
function toCSV(delim=';'){
  const all = loadAll();
  const rows = [["Date","Product","Weight","Calories","Protein","Fat","Carbs"]];
  Object.keys(all).sort().forEach(date=>{
    (all[date]||[]).forEach(r=>{
      rows.push([date, r.product||'', r.weight||'', r.kcal||'', r.p||'', r.f||'', r.c||'']);
    });
  });
  return rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(delim)).join('\n');
}
function downloadCSV(){
  const csv = '\uFEFF' + toCSV(';'); // UTF-8 BOM для русских букв
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'calctracker.csv'; a.click();
  URL.revokeObjectURL(a.href);
}
function parseCSV(text){
  const firstLine = text.split(/\r?\n/).find(Boolean) || '';
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  let idx = 0; if(/date.*product.*weight/i.test(lines[0])) idx = 1;
  const out = [];
  for(let i=idx;i<lines.length;i++){
    const s = lines[i]; const row=[]; let cur=''; let inQ=false;
    for(let j=0;j<s.length;j++){
      const ch=s[j];
      if(ch === '"'){ if(inQ && s[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ; }
      else if(ch===delim && !inQ){ row.push(cur); cur=''; }
      else cur+=ch;
    }
    row.push(cur); out.push(row.map(x=>x.trim()));
  }
  return out;
}
function importCSV(text){
  const rows = parseCSV(text); const all = loadAll();
  for(const cells of rows){
    if(cells.length < 7) continue;
    const [date, product, weight, kcal, p, f, c] = cells;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    all[date] = all[date] || [];
    all[date].push({ product, weight:+weight||0, kcal:+kcal||0, p:+p||0, f:+f||0, c:+c||0 });
  }
  saveAll(all); loadDay($('#date')?.value || todayISO());
}

// ========= ВИЗУАЛИЗАЦИИ (canvas) =========
function startOfToday(){ const d=new Date(); d.setHours(0,0,0,0); return d; }
function rangeByKind(kind){
  // выбранная дата из инпута, если есть
  const selected = (document.querySelector('#date')?.value) || todayISO();

  // конец периода: для "дня" — именно выбранная дата; для остального оставляем сегодня
  if (kind === 'day') {
    return [selected, selected];
  }

  const end = startOfToday();                 // как и было: «до сегодня»
  const start = new Date(end);

  if (kind === 'week')  start.setDate(end.getDate() - 6);
  if (kind === 'month') start.setMonth(end.getMonth() - 1);
  if (kind === 'year')  start.setFullYear(end.getFullYear() - 1);

  const toISO = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return [toISO(start), toISO(end)];
}

function aggregateRange(kind){
  const [startISO, endISO] = rangeByKind(kind);
  const all = loadAll();
  const days = [];
  const cur = new Date(startISO);
  const end = new Date(endISO);

  while (cur <= end) {
    const dISO = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    const arr = all[dISO] || [];
    const sums = arr.reduce((a,r)=>({
      kcal:a.kcal+(+r.kcal||0), p:a.p+(+r.p||0), f:a.f+(+r.f||0), c:a.c+(+r.c||0)
    }), {kcal:0,p:0,f:0,c:0});
    days.push({date:dISO, ...sums, count:arr.length});
    cur.setDate(cur.getDate()+1);
  }

  const total = days.reduce((a,d)=>({kcal:a.kcal+d.kcal, p:a.p+d.p, f:a.f+d.f, c:a.c+d.c}), {kcal:0,p:0,f:0,c:0});
  const daysCount = days.length;
  const filledDays = days.filter(d => d.count>0).length; // считаем только реально заполненные
  return { total, days, startISO, endISO, daysCount, filledDays };
}

function clearCanvas(cv){ const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); }
function ensureCanvasSize(cv){
  const r=cv.getBoundingClientRect();
  cv.width = Math.max(320, r.width) * devicePixelRatio;
  cv.height = (r.height || 220) * devicePixelRatio;
  cv.style.height = (cv.height/devicePixelRatio) + 'px';
}

// KPI-датчик с подсветкой превышения
function drawGauge(cv, value, limit){
  ensureCanvasSize(cv);
  const ctx=cv.getContext('2d'); clearCanvas(cv);
  const W=cv.width, H=cv.height; const cx=W/2, cy=H/2; const R=Math.min(W,H)*0.35;
  const baseStart = Math.PI*0.75, baseEnd = Math.PI*0.25;
  ctx.lineWidth = Math.max(12, R*0.18);
  // фон дуги
  ctx.strokeStyle='#1a2332'; ctx.beginPath(); ctx.arc(cx,cy,R,baseStart,baseEnd,false); ctx.stroke();
  // значение
  let pct = 0;
  if(limit>0) pct = Math.min(1, value/limit);
  const grad = ctx.createLinearGradient(0,0,W,0);
  grad.addColorStop(0,'#4da3ff'); grad.addColorStop(1,'#7ddc82');
  ctx.strokeStyle = (limit>0 && value>limit) ? '#ff6b6b' : grad;
  ctx.beginPath();
  ctx.arc(cx,cy,R,baseStart, baseStart + (Math.PI*1.5)*(limit>0?Math.min(1,value/limit):0), false);
  ctx.stroke();
  // Текст
  ctx.fillStyle = (limit>0 && value>limit) ? '#ffb3b3' : '#c5d0db';
  ctx.textAlign='center';
  ctx.font = `${Math.round(R*0.28)}px system-ui`;
  ctx.fillText(`${Math.round(value)} ккал`, cx, cy);
  ctx.font = `${Math.round(R*0.18)}px system-ui`;
  ctx.fillStyle = (limit>0 && value>limit) ? '#ff6b6b' : '#9fb0c3';
  ctx.fillText(`Предел: ${limit||0}`, cx, cy + R*0.35);
  if(limit>0 && value>limit){
    ctx.font = `${Math.round(R*0.16)}px system-ui`;
    ctx.fillStyle='#ff6b6b';
    ctx.fillText('Превышение', cx, cy - R*0.55);
  }
}

// Пирог БЖУ (в цветах приложения) с подписями на секторах
function drawPie(cv, kcalP, kcalF, kcalC){
  ensureCanvasSize(cv);
  const ctx = cv.getContext('2d'); clearCanvas(cv);

  const W = cv.width, H = cv.height;
  const cx = W/2, cy = H/2;
  const R  = Math.min(W,H) * 0.38;

  // Спокойная палитра
  const colP = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim() || '#4da3ff'; // Б (синий)
  const colF = '#d75d5d';   // Ж (приглушённый красный)
  const colC = '#5a7d9a';   // У (серо-голубой)

  const parts = [
    { v: Math.max(0, +kcalP || 0), color: colP, label:'Б' },
    { v: Math.max(0, +kcalF || 0), color: colF, label:'Ж' },
    { v: Math.max(0, +kcalC || 0), color: colC, label:'У' },
  ];
  const total = parts.reduce((s,p)=>s+p.v,0);
  if (total <= 0){
    // Пустой круг с тонкой окружностью
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = Math.max(2, R*0.06);
    ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle = '#9fb0c3';
    ctx.font = `${Math.max(12, Math.round(R*0.18))}px system-ui`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('нет данных', cx, cy);
    return;
  }

  // Рисуем сектора (строго минимализм)
  let a0 = -Math.PI/2;
  parts.forEach(p=>{
    const a = (p.v/total)*Math.PI*2;
    ctx.beginPath(); ctx.moveTo(cx,cy);
    ctx.fillStyle = p.color;
    ctx.arc(cx,cy,R, a0, a0+a); ctx.closePath(); ctx.fill();
    a0 += a;
  });

  // Тонкие разделители
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = Math.max(1, R*0.02);
  a0 = -Math.PI/2;
  parts.forEach(p=>{
    const a = (p.v/total)*Math.PI*2;
    ctx.beginPath(); ctx.arc(cx,cy,R, a0, a0+a); ctx.stroke();
    a0 += a;
  });

  // Подписи на/у сектора: «Б 34%», «Ж 28%», «У 38%»
  ctx.fillStyle = '#e6edf3';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const baseFont = Math.max(13, Math.round(R*0.2));

  a0 = -Math.PI/2;
  parts.forEach(p=>{
    const a = (p.v/total)*Math.PI*2;
    const mid = a0 + a/2;
    const percent = Math.round((p.v/total)*100);

    // Если сектор маленький (<8%), выносим подпись наружу с короткой линейкой
    if (percent < 8) {
      const r1 = R*0.78, r2 = R*0.94;
      const x1 = cx + Math.cos(mid)*r1;
      const y1 = cy + Math.sin(mid)*r1;
      const x2 = cx + Math.cos(mid)*r2;
      const y2 = cy + Math.sin(mid)*r2;
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = Math.max(1, R*0.02);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();

      const outsideX = cx + Math.cos(mid)*(r2 + R*0.12);
      const outsideY = cy + Math.sin(mid)*(r2 + R*0.12);
      ctx.font = `${baseFont}px system-ui`;
      ctx.textAlign = (Math.cos(mid) >= 0) ? 'left' : 'right';
      ctx.fillText(`${p.label} ${percent}%`, outsideX, outsideY);
    } else {
      // Внутри сектора
      const rx = cx + Math.cos(mid) * R*0.58;
      const ry = cy + Math.sin(mid) * R*0.58;
      ctx.font = `${baseFont}px system-ui`;
      ctx.textAlign='center';
      ctx.fillText(`${p.label} ${percent}%`, rx, ry);
    }

    a0 += a;
  });
}

// Линия тренда (ккал по дням)
function drawTrend(cv, points){
  ensureCanvasSize(cv);
  const ctx=cv.getContext('2d'); clearCanvas(cv);
  const W=cv.width, H=cv.height; const pad=36; const w=W-pad*2; const h=H-pad*2;
  const maxVal = Math.max(1, ...points.map(p=>p.value));
  // оси
  ctx.strokeStyle='rgba(255,255,255,.1)'; ctx.beginPath();
  ctx.moveTo(pad, H-pad); ctx.lineTo(W-pad, H-pad); ctx.moveTo(pad, pad); ctx.lineTo(pad, H-pad); ctx.stroke();
  // линия
  ctx.beginPath(); ctx.strokeStyle='#4da3ff'; ctx.lineWidth=2;
  points.forEach((p,i)=>{
    const x = pad + (w * (i/(Math.max(1,points.length-1))));
    const y = H - pad - (h * (p.value/maxVal));
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }); ctx.stroke();
  // подписи дат снизу
  ctx.fillStyle='#c5d0db'; ctx.font='11px system-ui';
  points.forEach((p,i)=>{
    const x = pad + (w * (i/(Math.max(1,points.length-1)))); const y = H - pad + 14;
    ctx.fillText(p.label.slice(5), x-16, y);
  });
}
function refreshViz(){
  try{
    const kind = $('#period')?.value || 'day';
    const { total, days, filledDays } = aggregateRange(kind);

    const cv1 = $('#kpiGauge');
    const cv2 = $('#pieMacros');
    const cv3 = $('#trendDaily');

    const dailyLimit = +(localStorage.getItem(LIMIT_KEY)||'0') || 0;
    const inp = $('#kcalGoal'); if (inp) inp.value = dailyLimit || '';

    // Для дня = 1, для остальных — число реально заполненных дней (минимум 1, чтобы шкала не была нулевой)
    const effectiveDays = (kind === 'day') ? 1 : Math.max(1, filledDays);
    const periodLimit = dailyLimit * effectiveDays;

    if (cv1) drawGauge(cv1, total.kcal, periodLimit);
    if (cv2){
      const kcalP = total.p*4, kcalF = total.f*9, kcalC = total.c*4;
      drawPie(cv2, kcalP, kcalF, kcalC);
    }
    if (cv3) drawTrend(cv3, days.map(d=>({label:d.date, value:d.kcal})));
  }catch(e){ console.warn('viz error', e); }
}

// ========= ВВОД/ПОИСК =========
let debounceTimer = null;
async function onProductInput(i, value){
  state.rows[i]._per100 = null;
  const lower = String(value||'').toLowerCase().trim();
  const local = FOODS_BY_NAME.get(lower);
  if(local?.per100){
    state.rows[i]._per100 = {...local.per100};
    applyAutoToRow(i); recalcTotals(); renderDatalist(); return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async ()=>{
    try{
      const opts = await searchOFF(value, 20);
      renderDatalist(opts);
      const exact = opts.find(o => o.name.toLowerCase() === lower);
      if(exact){
        state.rows[i]._per100 = {kcal:exact.kcal,p:exact.p,f:exact.f,c:exact.c};
        state.rows[i].source = {type:'off', code: exact.code};
        applyAutoToRow(i); recalcTotals();
      }
    }catch(e){ renderDatalist(); }
  }, 300);
}

async function onFindBarcode(){
  const code = $('#barcode')?.value || '';
  const st = $('#lookupStatus'); if(st) st.textContent = 'Поиск...';
  try{
    const p = await fetchByBarcode(code);
    if(!p){ if(st) st.textContent = 'Не найдено'; return; }
    addEntry();
    const i = state.rows.length - 1;
    state.rows[i].product = p.name;
    state.rows[i]._per100 = {kcal:p.kcal,p:p.p,f:p.f,c:p.c};
    state.rows[i].source = {type:'barcode', code: p.code};
    const tr = $('#tbl tbody').children[i];
    tr.querySelector('input[data-k="product"]').value = p.name;
    applyAutoToRow(i); recalcTotals();
    if(st) st.textContent = 'Готово';
  }catch(e){ if(st) st.textContent = 'Ошибка'; }
}

// ========= СКАНЕР =========
let stream=null, rafId=null, detector=null;
function hasBarcodeDetector(){ return 'BarcodeDetector' in window; }
async function ensureDetector(){
  if(detector || !hasBarcodeDetector()) return;
  try{
    detector = new window.BarcodeDetector({
      formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code']
    });
  }catch{}
}
async function startCameraScan(){
  const st = $('#lookupStatus'); if(st) st.textContent='';
  $('#camModal')?.classList.remove('hidden');
  if(!window.ZXing){
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@zxing/library@latest'; document.head.appendChild(s);
  }
  await ensureDetector();
  try{
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
  }catch(e){
    if(window.ZXing){ return startZXingVideo(); }
    $('#camHint').textContent='Нет доступа к камере (проверь HTTPS/разрешения)';
    return;
  }
  const video = $('#camVideo'); video.srcObject = stream; await video.play();
  const loop = async ()=>{
    if(!video.videoWidth){ rafId = requestAnimationFrame(loop); return; }
    try{
      if(detector){
        const codes = await detector.detect(video);
        if(codes && codes.length){ const code = codes[0].rawValue; await onCodeDetected(code); return stopCameraScan(); }
      }
    }catch{}
    rafId = requestAnimationFrame(loop);
  }; loop();
}
async function stopCameraScan(){
  if(rafId) cancelAnimationFrame(rafId); rafId=null;
  const video=$('#camVideo');
  if(video && video.srcObject){ video.pause(); video.srcObject.getTracks().forEach(t=>t.stop()); video.srcObject=null; }
  $('#camModal')?.classList.add('hidden');
}
async function onCodeDetected(code){
  const el = $('#barcode'); if(el) el.value = code;
  const st = $('#lookupStatus'); if(st) st.textContent = `Код: ${code}`;
  await onFindBarcode();
}
async function startZXingVideo(){
  try{
    const codeReader = new window.ZXing.BrowserMultiFormatReader();
    await codeReader.decodeFromVideoDevice(undefined, 'camVideo', async (result, err, controls)=>{
      if(result){ controls.stop(); await onCodeDetected(result.getText()); await stopCameraScan(); }
    });
  }catch(e){ $('#camHint').textContent = 'Камера/ZXing недоступны.'; }
}
async function scanImageFile(file){
  const st = $('#lookupStatus'); if(st) st.textContent = 'Распознаю...';
  await ensureDetector();
  try{
    if(detector && 'createImageBitmap' in window){
      const bmp = await createImageBitmap(file); const codes = await detector.detect(bmp);
      if(codes && codes.length){ await onCodeDetected(codes[0].rawValue); return; }
    }
  }catch{}
  try{
    if(window.ZXing){
      const codeReader = new window.ZXing.BrowserMultiFormatReader();
      const img = URL.createObjectURL(file);
      const res = await codeReader.decodeFromImageUrl(img);
      URL.revokeObjectURL(img);
      if(res && res.getText){ await onCodeDetected(res.getText()); return; }
    }
    if(st) st.textContent = 'Код не распознан';
  }catch{ if(st) st.textContent = 'Не удалось распознать'; }
}

// ========= СЛУШАТЕЛИ / ИНИЦ =========
document.addEventListener('DOMContentLoaded', async ()=>{
  const dateEl = $('#date'); if(dateEl) dateEl.value = todayISO();

  const st = $('#lookupStatus'); if(st) st.textContent = 'Загружаю базы...';
  await Promise.all([loadDrinks(), loadFoods()]);
  if(st) st.textContent = `Базы: напитков ${DRINKS.length}, блюд ${FOODS.length}`;

  renderDatalist();
  loadDay(dateEl ? dateEl.value : todayISO());
  if(state.rows.length===0) addEntry();

  // ИИ: кнопки (через OpenAI-тестер + USDA)
  document.querySelector('#aiPhotoBtn')?.addEventListener('click', ()=> 
    document.querySelector('#aiPhotoInput').click()
  );
  document.querySelector('#aiPhotoInput')?.addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    await analyzeDishPhoto(f);
    e.target.value = '';
  });

  // Таблица: ввод
  $('#tbl').addEventListener('input', async (e)=>{
    const tr = e.target.closest('tr'); if(!tr) return;
    const i = +tr.dataset.i; const key = e.target.getAttribute('data-k'); if(!Number.isInteger(i) || !key) return;

    if(key === 'auto'){ state.rows[i].auto = e.target.checked; if(e.target.checked) { applyAutoToRow(i); } recalcTotals(); return; }

    const val = e.target.value;
    if(['kcal','p','f','c'].includes(key)) state.rows[i].auto = false;
    state.rows[i][key] = val;

    if(key==='product'){ await onProductInput(i, val); }
    if((key==='product' || key==='weight') && state.rows[i].auto!==false){ state.rows[i].auto = true; applyAutoToRow(i); }
    recalcTotals();
  });

  // Удаление строки
  $('#tbl').addEventListener('click', (e)=>{
    const del = e.target.getAttribute && e.target.getAttribute('data-del');
    if(del!==null && del!==undefined){ state.rows.splice(+del,1); renderTable(); }
  });

  // Кнопки
  $('#saveDay').addEventListener('click', ()=>{ saveDay(); alert('Сохранено в этом браузере'); refreshViz(); });
  $('#clearDay').addEventListener('click', ()=>{ if(confirm('Очистить текущий день?')){ state.rows=[]; renderTable(); saveDay(); refreshViz(); } });
  $('#clearAll').addEventListener('click', ()=>{ if(confirm('Точно стереть все записи?')){ localStorage.removeItem(STORE_KEY); loadDay($('#date')?.value || todayISO()); refreshViz(); } });
  $('#exportCsv').addEventListener('click', downloadCSV);
  $('#importCsv').addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const r = new FileReader(); r.onload = ()=> { importCSV(String(r.result||'')); refreshViz(); }; r.readAsText(f, 'utf-8');
    e.target.value = '';
  });

  if(dateEl){
    dateEl.addEventListener('change', (e)=> { loadDay(e.target.value); refreshViz(); });
  }

  // Визуализация
  $('#period').addEventListener('change', refreshViz);
  $('#kcalGoal').addEventListener('change', ()=>{
    const v = +$('#kcalGoal').value || 0; localStorage.setItem(LIMIT_KEY, String(v)); refreshViz();
  });

  // Штрих-коды
  $('#findBarcode').addEventListener('click', onFindBarcode);
  $('#scanCamera').addEventListener('click', startCameraScan);
  $('#closeCam').addEventListener('click', stopCameraScan);
  // Кнопка "Фото штрих-кода"
  $('#photoBtn').addEventListener('click', ()=> $('#barcodeImage').click());
  $('#barcodeImage').addEventListener('change', async (e)=>{ const f = e.target.files?.[0]; if(!f) return; await scanImageFile(f); e.target.value=''; });

  // Первая отрисовка графиков + ресайз
  refreshViz();
  let resizeT; window.addEventListener('resize', ()=>{ clearTimeout(resizeT); resizeT=setTimeout(refreshViz, 200); });
});

// === ИИ по фото: добавляем строки для КАЖДОГО найденного блюда ===
async function analyzeDishPhoto(file){
  const st = document.querySelector('#aiStatus'); 
  if (st) st.textContent = 'Отправляю фото...';

  const base = (AI_WORKER_URL || '').replace(/\/+$/,'');
  const MAX_ITEMS = 5; // максимум строк, чтобы не захламлять таблицу

  try{
    // 1) метки от OpenAI (через твой воркер)
    const fd = new FormData();
    fd.append('image', file, file.name || 'photo.jpg');

    const r = await fetch(`${base}/ai/openai-test`, { method:'POST', body: fd });
    if (!r.ok) {
      const tt = await r.text().catch(()=> '');
      throw new Error(`HTTP ${r.status} ${r.statusText||''} | ${tt.slice(0,200)}`);
    }
    const data = await r.json();
    const labels = (data && data.parsed && Array.isArray(data.parsed.items)) ? data.parsed.items : [];

    if (!labels.length){
      if (st) st.textContent = 'Не удалось распознать блюдо';
      return;
    }

    // 2) готовим список кандидатов: en и ru, уберём дубли/длину
    const candSet = new Set();
    for (const it of labels) {
      const a = String(it.en||'').trim();
      const b = String(it.ru||'').trim();
      if (a && a.length <= 40) candSet.add(a);
      if (b && b.length <= 40) candSet.add(b);
    }
    const candidates = Array.from(candSet).slice(0, 10);
    if (st) st.textContent = `Нашёл по фото: ${candidates.join(', ')} — ищу КБЖУ...`;

    // 3) для КАЖДОГО кандидата пробуем USDA, затем OFF; собираем до MAX_ITEMS
    const picks = [];
    for (const name of candidates) {
      if (picks.length >= MAX_ITEMS) break;

      // 3.1 USDA
      try{
        const usdaResp = await fetch(`${base}/ai/usda?q=${encodeURIComponent(name)}`);
        const usda = await usdaResp.json().catch(()=>null);
        if (usda && usda.item && usda.item.per100) {
          picks.push({ name: usda.item.name || name, per100: usda.item.per100, match: 'USDA' });
          continue;
        }
      }catch{}

      // 3.2 OFF (если USDA не нашёл)
      try{
        const offHits = await searchOFF(name, 10);
        if (Array.isArray(offHits) && offHits.length) {
          const h = offHits.find(x => Number.isFinite(+x.kcal) && Number.isFinite(+x.p) && Number.isFinite(+x.f) && Number.isFinite(+x.c));
          if (h) {
            picks.push({ name: h.name || name, per100: { kcal:+h.kcal, p:+h.p, f:+h.f, c:+h.c }, match: 'OpenFoodFacts' });
          }
        }
      }catch{}
    }

    if (!picks.length){
      if (st) st.textContent = 'Нашёл по фото, но не нашёл ни в USDA, ни в OFF';
      return;
    }

    // 4) добавляем по СТРОКЕ на каждый pick
    const addedNames = [];
    for (const picked of picks) {
      addEntry();
      const i = state.rows.length-1;

      state.rows[i].product = picked.name;
      state.rows[i]._per100 = { ...picked.per100 };
      state.rows[i].source  = { type:'ai', match:picked.match };

      const tr = document.querySelector('#tbl tbody').children[i];
      tr.querySelector('input[data-k="product"]').value = picked.name;

      addedNames.push(`${picked.name} (${picked.match})`);
    }

    if (st) st.textContent = `Добавлено: ${addedNames.join(', ')}. Введите веса.`;
  }catch(e){
    if (st) st.textContent = `Ошибка ИИ: ${e.message||e}`;
  }
}






