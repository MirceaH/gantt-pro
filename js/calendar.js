// ============================================================
// CALENDAR — zile lucrătoare per proiect (tab) + zile libere
// ============================================================
// Durata unei activități (dur) = număr de ZILE LUCRĂTOARE.
// CAL.days[getDay()] = 1 dacă se lucrează (0 = duminică ... 6 = sâmbătă).
// CAL.hol = ["YYYY-MM-DD", ...] zile libere (sărbători, concedii).
const CAL_DEFAULT = () => ({ days: [0,1,1,1,1,1,0], hol: [] });
let CAL = CAL_DEFAULT();
let _holSet = new Set();

function setCal(c) {
  const days = c && Array.isArray(c.days) && c.days.length === 7 ? c.days.map(x => x ? 1 : 0) : CAL_DEFAULT().days;
  CAL = { days: days.some(Boolean) ? days : CAL_DEFAULT().days, hol: c && Array.isArray(c.hol) ? [...c.hol].sort() : [] };
  _holSet = new Set(CAL.hol);
}

const isWork = d => !!CAL.days[d.getDay()] && !_holSet.has(fD(d));
const isOff = d => !isWork(d);

function nextWork(d) {
  let r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  for (let i = 0; i < 3660 && !isWork(r); i++) r = aD(r, 1);
  return r;
}

// Mută n zile lucrătoare (n poate fi negativ) față de d (d se aliniază întâi la o zi lucrătoare)
function addWorkDays(d, n) {
  let r = nextWork(d), left = Math.abs(n);
  const s = n < 0 ? -1 : 1;
  for (let g = 0; left > 0 && g < 36600; g++) { r = aD(r, s); if (isWork(r)) left--; }
  return r;
}

// Ultima zi lucrată a unei activități
const endDate = t => addWorkDays(pD(t.sd), Math.max(1, t.dur) - 1);

// Număr de zile lucrătoare în [sd, ed] (minim 1)
function workDur(sd, ed) {
  let n = 0;
  for (let r = sd; r <= ed && n < 36600; r = aD(r, 1)) if (isWork(r)) n++;
  return Math.max(1, n);
}

// Număr de zile calendaristice ocupate de bară (de la sd la ultima zi lucrată)
const calSpan = t => dD(pD(t.sd), endDate(t)) + 1;

// ============================================================
// FEREASTRA CALENDAR
// ============================================================
const _DAY_NAMES = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
const _DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
let _calDraft = null;

function openCalendar() {
  _calDraft = { days: CAL.days.slice(), hol: CAL.hol.slice() };
  $('calDays').innerHTML = _DAY_ORDER.map(i =>
    `<label class="cal-day"><input type="checkbox" data-day="${i}" ${_calDraft.days[i] ? 'checked' : ''}><span>${_DAY_NAMES[i]}</span></label>`).join('');
  $('calDays').querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => { _calDraft.days[+cb.dataset.day] = cb.checked ? 1 : 0; }));
  dtSet('calHolDate', '');
  renderCalHol();
  $('calModal').classList.add('open');
}

function renderCalHol() {
  $('calHolList').innerHTML = _calDraft.hol.length
    ? _calDraft.hol.map(h => `<span class="cal-chip">${fmtDate(pD(h))}<button type="button" onclick="removeCalHol('${h}')" title="Șterge">✕</button></span>`).join('')
    : '<span style="color:var(--muted);font-size:11px">Nicio zi liberă adăugată</span>';
}

function addCalHol() {
  const v = $('calHolDate').value;
  if (!v) return;
  if (!_calDraft.hol.includes(v)) { _calDraft.hol.push(v); _calDraft.hol.sort(); }
  dtSet('calHolDate', '');
  renderCalHol();
}

function removeCalHol(h) { _calDraft.hol = _calDraft.hol.filter(x => x !== h); renderCalHol(); }

function closeCalendar() { $('calModal').classList.remove('open'); }

function saveCalendar() {
  if (!_calDraft.days.some(Boolean)) { toast('⚠️ Bifează cel puțin o zi lucrătoare'); return; }
  pushHistory();
  setCal(_calDraft);
  closeCalendar();
  syncTabData();
  renderAll();
  toast('📅 Calendar salvat');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('calModal') && $('calModal').classList.contains('open')) closeCalendar();
  if (e.key === 'Enter' && e.target && e.target.id === 'calHolDate') { e.preventDefault(); addCalHol(); }
});

// ============================================================
// SĂRBĂTORI LEGALE — ROMÂNIA
// ============================================================
// Paștele ortodox (calendar iulian → +13 zile pentru 1900–2099), algoritmul Meeus
function _orthodoxEaster(y) {
  const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const m = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  return new Date(y, m - 1, day + 13);
}

function roHolidays(y) {
  const E = _orthodoxEaster(y), fx = (m, d) => new Date(y, m - 1, d);
  return [
    fx(1, 1), fx(1, 2), fx(1, 6), fx(1, 7), fx(1, 24),
    aD(E, -2), E, aD(E, 1),                // Vinerea Mare, Paște, Lunea Paștelui
    fx(5, 1), fx(6, 1),
    aD(E, 49), aD(E, 50),                  // Rusalii
    fx(8, 15), fx(11, 30), fx(12, 1), fx(12, 25), fx(12, 26)
  ].map(fD);
}

// Adaugă (în fereastra Calendar) sărbătorile din anii proiectului, doar cele care cad în zile lucrătoare
function addRoHolidays() {
  let y1 = new Date().getFullYear(), y2 = y1 + 1;
  const b = T.length ? ab() : null;
  if (b) { y1 = b.mn.getFullYear(); y2 = b.mx.getFullYear(); }
  let n = 0;
  for (let y = y1; y <= y2; y++) roHolidays(y).forEach(h => {
    if (_calDraft.days[pD(h).getDay()] && !_calDraft.hol.includes(h)) { _calDraft.hol.push(h); n++; }
  });
  _calDraft.hol.sort();
  renderCalHol();
  toast(n ? '🇷🇴 Adăugate ' + n + ' sărbători legale (' + y1 + (y2 > y1 ? '–' + y2 : '') + ')' : 'ℹ️ Sărbătorile legale pentru acești ani sunt deja adăugate');
}
