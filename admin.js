// =====================================================================
// หน้าส่วนกลาง : ติดตามการส่ง, เปิด/ปิดรอบ, Export
// =====================================================================

import {
  sb, esc, toast, errMsg, loadProfile, renderNav, statusBadge, fmtDate, showError,
  fetchAll, downloadCsv, asText, STATUS,
} from './app.js';
import { EXPORT_SUMMARY, EXPORT_BUILDINGS, BILL_FIELDS } from './solar-budget-schema.js';

// คอลัมน์ที่ต้องคงเลข 0 ข้างหน้าเมื่อเปิดใน Excel
const TEXT_COLS = new Set(['hcode', 'contact_phone']);

const main = document.getElementById('main');

let rounds = [];
let units = [];
let subsByHcode = {};
let round;

try {
  const profile = await loadProfile();
  renderNav(profile);
  if (profile.role !== 'admin') {
    location.replace('home.html');
  } else {
    await init();
  }
} catch (e) {
  if (e.message !== 'not logged in') showError(main, e);
}

async function init() {
  const { data, error } = await sb.from('survey_rounds').select('*').order('fiscal_year', { ascending: false });
  if (error) throw error;
  rounds = data;
  units = await fetchAll(() => sb.from('units').select('hcode, name, unit_type, region, province').order('hcode'));

  main.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-end gap-3 mb-4">
      <div>
        <h1 class="h4 fw-bold mb-1"><i class="bi bi-speedometer2 me-2"></i>ติดตามการส่งแบบสำรวจ</h1>
        <div class="text-muted small">ทะเบียนหน่วยงานทั้งหมด ${units.length.toLocaleString()} แห่ง</div>
      </div>
      <div class="d-flex gap-2 align-items-center">
        <select class="form-select" id="roundSelect" style="min-width: 320px;">
          ${rounds.map((r) => `<option value="${r.id}">${esc(r.fiscal_year)} : ${esc(r.title)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card p-3 mb-4" id="roundBar"></div>
    <div class="row g-3 mb-4" id="stats"></div>

    <div class="card p-3 mb-3">
      <div class="row g-2 align-items-end">
        <div class="col-md-2">
          <label class="form-label small">เขตสุขภาพ</label>
          <select class="form-select form-select-sm" id="fRegion"><option value="">ทั้งหมด</option></select>
        </div>
        <div class="col-md-2">
          <label class="form-label small">จังหวัด</label>
          <select class="form-select form-select-sm" id="fProvince"><option value="">ทั้งหมด</option></select>
        </div>
        <div class="col-md-2">
          <label class="form-label small">สถานะ</label>
          <select class="form-select form-select-sm" id="fStatus">
            <option value="started">มีการกรอกข้อมูล</option>
            <option value="">ทุกหน่วยงาน</option>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label small">ค้นหา (รหัส / ชื่อ)</label>
          <input class="form-control form-control-sm" id="fText" placeholder="พิมพ์เพื่อค้นหา">
        </div>
        <div class="col-md-3 text-md-end">
          <div class="dropdown">
            <button class="btn btn-sm btn-primary dropdown-toggle" data-bs-toggle="dropdown"><i class="bi bi-download me-1"></i>Export CSV</button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#" data-export="summary">สรุปรายหน่วยงาน</a></li>
              <li><a class="dropdown-item" href="#" data-export="buildings">ข้อมูลรายอาคาร</a></li>
              <li><a class="dropdown-item" href="#" data-export="bills">ค่าไฟฟ้า 12 เดือน</a></li>
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item" href="#" data-export="codes">รหัสลงทะเบียนหน่วยงาน</a></li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr><th>รหัส</th><th>ชื่อหน่วยงาน</th><th>จังหวัด</th><th>เขต</th><th>สถานะ</th><th>อัปเดตล่าสุด</th><th></th></tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div class="small text-muted p-2" id="rowInfo"></div>
    </div>`;

  const regions = [...new Set(units.map((u) => u.region).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  document.getElementById('fRegion').insertAdjacentHTML('beforeend', regions.map((r) => `<option>${esc(r)}</option>`).join(''));
  fillProvinces();

  document.getElementById('roundSelect').addEventListener('change', loadRound);
  document.getElementById('fRegion').addEventListener('change', () => { fillProvinces(); renderTable(); });
  for (const id of ['fProvince', 'fStatus']) document.getElementById(id).addEventListener('change', renderTable);
  document.getElementById('fText').addEventListener('input', renderTable);
  main.addEventListener('click', onClick);

  if (rounds.length) await loadRound();
  else document.getElementById('roundBar').innerHTML = '<div class="text-muted">ยังไม่มีรอบสำรวจ</div>';
}

function fillProvinces() {
  const region = document.getElementById('fRegion').value;
  const provinces = [...new Set(units.filter((u) => !region || u.region === region).map((u) => u.province).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'th'));
  document.getElementById('fProvince').innerHTML = '<option value="">ทั้งหมด</option>'
    + provinces.map((p) => `<option>${esc(p)}</option>`).join('');
}

async function loadRound() {
  const id = Number(document.getElementById('roundSelect').value);
  round = rounds.find((r) => Number(r.id) === id);
  const subs = await fetchAll(() => sb.from('submissions')
    .select('id, hcode, status, submitted_at, updated_at').eq('round_id', id).order('hcode'));
  subsByHcode = Object.fromEntries(subs.map((s) => [s.hcode, s]));
  renderRoundBar();
  renderStats();
  renderTable();
}

function renderRoundBar() {
  document.getElementById('roundBar').innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
      <div>
        <span class="badge text-bg-${round.is_open ? 'success' : 'secondary'} me-2">${round.is_open ? 'เปิดรับข้อมูล' : 'ปิดรับข้อมูล'}</span>
        <span class="small text-muted">
          ${round.opens_at ? `เปิด ${fmtDate(round.opens_at)}` : ''} ${round.closes_at ? ` · ปิด ${fmtDate(round.closes_at)}` : ''}
        </span>
      </div>
      <button class="btn btn-sm btn-outline-${round.is_open ? 'danger' : 'success'}" data-toggle-round>
        ${round.is_open ? '<i class="bi bi-lock me-1"></i>ปิดรับข้อมูล' : '<i class="bi bi-unlock me-1"></i>เปิดรับข้อมูล'}
      </button>
    </div>`;
}

function renderStats() {
  const count = { none: 0, draft: 0, submitted: 0, returned: 0 };
  for (const u of units) count[subsByHcode[u.hcode]?.status || 'none']++;
  const box = (label, value, cls) => `
    <div class="col-6 col-md">
      <div class="stat"><div class="small text-muted">${label}</div><div class="value text-${cls}">${value.toLocaleString()}</div></div>
    </div>`;
  document.getElementById('stats').innerHTML =
    box('ส่งแล้ว', count.submitted, 'success')
    + box('บันทึกร่าง (ยังไม่ส่ง)', count.draft, 'warning')
    + box('ส่งกลับแก้ไข', count.returned, 'danger')
    + box('ยังไม่เริ่ม', count.none, 'secondary');
}

function filteredUnits() {
  const region = document.getElementById('fRegion').value;
  const province = document.getElementById('fProvince').value;
  const status = document.getElementById('fStatus').value;
  const text = document.getElementById('fText').value.trim().toLowerCase();
  return units.filter((u) => {
    const s = subsByHcode[u.hcode]?.status || 'none';
    if (region && u.region !== region) return false;
    if (province && u.province !== province) return false;
    if (status === 'started' && s === 'none') return false;
    if (status && status !== 'started' && s !== status) return false;
    if (text && !u.hcode.includes(text) && !u.name.toLowerCase().includes(text)) return false;
    return true;
  });
}

function renderTable() {
  const list = filteredUnits();
  const shown = list.slice(0, 500);
  document.getElementById('rows').innerHTML = shown.map((u) => {
    const s = subsByHcode[u.hcode];
    return `<tr>
      <td class="font-monospace">${esc(u.hcode)}</td>
      <td>${esc(u.name)}<div class="small text-muted">${esc(u.unit_type || '')}</div></td>
      <td>${esc(u.province || '')}</td>
      <td class="small">${esc(u.region || '')}</td>
      <td>${statusBadge(s?.status)}</td>
      <td class="small">${s ? fmtDate(s.submitted_at || s.updated_at) : '-'}</td>
      <td>${s ? `<a class="btn btn-sm btn-outline-primary" href="view.html?id=${s.id}">ดูข้อมูล</a>` : ''}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="text-center text-muted py-4">ไม่พบข้อมูล</td></tr>';
  document.getElementById('rowInfo').textContent = list.length > shown.length
    ? `แสดง ${shown.length} จาก ${list.length} รายการ (ใช้ตัวกรองเพื่อค้นหา)`
    : `${list.length} รายการ`;
}

async function onClick(e) {
  if (e.target.closest('[data-toggle-round]')) {
    const open = !round.is_open;
    if (!confirm(open ? 'เปิดรับข้อมูลรอบนี้?' : 'ปิดรับข้อมูลรอบนี้? หน่วยงานจะแก้ไข/ส่งไม่ได้')) return;
    const { error } = await sb.rpc('set_round_open', { p_round_id: round.id, p_open: open });
    if (error) return toast(errMsg(error), 'danger');
    round.is_open = open;
    renderRoundBar();
    toast(open ? 'เปิดรับข้อมูลแล้ว' : 'ปิดรับข้อมูลแล้ว');
    return;
  }
  const exp = e.target.closest('[data-export]');
  if (exp) {
    e.preventDefault();
    try {
      await exportCsv(exp.dataset.export);
    } catch (err) {
      toast(errMsg(err), 'danger');
    }
  }
}

// ---------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------

function statusText(s) {
  return STATUS[s]?.label || s || '';
}

function exportValue(key, value) {
  if (key === 'status') return statusText(value);
  if (key === 'submitted_at') return fmtDate(value);
  if (TEXT_COLS.has(key)) return asText(value);
  return value;
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

async function exportCsv(kind) {
  toast('กำลังเตรียมไฟล์...', 'secondary');
  const fy = round?.fiscal_year;

  if (kind === 'summary') {
    const rows = await fetchAll(() => sb.from('v_solar_budget_summary').select('*').eq('round_id', round.id).order('hcode'));
    downloadCsv(`solar_budget_${fy}_summary_${stamp()}.csv`,
      EXPORT_SUMMARY.map(([, h]) => h),
      rows.map((r) => EXPORT_SUMMARY.map(([k]) => exportValue(k, r[k]))));
  }

  if (kind === 'buildings') {
    const rows = await fetchAll(() => sb.from('v_solar_budget_buildings').select('*').eq('round_id', round.id).order('hcode').order('seq'));
    downloadCsv(`solar_budget_${fy}_buildings_${stamp()}.csv`,
      EXPORT_BUILDINGS.map(([, h]) => h),
      rows.map((r) => EXPORT_BUILDINGS.map(([k]) => exportValue(k, r[k]))));
  }

  if (kind === 'bills') {
    const months = round.settings?.bill_months || Array.from({ length: 12 }, (_, i) => `เดือนที่ ${i + 1}`);
    const rows = await fetchAll(() => sb.from('solar_budget_bills')
      .select('month_no, cost_baht, peak_kw, offpeak_kw, ft_units, submissions!inner(round_id, hcode, status, units(name, province))')
      .eq('submissions.round_id', round.id)
      .order('submission_id').order('month_no'));
    const byUnit = {};
    for (const r of rows) {
      const s = r.submissions;
      byUnit[s.hcode] ??= { hcode: s.hcode, name: s.units?.name, province: s.units?.province, status: s.status, m: {} };
      byUnit[s.hcode].m[r.month_no] = r;
    }
    const header = ['รหัสหน่วยงาน', 'ชื่อหน่วยงาน', 'จังหวัด', 'สถานะ'];
    months.forEach((m) => BILL_FIELDS.forEach((f) => header.push(`${m} ${f.label}`)));
    const out = Object.values(byUnit).sort((a, b) => a.hcode.localeCompare(b.hcode)).map((u) => {
      const line = [asText(u.hcode), u.name, u.province, statusText(u.status)];
      months.forEach((_, i) => BILL_FIELDS.forEach((f) => line.push(u.m[i + 1]?.[f.key] ?? '')));
      return line;
    });
    downloadCsv(`solar_budget_${fy}_bills_${stamp()}.csv`, header, out);
  }

  if (kind === 'codes') {
    const rows = await fetchAll(() => sb.from('unit_codes').select('hcode, code, units(name, unit_type, province, region)').order('hcode'));
    downloadCsv(`unit_registration_codes_${stamp()}.csv`,
      ['เขตสุขภาพ', 'จังหวัด', 'รหัสหน่วยงาน', 'ชื่อหน่วยงาน', 'ประเภท', 'รหัสลงทะเบียน'],
      rows.map((r) => [r.units?.region, r.units?.province, asText(r.hcode), r.units?.name, r.units?.unit_type, asText(r.code)]));
  }
}
