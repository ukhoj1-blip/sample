/* 법인카드 집근처 분석 — 모든 데이터는 브라우저(localStorage)에만 저장됩니다. */
'use strict';

// ───────────────────────── 상수 / 상태 ─────────────────────────
const LS = { settings: 'cha.settings', tx: 'cha.tx', homes: 'cha.homes', geo: 'cha.geo', biz: 'cha.biz', ai: 'cha.ai' };

const DEFAULTS = {
  kakaoKey: '',
  ntsKey: '',
  bizCheckedAt: null,
  geminiKey: '',
  geminiModel: 'gemini-flash-latest', // 구글이 최신 flash 모델로 연결해 주는 별칭. 없으면 목록에서 자동 선택
  aiAuthor: '',
  aiTo: '',
  r1: 500,
  r2: 1500,
  nightFrom: '22:00',
  nightTo: '06:00',
  exclude: 'PG,쇼핑몰,온라인,인터넷,전자상거래,결제대행,통신,택시,항공,여행사,보험,소프트웨어',
  risky: '주유,편의점,마트,슈퍼,약국,의원,병원,미용,세탁,정육,제과,베이커리,학원,동물,꽃,주점',
  holidays: '',
  workdays: '',
  satOff: true,
  laborDay: true,
  office: '',
  officeR: 700,
  officeGeo: null,
  analyzedAt: null,
};

// 원본 컬럼 ↔ 내부 필드 (헤더는 공백 제거 후 비교)
const FIELDS = [
  ['seq', '순번', ['번호', 'No']],
  ['card', '카드번호', []],
  ['user', '이용자명', ['사용자명', '이용자', '사용자', '성명']],
  ['date', '이용일', ['이용일자', '사용일', '사용일자', '승인일', '승인일자', '거래일']],
  ['merchant', '가맹점명', ['가맹점']],
  ['amount', '이용금액', ['사용금액', '승인금액', '금액']],
  ['addr', '가맹점 주소', ['가맹점주소', '주소']],
  ['bizno', '사업자 등록번호', ['사업자등록번호', '사업자번호']],
  ['approval', '승인번호', []],
  ['taxType', '과세유형', []],
  ['slip', '전표구분', []],
  ['usd', '미화금액', []],
  ['fx', '미화환율', []],
  ['time', '승인시간', ['이용시간', '사용시간', '승인시각']],
  ['catCode', '가맹점업종코드', ['업종코드']],
  ['catName', '가맹점업종명', ['업종명', '업종']],
  ['fuel', '유종', []],
  ['unitPrice', '리터당단가', []],
];

// 법정 공휴일(대체공휴일 포함). 설정의 '추가 휴일'로 보완하세요.
const HOLIDAYS = {
  '2024-01-01': '신정', '2024-02-09': '설날', '2024-02-10': '설날', '2024-02-11': '설날', '2024-02-12': '대체공휴일',
  '2024-03-01': '삼일절', '2024-04-10': '국회의원선거', '2024-05-05': '어린이날', '2024-05-06': '대체공휴일',
  '2024-05-15': '부처님오신날', '2024-06-06': '현충일', '2024-08-15': '광복절', '2024-09-16': '추석',
  '2024-09-17': '추석', '2024-09-18': '추석', '2024-10-01': '국군의날', '2024-10-03': '개천절',
  '2024-10-09': '한글날', '2024-12-25': '성탄절',
  '2025-01-01': '신정', '2025-01-27': '임시공휴일', '2025-01-28': '설날', '2025-01-29': '설날', '2025-01-30': '설날',
  '2025-03-01': '삼일절', '2025-03-03': '대체공휴일', '2025-05-05': '어린이날·부처님오신날', '2025-05-06': '대체공휴일',
  '2025-06-03': '대통령선거', '2025-06-06': '현충일', '2025-08-15': '광복절', '2025-10-03': '개천절',
  '2025-10-05': '추석', '2025-10-06': '추석', '2025-10-07': '추석', '2025-10-08': '대체공휴일',
  '2025-10-09': '한글날', '2025-12-25': '성탄절',
  '2026-01-01': '신정', '2026-02-16': '설날', '2026-02-17': '설날', '2026-02-18': '설날',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일', '2026-08-15': '광복절',
  '2026-08-17': '대체공휴일', '2026-09-24': '추석', '2026-09-25': '추석', '2026-09-26': '추석',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
};

const LEVELS = {
  near: '집근처', warn: '주의', ok: '정상', office: '회사근처',
  excluded: '분석제외', unknown: '위치불명', nohome: '집주소 미등록',
};
const LEVEL_ORDER = { near: 0, warn: 1, office: 2, ok: 3, unknown: 4, nohome: 5, excluded: 6 };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

let S = Object.assign({}, DEFAULTS, readLS(LS.settings, {}));
// 배포용 기본 키(js/config.js) — 사용자가 직접 입력한 키가 없을 때만 사용
const CFG = window.APP_CONFIG || {};
if (!S.kakaoKey && CFG.kakaoKey) S.kakaoKey = CFG.kakaoKey;
if (!S.ntsKey && CFG.ntsKey) S.ntsKey = CFG.ntsKey;
let TX = readLS(LS.tx, []);
let HOMES = readLS(LS.homes, {});
let GEO = readLS(LS.geo, {});
let BIZ = readLS(LS.biz, {}); // 사업자번호 → 국세청 상태조회 결과
let RESULT = null;
let kakaoReady = false;
let geocoder = null, places = null;

// ───────────────────────── 유틸 ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = n => (Math.round(n || 0)).toLocaleString('ko-KR');
const pad = n => String(n).padStart(2, '0');
const norm = s => String(s ?? '').replace(/\s+/g, '');
const kw = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function readLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeLS(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; }
}
function saveAll() {
  writeLS(LS.settings, S);
  writeLS(LS.homes, HOMES);
  writeLS(LS.geo, GEO);
  if (!writeLS(LS.tx, TX)) toast('내역이 커서 브라우저에 저장하지 못했습니다. 새로고침하면 다시 업로드해야 합니다.');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3000);
}

function haversine(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = m => m == null ? '' : m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;

function parseDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v < 100000) { // 엑셀 날짜 일련번호
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/(\d{4})\D?(\d{1,2})\D?(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{2})\D(\d{1,2})\D(\d{1,2})$/);
  if (m) return `20${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  return s;
}
function parseTime(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v < 1) { // 엑셀 시간 소수
    const sec = Math.round(v * 86400);
    return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}`;
  }
  const s = String(v).trim();
  let m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${pad(m[1])}:${m[2]}:${m[3] || '00'}`;
  m = s.replace(/\D/g, '').match(/^(\d{2})(\d{2})(\d{2})?$/);
  if (m) return `${m[1]}:${m[2]}:${m[3] || '00'}`;
  const d = s.replace(/\D/g, '');
  if (d.length === 5) return `0${d[0]}:${d.slice(1, 3)}:${d.slice(3)}`;
  return s;
}
const parseNum = v => typeof v === 'number' ? v : (Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
const toMin = hhmm => { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); };

// ───────────────────────── 파일 읽기 ─────────────────────────
async function readSheetRows(file) {
  const buf = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { text = new TextDecoder('euc-kr').decode(buf); }
    wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buf, { type: 'array' });
  }
  return wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
}

function mapHeader(row) {
  const idx = {};
  row.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    for (const [key, label, alias] of FIELDS) {
      if (idx[key] != null) continue;
      if (n === norm(label) || alias.some(a => norm(a) === n)) { idx[key] = i; break; }
    }
  });
  return idx;
}

function parseCardSheets(sheets) {
  for (const rows of sheets) {
    for (let r = 0; r < Math.min(rows.length, 15); r++) {
      const idx = mapHeader(rows[r]);
      if (idx.user != null && idx.merchant != null && idx.addr != null && idx.amount != null) {
        const out = [];
        for (const row of rows.slice(r + 1)) {
          if (!row.some(c => String(c).trim() !== '')) continue;
          const g = k => idx[k] != null ? row[idx[k]] : '';
          const t = {
            seq: String(g('seq')).trim(), card: String(g('card')).trim(), user: String(g('user')).trim(),
            date: parseDate(g('date')), merchant: String(g('merchant')).trim(), amount: parseNum(g('amount')),
            addr: String(g('addr')).replace(/\s+/g, ' ').trim(), bizno: String(g('bizno')).trim(),
            approval: String(g('approval')).trim(), taxType: String(g('taxType')).trim(), slip: String(g('slip')).trim(),
            usd: parseNum(g('usd')), fx: parseNum(g('fx')), time: parseTime(g('time')),
            catCode: String(g('catCode')).trim(), catName: String(g('catName')).trim(),
            fuel: String(g('fuel')).trim(), unitPrice: parseNum(g('unitPrice')),
          };
          if (!t.user && !t.merchant) continue;
          out.push(t);
        }
        return { rows: out, missing: FIELDS.filter(([k]) => idx[k] == null).map(f => f[1]) };
      }
    }
  }
  return null;
}

const txKey = t => [t.card, t.approval, t.date, t.time, t.amount, t.merchant].join('|');

async function handleCardFiles(files) {
  const info = [];
  let added = 0;
  const seen = new Set(TX.map(txKey));
  for (const f of files) {
    try {
      const parsed = parseCardSheets(await readSheetRows(f));
      if (!parsed) { info.push(`<div class="err-txt">${esc(f.name)}: 헤더(이용자명·가맹점명·이용금액·가맹점 주소)를 찾지 못했습니다.</div>`); continue; }
      let n = 0;
      for (const t of parsed.rows) {
        const k = txKey(t);
        if (seen.has(k)) continue;
        seen.add(k); TX.push(t); n++;
      }
      added += n;
      info.push(`<div><span class="ok-txt">${esc(f.name)}</span>: ${parsed.rows.length}건 읽음, ${n}건 추가` +
        (parsed.missing.length ? ` <span class="muted">(없는 컬럼: ${esc(parsed.missing.join(', '))})</span>` : '') + '</div>');
    } catch (e) {
      info.push(`<div class="err-txt">${esc(f.name)}: 읽기 실패 — ${esc(e.message)}</div>`);
    }
  }
  TX.forEach((t, i) => { t._id = i; });
  for (const t of TX) if (t.user && !HOMES[t.user]) HOMES[t.user] = { addr: '' };
  S.analyzedAt = null;
  saveAll();
  analyze(); // 위치는 아직 미변환이지만 휴일·심야 분석은 바로 가능
  $('#uploadInfo').innerHTML = info.join('') + `<p>총 <b>${TX.length.toLocaleString()}</b>건 보관 중 · 이용자 ${userList().length}명</p>`;
  if (added) toast(`${added}건 추가됨 — 집주소를 등록하세요`);
  renderAll();
}

// ───────────────────────── 카카오 ─────────────────────────
function loadKakao(key) {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) return resolve();
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
    const timer = setTimeout(() => reject(new Error('응답 시간 초과')), 12000);
    s.onload = () => {
      if (!window.kakao || !kakao.maps) { clearTimeout(timer); return reject(new Error('SDK 초기화 실패')); }
      kakao.maps.load(() => { clearTimeout(timer); resolve(); });
    };
    s.onerror = () => { clearTimeout(timer); reject(new Error('SDK 로드 실패 — 키와 등록 도메인을 확인하세요')); };
    document.head.appendChild(s);
  });
}

async function connectKakao() {
  const badge = $('#kakaoBadge');
  if (!S.kakaoKey) { badge.className = 'badge badge-off'; badge.textContent = '카카오지도 미연결'; return false; }
  try {
    await loadKakao(S.kakaoKey);
    geocoder = new kakao.maps.services.Geocoder();
    places = new kakao.maps.services.Places();
    kakaoReady = true;
    badge.className = 'badge badge-on'; badge.textContent = '카카오지도 연결됨';
  } catch (e) {
    kakaoReady = false;
    badge.className = 'badge badge-err'; badge.textContent = '카카오 연결 실패';
    toast(e.message);
  }
  renderSteps();
  return kakaoReady;
}

function kakaoCall(fn, q) {
  return new Promise(resolve => {
    try {
      fn(q, (res, status) => resolve({ res, status }));
    } catch (e) { resolve({ res: null, status: 'EXCEPTION' }); }
  });
}
let apiError = false; // 마지막 변환에서 카카오가 ERROR를 돌려줬는지 (사용 설정 OFF·쿼터 초과 등)
async function kAddress(q) {
  for (let i = 0; i < 3; i++) {
    const { res, status } = await kakaoCall((a, cb) => geocoder.addressSearch(a, cb), q);
    if (status === kakao.maps.services.Status.OK) return res;
    if (status === kakao.maps.services.Status.ZERO_RESULT) return null;
    await sleep(400 * (i + 1)); // ERROR(쿼터·네트워크) → 재시도
  }
  apiError = true;
  return null;
}
const API_ERROR_MSG = '카카오 API 오류 — 카카오맵 [사용 설정] ON 여부, JavaScript SDK 도메인 등록, 쿼터를 확인하세요';
async function kKeyword(q) {
  const { res, status } = await kakaoCall((a, cb) => places.keywordSearch(a, cb), q);
  return status === kakao.maps.services.Status.OK ? res : null;
}

// 카드사 주소는 건물명·층·호수가 붙거나 "1670 15"처럼 하이픈이 빠져 있어 후보를 여러 개 만든다.
function addrCandidates(raw) {
  let s = String(raw || '').replace(/\([^)]*\)/g, ' ').replace(/[,·]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.split(' ').filter(t => !/^(지하|B)?\d+(층|호|F|f)$/.test(t) && !/^\d+(층|호)\S*$/.test(t)).join(' ');
  const out = [];
  // 시·구만 남은 너무 넓은 결과는 geocodeAddress에서 걸러지므로 2단어(예: "서초대로 356")부터 허용
  const add = q => { q = q.trim().replace(/\s+/g, ' '); if (q && q.split(' ').length >= 2 && !out.includes(q)) out.push(q); };
  const road = s.match(/^(.*?[가-힣0-9]+(?:로|길))\s+(\d+)(?:[-\s](\d+))?(?=\s|$)/);
  if (road) { if (road[3]) add(`${road[1]} ${road[2]}-${road[3]}`); add(`${road[1]} ${road[2]}`); }
  const jibun = s.match(/^(.*?[가-힣0-9]+(?:동|가|리))\s+(산\s*)?(\d+)(?:[-\s](\d+))?(?=\s|$|[^\d-])/);
  if (jibun) {
    const san = jibun[2] ? '산 ' : '';
    if (jibun[4]) add(`${jibun[1]} ${san}${jibun[3]}-${jibun[4]}`);
    add(`${jibun[1]} ${san}${jibun[3]}`);
  }
  add(s);
  const toks = s.split(' ');
  for (let i = Math.min(toks.length - 1, 5); i >= 2; i--) add(toks.slice(0, i).join(' '));
  return out.slice(0, 7);
}
const cleanName = n => String(n || '').split(' - ')[0].replace(/\(주\)|㈜|주식회사|\(유\)|\(재\)|\(사\)/g, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 25);
const regionOf = a => String(a || '').split(' ').slice(0, 2).join(' ');
const geoKey = a => 'a:' + String(a || '').replace(/\s+/g, ' ').trim();
const kwKey = t => 'k:' + regionOf(t.addr) + '|' + cleanName(t.merchant);
const isForeign = t => t.usd > 0 || !/[가-힣]/.test(t.addr || '');

async function geocodeAddress(raw) {
  for (const q of addrCandidates(raw)) {
    const res = await kAddress(q);
    if (!res || !res.length) continue;
    const r = res[0];
    const precise = /ROAD_ADDR|REGION_ADDR/.test(r.address_type);
    // 동 단위보다 넓은(시·구) 결과는 거리 판정에 쓰기엔 오차가 너무 커서 버린다
    if (!precise && !(r.address && r.address.region_3depth_name)) continue;
    return { lat: +r.y, lng: +r.x, matched: r.address_name, query: q, precision: precise ? '정확' : '동단위', method: '주소검색' };
  }
  return { fail: true };
}
async function geocodeKeyword(t) {
  const name = cleanName(t.merchant);
  if (!name) return { fail: true };
  const res = await kKeyword(`${regionOf(t.addr)} ${name}`.trim());
  if (!res || !res.length) return { fail: true };
  const r = res[0];
  return { lat: +r.y, lng: +r.x, matched: `${r.place_name} (${r.road_address_name || r.address_name})`, query: name, precision: '장소검색', method: '키워드검색' };
}

function geoFor(t) {
  const a = GEO[geoKey(t.addr)];
  if (a && !a.fail) return a;
  const k = GEO[kwKey(t)];
  if (k && !k.fail) return k;
  return null;
}

async function pool(items, size, worker, onProgress) {
  let i = 0, done = 0;
  const run = async () => {
    while (i < items.length) {
      const it = items[i++];
      await worker(it);
      onProgress(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
}

function setProgress(done, total, label) {
  const w = $('#progWrap');
  w.classList.toggle('hidden', total === 0);
  $('#progBar').style.width = total ? `${(done / total) * 100}%` : '0';
  $('#progText').textContent = `${label} ${done}/${total}`;
}

async function geocodeHomes(force) {
  const names = Object.keys(HOMES).filter(n => HOMES[n].addr && (force || HOMES[n].lat == null));
  let fail = 0;
  for (const n of names) {
    const r = await geocodeAddress(HOMES[n].addr);
    if (r.fail) { HOMES[n] = { addr: HOMES[n].addr, fail: true }; fail++; }
    else HOMES[n] = { addr: HOMES[n].addr, lat: r.lat, lng: r.lng, matched: r.matched, precision: r.precision };
  }
  writeLS(LS.homes, HOMES);
  return { total: names.length, fail };
}

async function geocodeOffice() {
  if (!S.office) { S.officeGeo = null; return; }
  if (S.officeGeo && S.officeGeo.src === S.office) return;
  const r = await geocodeAddress(S.office);
  S.officeGeo = r.fail ? { src: S.office, fail: true } : { src: S.office, lat: r.lat, lng: r.lng, matched: r.matched };
  writeLS(LS.settings, S);
}

async function runAnalysis() {
  if (!TX.length) return toast('먼저 카드 사용내역을 업로드하세요');
  if (!kakaoReady) { toast('설정에서 카카오 JavaScript 키를 먼저 연결하세요'); return switchTab('settings'); }
  const btn = $('#btnRun');
  btn.disabled = true;
  apiError = false;
  try {
    setProgress(0, 1, '집주소 변환');
    const h = await geocodeHomes(false);
    await geocodeOffice();

    const ex = kw(S.exclude);
    const targets = new Map();
    for (const t of TX) {
      if (isCancelled(t) || matchAny(`${t.catName} ${t.merchant}`, ex) || isForeign(t)) continue;
      if (!HOMES[t.user] || HOMES[t.user].lat == null) continue;
      const k = geoKey(t.addr);
      if (GEO[k] === undefined || (GEO[k].fail && GEO[kwKey(t)] === undefined)) targets.set(k + '#' + kwKey(t), t);
    }
    const list = [...targets.values()];
    let saved = 0;
    await pool(list, 4, async t => {
      const k = geoKey(t.addr);
      if (GEO[k] === undefined) GEO[k] = await geocodeAddress(t.addr);
      if (GEO[k].fail && GEO[kwKey(t)] === undefined) GEO[kwKey(t)] = await geocodeKeyword(t);
      if (++saved % 25 === 0) writeLS(LS.geo, GEO);
    }, (d, n) => setProgress(d, n, '가맹점 주소 변환'));
    writeLS(LS.geo, GEO);

    S.analyzedAt = new Date().toISOString();
    writeLS(LS.settings, S);
    analyze();
    renderAll();
    const msgs = [`가맹점 주소 ${list.length}곳 새로 변환`];
    if (apiError) msgs.push(`<span class="err-txt">${API_ERROR_MSG}</span>`);
    if (h.fail) msgs.push(`<span class="err-txt">집주소 ${h.fail}건 변환 실패 — ② 집주소 관리에서 확인</span>`);
    const noHome = userList().filter(u => !HOMES[u] || HOMES[u].lat == null);
    if (noHome.length) msgs.push(`<span class="err-txt">집주소 미등록: ${esc(noHome.join(', '))}</span>`);
    $('#runInfo').innerHTML = `<p>${msgs.join(' · ')}</p>`;
    toast('분석 완료');
    switchTab('dash');
  } finally {
    btn.disabled = false;
    setTimeout(() => $('#progWrap').classList.add('hidden'), 800);
  }
}

// ───────────────────────── 국세청 휴폐업 조회 ─────────────────────────
const bizNo = s => String(s || '').replace(/\D/g, '');
const ymd = s => /^\d{8}$/.test(s || '') ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : '';
const taxClass = s => /간이/.test(s) ? '간이' : /면세/.test(s) ? '면세' : /일반/.test(s) ? '일반' : '';
const BIZ_FLAGS = {
  afterClose: '폐업 후 거래', unregistered: '미등록 사업자', suspended: '현재 휴업', closedLater: '거래 후 폐업', taxMismatch: '과세유형 불일치',
};
const BIZ_ORDER = { afterClose: 0, unregistered: 1, suspended: 2, closedLater: 3, taxMismatch: 4, '': 5 };

async function ntsStatus(nums) {
  const key = S.ntsKey.includes('%') ? S.ntsKey : encodeURIComponent(S.ntsKey);
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ b_no: nums }) };
  // 국세청 API는 CORS를 허용하므로 브라우저에서 직접 호출하고, 사내망 등에서 막히면 start.bat 서버의 중계로 재시도
  let res;
  try {
    res = await fetch(`https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${key}`, opts);
  } catch {
    try { res = await fetch(`/api/nts-status?serviceKey=${key}`, opts); } catch { res = null; }
    if (!res || res.status === 404 || res.status === 405 || res.status === 501) throw new Error('국세청 API(api.odcloud.kr)에 연결할 수 없습니다 — 네트워크·방화벽을 확인하세요');
  }
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`국세청 API 응답 오류 (HTTP ${res.status}) ${text.slice(0, 120)}`); }
  if (!res.ok || j.status_code !== 'OK') {
    const m = j.msg || j.message || j.status_code || `HTTP ${res.status}`;
    throw new Error(/인증키|SERVICE_KEY|-4|401/.test(m + res.status) ? `서비스키 오류: ${m} — 설정의 공공데이터포털 키(Decoding)와 활용신청 승인 여부를 확인하세요` : `국세청 API 오류: ${m}`);
  }
  return j.data || [];
}

function bizTargets(force) {
  const all = [...new Set(TX.map(t => bizNo(t.bizno)).filter(b => b.length === 10))];
  return { all, todo: force ? all : all.filter(b => !BIZ[b]) };
}

async function runBizCheck(force) {
  if (!TX.length) return toast('먼저 카드 사용내역을 업로드하세요');
  if (!S.ntsKey) { toast('설정 탭에서 공공데이터포털 서비스키를 입력하세요'); return switchTab('settings'); }
  const { todo } = bizTargets(force);
  if (!todo.length) { toast('새로 조회할 사업자번호가 없습니다 (다시 조회하려면 [전체 다시 조회])'); return; }
  const btns = [$('#btnBizRun'), $('#btnBizRerun')];
  btns.forEach(b => { b.disabled = true; });
  const prog = $('#bizProg');
  prog.classList.remove('hidden');
  try {
    for (let i = 0; i < todo.length; i += 100) { // API 1회 최대 100건
      const chunk = todo.slice(i, i + 100);
      $('#bizProgBar').style.width = `${(i / todo.length) * 100}%`;
      $('#bizProgText').textContent = `국세청 조회 ${i}/${todo.length}`;
      const now = new Date().toISOString();
      for (const d of await ntsStatus(chunk)) {
        BIZ[d.b_no] = { stt: d.b_stt || '미등록', cd: d.b_stt_cd || '', taxType: d.tax_type || '', endDt: ymd(d.end_dt), at: now };
      }
      writeLS(LS.biz, BIZ);
    }
    S.bizCheckedAt = new Date().toISOString();
    writeLS(LS.settings, S);
    analyze();
    renderAll();
    toast(`사업자 ${todo.length}개 조회 완료`);
  } catch (e) {
    toast(e.message);
    $('#bizInfo').innerHTML = `<span class="err-txt">${esc(e.message)}</span>`;
  } finally {
    btns.forEach(b => { b.disabled = false; });
    prog.classList.add('hidden');
  }
}

// ───────────────────────── 분석 ─────────────────────────
const matchAny = (text, words) => words.some(w => text.includes(w));
const isCancelled = t => /취소|반품|환불/.test(t.slip) || t.amount < 0;

function holidayMap() {
  const m = Object.assign({}, HOLIDAYS);
  if (S.laborDay) for (const y of new Set(TX.map(t => t.date.slice(0, 4)))) m[`${y}-05-01`] = m[`${y}-05-01`] || '근로자의날';
  for (const d of kw(S.holidays)) m[parseDate(d)] = '추가휴일';
  return m;
}

function isNight(time) {
  if (!/^\d{2}:\d{2}/.test(time || '')) return false;
  const t = toMin(time), a = toMin(S.nightFrom), b = toMin(S.nightTo);
  return a <= b ? (t >= a && t < b) : (t >= a || t < b);
}

function analyze() {
  const hol = holidayMap();
  const work = new Set(kw(S.workdays).map(parseDate));
  const ex = kw(S.exclude), risky = kw(S.risky);
  const office = S.officeGeo && !S.officeGeo.fail ? S.officeGeo : null;
  const rows = TX.map(t => {
    const r = Object.assign({}, t, { level: '', dist: null, officeDist: null, flags: [], score: 0, note: '', geo: null });
    const d = new Date(t.date + 'T00:00:00');
    r.dow = isNaN(d) ? '' : DOW[d.getDay()];
    r.weekend = r.dow === '토' || r.dow === '일';
    r.holidayName = hol[t.date] || '';
    r.offType = work.has(t.date) ? '' : r.holidayName ? '공휴일' : r.dow === '일' ? '일요일' : (r.dow === '토' && S.satOff) ? '토요일' : '';
    r.offday = !!r.offType;
    r.night = isNight(t.time);
    r.risky = matchAny(`${t.catName} ${t.merchant}`, risky);

    // 휴폐업: 폐업일 이후 결제는 실제 매장이 아닐 가능성이 높다
    const b = BIZ[bizNo(t.bizno)];
    r.biz = b || null;
    r.bizFlag = !b ? '' : b.cd === '03' ? (b.endDt && b.endDt < t.date ? 'afterClose' : 'closedLater')
      : b.cd === '02' ? 'suspended' : !b.cd ? 'unregistered' : '';
    const ct = taxClass(t.taxType), nt = b ? taxClass(b.taxType) : '';
    if (!r.bizFlag && ct && nt && ct !== nt) r.bizFlag = 'taxMismatch';

    if (isCancelled(t)) { r.level = 'excluded'; r.note = '취소·마이너스 전표'; return r; }
    if (matchAny(`${t.catName} ${t.merchant}`, ex)) { r.level = 'excluded'; r.note = '제외 업종(주소가 실제 매장 위치가 아님)'; return r; }
    if (isForeign(t)) { r.level = 'excluded'; r.note = '해외·주소 없음'; return r; }
    const home = HOMES[t.user];
    if (!home || home.lat == null) { r.level = 'nohome'; return r; }
    const g = geoFor(t);
    if (!g) { r.level = 'unknown'; r.note = GEO[geoKey(t.addr)] ? '주소 검색 실패' : '좌표 미변환(분석 실행 필요)'; return r; }
    r.geo = g;
    r.dist = haversine(home, g);
    if (office) r.officeDist = haversine(office, g);
    r.level = r.dist <= S.r1 ? 'near' : r.dist <= S.r2 ? 'warn' : 'ok';
    // 집보다 회사에 더 가깝고 회사 반경 안이면 업무 사용으로 분류
    if (office && r.level !== 'ok' && r.officeDist <= S.officeR && r.officeDist < r.dist) r.level = 'office';
    if (g.precision !== '정확') r.flags.push(g.precision);
    return r;
  });

  // 같은 집근처 가맹점 반복 이용
  const rep = {};
  for (const r of rows) if (r.level === 'near') {
    const k = r.user + '|' + r.geo.lat.toFixed(5) + ',' + r.geo.lng.toFixed(5);
    (rep[k] = rep[k] || []).push(r);
  }
  for (const k in rep) if (rep[k].length >= 3) rep[k].forEach(r => { r.repeat = rep[k].length; });

  for (const r of rows) {
    if (r.level === 'near' || r.level === 'warn') {
      r.score = r.level === 'near' ? 50 : 20;
      if (r.offday) { r.score += 20; r.flags.unshift(r.holidayName || r.offType); }
      if (r.night) { r.score += 15; r.flags.unshift('심야'); }
      if (r.risky) { r.score += 15; r.flags.unshift('고위험업종'); }
      if (r.repeat) { r.score += 10; r.flags.unshift(`반복 ${r.repeat}회`); }
    }
    if (isCancelled(r) || !r.bizFlag) continue;
    if (r.bizFlag === 'afterClose') r.score += 40;
    if (r.bizFlag === 'unregistered') r.score += 20;
    r.flags.unshift(BIZ_FLAGS[r.bizFlag]);
  }
  RESULT = rows;
  return rows;
}

function userList() {
  return [...new Set([...TX.map(t => t.user).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'ko'));
}

// ───────────────────────── 렌더링: 공통 ─────────────────────────
function switchTab(name) {
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  if (name === 'map') renderMap();
  if (name === 'homes') renderHomes();
}

function renderAll() {
  renderSteps();
  renderHomes();
  renderDash();
  renderUserSelects();
  renderHoliday();
  renderBiz();
  renderDetail();
  if ($('#tab-map').classList.contains('active')) renderMap();
}

function renderSteps() {
  const users = userList();
  const homesDone = users.filter(u => HOMES[u] && HOMES[u].lat != null).length;
  const steps = [
    ['카카오지도 연결', kakaoReady, kakaoReady ? '연결됨' : '설정 탭에서 JavaScript 키 입력'],
    ['카드내역 업로드', TX.length > 0, TX.length ? `${TX.length.toLocaleString()}건 · ${users.length}명` : '엑셀/CSV 업로드'],
    ['집주소 등록', users.length > 0 && homesDone === users.length, users.length ? `${homesDone}/${users.length}명 좌표 확보` : '-'],
    ['분석 실행', !!RESULT && !!S.analyzedAt, S.analyzedAt ? new Date(S.analyzedAt).toLocaleString('ko-KR') : '미실행'],
  ];
  $('#steps').innerHTML = steps.map(([t, ok, st], i) =>
    `<div class="step ${ok ? 'done' : ''}"><b>${ok ? '✓' : i + 1}. ${t}</b><span class="st">${esc(st)}</span></div>`).join('');
}

const lvBadge = l => `<span class="lv lv-${l}">${LEVELS[l] || l}</span>`;
const scoreHtml = s => s ? `<span class="score ${s >= 70 ? 'hi' : s >= 50 ? 'mid' : ''}">${s}</span>` : '';
const flagsHtml = r => r.flags.map(f => `<span class="tag ${/심야|고위험|반복|주말|요일|휴|절|날|설|추석|선거|폐업|미등록/.test(f) ? 'red' : ''}">${esc(f)}</span>`).join('');

// ───────────────────────── 렌더링: 집주소 ─────────────────────────
function renderHomes() {
  const users = userList();
  const extra = Object.keys(HOMES).filter(n => !users.includes(n) && HOMES[n].addr);
  const all = [...users, ...extra];
  const cards = {}, counts = {};
  for (const t of TX) {
    (cards[t.user] = cards[t.user] || new Set()).add(t.card);
    counts[t.user] = (counts[t.user] || 0) + 1;
  }
  const tbl = $('#homeTable');
  if (!all.length) { tbl.innerHTML = '<tr><td class="muted">카드내역을 업로드하면 이용자가 표시됩니다.</td></tr>'; return; }
  tbl.innerHTML = `<thead><tr><th>이용자명</th><th>카드번호</th><th class="num">건수</th><th>집주소</th><th>좌표 상태</th><th>검색된 주소</th><th></th></tr></thead><tbody>` +
    all.map(n => {
      const h = HOMES[n] || { addr: '' };
      const st = h.lat != null ? `<span class="ok-txt">✓ ${esc(h.precision || '')}</span>` : h.fail ? '<span class="err-txt">검색 실패</span>' : h.addr ? '<span class="muted">미변환</span>' : '<span class="muted">미입력</span>';
      return `<tr data-user="${esc(n)}"><td><b>${esc(n)}</b></td><td>${esc([...(cards[n] || [])].join(', '))}</td><td class="num">${counts[n] || 0}</td>
        <td><input type="text" class="home-addr" value="${esc(h.addr)}" placeholder="예) 서울 송파구 올림픽로 300"></td>
        <td>${st}</td><td class="muted">${esc(h.matched || '')}</td>
        <td><button class="btn small geo-one">변환</button></td></tr>`;
    }).join('') + '</tbody>';
}

function onHomeInput(e) {
  const tr = e.target.closest('tr');
  const n = tr.dataset.user;
  const addr = e.target.value.trim();
  if ((HOMES[n] || {}).addr === addr) return;
  HOMES[n] = { addr };
  writeLS(LS.homes, HOMES);
  tr.children[4].innerHTML = '<span class="muted">미변환</span>';
  tr.children[5].textContent = '';
  if (S.analyzedAt) { analyze(); renderDash(); renderDetail(); }
  renderSteps();
}

async function geoOne(n) {
  if (!kakaoReady) return toast('카카오지도 연결이 필요합니다');
  const h = HOMES[n];
  if (!h || !h.addr) return toast('주소를 입력하세요');
  apiError = false;
  const r = await geocodeAddress(h.addr);
  HOMES[n] = r.fail ? { addr: h.addr, fail: true } : { addr: h.addr, lat: r.lat, lng: r.lng, matched: r.matched, precision: r.precision };
  writeLS(LS.homes, HOMES);
  toast(!r.fail ? `${n}: ${r.matched}` : apiError ? API_ERROR_MSG : `${n}: 주소를 찾지 못했습니다 — 시·구를 포함해 입력해 보세요`);
  if (S.analyzedAt) analyze();
  renderAll();
}

async function handleHomeFile(file) {
  const sheets = await readSheetRows(file);
  let n = 0;
  for (const rows of sheets) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const hdr = rows[r].map(norm);
      const iu = hdr.findIndex(h => ['이용자명', '이름', '성명', '사용자명', '이용자'].includes(h));
      const ia = hdr.findIndex(h => ['집주소', '주소', '자택주소', '거주지'].includes(h));
      if (iu < 0 || ia < 0) continue;
      for (const row of rows.slice(r + 1)) {
        const name = String(row[iu] || '').trim(), addr = String(row[ia] || '').trim();
        if (!name || !addr) continue;
        if ((HOMES[name] || {}).addr !== addr) HOMES[name] = { addr };
        n++;
      }
      break;
    }
  }
  writeLS(LS.homes, HOMES);
  renderAll();
  toast(n ? `${n}명 집주소 반영 — [집주소 좌표 변환]을 누르세요` : '이용자명/집주소 컬럼을 찾지 못했습니다');
}

function downloadHomeTemplate() {
  const users = userList();
  const data = [['이용자명', '집주소'], ...(users.length ? users : ['홍길동']).map(u => [u, (HOMES[u] || {}).addr || ''])];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, ws, '집주소');
  XLSX.writeFile(wb, '집주소_양식.xlsx');
}

// ───────────────────────── 렌더링: 대시보드 ─────────────────────────
function renderDash() {
  const has = !!RESULT && !!S.analyzedAt;
  $('#dashEmpty').classList.toggle('hidden', has);
  $('#dash').classList.toggle('hidden', !has);
  if (!has) return;
  const R = RESULT;
  const valid = R.filter(r => ['near', 'warn', 'ok', 'office'].includes(r.level));
  const near = R.filter(r => r.level === 'near'), warn = R.filter(r => r.level === 'warn');
  const sum = a => a.reduce((s, r) => s + r.amount, 0);
  const nearOff = near.filter(r => r.offday || r.night);
  const unknown = R.filter(r => r.level === 'unknown' || r.level === 'nohome');
  const pct = (a, b) => b ? `${((a / b) * 100).toFixed(1)}%` : '-';

  $('#kpis').innerHTML = [
    ['전체 거래', `${R.length.toLocaleString()}건`, `${won(sum(R))}원`],
    ['위치 분석 대상', `${valid.length.toLocaleString()}건`, `제외 ${R.filter(r => r.level === 'excluded').length}건 · 불명 ${unknown.length}건`],
    ['집근처 거래', `${near.length}건`, `${won(sum(near))}원 · 금액비중 ${pct(sum(near), sum(valid))}`, true],
    ['주의 반경 거래', `${warn.length}건`, `${won(sum(warn))}원`],
    ['집근처 + 휴일·심야', `${nearOff.length}건`, `${won(sum(nearOff))}원`, true],
    ['회사근처', `${R.filter(r => r.level === 'office').length}건`, S.officeGeo && !S.officeGeo.fail ? `반경 ${S.officeR}m` : '회사주소 미설정'],
  ].map(([k, v, s, alert]) => `<div class="kpi ${alert ? 'alert' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

  // 사용자별
  const by = {};
  for (const r of R) {
    const u = by[r.user] = by[r.user] || { n: 0, amt: 0, vn: 0, vamt: 0, nn: 0, namt: 0, wn: 0, off: 0, maxScore: 0 };
    u.n++; u.amt += r.amount;
    if (['near', 'warn', 'ok', 'office'].includes(r.level)) { u.vn++; u.vamt += r.amount; }
    if (r.level === 'near') { u.nn++; u.namt += r.amount; if (r.offday || r.night) u.off++; }
    if (r.level === 'warn') u.wn++;
    u.maxScore = Math.max(u.maxScore, r.score);
  }
  const users = Object.entries(by).sort((a, b) => b[1].namt - a[1].namt);
  $('#userSummary').innerHTML = `<thead><tr><th>이용자</th><th class="num">거래</th><th class="num">집근처</th><th class="num">집근처 금액</th><th class="num">비중</th><th class="num">주의</th><th class="num">휴일·심야</th><th class="num">최고점수</th></tr></thead><tbody>` +
    users.map(([n, u]) => `<tr class="clickable" data-user="${esc(n)}"><td><b>${esc(n)}</b>${HOMES[n] && HOMES[n].lat != null ? '' : ' <span class="tag">집주소 없음</span>'}</td>
      <td class="num">${u.n}</td><td class="num">${u.nn}</td><td class="num">${won(u.namt)}</td><td class="num">${pct(u.namt, u.vamt)}</td>
      <td class="num">${u.wn}</td><td class="num">${u.off}</td><td class="num">${scoreHtml(u.maxScore)}</td></tr>`).join('') + '</tbody>';

  // 업종
  const cat = {};
  for (const r of near) { const c = r.catName || '(미분류)'; cat[c] = cat[c] || { n: 0, amt: 0 }; cat[c].n++; cat[c].amt += r.amount; }
  const cats = Object.entries(cat).sort((a, b) => b[1].amt - a[1].amt).slice(0, 12);
  const max = Math.max(1, ...cats.map(c => c[1].amt));
  $('#catBars').innerHTML = cats.length ? cats.map(([c, v]) =>
    `<div class="barrow"><span>${esc(c)}</span><div class="track"><div class="fill" style="width:${(v.amt / max) * 100}%"></div></div><span class="val">${won(v.amt)}원 · ${v.n}건</span></div>`).join('')
    : '<p class="muted">집근처 거래가 없습니다.</p>';

  // 가맹점
  const mer = {};
  for (const r of near) {
    const k = r.user + '|' + r.merchant;
    const m = mer[k] = mer[k] || { user: r.user, name: r.merchant, cat: r.catName, dist: r.dist, n: 0, amt: 0 };
    m.n++; m.amt += r.amount;
  }
  const mers = Object.values(mer).sort((a, b) => b.n - a.n || b.amt - a.amt).slice(0, 15);
  $('#topMerchants').innerHTML = `<thead><tr><th>이용자</th><th>가맹점</th><th>업종</th><th class="num">거리</th><th class="num">횟수</th><th class="num">금액</th></tr></thead><tbody>` +
    (mers.length ? mers.map(m => `<tr><td>${esc(m.user)}</td><td>${esc(m.name)}</td><td>${esc(m.cat)}</td><td class="num">${fmtDist(m.dist)}</td><td class="num">${m.n}</td><td class="num">${won(m.amt)}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">없음</td></tr>') + '</tbody>';

  const top = R.filter(r => r.score > 0).sort((a, b) => b.score - a.score || b.amount - a.amount).slice(0, 15);
  $('#topRisk').innerHTML = `<thead><tr><th class="num">점수</th><th>이용자</th><th>일시</th><th>가맹점</th><th class="num">금액</th><th class="num">거리</th><th>플래그</th></tr></thead><tbody>` +
    (top.length ? top.map(r => `<tr><td class="num">${scoreHtml(r.score)}</td><td>${esc(r.user)}</td><td>${esc(r.date)}(${r.dow}) ${esc(r.time.slice(0, 5))}</td><td>${esc(r.merchant)}</td>
      <td class="num">${won(r.amount)}</td><td class="num">${fmtDist(r.dist)}</td><td>${flagsHtml(r)}</td></tr>`).join('')
      : '<tr><td colspan="7" class="muted">없음</td></tr>') + '</tbody>';
}

// ───────────────────────── 렌더링: 상세 ─────────────────────────
const COLS = [
  ['level', '판정', r => LEVEL_ORDER[r.level], r => lvBadge(r.level)],
  ['score', '점수', r => r.score, r => scoreHtml(r.score), 'num'],
  ['user', '이용자', r => r.user],
  ['date', '이용일', r => r.date + ' ' + r.time, r => `${esc(r.date)} <span class="muted">(${r.dow})</span>`],
  ['time', '승인시간', r => r.time],
  ['merchant', '가맹점명', r => r.merchant],
  ['catName', '업종', r => r.catName],
  ['amount', '이용금액', r => r.amount, r => won(r.amount), 'num'],
  ['dist', '집까지', r => r.dist ?? 1e12, r => fmtDist(r.dist), 'num'],
  ['addr', '가맹점 주소', r => r.addr, null, 'wrap'],
  ['flags', '플래그·비고', r => r.flags.join(' ') + r.note, r => flagsHtml(r) + (r.note ? `<span class="muted">${esc(r.note)}</span>` : ''), 'wrap'],
];
let sortState = { key: 'score', dir: -1 };

function filteredRows() {
  if (!RESULT) return [];
  const u = $('#fUser').value, l = $('#fLevel').value, q = $('#fText').value.trim();
  const hol = $('#fHoliday').checked, night = $('#fNight').checked, biz = $('#fBiz').checked;
  const col = COLS.find(c => c[0] === sortState.key);
  return RESULT.filter(r => (!u || r.user === u) && (!l || r.level === l) && (!hol || r.offday) && (!night || r.night) && (!biz || ['afterClose', 'unregistered', 'suspended'].includes(r.bizFlag)) &&
    (!q || `${r.merchant} ${r.addr} ${r.catName}`.includes(q)))
    .sort((a, b) => {
      const x = col[2](a), y = col[2](b);
      return (x > y ? 1 : x < y ? -1 : 0) * sortState.dir || (LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]) || a.date.localeCompare(b.date);
    });
}

function renderDetail() {
  const tbl = $('#detailTable');
  if (!RESULT) { tbl.innerHTML = '<tr><td class="muted">분석을 먼저 실행하세요.</td></tr>'; $('#fCount').textContent = ''; return; }
  const rows = filteredRows();
  const LIMIT = 3000;
  $('#fCount').textContent = `${rows.length.toLocaleString()}건 · ${won(rows.reduce((s, r) => s + r.amount, 0))}원` + (rows.length > LIMIT ? ` (상위 ${LIMIT}건 표시)` : '');
  tbl.innerHTML = '<thead><tr>' + COLS.map(([k, label, , , cls]) =>
    `<th data-key="${k}" class="${cls === 'num' ? 'num' : ''} ${sortState.key === k ? 'sorted' : ''}" data-dir="${sortState.dir > 0 ? '▲' : '▼'}">${label}</th>`).join('') + '</tr></thead><tbody>' +
    rows.slice(0, LIMIT).map(r => '<tr>' + COLS.map(([k, , , html, cls]) =>
      `<td class="${cls || ''}">${html ? html(r) : esc(r[k])}</td>`).join('') + '</tr>').join('') + '</tbody>';
}

function renderUserSelects() {
  const users = userList();
  for (const sel of [$('#fUser'), $('#mapUser'), $('#hUser'), $('#aiUser')]) {
    const cur = sel.value;
    const first = sel.id !== 'mapUser' ? '<option value="">전체 사용자</option>' : '';
    sel.innerHTML = first + users.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
    if (users.includes(cur)) sel.value = cur;
  }
  // 지도 기본값: 집근처가 가장 많은 사용자
  if (RESULT && !$('#mapUser').dataset.touched) {
    const cnt = {};
    RESULT.forEach(r => { if (r.level === 'near') cnt[r.user] = (cnt[r.user] || 0) + 1; });
    const best = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    if (best) $('#mapUser').value = best[0];
  }
}

function exportExcel(rows = filteredRows(), prefix = '법인카드_집근처분석') {
  if (!rows.length) return toast('내보낼 데이터가 없습니다');
  const data = rows.map(r => ({
    '판정': LEVELS[r.level], '위험점수': r.score, '집까지거리(m)': r.dist == null ? '' : Math.round(r.dist),
    '회사까지거리(m)': r.officeDist == null ? '' : Math.round(r.officeDist),
    '요일': r.dow, '휴일구분': r.offType, '휴일명': r.holidayName, '심야': r.night ? 'Y' : '',
    '플래그': r.flags.join(', '), '비고': r.note,
    '사업자상태(국세청)': r.biz ? r.biz.stt : '', '폐업일': r.biz ? r.biz.endDt : '', '휴폐업판정': BIZ_FLAGS[r.bizFlag] || '',
    '국세청과세유형': r.biz ? r.biz.taxType : '',
    '순번': r.seq, '카드번호': r.card, '이용자명': r.user, '이용일': r.date, '가맹점명': r.merchant, '이용금액': r.amount,
    '가맹점 주소': r.addr, '사업자 등록번호': r.bizno, '승인번호': r.approval, '과세유형': r.taxType, '전표구분': r.slip,
    '미화금액': r.usd, '미화환율': r.fx, '승인시간': r.time, '가맹점업종코드': r.catCode, '가맹점업종명': r.catName,
    '유종': r.fuel, '리터당단가': r.unitPrice,
    '좌표검색주소': r.geo ? r.geo.matched : '', '좌표정확도': r.geo ? r.geo.precision : '',
    '위도': r.geo ? r.geo.lat : '', '경도': r.geo ? r.geo.lng : '',
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), '분석결과');
  const sumRows = {};
  for (const r of RESULT) {
    const u = sumRows[r.user] = sumRows[r.user] || { '이용자명': r.user, '집주소': (HOMES[r.user] || {}).addr || '', '전체건수': 0, '전체금액': 0, '집근처건수': 0, '집근처금액': 0, '주의건수': 0, '주의금액': 0, '집근처_휴일심야건수': 0 };
    u['전체건수']++; u['전체금액'] += r.amount;
    if (r.level === 'near') { u['집근처건수']++; u['집근처금액'] += r.amount; if (r.offday || r.night) u['집근처_휴일심야건수']++; }
    if (r.level === 'warn') { u['주의건수']++; u['주의금액'] += r.amount; }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(sumRows)), '사용자별요약');
  const d = new Date();
  XLSX.writeFile(wb, `${prefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`);
}

// ───────────────────────── 렌더링: 휴폐업 ─────────────────────────
function renderBiz() {
  const { all, todo } = bizTargets(false);
  const invalid = new Set(TX.map(t => bizNo(t.bizno)).filter(b => b && b.length !== 10)).size;
  const noNum = TX.filter(t => !bizNo(t.bizno)).length;
  $('#bizInfo').innerHTML = !TX.length ? '카드내역을 먼저 업로드하세요.' :
    `사업자번호 ${all.length}개 중 ${all.length - todo.length}개 조회됨` +
    (todo.length ? ` · <b>미조회 ${todo.length}개</b>` : '') +
    (S.bizCheckedAt ? ` · 마지막 조회 ${new Date(S.bizCheckedAt).toLocaleString('ko-KR')}` : '') +
    (invalid ? ` · 형식 오류 ${invalid}개` : '') + (noNum ? ` · 사업자번호 없는 거래 ${noNum}건` : '');
  const has = !!RESULT && Object.keys(BIZ).length > 0 && all.some(b => BIZ[b]);
  $('#bizEmpty').classList.toggle('hidden', has);
  $('#bizBody').classList.toggle('hidden', !has);
  if (!has) return;

  const rows = RESULT.filter(r => !isCancelled(r) && r.biz);
  const sum = a => a.reduce((s, r) => s + r.amount, 0);
  const of = f => rows.filter(r => r.bizFlag === f);
  const nums = new Set(rows.map(r => bizNo(r.bizno)));
  const cnt = cd => [...nums].filter(b => BIZ[b] && BIZ[b].cd === cd).length;
  const after = of('afterClose'), unreg = of('unregistered'), susp = of('suspended'), later = of('closedLater');
  $('#bizKpis').innerHTML = [
    ['조회된 가맹점', `${nums.size}곳`, `계속 ${cnt('01')} · 휴업 ${cnt('02')} · 폐업 ${cnt('03')} · 미등록 ${cnt('')}`],
    ['폐업 후 거래', `${after.length}건`, `${won(sum(after))}원`, true],
    ['미등록 사업자 거래', `${unreg.length}건`, `${won(sum(unreg))}원`, true],
    ['현재 휴업 가맹점 거래', `${susp.length}건`, `${won(sum(susp))}원`],
    ['거래 후 폐업', `${later.length}건`, `${won(sum(later))}원`],
    ['과세유형 불일치', `${of('taxMismatch').length}건`, '참고용'],
  ].map(([k, v, s, alert]) => `<div class="kpi ${alert ? 'alert' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

  // 사업자번호별로 묶고 가장 심각한 판정을 대표값으로
  const g = {};
  for (const r of rows) {
    const b = bizNo(r.bizno);
    const x = g[b] = g[b] || { b, biz: r.biz, names: new Set(), cardTax: r.taxType, n: 0, amt: 0, first: r.date, last: r.date, flag: r.bizFlag, users: new Set(), badN: 0 };
    x.names.add(r.merchant); x.users.add(r.user);
    x.n++; x.amt += r.amount;
    if (r.date < x.first) x.first = r.date;
    if (r.date > x.last) x.last = r.date;
    if (BIZ_ORDER[r.bizFlag] < BIZ_ORDER[x.flag]) x.flag = r.bizFlag;
    if (r.bizFlag === 'afterClose') x.badN++;
  }
  const onlyIssue = $('#bizFilter').value === 'issue';
  const list = Object.values(g).filter(x => !onlyIssue || x.flag).sort((a, b) => BIZ_ORDER[a.flag] - BIZ_ORDER[b.flag] || b.amt - a.amt);
  const sttTag = x => `<span class="tag ${x.biz.cd === '01' ? '' : 'red'}">${esc(x.biz.stt)}</span>`;
  $('#bizTable').innerHTML = `<thead><tr><th>판정</th><th>가맹점명</th><th>사업자번호</th><th>국세청 상태</th><th>폐업일</th><th>국세청 과세유형</th><th>카드 과세유형</th><th class="num">거래</th><th class="num">금액</th><th>첫 거래</th><th>마지막 거래</th><th>이용자</th></tr></thead><tbody>` +
    (list.length ? list.map(x => `<tr class="clickable" data-biz="${esc(x.b)}">
      <td>${x.flag ? `<span class="tag ${['afterClose', 'unregistered', 'suspended'].includes(x.flag) ? 'red' : ''}">${BIZ_FLAGS[x.flag]}${x.flag === 'afterClose' ? ` ${x.badN}건` : ''}</span>` : '<span class="ok-txt">정상</span>'}</td>
      <td>${esc([...x.names].join(', '))}</td><td>${esc(x.b.replace(/(\d{3})(\d{2})(\d{5})/, '$1-$2-$3'))}</td><td>${sttTag(x)}</td>
      <td>${esc(x.biz.endDt)}</td><td class="wrap">${esc(x.biz.taxType)}</td><td>${esc(x.cardTax)}</td>
      <td class="num">${x.n}</td><td class="num">${won(x.amt)}</td><td>${esc(x.first)}</td><td>${esc(x.last)}</td><td>${esc([...x.users].join(', '))}</td></tr>`).join('')
      : `<tr><td colspan="12" class="muted">${onlyIssue ? '문제 있는 가맹점이 없습니다. ✓' : '없음'}</td></tr>`) + '</tbody>';
}

// ───────────────────────── 렌더링: 휴일 사용 ─────────────────────────
// 휴일 분석은 날짜만 쓰므로 카카오 좌표 변환 전에도 동작한다
let holDate = '';
const isHolSuspect = r => r.level === 'near' || r.level === 'warn' || r.night || r.risky;

function renderHoliday() {
  const has = !!RESULT && RESULT.length > 0;
  $('#holEmpty').classList.toggle('hidden', has);
  $('#hol').classList.toggle('hidden', !has);
  if (!has) return;

  const u = $('#hUser').value, ty = $('#hType').value, suspect = $('#hSuspect').checked;
  const base = RESULT.filter(r => !isCancelled(r) && (!u || r.user === u));
  const off = base.filter(r => r.offday && (!ty || r.offType === ty) && (!suspect || isHolSuspect(r)));
  const offSet = new Set(off);
  const sum = a => a.reduce((s, r) => s + r.amount, 0);
  const pct = (a, b) => b ? `${((a / b) * 100).toFixed(1)}%` : '-';
  const located = !!S.analyzedAt;

  $('#hRule').textContent = `휴일 기준: 공휴일·일요일${S.satOff ? '·토요일' : ''}${S.laborDay ? '·근로자의날' : ''}${S.holidays ? '·추가휴일' : ''}`;

  const weekday = base.filter(r => !r.offday);
  const avg = a => a.length ? sum(a) / a.length : 0;
  const near = off.filter(r => r.level === 'near'), night = off.filter(r => r.night), risky = off.filter(r => r.risky);
  const days = new Set(off.map(r => r.user + '|' + r.date));
  $('#hKpis').innerHTML = [
    ['휴일 사용', `${off.length}건`, `${won(sum(off))}원 · 전체 금액의 ${pct(sum(off), sum(base))}`, true],
    ['휴일 사용일수', `${new Set(off.map(r => r.date)).size}일`, `사용자·일 기준 ${days.size}건`],
    ['건당 평균', `${won(avg(off))}원`, `평일 ${won(avg(weekday))}원`],
    ['휴일 + 집근처', located ? `${near.length}건` : '-', located ? `${won(sum(near))}원` : '위치 분석 실행 후 표시', true],
    ['휴일 + 심야', `${night.length}건`, `${won(sum(night))}원`],
    ['휴일 + 고위험업종', `${risky.length}건`, `${won(sum(risky))}원`],
  ].map(([k, v, s, alert]) => `<div class="kpi ${alert ? 'alert' : ''}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');

  // 사용자별
  const by = {};
  for (const r of base) {
    const x = by[r.user] = by[r.user] || { n: 0, amt: 0, hn: 0, hamt: 0, days: new Set(), near: 0, cats: {} };
    x.n++; x.amt += r.amount;
    if (!offSet.has(r)) continue;
    x.hn++; x.hamt += r.amount; x.days.add(r.date);
    if (r.level === 'near') x.near++;
    x.cats[r.catName || '(미분류)'] = (x.cats[r.catName || '(미분류)'] || 0) + r.amount;
  }
  const users = Object.entries(by).filter(([, x]) => x.hn).sort((a, b) => b[1].hamt - a[1].hamt);
  $('#hUsers').innerHTML = `<thead><tr><th>이용자</th><th class="num">휴일 건수</th><th class="num">휴일 금액</th><th class="num">금액 비중</th><th class="num">사용일수</th><th class="num">집근처</th><th>주요 업종</th></tr></thead><tbody>` +
    (users.length ? users.map(([n, x]) => {
      const topCat = Object.entries(x.cats).sort((a, b) => b[1] - a[1])[0];
      return `<tr class="clickable" data-user="${esc(n)}"><td><b>${esc(n)}</b></td><td class="num">${x.hn}</td><td class="num">${won(x.hamt)}</td>
        <td class="num">${pct(x.hamt, x.amt)}</td><td class="num">${x.days.size}</td><td class="num">${located ? x.near : '-'}</td><td>${esc(topCat ? topCat[0] : '')}</td></tr>`;
    }).join('') : '<tr><td colspan="7" class="muted">휴일 거래가 없습니다.</td></tr>') + '</tbody>';

  // 업종별
  const cat = {};
  for (const r of off) { const c = r.catName || '(미분류)'; cat[c] = cat[c] || { n: 0, amt: 0 }; cat[c].n++; cat[c].amt += r.amount; }
  const cats = Object.entries(cat).sort((a, b) => b[1].amt - a[1].amt).slice(0, 12);
  const cmax = Math.max(1, ...cats.map(c => c[1].amt));
  $('#hCats').innerHTML = cats.length ? cats.map(([c, v]) =>
    `<div class="barrow"><span>${esc(c)}</span><div class="track"><div class="fill" style="width:${(v.amt / cmax) * 100}%"></div></div><span class="val">${won(v.amt)}원 · ${v.n}건</span></div>`).join('')
    : '<p class="muted">없음</p>';

  // 날짜별
  const byDate = {};
  for (const r of off) {
    const x = byDate[r.date] = byDate[r.date] || { dow: r.dow, label: r.holidayName || r.offType, n: 0, amt: 0, users: new Set(), sus: 0 };
    x.n++; x.amt += r.amount; x.users.add(r.user);
    if (isHolSuspect(r)) x.sus++;
  }
  const dates = Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]));
  $('#hDates').innerHTML = `<thead><tr><th>날짜</th><th>구분</th><th class="num">건수</th><th class="num">금액</th><th class="num">의심</th><th>이용자</th></tr></thead><tbody>` +
    (dates.length ? dates.map(([d, x]) => `<tr class="clickable ${d === holDate ? 'sel' : ''}" data-date="${esc(d)}"><td>${esc(d)} (${x.dow})</td><td><span class="tag red">${esc(x.label)}</span></td>
      <td class="num">${x.n}</td><td class="num">${won(x.amt)}</td><td class="num">${x.sus || ''}</td><td>${esc([...x.users].join(', '))}</td></tr>`).join('')
      : '<tr><td colspan="6" class="muted">없음</td></tr>') + '</tbody>';

  // 월별 (휴일 금액 + 그 달 전체 대비 비중)
  const mon = {};
  for (const r of base) {
    const m = r.date.slice(0, 7);
    const x = mon[m] = mon[m] || { amt: 0, hamt: 0, hn: 0 };
    x.amt += r.amount;
    if (offSet.has(r)) { x.hamt += r.amount; x.hn++; }
  }
  const months = Object.entries(mon).sort((a, b) => a[0].localeCompare(b[0]));
  const mmax = Math.max(1, ...months.map(m => m[1].hamt));
  $('#hMonths').innerHTML = months.length ? months.map(([m, x]) =>
    `<div class="barrow"><span>${esc(m)}</span><div class="track"><div class="fill hol" style="width:${(x.hamt / mmax) * 100}%"></div></div><span class="val">${won(x.hamt)}원 · ${x.hn}건 (${pct(x.hamt, x.amt)})</span></div>`).join('')
    : '<p class="muted">없음</p>';

  // 거래 목록
  if (holDate && !byDate[holDate]) holDate = '';
  $('#hDateTag').innerHTML = holDate ? `<span class="tag">${esc(holDate)}만 보기</span> <button class="btn small" id="hDateClear">해제</button>` : '';
  const list = off.filter(r => !holDate || r.date === holDate)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  $('#hCount').textContent = `${list.length}건 · ${won(sum(list))}원`;
  $('#hTable').innerHTML = `<thead><tr><th>이용일</th><th>구분</th><th>승인시간</th><th>이용자</th><th>가맹점명</th><th>업종</th><th class="num">이용금액</th><th>위치판정</th><th class="num">집까지</th><th>플래그</th><th>가맹점 주소</th></tr></thead><tbody>` +
    (list.length ? list.slice(0, 3000).map(r => `<tr><td>${esc(r.date)} (${r.dow})</td><td><span class="tag red">${esc(r.holidayName || r.offType)}</span></td>
      <td>${esc(r.time)}${r.night ? ' <span class="tag red">심야</span>' : ''}</td><td>${esc(r.user)}</td><td>${esc(r.merchant)}</td><td>${esc(r.catName)}${r.risky ? ' <span class="tag red">고위험</span>' : ''}</td>
      <td class="num">${won(r.amount)}</td><td>${lvBadge(r.level)}</td><td class="num">${fmtDist(r.dist)}</td><td>${flagsHtml(r)}</td><td class="wrap">${esc(r.addr)}</td></tr>`).join('')
      : '<tr><td colspan="11" class="muted">없음</td></tr>') + '</tbody>';
  renderHoliday.rows = list;
}

// ───────────────────────── 렌더링: 지도 ─────────────────────────
let map = null, overlays = [];

function renderMap() {
  const msg = $('#mapMsg');
  const show = text => { msg.textContent = text; msg.classList.remove('hidden'); };
  if (!kakaoReady) return show('설정 탭에서 카카오 JavaScript 키를 연결하세요.');
  if (!RESULT || !S.analyzedAt) return show('분석을 먼저 실행하세요.');
  const user = $('#mapUser').value;
  const home = HOMES[user];
  if (!home || home.lat == null) { clearMap(); $('#mapList').innerHTML = ''; return show(`${user || '선택한 사용자'}의 집주소 좌표가 없습니다.`); }
  msg.classList.add('hidden');

  if (!map) {
    map = new kakao.maps.Map($('#map'), { center: new kakao.maps.LatLng(home.lat, home.lng), level: 5 });
    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  }
  map.relayout();
  clearMap();

  const homePos = new kakao.maps.LatLng(home.lat, home.lng);
  const circle = (pos, r, color, fill) => overlays.push(new kakao.maps.Circle({
    map, center: pos, radius: r, strokeWeight: 2, strokeColor: color, strokeOpacity: .8, strokeStyle: 'dash', fillColor: color, fillOpacity: fill,
  }));
  circle(homePos, S.r2, '#f59e0b', .05);
  circle(homePos, S.r1, '#e5484d', .1);
  overlays.push(new kakao.maps.CustomOverlay({ map, position: homePos, yAnchor: 1.4, zIndex: 10, content: `<div class="home-mk">🏠 ${esc(user)} 집</div>` }));

  const office = S.officeGeo && !S.officeGeo.fail ? S.officeGeo : null;
  if (office) {
    const op = new kakao.maps.LatLng(office.lat, office.lng);
    circle(op, S.officeR, '#8b5cf6', .05);
    overlays.push(new kakao.maps.CustomOverlay({ map, position: op, yAnchor: 1.4, zIndex: 9, content: '<div class="home-mk office-mk">🏢 회사</div>' }));
  }

  // 같은 좌표의 거래를 묶어 하나의 마커로
  const onlyFlag = $('#mapFilter').value === 'flag';
  const groups = {};
  for (const r of RESULT) {
    if (r.user !== user || !r.geo || r.dist == null) continue;
    if (onlyFlag && !['near', 'warn'].includes(r.level)) continue;
    const k = r.geo.lat.toFixed(5) + ',' + r.geo.lng.toFixed(5);
    const g = groups[k] = groups[k] || { geo: r.geo, rows: [], level: r.level, dist: r.dist };
    g.rows.push(r);
    if (LEVEL_ORDER[r.level] < LEVEL_ORDER[g.level]) g.level = r.level;
  }
  const list = Object.values(groups).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.dist - b.dist);
  const bounds = new kakao.maps.LatLngBounds();
  bounds.extend(homePos);
  for (const g of list) {
    const el = document.createElement('div');
    el.className = 'mk';
    el.style.position = 'relative';
    el.title = g.rows[0].merchant;
    el.innerHTML = `<span class="dot lvl-${g.level}"></span>${g.rows.length > 1 ? `<span class="cnt">${g.rows.length}</span>` : ''}`;
    el.addEventListener('click', () => showGroup(g));
    g.pos = new kakao.maps.LatLng(g.geo.lat, g.geo.lng);
    overlays.push(new kakao.maps.CustomOverlay({ map, position: g.pos, content: el, zIndex: 5 - LEVEL_ORDER[g.level] }));
    if (!onlyFlag || g.level !== 'ok') bounds.extend(g.pos);
  }
  map.setBounds(bounds, 40, 40, 40, 40);

  $('#mapList').innerHTML = list.length ? list.map((g, i) => {
    const amt = g.rows.reduce((s, r) => s + r.amount, 0);
    return `<div class="map-item" data-i="${i}"><div class="t"><span>${esc(g.rows[0].merchant)}</span>${lvBadge(g.level)}</div>
      <div class="d">${fmtDist(g.dist)} · ${g.rows.length}건 · ${won(amt)}원 · ${esc(g.rows[0].catName)}</div></div>`;
  }).join('') : '<p class="muted">표시할 가맹점이 없습니다.</p>';
  $$('#mapList .map-item').forEach(el => el.addEventListener('click', () => {
    const g = list[+el.dataset.i];
    map.setLevel(3);
    map.panTo(g.pos);
    showGroup(g);
  }));
  $('#mapDetail').classList.add('hidden');
}

function clearMap() { overlays.forEach(o => o.setMap(null)); overlays = []; }

function showGroup(g) {
  const box = $('#mapDetail');
  const r0 = g.rows[0];
  box.innerHTML = `<div class="row between"><h2>${esc(r0.merchant)} ${lvBadge(g.level)}</h2><span class="muted">집까지 ${fmtDist(g.dist)}</span></div>
    <p class="muted">카드사 주소: ${esc(r0.addr)}<br>좌표 기준: ${esc(g.geo.matched)} (${esc(g.geo.precision)}, ${esc(g.geo.method)})</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>이용일</th><th>승인시간</th><th>업종</th><th class="num">금액</th><th class="num">점수</th><th>플래그</th></tr></thead><tbody>` +
    g.rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(r =>
      `<tr><td>${esc(r.date)} (${r.dow})</td><td>${esc(r.time)}</td><td>${esc(r.catName)}</td><td class="num">${won(r.amount)}</td><td class="num">${scoreHtml(r.score)}</td><td>${flagsHtml(r)}</td></tr>`).join('') +
    '</tbody></table></div>';
  box.classList.remove('hidden');
}

// ───────────────────────── AI 요약·보고서 (Gemini) ─────────────────────────
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
let aiAbort = null;
let AI_LAST = readLS(LS.ai, null); // { kind, title, md, model, at }

function geminiError(status, msg) {
  if (status === 400 && /API key/i.test(msg)) return 'Gemini API 키가 올바르지 않습니다 — 설정에서 키를 확인하세요';
  if (status === 403) return `Gemini 접근 거부 — 키 권한 또는 사용 지역을 확인하세요 (${msg})`;
  if (status === 404) return `사용 가능한 Gemini 모델을 찾지 못했습니다 — 설정에서 [모델 목록 불러오기] 후 모델을 직접 고르세요 (${msg})`;
  if (status === 429) return 'Gemini 사용량 한도 초과 — 잠시 후 다시 시도하거나 flash 계열 모델을 고르세요';
  if (status >= 500) return `Gemini 서버 오류(${status}) — 잠시 후 다시 시도하세요`;
  return `Gemini 오류(${status}): ${msg}`;
}

async function geminiFetch(path, opts = {}) {
  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/${path}`, { ...opts, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.geminiKey } });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Gemini 서버에 연결할 수 없습니다 — 네트워크·방화벽을 확인하세요');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error.message || msg; } catch { /* 본문 없음 */ }
    const err = new Error(geminiError(res.status, msg));
    err.status = res.status;
    throw err;
  }
  return res;
}

// 구글은 구형 모델을 주기적으로 종료하므로, 쓸 수 있는 모델 중 최신 안정판 flash를 우선한다
function rankModels(models, exclude = []) {
  const ver = id => +((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const score = id => (id === 'gemini-flash-latest' ? 1000 : 0) + (/flash/.test(id) ? 100 : 0)
    - (/lite/.test(id) ? 30 : 0) - (/preview|exp/.test(id) ? 50 : 0) + ver(id) * 10;
  return models.filter(m => !exclude.includes(m.id)).sort((a, b) => score(b.id) - score(a.id));
}

async function switchToAvailableModel(exclude) {
  const models = await loadGeminiModels();
  const next = rankModels(models, exclude)[0];
  if (!next) return null;
  S.geminiModel = next.id;
  writeLS(LS.settings, S);
  fillModelSelect(models);
  setAiBadge('on');
  return next.id;
}

async function loadGeminiModels() {
  const j = await (await geminiFetch('models?pageSize=200')).json();
  return (j.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name) && !/tts|image|embedding|audio|live|robotics/i.test(m.name))
    .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || '' }));
}

function fillModelSelect(models) {
  const list = models && models.length ? [...models] : [];
  if (!list.some(m => m.id === S.geminiModel)) list.unshift({ id: S.geminiModel, label: '' });
  $('#sGeminiModel').innerHTML = list.map(m => `<option value="${esc(m.id)}">${esc(m.id)}${m.label && m.label !== m.id ? ` — ${esc(m.label)}` : ''}</option>`).join('');
  $('#sGeminiModel').value = S.geminiModel;
}

function setAiBadge(state) {
  const b = $('#aiBadge');
  b.className = 'badge ' + (state === 'on' ? 'badge-on' : state === 'err' ? 'badge-err' : 'badge-off');
  b.textContent = state === 'on' ? `AI 연결됨 · ${S.geminiModel}` : state === 'err' ? 'AI 연결 실패' : S.geminiKey ? 'AI 키 등록됨' : 'AI 미연결';
}

async function saveGeminiKey() {
  S.geminiKey = $('#sGeminiKey').value.trim();
  writeLS(LS.settings, S);
  if (!S.geminiKey) { setAiBadge('off'); return toast('Gemini 키를 입력하세요'); }
  try {
    const models = await loadGeminiModels();
    if (models.length && !models.some(m => m.id === S.geminiModel)) {
      S.geminiModel = rankModels(models)[0].id;
      writeLS(LS.settings, S);
    }
    fillModelSelect(models);
    setAiBadge('on');
    toast(`Gemini 연결 성공 — 사용 가능 모델 ${models.length}개`);
  } catch (e) {
    setAiBadge('err');
    toast(e.message);
  }
}

async function geminiStream(system, prompt, onText, signal) {
  const res = await geminiFetch(`models/${encodeURIComponent(S.geminiModel)}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', finish = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      let j;
      try { j = JSON.parse(line.slice(5)); } catch { continue; }
      if (j.promptFeedback && j.promptFeedback.blockReason) throw new Error(`요청이 차단되었습니다 (${j.promptFeedback.blockReason})`);
      const c = (j.candidates || [])[0];
      if (!c) continue;
      for (const p of (c.content && c.content.parts) || []) if (p.text && !p.thought) { text += p.text; onText(text); }
      if (c.finishReason) finish = c.finishReason;
    }
  }
  if (!text) throw new Error(`AI가 빈 응답을 보냈습니다 (${finish || '원인 불명'})`);
  if (finish === 'MAX_TOKENS') text += '\n\n> ⚠ 응답 길이 한도에 도달해 뒷부분이 잘렸습니다. 분량을 줄여 다시 시도하세요.';
  return text;
}

// AI에 보낼 데이터: 집계 수치와 의심 거래만. 집주소·카드번호·가맹점 주소는 보내지 않는다.
function aiPayload() {
  if (!RESULT || !RESULT.length) return null;
  const onlyUser = $('#aiUser').value, mask = $('#aiMask').checked;
  const rows = RESULT.filter(r => !isCancelled(r) && (!onlyUser || r.user === onlyUser));
  if (!rows.length) return null;
  const names = [...new Set(rows.map(r => r.user))].sort((a, b) => a.localeCompare(b, 'ko'));
  const w = Math.max(2, String(names.length).length);
  const alias = {};
  names.forEach((n, i) => { alias[n] = mask ? `직원${String(i + 1).padStart(w, '0')}` : n; });

  const sum = a => a.reduce((s, r) => s + r.amount, 0);
  const pct = (a, b) => b ? +((a / b) * 100).toFixed(1) : 0;
  const avg = a => a.length ? Math.round(sum(a) / a.length) : 0;
  const located = !!S.analyzedAt, bizDone = !!S.bizCheckedAt;
  const valid = rows.filter(r => ['near', 'warn', 'ok', 'office'].includes(r.level));
  const near = rows.filter(r => r.level === 'near'), warn = rows.filter(r => r.level === 'warn');
  const off = rows.filter(r => r.offday), wk = rows.filter(r => !r.offday);
  const flagged = f => rows.filter(r => r.bizFlag === f);
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const catTop = arr => {
    const m = {};
    arr.forEach(r => { const c = r.catName || '(미분류)'; m[c] = m[c] || { 업종: c, 건수: 0, 금액: 0 }; m[c].건수++; m[c].금액 += r.amount; });
    return Object.values(m).sort((a, b) => b.금액 - a.금액).slice(0, 8);
  };
  const tx = r => ({
    이용자: alias[r.user], 일자: r.date, 요일: r.dow, 시각: r.time.slice(0, 5), 가맹점: r.merchant, 업종: r.catName, 금액: r.amount,
    집까지거리m: r.dist == null ? null : Math.round(r.dist), 위치판정: LEVELS[r.level], 휴일: r.offType ? (r.holidayName || r.offType) : '',
    위험점수: r.score, 플래그: r.flags,
  });
  const bizGroups = {};
  for (const r of rows.filter(r => ['afterClose', 'unregistered', 'suspended'].includes(r.bizFlag))) {
    const k = bizNo(r.bizno);
    const g = bizGroups[k] = bizGroups[k] || { 가맹점: r.merchant, 업종: r.catName, 국세청상태: r.biz.stt, 폐업일: r.biz.endDt || null, 판정: BIZ_FLAGS[r.bizFlag], 거래건수: 0, 금액: 0, 이용자: new Set() };
    g.거래건수++; g.금액 += r.amount; g.이용자.add(alias[r.user]);
  }

  return {
    alias,
    payload: {
      분석기준: {
        집근처반경m: S.r1, 주의반경m: S.r2, 심야시간: `${S.nightFrom}~${S.nightTo}`,
        휴일기준: `공휴일·일요일${S.satOff ? '·토요일' : ''}${S.laborDay ? '·근로자의날' : ''}${S.holidays ? '·회사지정휴일' : ''}`,
        위험점수산정: '집근처+50, 주의반경+20, (집근처·주의일 때) 휴일+20·심야+15·고위험업종+15·같은가맹점3회이상+10, 폐업후거래+40, 미등록사업자+20',
      },
      분석기간: { 시작: dates[0], 종료: dates[dates.length - 1] },
      분석범위: onlyUser ? `이용자 1명(${alias[onlyUser]})` : `전체 이용자 ${names.length}명`,
      분석상태: { 집근처위치분석: located ? '완료' : '미실행', 휴폐업조회: bizDone ? '완료' : '미실행' },
      전체: { 거래건수: rows.length, 총금액: sum(rows), 이용자수: names.length },
      집근처분석: located ? {
        위치분석대상건수: valid.length, 제외건수: rows.length - valid.length,
        집근처건수: near.length, 집근처금액: sum(near), 집근처금액비중pct: pct(sum(near), sum(valid)),
        주의반경건수: warn.length, 주의반경금액: sum(warn),
        집근처중_휴일또는심야건수: near.filter(r => r.offday || r.night).length, 집근처_업종상위: catTop(near),
      } : null,
      휴일분석: {
        휴일건수: off.length, 휴일금액: sum(off), 휴일금액비중pct: pct(sum(off), sum(rows)),
        휴일건당평균: avg(off), 평일건당평균: avg(wk), 휴일사용일수: new Set(off.map(r => r.date)).size,
        휴일심야건수: off.filter(r => r.night).length, 휴일_업종상위: catTop(off),
      },
      휴폐업분석: bizDone ? {
        폐업후거래: { 건수: flagged('afterClose').length, 금액: sum(flagged('afterClose')) },
        미등록사업자거래: { 건수: flagged('unregistered').length, 금액: sum(flagged('unregistered')) },
        현재휴업가맹점거래: { 건수: flagged('suspended').length, 금액: sum(flagged('suspended')) },
        문제가맹점: Object.values(bizGroups).sort((a, b) => b.금액 - a.금액).slice(0, 20).map(g => ({ ...g, 이용자: [...g.이용자] })),
      } : null,
      이용자별: names.map(n => {
        const a = rows.filter(r => r.user === n), an = a.filter(r => r.level === 'near'), ao = a.filter(r => r.offday);
        return {
          이용자: alias[n], 거래건수: a.length, 총금액: sum(a),
          집근처건수: located ? an.length : null, 집근처금액: located ? sum(an) : null,
          집근처중_휴일심야건수: located ? an.filter(r => r.offday || r.night).length : null,
          휴일건수: ao.length, 휴일금액: sum(ao), 휴일금액비중pct: pct(sum(ao), sum(a)),
          폐업후거래건수: bizDone ? a.filter(r => r.bizFlag === 'afterClose').length : null,
          최고위험점수: Math.max(0, ...a.map(r => r.score)),
        };
      }).sort((a, b) => b.최고위험점수 - a.최고위험점수 || b.총금액 - a.총금액).slice(0, 50),
      위험거래상위: rows.filter(r => r.score > 0).sort((a, b) => b.score - a.score || b.amount - a.amount).slice(0, 30).map(tx),
    },
  };
}

// 가명 → 실명 복원 (긴 가명부터 바꿔 '직원1'이 '직원10'을 건드리지 않게)
function unmask(text, alias) {
  return Object.entries(alias).sort((a, b) => b[1].length - a[1].length)
    .reduce((t, [real, fake]) => real === fake ? t : t.split(fake).join(real), text);
}

const AI_SYSTEM = `당신은 한국 기업의 내부감사 전문가입니다. 법인카드 이상징후 탐지 결과(JSON)를 바탕으로 문서를 작성합니다.
규칙:
- JSON에 있는 수치와 사실만 사용하고, 없는 수치·사례·원인을 지어내지 마십시오. 값이 null이거나 분석상태가 '미실행'이면 "분석 미실행"이라고 쓰십시오.
- 금액은 천 단위 콤마와 '원'(예: 1,234,000원), 비율은 소수 첫째 자리까지 쓰십시오.
- 탐지 결과는 '의심' 단계입니다. 사적 사용으로 단정하지 말고 소명 확인이 필요하다는 관점을 유지하십시오.
- 이용자는 JSON에 적힌 표기(예: 직원01)를 그대로 쓰십시오.
- 한국어 마크다운으로만 출력하고, 전체를 코드블록으로 감싸지 마십시오.`;

function summaryPrompt(payload) {
  return `다음 법인카드 이상징후 탐지 결과를 감사 담당자가 3분 안에 파악할 수 있도록 요약하세요.

형식:
## 한 줄 요약
## 핵심 이상징후
(중요도 순 최대 5개, 각 항목에 근거 수치)
## 우선 소명 확인 대상
(표: 이용자 | 사유 | 관련 건수·금액 | 우선순위(상/중/하))
## 권장 조치
(3~5개)

데이터:
${JSON.stringify(payload)}`;
}

function reportPrompt(payload) {
  const len = { short: 'A4 1페이지 이내. 각 장을 2~3줄로 압축', standard: 'A4 2~3페이지', long: '상세하게. 사례와 근거를 충분히 서술' }[$('#aiLength').value];
  const tone = $('#aiTone').value === 'formal' ? '공식 보고서 개조식(~함, ~임)' : '평이한 서술체';
  const extra = $('#aiExtra').value.trim();
  return `아래 데이터로 경영진 보고서를 작성하세요.

- 보고일: ${new Date().toLocaleDateString('ko-KR')}
- 보고자: ${S.aiAuthor || '(미기재)'}
- 수신: ${S.aiTo || '경영진'}
- 분량: ${len}
- 문체: ${tone}
${extra ? `- 추가 지시: ${extra}\n` : ''}
구성:
# 법인카드 사용 이상징후 점검 결과 보고
(보고일·보고자·수신·점검 기간을 2열 표로)
## 1. 보고 요약
(경영진이 결론을 바로 알 수 있게 3~5개 항목)
## 2. 점검 개요
(대상, 기간, 방법, 판정 기준)
## 3. 주요 점검 결과
(집근처·휴일·휴폐업 핵심 지표 표. 미실행 항목은 '분석 미실행')
## 4. 주요 이상징후 사례
(위험점수 상위 사례 표와 해석)
## 5. 시사점 및 리스크
## 6. 개선 권고
(통제·제도 개선안)
## 7. 향후 조치 계획
(표: 조치 | 담당(제안) | 기한(제안))

데이터:
${JSON.stringify(payload)}`;
}

let aiRaf = 0;
function renderAiDoc(md) {
  $('#aiDoc').innerHTML = DOMPurify.sanitize(marked.parse(md));
}

function showAiLast() {
  if (!AI_LAST) return;
  renderAiDoc(AI_LAST.md);
  const at = new Date(AI_LAST.at).toLocaleString('ko-KR');
  $('#aiDoc').insertAdjacentHTML('beforeend',
    `<p class="ai-footnote">※ 본 문서는 AI(${esc(AI_LAST.model)})가 탐지 결과 수치를 바탕으로 작성한 초안입니다. 수치는 분석 앱 기준이며, 판정은 '의심' 단계로 당사자 소명 확인이 필요합니다. 작성: ${esc(at)}</p>`);
  $('#aiOutTitle').textContent = AI_LAST.title;
  $('#aiMeta').textContent = `${AI_LAST.model} · ${at}`;
}

function setAiBusy(busy, title) {
  ['#btnAiSummary', '#btnAiReport'].forEach(s => { $(s).disabled = busy; });
  $('#btnAiStop').classList.toggle('hidden', !busy);
  if (busy) {
    $('#aiOutTitle').textContent = title;
    $('#aiMeta').textContent = `${S.geminiModel} · 작성 중…`;
    $('#aiOutCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function runAi(kind) {
  if (!S.geminiKey) { toast('설정 탭에서 Gemini API 키를 입력하세요'); return switchTab('settings'); }
  const p = aiPayload();
  if (!p) return toast('먼저 카드 사용내역을 업로드하세요');
  S.aiAuthor = $('#aiAuthor').value.trim(); S.aiTo = $('#aiTo').value.trim();
  writeLS(LS.settings, S);
  const title = kind === 'summary' ? '이상징후 요약' : '경영진 보고서';
  const prompt = kind === 'summary' ? summaryPrompt(p.payload) : reportPrompt(p.payload);
  const doc = $('#aiDoc');
  aiAbort = new AbortController();
  setAiBusy(true, title);
  doc.classList.add('streaming');
  doc.innerHTML = '<p class="muted">AI가 작성 중입니다…</p>';
  let partial = '';
  const save = md => {
    AI_LAST = { kind, title, md, model: S.geminiModel, at: new Date().toISOString() };
    writeLS(LS.ai, AI_LAST);
    showAiLast();
  };
  const onText = t => {
    partial = t;
    if (!aiRaf) aiRaf = requestAnimationFrame(() => { aiRaf = 0; renderAiDoc(unmask(partial, p.alias)); });
  };
  try {
    let md;
    const tried = [];
    for (;;) {
      try {
        md = await geminiStream(AI_SYSTEM, prompt, onText, aiAbort.signal);
        break;
      } catch (e) {
        // 모델 종료(404)면 사용 가능한 다른 모델로 바꿔 최대 3번 재시도
        if (e.status !== 404 || tried.length >= 3) throw e;
        tried.push(S.geminiModel);
        const prev = S.geminiModel;
        const next = await switchToAvailableModel(tried);
        if (!next) throw e;
        toast(`'${prev}' 모델은 종료되어 '${next}'(으)로 자동 전환했습니다`);
        $('#aiMeta').textContent = `${next} · 작성 중…`;
      }
    }
    cancelAnimationFrame(aiRaf); aiRaf = 0;
    save(unmask(md, p.alias));
    setAiBadge('on');
  } catch (e) {
    cancelAnimationFrame(aiRaf); aiRaf = 0;
    if (e.name === 'AbortError') {
      toast('작성을 중지했습니다');
      if (partial) save(unmask(partial, p.alias) + '\n\n> (작성 중 중지됨)');
    } else {
      doc.innerHTML = `<p class="err-txt">${esc(e.message)}</p>`;
      $('#aiMeta').textContent = '';
    }
  } finally {
    doc.classList.remove('streaming');
    setAiBusy(false);
    aiAbort = null;
  }
}

const DOC_CSS = `body{font-family:'맑은 고딕','Malgun Gothic',sans-serif;font-size:11pt;line-height:1.7;color:#111;margin:24px 32px}
h1{font-size:18pt;border-bottom:2px solid #111;padding-bottom:6px}h2{font-size:13.5pt;margin-top:18pt;border-left:4px solid #1f5eff;padding-left:6px}
h3{font-size:12pt}table{border-collapse:collapse;margin:6pt 0}th,td{border:1px solid #888;padding:4px 8px;text-align:left;font-size:10pt}
th{background:#eef1f6}blockquote{margin:8px 0;padding:6px 12px;background:#f5f8ff;border-left:4px solid #1f5eff}.ai-footnote{font-size:9pt;color:#666;border-top:1px solid #ccc;padding-top:6px;margin-top:20px}`;

function docHtml(title) {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}</style></head><body>${$('#aiDoc').innerHTML}</body></html>`;
}

function aiExportWord() {
  if (!AI_LAST) return toast('먼저 요약이나 보고서를 생성하세요');
  const blob = new Blob(['﻿', docHtml(AI_LAST.title)], { type: 'application/msword' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `${AI_LAST.title.replace(/\s/g, '_')}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.doc`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function aiPrint() {
  if (!AI_LAST) return toast('먼저 요약이나 보고서를 생성하세요');
  const w = window.open('', '_blank');
  if (!w) return toast('팝업이 차단되었습니다 — 이 사이트의 팝업을 허용하세요');
  w.document.write(docHtml(AI_LAST.title));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

async function aiCopy() {
  if (!AI_LAST) return toast('먼저 요약이나 보고서를 생성하세요');
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([$('#aiDoc').innerHTML], { type: 'text/html' }),
      'text/plain': new Blob([AI_LAST.md], { type: 'text/plain' }),
    })]);
  } catch {
    await navigator.clipboard.writeText(AI_LAST.md);
  }
  toast('복사했습니다 — 메일·한글·워드에 붙여넣을 수 있습니다');
}

// ───────────────────────── 설정 ─────────────────────────
function fillSettings() {
  $('#sKey').value = S.kakaoKey;
  $('#sNtsKey').value = S.ntsKey;
  $('#sGeminiKey').value = S.geminiKey;
  $('#aiAuthor').value = S.aiAuthor; $('#aiTo').value = S.aiTo;
  $('#sR1').value = S.r1; $('#sR2').value = S.r2;
  $('#sNightFrom').value = S.nightFrom; $('#sNightTo').value = S.nightTo;
  $('#sExclude').value = S.exclude; $('#sRisky').value = S.risky; $('#sHolidays').value = S.holidays;
  $('#sWorkdays').value = S.workdays; $('#sSatOff').checked = S.satOff; $('#sLaborDay').checked = S.laborDay;
  $('#sOffice').value = S.office; $('#sOfficeR').value = S.officeR;
  $('#originHint').textContent = location.origin.startsWith('http') ? location.origin : 'http://localhost:8080';
  const o = S.officeGeo;
  $('#officeInfo').innerHTML = !S.office ? '' : o && o.fail ? '<span class="err-txt">회사 주소를 찾지 못했습니다</span>' : o ? `좌표 기준: ${esc(o.matched)}` : '저장하면 좌표로 변환합니다';
}

async function saveSettings() {
  const r1 = Math.max(50, +$('#sR1').value || DEFAULTS.r1);
  Object.assign(S, {
    r1, r2: Math.max(r1, +$('#sR2').value || DEFAULTS.r2),
    nightFrom: $('#sNightFrom').value || DEFAULTS.nightFrom, nightTo: $('#sNightTo').value || DEFAULTS.nightTo,
    exclude: $('#sExclude').value, risky: $('#sRisky').value, holidays: $('#sHolidays').value,
    workdays: $('#sWorkdays').value, satOff: $('#sSatOff').checked, laborDay: $('#sLaborDay').checked,
    office: $('#sOffice').value.trim(), officeR: Math.max(100, +$('#sOfficeR').value || DEFAULTS.officeR),
  });
  if (kakaoReady) await geocodeOffice();
  writeLS(LS.settings, S);
  fillSettings();
  if (TX.length) analyze();
  renderAll();
  toast(S.analyzedAt ? '설정 저장 · 재분석 완료' : '설정 저장됨');
}

async function saveKey() {
  const key = $('#sKey').value.trim();
  if (!key) return toast('JavaScript 키를 입력하세요');
  const changed = key !== S.kakaoKey;
  S.kakaoKey = key;
  writeLS(LS.settings, S);
  // 이미 다른 키로 SDK가 로드됐으면 새로고침해야 교체된다
  if (changed && window.kakao && window.kakao.maps) return location.reload();
  if (await connectKakao()) { toast('카카오지도 연결 성공'); if (S.office) { await geocodeOffice(); fillSettings(); } }
}

// ───────────────────────── 이벤트 ─────────────────────────
function bind() {
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });

  const drop = $('#drop');
  $('#fileInput').addEventListener('change', e => { handleCardFiles([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleCardFiles([...e.dataTransfer.files]));

  $('#btnClearTx').addEventListener('click', () => {
    if (!TX.length || !confirm(`업로드된 ${TX.length}건을 비울까요? (집주소·좌표 캐시는 유지)`)) return;
    TX = []; RESULT = null; S.analyzedAt = null; saveAll();
    $('#uploadInfo').innerHTML = ''; renderAll();
  });
  $('#btnRun').addEventListener('click', runAnalysis);
  $('#btnRegeo').addEventListener('click', () => {
    if (!confirm('가맹점 좌표 캐시를 지우고 다시 변환할까요? (카카오 API 호출량이 늘어납니다)')) return;
    GEO = {}; writeLS(LS.geo, GEO);
    Object.keys(HOMES).forEach(n => { HOMES[n] = { addr: HOMES[n].addr }; });
    writeLS(LS.homes, HOMES);
    runAnalysis();
  });

  $('#homeTable').addEventListener('change', e => { if (e.target.classList.contains('home-addr')) onHomeInput(e); });
  $('#homeTable').addEventListener('click', e => { if (e.target.classList.contains('geo-one')) geoOne(e.target.closest('tr').dataset.user); });
  $('#homeFile').addEventListener('change', e => { if (e.target.files[0]) handleHomeFile(e.target.files[0]); e.target.value = ''; });
  $('#btnHomeTemplate').addEventListener('click', downloadHomeTemplate);
  $('#btnGeoHomes').addEventListener('click', async () => {
    if (!kakaoReady) return toast('카카오지도 연결이 필요합니다');
    apiError = false;
    const r = await geocodeHomes(true);
    if (S.analyzedAt) analyze();
    renderAll();
    toast(apiError ? API_ERROR_MSG : `${r.total}명 변환` + (r.fail ? ` · ${r.fail}명 실패` : ''));
  });

  $('#userSummary').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-user]');
    if (!tr) return;
    $('#fUser').value = tr.dataset.user; $('#fLevel').value = '';
    renderDetail(); switchTab('detail');
  });

  ['#fUser', '#fLevel', '#fHoliday', '#fNight', '#fBiz'].forEach(s => $(s).addEventListener('change', renderDetail));
  $('#fText').addEventListener('input', renderDetail);
  $('#detailTable').addEventListener('click', e => {
    const th = e.target.closest('th[data-key]');
    if (!th) return;
    const k = th.dataset.key;
    sortState = { key: k, dir: sortState.key === k ? -sortState.dir : (['score', 'amount'].includes(k) ? -1 : 1) };
    renderDetail();
  });
  $('#btnExport').addEventListener('click', exportExcel);

  ['#hUser', '#hType', '#hSuspect'].forEach(s => $(s).addEventListener('change', () => { holDate = ''; renderHoliday(); }));
  $('#hUsers').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-user]');
    if (tr) { $('#hUser').value = tr.dataset.user; holDate = ''; renderHoliday(); }
  });
  $('#hDates').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-date]');
    if (tr) { holDate = holDate === tr.dataset.date ? '' : tr.dataset.date; renderHoliday(); }
  });
  $('#hDateTag').addEventListener('click', e => { if (e.target.id === 'hDateClear') { holDate = ''; renderHoliday(); } });
  $('#btnHolExport').addEventListener('click', () => exportExcel(renderHoliday.rows || [], '법인카드_휴일사용'));

  $('#btnBizRun').addEventListener('click', () => runBizCheck(false));
  $('#btnBizRerun').addEventListener('click', () => runBizCheck(true));
  $('#bizFilter').addEventListener('change', renderBiz);
  $('#bizTable').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-biz]');
    if (!tr) return;
    $('#fUser').value = ''; $('#fLevel').value = ''; $('#fBiz').checked = false;
    $('#fText').value = [...new Set(RESULT.filter(r => bizNo(r.bizno) === tr.dataset.biz).map(r => r.merchant))][0] || '';
    renderDetail(); switchTab('detail');
  });
  $('#btnBizExport').addEventListener('click', () =>
    exportExcel(RESULT.filter(r => !isCancelled(r) && ['afterClose', 'unregistered', 'suspended'].includes(r.bizFlag)), '법인카드_휴폐업가맹점'));
  $('#btnNtsKey').addEventListener('click', () => {
    S.ntsKey = $('#sNtsKey').value.trim();
    writeLS(LS.settings, S);
    toast(S.ntsKey ? '서비스키 저장됨 — ⑥ 휴폐업 조회 탭에서 실행하세요' : '서비스키 삭제됨');
  });

  $('#btnGeminiKey').addEventListener('click', saveGeminiKey);
  $('#btnGeminiModels').addEventListener('click', saveGeminiKey);
  $('#sGeminiModel').addEventListener('change', e => {
    S.geminiModel = e.target.value;
    writeLS(LS.settings, S);
    setAiBadge(S.geminiKey ? 'on' : 'off');
  });
  $('#btnAiSummary').addEventListener('click', () => runAi('summary'));
  $('#btnAiReport').addEventListener('click', () => runAi('report'));
  $('#btnAiStop').addEventListener('click', () => { if (aiAbort) aiAbort.abort(); });
  $('#btnAiCopy').addEventListener('click', aiCopy);
  $('#btnAiPrint').addEventListener('click', aiPrint);
  $('#btnAiWord').addEventListener('click', aiExportWord);
  $('#btnAiPreview').addEventListener('click', () => {
    const pre = $('#aiPreview');
    if (!pre.classList.contains('hidden')) return pre.classList.add('hidden');
    const p = aiPayload();
    pre.textContent = p ? JSON.stringify(p.payload, null, 2) : '카드내역을 먼저 업로드하세요.';
    pre.classList.remove('hidden');
  });

  $('#mapUser').addEventListener('change', e => { e.target.dataset.touched = '1'; renderMap(); });
  $('#mapFilter').addEventListener('change', renderMap);

  $('#btnKey').addEventListener('click', saveKey);
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('카드내역·집주소·좌표 캐시·설정을 모두 삭제할까요?')) return;
    Object.values(LS).forEach(k => localStorage.removeItem(k));
    location.reload();
  });
}

// ───────────────────────── 시작 ─────────────────────────
(async function init() {
  TX.forEach((t, i) => { t._id = i; });
  bind();
  fillSettings();
  fillModelSelect(null);
  setAiBadge('off');
  showAiLast();
  if (TX.length) $('#uploadInfo').innerHTML = `<p>이전에 올린 <b>${TX.length.toLocaleString()}</b>건이 저장되어 있습니다.</p>`;
  if (TX.length) analyze();
  renderAll();
  if (!S.kakaoKey) toast('설정 탭에서 카카오 JavaScript 키를 입력하세요');
  await connectKakao();
})();
