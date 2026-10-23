// ============================================================
// CÂMP DE DATĂ în format românesc zz.ll.aaaa
// ============================================================
// <input type="date"> afișează data după limba sistemului (ex: 10/26/2026 pe Windows în engleză).
// Aici folosim un câmp text zz.ll.aaaa + un buton de calendar; un <input type="date"> ascuns
// păstrează valoarea ISO (aaaa-ll-zz), așa că restul aplicației citește .value ca până acum.
const fmtRO = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.slice(8) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4) : '';

function parseRO(s) {
  s = (s || '').trim();
  let m = s.match(/^(\d{1,2})\s*[.\/\-\s]\s*(\d{1,2})\s*[.\/\-\s]\s*(\d{2}|\d{4})$/) || s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return null;
  let d = +m[1], mo = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return fD(dt);
}

const _DT_ICON = '<svg class="ic" viewBox="0 0 24 24"><path d="M3 10h18M8 3v4M16 3v4"/><rect x="3" y="5" width="18" height="16" rx="2"/></svg>';

// HTML pentru un câmp de dată. opts: { id, dis, cls, onchange }
function dtField(iso, opts) {
  opts = opts || {};
  const dis = opts.dis ? ' disabled' : '';
  return '<span class="dtx">'
    + '<input type="date" class="dtx-n" tabindex="-1" aria-hidden="true"' + (opts.id ? ' id="' + opts.id + '"' : '') + ' value="' + (iso || '') + '"' + dis
    + (opts.onchange ? ' onchange="' + opts.onchange + '"' : '') + '>'
    + '<input type="text" class="dtx-t ' + (opts.cls || '') + '" inputmode="numeric" maxlength="10" placeholder="zz.ll.aaaa" value="' + fmtRO(iso) + '"' + dis
    + ' onclick="event.stopPropagation()" ondblclick="event.stopPropagation()" onkeydown="if(event.key===\'Enter\'){this.blur()}">'
    + '<button type="button" class="dtx-b" tabindex="-1" title="Alege din calendar"' + dis + ' onclick="event.stopPropagation();dtPick(this)">' + _DT_ICON + '</button>'
    + '</span>';
}

function dtPick(btn) {
  const n = btn.parentNode.querySelector('.dtx-n');
  if (!n || n.disabled) return;
  try { n.showPicker(); } catch (e) { n.focus(); n.click(); }
}

// Setare din cod (și reîmprospătarea textului afișat)
function dtSet(id, iso) {
  const n = document.getElementById(id); if (!n) return;
  n.value = iso || '';
  const t = n.parentNode.querySelector('.dtx-t'); if (t) t.value = fmtRO(iso);
}

// Transformă un <input type="date"> din HTML-ul static într-un câmp românesc (păstrează id-ul)
function dtWrapStatic(id) {
  const n = document.getElementById(id); if (!n || n.classList.contains('dtx-n')) return;
  const holder = document.createElement('span');
  holder.innerHTML = dtField(n.value, { id: '__dtx_tmp' });
  const wrap = holder.firstChild;
  n.replaceWith(wrap);
  wrap.querySelector('.dtx-n').remove();
  n.classList.add('dtx-n'); n.tabIndex = -1; n.setAttribute('aria-hidden', 'true');
  wrap.insertBefore(n, wrap.firstChild);
}

document.addEventListener('change', e => {
  const el = e.target;
  if (!el.classList) return;
  if (el.classList.contains('dtx-n')) {            // s-a ales din calendar → actualizăm textul
    const t = el.parentNode.querySelector('.dtx-t'); if (t) t.value = fmtRO(el.value);
    return;
  }
  if (!el.classList.contains('dtx-t')) return;     // s-a scris în câmpul text
  const n = el.parentNode.querySelector('.dtx-n');
  if (!n || n.disabled) { if (n) el.value = fmtRO(n.value); return; }
  const raw = el.value.trim();
  const iso = raw === '' ? '' : parseRO(raw);
  if (iso === null) { toast('⚠️ Dată invalidă — scrie zz.ll.aaaa (ex: 26.10.2026)'); el.value = fmtRO(n.value); return; }
  el.value = fmtRO(iso);
  if (iso !== n.value) { n.value = iso; n.dispatchEvent(new Event('change', { bubbles: true })); }
});

// La scriere, punem punctele singuri: 26 → 26. , 26.10 → 26.10.
document.addEventListener('input', e => {
  const el = e.target;
  if (!el.classList || !el.classList.contains('dtx-t')) return;
  if (e.inputType !== 'insertText') return;
  if (/^\d{2}$/.test(el.value) || /^\d{2}\.\d{2}$/.test(el.value)) el.value += '.';
});
