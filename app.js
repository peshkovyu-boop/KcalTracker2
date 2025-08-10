if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
        .catch(console.warn);
}

// ====== КЛЮЧИ ======
const STORE_KEY = 'calctracker:v5';
const CACHE_KEY = 'calctracker:offCache:v1';

// ====== ЛОКАЛЬНАЯ БАЗА (на 100 г) ======
const FOOD_DB = [
  {name:'Яичница (жареные яйца)', kcal:196, p:13, f:15, c:1.2},
  {name:'Яйцо куриное (сырое)', kcal:143, p:12.6, f:10.6, c:0.7},
  {name:'Творог 5%', kcal:121, p:17, f:5, c:3},
  {name:'Куриная грудка (варёная)', kcal:165, p:31, f:3.6, c:0},
  {name:'Овсяные хлопья (сухие)', kcal:370, p:13, f:7, c:62},
  {name:'Рис варёный', kcal:130, p:2.7, f:0.3, c:28},
  {name:'Гречка варёная', kcal:110, p:3.6, f:1.1, c:20},
  {name:'Оливковое масло', kcal:884, p:0, f:100, c:0},
  {name:'Масло сливочное', kcal:717, p:0.8, f:81, c:0.6},
  {name:'Банан', kcal:89, p:1.1, f:0.3, c:23},
  {name:'Яблоко', kcal:52, p:0.3, f:0.2, c:14},
  {name:'Молоко 2.5%', kcal:50, p:3.3, f:2.5, c:4.8},
  {name:'Сыр 45%', kcal:356, p:26, f:28, c:2},
  {name:'Хлеб ржаной', kcal:220, p:6, f:1.1, c:46},
  {name:'Макароны варёные', kcal:157, p:5.8, f:0.9, c:30},
  {name:'Говядина постная', kcal:187, p:26, f:9, c:0},
  {name:'Свинина', kcal:242, p:27, f:14, c:0},
  {name:'Лосось', kcal:208, p:20, f:13, c:0},
  {name:'Тунец консервированный (в собственном соку)', kcal:132, p:29, f:1, c:0},
  {name:'Йогурт греческий 2%', kcal:73, p:9, f:2, c:3.8},
  {name:'Протеин (сывороточный изолят)', kcal:390, p:90, f:2, c:2}
];
const FOOD_INDEX = new Map(FOOD_DB.map(f => [f.name.toLowerCase(), f]));

// ====== УТИЛИТЫ ======
const $ = (sel)=> document.querySelector(sel);
const todayISO = ()=>{ const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`; };
const fmt = (n)=> Number.isFinite(+n) ? (Math.round(+n*100)/100).toString() : '';
const loadAll = ()=> { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } };
const saveAll = (data)=> localStorage.setItem(STORE_KEY, JSON.stringify(data));
const loadCache = ()=> { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } };
const saveCache = (c)=> localStorage.setItem(CACHE_KEY, JSON.stringify(c));

// ====== СОСТОЯНИЕ ======
const state = { date: todayISO(), rows: [], useOnline: true };
let offCache = loadCache();

// ====== OPEN FOOD FACTS ======
function extractNutrients(p){
  if(!p || !p.nutriments) return null;
  const n = p.nutriments;
  let kcal = n['energy-kcal_100g'];
  if(!Number.isFinite(+kcal)){
    const kJ = n['energy_100g'];
    if(Number.isFinite(+kJ)) kcal = +kJ / 4.184;
  }
  const proteins = n['proteins_100g'];
  const fat = n['fat_100g'];
  const carbs = n['carbohydrates_100g'];
  if([kcal, proteins, fat, carbs].some(v => !Number.isFinite(+v))) return null;
  return { kcal:+(+kcal).toFixed(1), p:+(+proteins).toFixed(2), f:+(+fat).toFixed(2), c:+(+carbs).toFixed(2) };
}

async function searchOFF(query, limit=20){
  const q = String(query||'').trim(); if(!q) return [];
  const key = `q:${q.toLowerCase()}`; if(offCache[key]) return offCache[key];
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=${limit}&fields=product_name,brands,nutriments,code`;
  const res = await fetch(url);
  const data = await res.json();
  const out = (data.products||[]).map(p=>{
    const nut = extractNutrients(p); if(!nut) return null;
    const name = [p.product_name, p.brands].filter(Boolean).join(' • ');
    return { name: name || 'Без названия', code: p.code, ...nut };
  }).filter(Boolean);
  offCache[key] = out; saveCache(offCache); return out;
}

async function fetchByBarcode(code){
  const c = String(code||'').replace(/\D/g,''); if(!c) return null;
  const key = `barcode:${c}`; if(offCache[key]) return offCache[key];
  const url = `https://world.openfoodfacts.org/api/v2/product/${c}.json`;
  const res = await fetch(url);
  const data = await res.json();
  const p = data && data.product;
  const nut = extractNutrients(p); if(!nut) return null;
  const name = [p.product_name, p.brands].filter(Boolean).join(' • ') || c;
  const out = { name, code:c, ...nut };
  offCache[key] = out; saveCache(offCache); return out;
}

// ====== РЕНДЕР/ТАБЛИЦА ======
function renderDatalist(options){
  const dl = $('#foods'); dl.innerHTML='';
  const base = FOOD_DB.map(b=>b.name);
  const list = options && options.length ? [...new Set([...options.map(o=>o.name), ...base])] : base;
  list.sort((a,b)=>a.localeCompare(b,'ru')).forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; dl.appendChild(opt);
  });
}

function buildRow(r,i){
  const tr = document.createElement('tr'); tr.dataset.i = i;
  tr.innerHTML = `
    <td>${i+1}</td>
    <td><input list="foods" value="${r.product??''}" data-k="product" placeholder="например: Яичница" /></td>
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
window.__addEntry = ()=> addEntry();

function loadDay(date){
  const all = loadAll();
  state.date = date;
  state.rows = (all[date] || []).map(r=>({auto:true, source:null, ...r}));
  $('#date').value = date;
  renderTable();
}

function saveDay(){
  const all = loadAll();
  all[state.date] = state.rows
    .filter(r => (r.product||'').trim() || r.kcal || r.p || r.f || r.c || r.weight)
    .map(({auto, source, ...rest}) => rest);
  saveAll(all);
}

// ====== ПЕРЕСЧЁТ ======
function findLocal(name){
  const key = (name||'').toLowerCase().trim();
  if(!key) return null;
  return FOOD_INDEX.get(key) ||
         FOOD_DB.find(f => f.name.toLowerCase()===key) ||
         FOOD_DB.find(f => f.name.toLowerCase().startsWith(key)) ||
         FOOD_DB.find(f => f.name.toLowerCase().includes(key)) ||
         null;
}

function applyAutoToRow(i){
  const r = state.rows[i]; if(!r || r.auto===false) return;

  if(r._per100){
    const k = (+r.weight||0)/100;
    r.kcal = +(r._per100.kcal * k).toFixed(1);
    r.p    = +(r._per100.p    * k).toFixed(2);
    r.f    = +(r._per100.f    * k).toFixed(2);
    r.c    = +(r._per100.c    * k).toFixed(2);
  } else {
    const f = findLocal(r.product);
    const w = +r.weight || 0;
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

// ====== CSV ======
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
  const csv = '\uFEFF' + toCSV(';');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'calctracker.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
function parseCSV(text){
  const firstLine = text.split(/\r?\n/).find(Boolean) || '';
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const lines = text.split(/\r?\n/).filter(Boolean);
  if(!lines.length) return [];
  let idx = 0;
  if(/date.*product.*weight/i.test(lines[0])) idx = 1;
  const out = [];
  for(let i=idx;i<lines.length;i++){
    const s = lines[i];
    const row=[]; let cur=''; let inQ=false;
    for(let j=0;j<s.length;j++){
      const ch=s[j];
      if(ch === '"'){
        if(inQ && s[j+1]==='"'){ cur+='"'; j++; } else inQ=!inQ;
      }else if(ch===delim && !inQ){ row.push(cur); cur=''; }
      else cur+=ch;
    }
    row.push(cur);
    out.push(row.map(x=>x.trim()));
  }
  return out;
}
function importCSV(text){
  const rows = parseCSV(text);
  const all = loadAll();
  for(const cells of rows){
    if(cells.length < 7) continue;
    const [date, product, weight, kcal, p, f, c] = cells;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    all[date] = all[date] || [];
    all[date].push({ product, weight:+weight||0, kcal:+kcal||0, p:+p||0, f:+f||0, c:+c||0 });
  }
  saveAll(all);
  loadDay($('#date').value);
}

// ====== ВИЗУАЛИЗАЦИЯ (как раньше) ======
function periodRange(kind, startISO){
  const d = new Date(startISO);
  if(isNaN(d)) return [null,null];
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  let end = new Date(start);
  if(kind==='day') end = new Date(start.getFullYear(), start.getMonth(), start.getDate()+1);
  if(kind==='week') end = new Date(start.getFullYear(), start.getMonth(), start.getDate()+7);
  if(kind==='month') end = new Date(start.getFullYear(), start.getMonth()+1, start.getDate());
  if(kind==='year') end = new Date(start.getFullYear()+1, start.getMonth(), start.getDate());
  const toISO = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return [toISO(start), toISO(end)];
}
function aggregateRange(kind, startISO){
  const [startISOInc, endISOEx] = periodRange(kind, startISO);
  if(!startISOInc) return {total:{kcal:0,p:0,f:0,c:0}, days:[]};
  const all = loadAll();
  const days = [];
  const cur = new Date(startISOInc);
  const end = new Date(endISOEx);
  while(cur < end){
    const dISO = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
    const arr = all[dISO] || [];
    const sums = arr.reduce((a,r)=>({
      kcal:a.kcal+(+r.kcal||0), p:a.p+(+r.p||0), f:a.f+(+r.f||0), c:a.c+(+r.c||0)
    }), {kcal:0,p:0,f:0,c:0});
    days.push({date:dISO, ...sums});
    cur.setDate(cur.getDate()+1);
  }
  const total = days.reduce((a,d)=>({kcal:a.kcal+d.kcal, p:a.p+d.p, f:a.f+d.f, c:a.c+d.c}), {kcal:0,p:0,f:0,c:0});
  return { total, days };
}
function clearCanvas(cv){ const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); }
function drawBar(cv, label, value, maxValue){
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height; clearCanvas(cv);
  const pad = 28; const w = W - pad*2; const h = H - pad*2;
  ctx.fillStyle = '#c5d0db'; ctx.font = '12px system-ui'; ctx.fillText(label, pad, 18);
  const ratio = maxValue ? Math.max(0, Math.min(1, value/maxValue)) : 0;
  ctx.fillStyle = '#1a2332'; ctx.fillRect(pad, pad+10, w, h-10);
  const grad = ctx.createLinearGradient(pad,0,pad+w,0);
  grad.addColorStop(0,'#4da3ff'); grad.addColorStop(1,'#7ddc82');
  ctx.fillStyle = grad; ctx.fillRect(pad, pad+10, w*ratio, h-10);
  ctx.fillStyle = '#e6edf3'; ctx.fillText(`${Math.round(value)} ккал`, pad, H-8);
}
function drawStack(cv, label, kcalP, kcalF, kcalC){
  const ctx = cv.getContext('2d'); clearCanvas(cv);
  const W=cv.width, H=cv.height; const pad=28; const w=W-pad*2; const h=H-pad*2;
  const total = kcalP+kcalF+kcalC || 1;
  ctx.fillStyle='#c5d0db'; ctx.font='12px system-ui'; ctx.fillText(label, pad, 18);
  ctx.fillStyle='#1a2332'; ctx.fillRect(pad, pad+10, w, h-10);
  const segs = [
    {val:kcalP, color:'#7ddc82', name:'Белки'},
    {val:kcalF, color:'#ffb86b', name:'Жиры'},
    {val:kcalC, color:'#4da3ff', name:'Углеводы'}
  ];
  let x=pad;
  segs.forEach(s=>{
    const ww = w*(s.val/total);
    ctx.fillStyle=s.color; ctx.fillRect(x, pad+10, ww, h-10);
    x+=ww;
  });
  ctx.fillStyle='#e6edf3';
  ctx.fillText(`P:${Math.round(kcalP)}  F:${Math.round(kcalF)}  C:${Math.round(kcalC)}`, pad, H-8);
}
function drawTrend(cv, points){
  const ctx=cv.getContext('2d'); clearCanvas(cv);
  const W=cv.width, H=cv.height; const pad=36; const w=W-pad*2; const h=H-pad*2;
  const maxVal = Math.max(1, ...points.map(p=>p.value));
  ctx.strokeStyle='rgba(255,255,255,.1)'; ctx.beginPath();
  ctx.moveTo(pad, H-pad); ctx.lineTo(W-pad, H-pad); ctx.moveTo(pad, pad); ctx.lineTo(pad, H-pad); ctx.stroke();
  ctx.beginPath(); ctx.strokeStyle='#4da3ff'; ctx.lineWidth=2;
  points.forEach((p,i)=>{
    const x = pad + (w * (i/(Math.max(1,points.length-1))));
    const y = H - pad - (h * (p.value/maxVal));
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
  ctx.fillStyle='#c5d0db'; ctx.font='11px system-ui';
  points.forEach((p,i)=>{
    const x = pad + (w * (i/(Math.max(1,points.length-1))));
    const y = H - pad + 14; ctx.fillText(p.label.slice(5), x-16, y);
  });
}
function refreshViz(){
  const kind = $('#period').value;
  const start = $('#periodStart').value || todayISO();
  const { total, days } = aggregateRange(kind, start);

  const cv1 = $('#barTotal'); const cv2 = $('#stackMacros'); const cv3 = $('#trendDaily');
  [cv1,cv2,cv3].forEach(cv=>{
    const r=cv.getBoundingClientRect();
    cv.width = Math.max(320, r.width) * devicePixelRatio;
    cv.height = r.height * devicePixelRatio || 220 * devicePixelRatio;
    cv.style.height = (cv.height/devicePixelRatio) + 'px';
  });

  const totalKcal = total.kcal;
  const kcalP = total.p*4, kcalF = total.f*9, kcalC = total.c*4;
  drawBar(cv1, 'Суммарные калории', totalKcal, Math.max(totalKcal, 2500));
  drawStack(cv2, 'Соотношение Б/Ж/У (в ккал)', kcalP, kcalF, kcalC);
  drawTrend(cv3, days.map(d=>({label:d.date, value:d.kcal})));

  $('#vizInfo').textContent = `${kind.toUpperCase()} • с ${start}`;
}

// ====== ВВОД/ПОИСК НАЗВАНИЯ ======
let debounceTimer = null;
async function onProductInput(i, value){
  state.rows[i]._per100 = null;
  if(!state.useOnline) return renderDatalist();

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async ()=>{
    try{
      const opts = await searchOFF(value, 20);
      renderDatalist(opts);
      const exact = opts.find(o => o.name.toLowerCase() === String(value||'').toLowerCase());
      if(exact){
        state.rows[i]._per100 = {kcal:exact.kcal,p:exact.p,f:exact.f,c:exact.c};
        state.rows[i].source = {type:'off', code: exact.code};
        applyAutoToRow(i); recalcTotals();
      }
    }catch(e){
      console.warn('OFF search error', e);
      renderDatalist();
    }
  }, 350);
}

async function onFindBarcode(){
  const code = $('#barcode').value;
  $('#lookupStatus').textContent = 'Поиск...';
  try{
    const p = await fetchByBarcode(code);
    if(!p){ $('#lookupStatus').textContent = 'Не найдено'; return; }
    addEntry();
    const i = state.rows.length - 1;
    state.rows[i].product = p.name;
    state.rows[i]._per100 = {kcal:p.kcal,p:p.p,f:p.f,c:p.c};
    state.rows[i].source = {type:'off', code: p.code};
    const tr = $('#tbl tbody').children[i];
    tr.querySelector('input[data-k="product"]').value = p.name;
    applyAutoToRow(i); recalcTotals();
    $('#lookupStatus').textContent = 'Готово';
  }catch(e){
    console.warn(e);
    $('#lookupStatus').textContent = 'Ошибка';
  }
}

// ====== СКАНИРОВАНИЕ КАМЕРОЙ / ФОТО ======
let stream = null, rafId = null, detector = null;

function hasBarcodeDetector(){
  return 'BarcodeDetector' in window;
}

async function ensureDetector(){
  if(detector || !hasBarcodeDetector()) return;
  try{
    detector = new window.BarcodeDetector({
      formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','qr_code']
    });
  }catch(e){ detector = null; }
}

async function startCameraScan(){
  $('#lookupStatus').textContent = '';
  $('#camModal').classList.remove('hidden');
  await ensureDetector();

  try{
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio:false });
  }catch(e){
    $('#camHint').textContent = 'Нет доступа к камере. Разреши доступ в браузере.';
    // ZXing фолбэк с собственным доступом
    if(window.ZXing){ return startZXingVideo(); }
    return;
  }

  const video = $('#camVideo'); video.srcObject = stream; await video.play();

  const loop = async ()=>{
    if(!video.videoWidth){ rafId = requestAnimationFrame(loop); return; }
    const canvas = $('#camCanvas');
    const r = video.getBoundingClientRect();
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    // рисовать рамку не обязательно — оставим подсказку
    try{
      if(detector){
        const codes = await detector.detect(video);
        if(codes && codes.length){
          const code = codes[0].rawValue;
          await onCodeDetected(code);
          return stopCameraScan();
        }
      }else{
        // ZXing fallback
        if(window.ZXing){ /* уже запущен отдельным методом */ }
      }
    }catch(e){ /* молча */ }
    rafId = requestAnimationFrame(loop);
  };
  loop();
}

async function stopCameraScan(){
  if(rafId) cancelAnimationFrame(rafId); rafId = null;
  const video = $('#camVideo');
  if(video && video.srcObject){
    video.pause();
    const tracks = video.srcObject.getTracks(); tracks.forEach(t=>t.stop());
    video.srcObject = null;
  }
  $('#camModal').classList.add('hidden');
}

async function onCodeDetected(code){
  $('#barcode').value = code;
  $('#lookupStatus').textContent = `Код: ${code}`;
  await onFindBarcode();
}

// ZXing видео-фолбэк
async function startZXingVideo(){
  try{
    const codeReader = new window.ZXing.BrowserMultiFormatReader();
    await codeReader.decodeFromVideoDevice(undefined, 'camVideo', async (result, err, controls)=>{
      if(result){
        controls.stop();
        await onCodeDetected(result.getText());
        await stopCameraScan();
      }
    });
  }catch(e){
    $('#camHint').textContent = 'Нужна поддержка камеры или ZXing не загрузился.';
  }
}

// Распознавание из фото
async function scanImageFile(file){
  $('#lookupStatus').textContent = 'Распознаю...';
  await ensureDetector();
  try{
    if(detector && 'createImageBitmap' in window){
      const bmp = await createImageBitmap(file);
      const codes = await detector.detect(bmp);
      if(codes && codes.length){
        await onCodeDetected(codes[0].rawValue);
        return;
      }
    }
  }catch(e){ /* попробуем ZXing */ }

  // ZXing fallback
  try{
    if(window.ZXing){
      const codeReader = new window.ZXing.BrowserMultiFormatReader();
      const img = URL.createObjectURL(file);
      const res = await codeReader.decodeFromImageUrl(img);
      URL.revokeObjectURL(img);
      if(res && res.getText){
        await onCodeDetected(res.getText());
        return;
      }
    }
    $('#lookupStatus').textContent = 'Код не распознан';
  }catch(e){
    $('#lookupStatus').textContent = 'Не удалось распознать';
  }
}

// ====== СЛУШАТЕЛИ UI ======
document.addEventListener('DOMContentLoaded', ()=>{
  $('#date').value = todayISO();
  $('#periodStart').value = todayISO();
  state.useOnline = $('#useOnline').checked;
  renderDatalist();
  loadDay($('#date').value);
  if(state.rows.length===0) addEntry();
  refreshViz();

  // переключатель источника
  $('#useOnline').addEventListener('change', ()=>{
    state.useOnline = $('#useOnline').checked;
    renderDatalist();
  });

  // таблица — ввод
  $('#tbl').addEventListener('input', async (e)=>{
    const tr = e.target.closest('tr'); if(!tr) return;
    const i = +tr.dataset.i; const key = e.target.getAttribute('data-k'); if(!Number.isInteger(i) || !key) return;

    if(key === 'auto'){
      state.rows[i].auto = e.target.checked;
      if(e.target.checked) { applyAutoToRow(i); }
      recalcTotals(); return;
    }

    const val = e.target.value;
    if(['kcal','p','f','c'].includes(key)) state.rows[i].auto = false;
    state.rows[i][key] = val;

    if(key==='product'){ await onProductInput(i, val); }

    if((key==='product' || key==='weight') && state.rows[i].auto!==false){
      state.rows[i].auto = true;
      applyAutoToRow(i);
    }
    recalcTotals();
  });

  // удаление строки
  $('#tbl').addEventListener('click', (e)=>{
    const del = e.target.getAttribute && e.target.getAttribute('data-del');
    if(del!==null && del!==undefined){
      state.rows.splice(+del,1);
      renderTable();
    }
  });

  // кнопки
  const addBtn = $('#addEntryBtn'); if(addBtn) addBtn.addEventListener('click', ()=> addEntry());
  $('#saveDay').addEventListener('click', ()=>{ saveDay(); alert('Сохранено в этом браузере'); refreshViz(); });
  $('#clearDay').addEventListener('click', ()=>{ if(confirm('Очистить текущий день?')){ state.rows=[]; renderTable(); saveDay(); refreshViz(); } });
  $('#clearAll').addEventListener('click', ()=>{ if(confirm('Точно стереть все записи?')){ localStorage.removeItem(STORE_KEY); loadDay($('#date').value); refreshViz(); } });
  $('#exportCsv').addEventListener('click', downloadCSV);
  $('#importCsv').addEventListener('change', (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    const r = new FileReader(); r.onload = ()=> { importCSV(String(r.result||'')); refreshViz(); }; r.readAsText(f, 'utf-8');
    e.target.value = '';
  });
  $('#date').addEventListener('change', (e)=> { loadDay(e.target.value); refreshViz(); });

  // визуализация
  $('#period').addEventListener('change', refreshViz);
  $('#periodStart').addEventListener('change', refreshViz);
  $('#refreshViz').addEventListener('click', refreshViz);

  // штрих-код: поиск по номеру
  $('#findBarcode').addEventListener('click', onFindBarcode);

  // штрих-код: камера
  $('#scanCamera').addEventListener('click', startCameraScan);
  $('#closeCam').addEventListener('click', stopCameraScan);

  // штрих-код: фото
  $('#barcodeImage').addEventListener('change', async (e)=>{
    const f = e.target.files?.[0]; if(!f) return;
    await scanImageFile(f);
    e.target.value = '';
  });

  // ресайз графиков
  let resizeT; window.addEventListener('resize', ()=>{ clearTimeout(resizeT); resizeT=setTimeout(refreshViz, 200); });
});
