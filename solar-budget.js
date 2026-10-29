// =====================================================================
// แบบสำรวจ Solar เพื่อของบประมาณ : หน้ากรอกข้อมูลของ รพ.
// =====================================================================

import {
  sb, esc, qs, toast, errMsg, loadProfile, renderNav, statusBadge, fmtDate, fmtNum,
  showError, openAttachment, uuid, fmtSize,
} from './app.js';
import { MAX_FILE_MB } from './config.js';
import { OPTIONS, MAX_BUILDINGS, ROOF_AGE_LIMIT, ATTACHMENTS, BILL_FIELDS } from './solar-budget-schema.js';

const main = document.getElementById('main');

let round;
let unit;
let submission;   // แถวใน submissions
let editable = false;
let dirty = false;
let saving = false;
let attachments = [];

try {
  await init();
} catch (e) {
  if (e.message !== 'not logged in') showError(main, e);
}

// ---------------------------------------------------------------------
// โหลดข้อมูล
// ---------------------------------------------------------------------

async function init() {
  const profile = await loadProfile();
  renderNav(profile);
  if (profile.role !== 'unit' || !profile.hcode) {
    location.replace('home.html');
    return;
  }
  unit = profile.unit;

  const roundId = Number(qs('round'));
  const { data: r, error: e1 } = await sb.from('survey_rounds').select('*').eq('id', roundId).single();
  if (e1) throw e1;
  round = r;

  submission = await loadSubmission();
  const now = new Date();
  const roundOpen = round.is_open
    && (!round.opens_at || now >= new Date(round.opens_at))
    && (!round.closes_at || now <= new Date(round.closes_at));
  editable = roundOpen && (!submission || submission.status !== 'submitted');

  if (!submission) {
    if (!roundOpen) {
      main.innerHTML = '<div class="alert alert-warning">รอบสำรวจนี้ยังไม่เปิด หรือปิดรับข้อมูลแล้ว</div>';
      return;
    }
    const { error } = await sb.rpc('start_submission', { p_round_id: roundId });
    if (error) throw error;
    submission = await loadSubmission();
  }

  const [resp, buildings, bills, files] = await Promise.all([
    sb.from('solar_budget_responses').select('*').eq('submission_id', submission.id).maybeSingle(),
    sb.from('solar_budget_buildings').select('*').eq('submission_id', submission.id).order('seq'),
    sb.from('solar_budget_bills').select('*').eq('submission_id', submission.id).order('month_no'),
    sb.from('attachments').select('*').eq('submission_id', submission.id).order('created_at'),
  ]);
  for (const res of [resp, buildings, bills, files]) if (res.error) throw res.error;
  attachments = files.data;

  render();
  fill(resp.data || {}, buildings.data, bills.data);
  refreshVisibility();
  renderAttachments();
  updateBillTotals();
  bindEvents();
}

async function loadSubmission() {
  const { data, error } = await sb
    .from('submissions').select('*')
    .eq('round_id', round.id).eq('hcode', unit.hcode)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// สร้างฟอร์ม
// ---------------------------------------------------------------------

// ตัวเลือกแบบ radio : attr = 'f' (ข้อมูลทั่วไป) หรือ 'b' (ข้อมูลอาคาร)
function radios(attr, key, options, name) {
  return `<div data-${attr}="${key}" data-kind="radio" class="d-flex flex-wrap column-gap-4 row-gap-1">
    ${options.map((o, i) => `
      <div class="form-check">
        <input class="form-check-input" type="radio" name="${name}" id="${name}_${i}" value="${esc(o)}">
        <label class="form-check-label" for="${name}_${i}">${esc(o)}</label>
      </div>`).join('')}
  </div>`;
}

function field(label, control, { req = true, col = 'col-md-6', hint = '', id = '' } = {}) {
  return `<div class="${col}" data-field ${id ? `id="${id}"` : ''}>
    <label class="form-label">${label}${req ? '<span class="req">*</span>' : ''}</label>
    ${control}
    ${hint ? `<div class="form-text">${hint}</div>` : ''}
  </div>`;
}

function text(key, ph = '', type = 'text') {
  return `<input type="${type}" class="form-control" data-f="${key}" placeholder="${esc(ph)}">`;
}

function num(key, ph = '', type = 'num') {
  return `<input type="number" step="any" min="0" class="form-control" data-f="${key}" data-type="${type}" placeholder="${esc(ph)}">`;
}

function buildingCard(seq) {
  const n = (k) => `b${seq}_${k}`;
  const bText = (k, ph = '') => `<input type="text" class="form-control" data-b="${k}" placeholder="${esc(ph)}">`;
  const bNum = (k, ph = '', type = 'num') =>
    `<input type="number" step="any" min="0" class="form-control" data-b="${k}" data-type="${type}" placeholder="${esc(ph)}">`;
  return `
    <div class="card building-card p-3 mb-3" data-seq="${seq}">
      <div class="fw-bold mb-3"><i class="bi bi-building me-2"></i>อาคารที่ ${seq}</div>
      <div class="row g-3">
        ${field(`${seq}.1 ชื่ออาคารที่กำหนดให้ติดตั้งระบบฯ`, bText('building_name', 'เช่น อาคารผู้ป่วยนอก'), { col: 'col-12' })}
        ${field(`${seq}.2 มีแผนการรื้อถอนหรือสร้างใหม่ภายในปี ${esc(round.settings?.renovation_years || '')} หรือไม่`,
          radios('b', 'demolition_plan', OPTIONS.demolition, n('demolition')), { col: 'col-md-6' })}
        <div class="col-md-6 d-none" data-field data-when="demolition">
          <label class="form-label">ระบุแผนการรื้อถอน/สร้างใหม่<span class="req">*</span></label>
          ${bText('demolition_note', 'เช่น รื้อถอนปี 2572 เพื่อสร้างอาคารใหม่')}
        </div>
        ${field(`${seq}.3 อาคารที่จะติดตั้งระบบฯ มีการบดบังจากแสงเงาหรือไม่`,
          radios('b', 'shading', OPTIONS.shading, n('shading')), { col: 'col-12' })}
        ${field(`${seq}.4 ขนาดพื้นที่หลังคาสำหรับการติดตั้ง (ตารางเมตร)`, bNum('roof_area_m2', '0'))}
        ${field(`${seq}.5 ชนิดวัสดุมุงหลังคา`,
          `<select class="form-select" data-b="roof_material">
             <option value="">-- เลือก --</option>
             ${OPTIONS.roofMaterial.map((o) => `<option>${esc(o)}</option>`).join('')}
           </select>`)}
        <div class="col-md-6 d-none" data-field data-when="material">
          <label class="form-label">ระบุวัสดุมุงหลังคาอื่นๆ<span class="req">*</span></label>
          ${bText('roof_material_other')}
        </div>
        ${field(`${seq}.6 อายุหลังคาที่จะติดตั้งระบบฯ (ปี)`, bNum('roof_age_years', '0', 'int'))}
        <div class="col-md-6 d-none" data-field data-when="roofage">
          <label class="form-label">${seq}.7 หลังคาอายุเกิน ${ROOF_AGE_LIMIT} ปี มีแผนที่จะเปลี่ยนหลังคาหรือไม่<span class="req">*</span></label>
          ${radios('b', 'roof_replace_plan', OPTIONS.roofReplace, n('replace'))}
        </div>
        ${field(`${seq}.8 ความลาดชันของหลังคา (องศา)`, bNum('roof_slope_deg', '0'))}
        ${field(`${seq}.9 มีช่องทางการเข้าถึงพื้นที่บนหลังคาสำหรับงานซ่อมบำรุงแผงหรือไม่`,
          radios('b', 'roof_access', OPTIONS.roofAccess, n('access')))}
      </div>
    </div>`;
}

function uploadBox(kind) {
  const a = ATTACHMENTS[kind];
  return `
    <div class="mt-3" data-attach="${kind}">
      <label class="form-label">${esc(a.label)}<span class="req">*</span></label>
      <div class="form-text mt-0 mb-2">${esc(a.hint)} · ไม่เกิน ${MAX_FILE_MB} MB ต่อไฟล์</div>
      <div class="file-list"></div>
      <div class="upload-zone">
        <label class="btn btn-outline-primary btn-sm">
          <i class="bi bi-paperclip me-1"></i>เลือกไฟล์ PDF
          <input type="file" accept="application/pdf,.pdf" multiple hidden>
        </label>
        <span class="upload-status small text-muted ms-2"></span>
      </div>
    </div>`;
}

function render() {
  const months = round.settings?.bill_months || Array.from({ length: 12 }, (_, i) => `เดือนที่ ${i + 1}`);
  const s = submission;

  main.innerHTML = `
    <div class="hero p-4 mb-4">
      <div class="d-flex justify-content-between flex-wrap gap-2">
        <span class="badge text-bg-light border">ปีงบประมาณ ${esc(round.fiscal_year)}</span>
        <span id="statusBadge">${statusBadge(s.status)}</span>
      </div>
      <h1 class="h5 fw-bold mt-2 mb-1">${esc(round.title)}</h1>
      <div class="small text-muted">${esc(unit.hcode)} ${esc(unit.name)} · จ.${esc(unit.province || '-')}</div>
    </div>

    ${s.status === 'returned' ? `<div class="alert alert-danger"><b><i class="bi bi-arrow-return-left me-1"></i>ส่วนกลางขอให้แก้ไข:</b> ${esc(s.review_note || '-')}</div>` : ''}
    ${s.status === 'submitted' ? `<div class="alert alert-success"><i class="bi bi-check-circle me-1"></i>ส่งข้อมูลแล้วเมื่อ ${fmtDate(s.submitted_at)} หากต้องการแก้ไข กรุณาติดต่อส่วนกลาง</div>` : ''}
    ${!editable && s.status !== 'submitted' ? '<div class="alert alert-warning">ปิดรับข้อมูลแล้ว แสดงข้อมูลแบบอ่านอย่างเดียว</div>' : ''}

    <form id="surveyForm" novalidate>
    <fieldset id="formFieldset" ${editable ? '' : 'disabled'}>

      <section class="card p-4 mb-4">
        <div class="section-title"><span class="num">1</span>ข้อมูลหน่วยงาน</div>
        <div class="row g-3">
          ${field('รหัสโรงพยาบาล (5 หลัก)', `<input class="form-control" value="${esc(unit.hcode)}" readonly>`, { req: false, col: 'col-md-4' })}
          ${field('ชื่อหน่วยงาน', `<input class="form-control" value="${esc(unit.name)}" readonly>`, { req: false, col: 'col-md-8' })}
          ${field('ตำบล', text('unit.subdistrict'), { col: 'col-md-4' })}
          ${field('อำเภอ', text('unit.district'), { col: 'col-md-4' })}
          ${field('จังหวัด', `<input class="form-control" value="${esc(unit.province || '')}" readonly>`, { req: false, col: 'col-md-4' })}
        </div>
      </section>

      <section class="card p-4 mb-4">
        <div class="section-title"><span class="num">2</span>ผู้ประสานงาน</div>
        <div class="row g-3">
          ${field('ชื่อ - นามสกุล', text('contact.name'))}
          ${field('ตำแหน่ง', text('contact.position'))}
          ${field('เบอร์มือถือ (ที่สามารถติดต่อได้)', text('contact.phone', '08xxxxxxxx', 'tel'), { col: 'col-md-4' })}
          ${field('E-mail (ที่สามารถติดต่อได้)', text('contact.email', 'name@example.com', 'email'), { col: 'col-md-4' })}
          ${field('ID LINE', text('contact.line'), { req: false, col: 'col-md-4' })}
        </div>
      </section>

      <section class="card p-4 mb-4">
        <div class="section-title"><span class="num">3</span>ระบบผลิตไฟฟ้าจากพลังงานแสงอาทิตย์เดิม</div>
        <div class="row g-3">
          ${field('หน่วยงานเคยติดตั้งระบบผลิตไฟฟ้าจากพลังงานแสงอาทิตย์หรือไม่',
            radios('f', 'response.has_existing_solar', OPTIONS.everInstalled, 'has_existing'), { col: 'col-12' })}
        </div>
        <div class="row g-3 mt-1 d-none" id="existingBlock">
          ${field('ชื่ออาคารที่ติดตั้งระบบฯ เดิมที่มีอยู่', text('response.existing_building'))}
          ${field('ขนาดกำลังผลิตติดตั้งรวมทั้งหมด (กิโลวัตต์)', num('response.existing_kw', '0'))}
          ${field('ระบบฯ มีการชำรุดหรือเสียหายหรือไม่', radios('f', 'response.existing_condition', OPTIONS.condition, 'existing_condition'), { col: 'col-12' })}
          ${field('ปี พ.ศ. ที่ได้รับการสนับสนุน', num('response.existing_support_year', 'เช่น 2565', 'int'))}
          ${field('หน่วยงานที่สนับสนุน',
            `<input type="text" class="form-control" data-f="response.existing_support_agency" list="agencyList" placeholder="เลือกหรือพิมพ์">
             <datalist id="agencyList">${OPTIONS.supportAgency.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`)}
          ${field('หน่วยงานมีใบขนานไฟหรือไม่', radios('f', 'response.cod_permit', OPTIONS.codPermit, 'cod_permit'), { col: 'col-12' })}
        </div>
      </section>

      <section class="card p-4 mb-4">
        <div class="section-title"><span class="num">4</span>อาคารที่จะติดตั้งระบบฯ</div>
        <div class="row g-3 mb-3">
          ${field('เคยดัดแปลงอาคารโรงพยาบาลที่จะดำเนินการติดตั้งระบบผลิตไฟฟ้าจากพลังงานแสงอาทิตย์หรือไม่',
            radios('f', 'response.building_modified', OPTIONS.modified, 'modified'), { col: 'col-12' })}
          ${field('ชื่ออาคารที่มีปริมาณการใช้ไฟฟ้าสูง (อาคารที่จะใช้ไฟที่ผลิตได้จากระบบฯ)', text('response.high_load_building'), { col: 'col-12' })}
          ${field('ลักษณะการใช้ไฟฟ้าของอาคารที่จะใช้ไฟฟ้าที่ผลิตได้จากระบบฯ',
            radios('f', 'response.load_profile', OPTIONS.loadProfile, 'load_profile'), { col: 'col-12' })}
          ${field('จำนวนอาคารที่จะติดตั้งระบบฯ',
            `<select class="form-select" data-f="response.building_count" data-type="int">
               <option value="">-- เลือก --</option>
               ${Array.from({ length: MAX_BUILDINGS }, (_, i) => `<option value="${i + 1}">${i + 1} อาคาร</option>`).join('')}
             </select>`, { col: 'col-md-4' })}
        </div>
        <div id="buildings">
          ${Array.from({ length: MAX_BUILDINGS }, (_, i) => buildingCard(i + 1)).join('')}
        </div>
        ${uploadBox('blueprint')}
      </section>

      <section class="card p-4 mb-4">
        <div class="section-title"><span class="num">5</span>ความมั่นคงของระบบไฟฟ้า</div>
        <div class="row g-3">
          ${field('หน่วยงานของท่านอยู่ "ปลายสายส่งการไฟฟ้า" หรือไม่', radios('f', 'response.end_of_line', OPTIONS.endOfLine, 'end_of_line'), { col: 'col-12' })}
          ${field('หน่วยงานของท่านโดยเฉลี่ยแล้ว ไฟฟ้าดับบ่อยแค่ไหนต่อเดือน', radios('f', 'response.outage_frequency', OPTIONS.outageFrequency, 'outage_freq'), { col: 'col-12' })}
          ${field('ช่วงเวลาที่เกิดไฟฟ้าดับบ่อยที่สุดคือช่วงเวลาไหนของวัน', radios('f', 'response.outage_time', OPTIONS.outageTime, 'outage_time'), { col: 'col-12' })}
        </div>
      </section>

      <section class="card p-4 mb-4">
        <div class="section-title"><span class="num">6</span>ข้อมูลค่าไฟฟ้าย้อนหลัง 12 เดือน</div>
        <div class="table-responsive">
          <table class="table table-sm align-middle bill-table">
            <thead class="table-light">
              <tr><th>เดือน</th>${BILL_FIELDS.map((f) => `<th>${esc(f.label)}<span class="text-danger">*</span></th>`).join('')}</tr>
            </thead>
            <tbody>
              ${months.map((m, i) => `
                <tr data-month="${i + 1}">
                  <td class="fw-semibold text-nowrap">${i + 1}. ${esc(m)}</td>
                  ${BILL_FIELDS.map((f) => `<td><input type="number" step="any" min="0" class="form-control form-control-sm" data-bill="${f.key}"></td>`).join('')}
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr class="fw-bold"><td>รวม</td><td id="totalCost">-</td><td></td><td></td><td id="totalFt">-</td></tr>
            </tfoot>
          </table>
        </div>
        ${uploadBox('electric_bill')}
      </section>

    </fieldset>
    </form>

    <div class="sticky-actions py-3 mt-2">
      <div class="d-flex flex-wrap gap-2 justify-content-between align-items-center">
        <div class="small text-muted" id="saveInfo">${s.updated_at ? `บันทึกล่าสุด ${fmtDate(s.updated_at)}` : ''}</div>
        <div class="d-flex gap-2">
          <a href="home.html" class="btn btn-outline-secondary"><i class="bi bi-arrow-left me-1"></i>กลับ</a>
          ${editable ? `
            <button type="button" class="btn btn-outline-primary" id="btnDraft"><i class="bi bi-floppy me-1"></i>บันทึกร่าง</button>
            <button type="button" class="btn btn-primary" id="btnSubmit"><i class="bi bi-send me-1"></i>ส่งแบบสำรวจ</button>` : ''}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// อ่าน / เขียนค่าในฟอร์ม
// ---------------------------------------------------------------------

function getVal(el) {
  if (el.dataset.kind === 'radio') return el.querySelector('input:checked')?.value ?? null;
  const v = el.value.trim();
  if (v === '') return null;
  if (el.dataset.type === 'num') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (el.dataset.type === 'int') {
    const n = parseInt(v.replace(/,/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}

function setVal(el, value) {
  if (el.dataset.kind === 'radio') {
    el.querySelectorAll('input').forEach((r) => { r.checked = value !== null && r.value === String(value); });
  } else {
    el.value = value ?? '';
  }
}

function fill(resp, buildings, bills) {
  const s = submission;
  const source = {
    unit: { subdistrict: s.subdistrict ?? unit.subdistrict, district: s.district ?? unit.district },
    contact: {
      name: s.contact_name, position: s.contact_position, phone: s.contact_phone,
      email: s.contact_email, line: s.contact_line,
    },
    response: resp,
  };
  document.querySelectorAll('[data-f]').forEach((el) => {
    const [group, key] = el.dataset.f.split('.');
    setVal(el, source[group]?.[key] ?? null);
  });

  buildings.forEach((b) => {
    const card = document.querySelector(`.building-card[data-seq="${b.seq}"]`);
    if (!card) return;
    card.querySelectorAll('[data-b]').forEach((el) => setVal(el, b[el.dataset.b]));
  });

  bills.forEach((b) => {
    const row = document.querySelector(`tr[data-month="${b.month_no}"]`);
    if (!row) return;
    row.querySelectorAll('[data-bill]').forEach((el) => { el.value = b[el.dataset.bill] ?? ''; });
  });
}

function buildingCount() {
  return getVal(document.querySelector('[data-f="response.building_count"]')) || 0;
}

function collect() {
  const data = { unit: {}, contact: {}, response: {}, buildings: [], bills: [] };
  document.querySelectorAll('[data-f]').forEach((el) => {
    const [group, key] = el.dataset.f.split('.');
    data[group][key] = getVal(el);
  });

  // ไม่เคยติดตั้ง : ล้างข้อมูลระบบเดิม
  if (data.response.has_existing_solar !== 'เคย') {
    for (const k of ['existing_building', 'existing_kw', 'existing_condition',
      'existing_support_year', 'existing_support_agency', 'cod_permit']) {
      data.response[k] = null;
    }
  }

  const count = buildingCount();
  document.querySelectorAll('.building-card').forEach((card) => {
    const seq = Number(card.dataset.seq);
    if (seq > count) return;
    const b = { seq };
    card.querySelectorAll('[data-b]').forEach((el) => { b[el.dataset.b] = getVal(el); });
    if (b.demolition_plan !== 'มีแผน') b.demolition_note = null;
    if (b.roof_material !== 'อื่นๆ') b.roof_material_other = null;
    if (!(b.roof_age_years > ROOF_AGE_LIMIT)) b.roof_replace_plan = null;
    data.buildings.push(b);
  });

  document.querySelectorAll('tr[data-month]').forEach((row) => {
    const bill = { month_no: Number(row.dataset.month) };
    for (const f of BILL_FIELDS) {
      const v = row.querySelector(`[data-bill="${f.key}"]`).value.trim();
      bill[f.key] = v === '' ? null : Number(v);
    }
    data.bills.push(bill);
  });

  return data;
}

// ---------------------------------------------------------------------
// แสดง/ซ่อน คำถามตามคำตอบ
// ---------------------------------------------------------------------

function refreshVisibility() {
  const existing = getVal(document.querySelector('[data-f="response.has_existing_solar"]'));
  document.getElementById('existingBlock').classList.toggle('d-none', existing !== 'เคย');

  const count = buildingCount();
  document.querySelectorAll('.building-card').forEach((card) => {
    const seq = Number(card.dataset.seq);
    card.classList.toggle('d-none', seq > count);
    const v = (k) => getVal(card.querySelector(`[data-b="${k}"]`));
    card.querySelector('[data-when="demolition"]').classList.toggle('d-none', v('demolition_plan') !== 'มีแผน');
    card.querySelector('[data-when="material"]').classList.toggle('d-none', v('roof_material') !== 'อื่นๆ');
    card.querySelector('[data-when="roofage"]').classList.toggle('d-none', !(v('roof_age_years') > ROOF_AGE_LIMIT));
  });
}

function updateBillTotals() {
  const sum = (key) => [...document.querySelectorAll(`[data-bill="${key}"]`)]
    .reduce((t, el) => t + (Number(el.value) || 0), 0);
  document.getElementById('totalCost').textContent = fmtNum(sum('cost_baht'));
  document.getElementById('totalFt').textContent = fmtNum(sum('ft_units'));
}

// ---------------------------------------------------------------------
// ตรวจความครบถ้วนก่อนส่ง
// ---------------------------------------------------------------------

function validate() {
  document.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
  const problems = [];
  const mark = (el, msg) => {
    if (!el) return;
    el.classList.add('is-invalid');
    problems.push({ el, msg });
  };
  const isEmpty = (el) => getVal(el) === null;
  const visible = (el) => !el.closest('.d-none');

  // ข้อมูลทั่วไป (ยกเว้น ID LINE)
  document.querySelectorAll('[data-f]').forEach((el) => {
    if (el.dataset.f === 'contact.line' || !visible(el)) return;
    if (isEmpty(el)) mark(el, `กรุณากรอก: ${labelOf(el)}`);
  });

  const email = getVal(document.querySelector('[data-f="contact.email"]'));
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    mark(document.querySelector('[data-f="contact.email"]'), 'รูปแบบอีเมลไม่ถูกต้อง');
  }

  // อาคาร
  document.querySelectorAll('.building-card').forEach((card) => {
    if (!visible(card)) return;
    card.querySelectorAll('[data-b]').forEach((el) => {
      if (visible(el) && isEmpty(el)) mark(el, `อาคารที่ ${card.dataset.seq}: ${labelOf(el)}`);
    });
  });

  // ค่าไฟฟ้า
  document.querySelectorAll('[data-bill]').forEach((el) => {
    if (el.value.trim() === '') mark(el, 'กรุณากรอกข้อมูลค่าไฟฟ้าให้ครบ 12 เดือน');
  });

  // ไฟล์แนบ
  for (const kind of Object.keys(ATTACHMENTS)) {
    if (!attachments.some((a) => a.kind === kind)) {
      mark(document.querySelector(`[data-attach="${kind}"]`), `กรุณาแนบ${ATTACHMENTS[kind].label}`);
    }
  }
  return problems;
}

function labelOf(el) {
  const label = el.closest('[data-field]')?.querySelector('.form-label');
  return label ? label.textContent.replace('*', '').trim() : 'ข้อมูล';
}

// ---------------------------------------------------------------------
// บันทึก / ส่ง
// ---------------------------------------------------------------------

async function save(submit = false, { silent = false } = {}) {
  if (saving) return false;
  saving = true;
  setButtons(true);
  try {
    const data = collect();
    const { error } = await sb.rpc('save_solar_budget', {
      p_submission_id: submission.id, p_data: data, p_submit: false,
    });
    if (error) throw error;
    dirty = false;

    if (submit) {
      const { data: status, error: e2 } = await sb.rpc('save_solar_budget', {
        p_submission_id: submission.id, p_data: data, p_submit: true,
      });
      if (e2) throw e2;
      submission.status = status;
    }
    document.getElementById('saveInfo').textContent = `บันทึกล่าสุด ${fmtDate(new Date())}`;
    if (!silent) toast(submit ? 'ส่งแบบสำรวจเรียบร้อยแล้ว' : 'บันทึกร่างเรียบร้อย', 'success');
    return true;
  } catch (e) {
    toast(errMsg(e), 'danger');
    return false;
  } finally {
    saving = false;
    setButtons(false);
  }
}

function setButtons(disabled) {
  for (const id of ['btnDraft', 'btnSubmit']) {
    const b = document.getElementById(id);
    if (b) b.disabled = disabled;
  }
}

async function onSubmit() {
  const problems = validate();
  if (problems.length) {
    problems[0].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`ยังกรอกข้อมูลไม่ครบ ${problems.length} รายการ : ${problems[0].msg}`, 'danger');
    return;
  }
  if (!confirm('ยืนยันส่งแบบสำรวจ?\nหลังส่งแล้วจะแก้ไขไม่ได้ จนกว่าส่วนกลางจะส่งกลับให้แก้ไข')) return;
  if (await save(true)) {
    setTimeout(() => location.reload(), 1200);
  }
}

// ---------------------------------------------------------------------
// ไฟล์แนบ
// ---------------------------------------------------------------------

function renderAttachments() {
  for (const kind of Object.keys(ATTACHMENTS)) {
    const box = document.querySelector(`[data-attach="${kind}"] .file-list`);
    const files = attachments.filter((a) => a.kind === kind);
    box.innerHTML = files.length
      ? files.map((f) => `
          <div class="file-row">
            <i class="bi bi-file-earmark-pdf text-danger"></i>
            <span class="name">${esc(f.file_name)}</span>
            <span class="small text-muted">${fmtSize(f.size_bytes)}</span>
            <button type="button" class="btn btn-sm btn-link" data-open="${esc(f.storage_path)}">เปิด</button>
            <button type="button" class="btn btn-sm btn-outline-danger btn-file-remove" data-remove="${esc(f.id)}"><i class="bi bi-trash"></i></button>
          </div>`).join('')
      : '<div class="small text-muted mb-2">ยังไม่มีไฟล์แนบ</div>';
  }
}

async function uploadFiles(kind, fileList, statusEl) {
  const files = [...fileList];
  for (const [i, file] of files.entries()) {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      toast(`${file.name} : รองรับเฉพาะไฟล์ PDF`, 'danger');
      continue;
    }
    if (file.size > MAX_FILE_MB * 1048576) {
      toast(`${file.name} : ไฟล์ใหญ่เกิน ${MAX_FILE_MB} MB`, 'danger');
      continue;
    }
    statusEl.textContent = `กำลังอัปโหลด ${i + 1}/${files.length} : ${file.name}`;
    const path = `${submission.id}/${kind}/${uuid()}.pdf`;
    // บางเครื่องส่งไฟล์ PDF มาโดยไม่ระบุชนิดไฟล์ จึงกำหนดให้เป็น application/pdf เสมอ
    const body = new Blob([file], { type: 'application/pdf' });
    const { error: upErr } = await sb.storage.from('attachments')
      .upload(path, body, { contentType: 'application/pdf', upsert: false });
    if (upErr) {
      toast(`${file.name} : ${errMsg(upErr)}`, 'danger');
      continue;
    }
    const { data: row, error: dbErr } = await sb.from('attachments').insert({
      submission_id: submission.id,
      kind,
      storage_path: path,
      file_name: file.name,
      mime_type: 'application/pdf',
      size_bytes: file.size,
      uploaded_by: (await sb.auth.getUser()).data.user.id,
    }).select().single();
    if (dbErr) {
      await sb.storage.from('attachments').remove([path]);
      toast(`${file.name} : ${errMsg(dbErr)}`, 'danger');
      continue;
    }
    attachments.push(row);
    document.querySelector(`[data-attach="${kind}"]`).classList.remove('is-invalid');
    renderAttachments();
  }
  statusEl.textContent = '';
}

async function removeFile(id) {
  const f = attachments.find((a) => a.id === id);
  if (!f || !confirm(`ลบไฟล์ ${f.file_name} ?`)) return;
  const { error: e1 } = await sb.storage.from('attachments').remove([f.storage_path]);
  if (e1) return toast(errMsg(e1), 'danger');
  const { error: e2 } = await sb.from('attachments').delete().eq('id', id);
  if (e2) return toast(errMsg(e2), 'danger');
  attachments = attachments.filter((a) => a.id !== id);
  renderAttachments();
}

// ---------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------

function bindEvents() {
  const form = document.getElementById('surveyForm');
  form.addEventListener('input', (e) => {
    dirty = true;
    e.target.classList.remove('is-invalid');
    e.target.closest('[data-kind="radio"]')?.classList.remove('is-invalid');
    if (e.target.matches('[data-bill]')) updateBillTotals();
    refreshVisibility();
  });
  form.addEventListener('change', (e) => {
    dirty = true;
    e.target.classList.remove('is-invalid');
    e.target.closest('[data-kind="radio"]')?.classList.remove('is-invalid');
    refreshVisibility();
  });

  main.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) openAttachment(open.dataset.open);
    const rm = e.target.closest('[data-remove]');
    if (rm && editable) removeFile(rm.dataset.remove);
  });

  document.querySelectorAll('[data-attach] input[type=file]').forEach((input) => {
    input.addEventListener('change', async () => {
      const box = input.closest('[data-attach]');
      await uploadFiles(box.dataset.attach, input.files, box.querySelector('.upload-status'));
      input.value = '';
    });
  });

  document.getElementById('btnDraft')?.addEventListener('click', () => save(false));
  document.getElementById('btnSubmit')?.addEventListener('click', onSubmit);

  // บันทึกร่างอัตโนมัติทุก 2 นาที เมื่อมีการแก้ไข
  if (editable) {
    setInterval(() => { if (dirty && !saving) save(false, { silent: true }); }, 120000);
  }

  window.addEventListener('beforeunload', (e) => {
    if (dirty && editable) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
