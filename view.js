// =====================================================================
// ดูข้อมูลแบบสำรวจที่ส่งมา (ส่วนกลาง) + ส่งกลับแก้ไข
// =====================================================================

import {
  sb, esc, qs, toast, errMsg, loadProfile, renderNav, statusBadge, fmtDate, fmtNum,
  showError, openAttachment, fmtSize,
} from './app.js';
import { ATTACHMENTS, BILL_FIELDS, EXPORT_BUILDINGS } from './solar-budget-schema.js';

const main = document.getElementById('main');

try {
  const profile = await loadProfile();
  renderNav(profile);
  await render(profile);
} catch (e) {
  if (e.message !== 'not logged in') showError(main, e);
}

async function render(profile) {
  const id = qs('id');
  const { data: s, error } = await sb.from('submissions')
    .select('*, unit:units(*), round:survey_rounds(*)').eq('id', id).single();
  if (error) throw error;

  const [resp, buildings, bills, files] = await Promise.all([
    sb.from('solar_budget_responses').select('*').eq('submission_id', id).maybeSingle(),
    sb.from('solar_budget_buildings').select('*').eq('submission_id', id).order('seq'),
    sb.from('solar_budget_bills').select('*').eq('submission_id', id).order('month_no'),
    sb.from('attachments').select('*').eq('submission_id', id).order('created_at'),
  ]);
  for (const res of [resp, buildings, bills, files]) if (res.error) throw res.error;
  const r = resp.data || {};
  const months = s.round.settings?.bill_months || [];

  const rows = (pairs) => `<table class="table table-sm view-table mb-0"><tbody>
    ${pairs.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${value === null || value === undefined || value === '' ? '<span class="text-muted">-</span>' : esc(value)}</td></tr>`).join('')}
  </tbody></table>`;

  const buildingLabels = Object.fromEntries(EXPORT_BUILDINGS);
  const buildingKeys = EXPORT_BUILDINGS.map(([k]) => k).filter((k) => !['fiscal_year', 'region', 'province', 'hcode', 'unit_name', 'status', 'seq'].includes(k));

  const fileList = (kind) => {
    const list = files.data.filter((f) => f.kind === kind);
    return list.length ? list.map((f) => `
      <div class="file-row">
        <i class="bi bi-file-earmark-pdf text-danger"></i>
        <span class="name">${esc(f.file_name)}</span>
        <span class="small text-muted">${fmtSize(f.size_bytes)}</span>
        <button class="btn btn-sm btn-outline-primary" data-open="${esc(f.storage_path)}"><i class="bi bi-box-arrow-up-right me-1"></i>เปิด</button>
      </div>`).join('') : '<div class="text-muted small">ไม่มีไฟล์</div>';
  };

  let totalCost = 0;
  let totalFt = 0;
  bills.data.forEach((b) => { totalCost += Number(b.cost_baht) || 0; totalFt += Number(b.ft_units) || 0; });

  main.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3 no-print">
      <a href="${profile.role === 'admin' ? 'admin.html' : 'home.html'}" class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-left me-1"></i>กลับ</a>
      <button class="btn btn-sm btn-outline-secondary" onclick="window.print()"><i class="bi bi-printer me-1"></i>พิมพ์</button>
    </div>

    <div class="hero p-4 mb-4">
      <div class="d-flex justify-content-between flex-wrap gap-2">
        <span class="badge text-bg-light border">ปีงบประมาณ ${esc(s.round.fiscal_year)}</span>
        ${statusBadge(s.status)}
      </div>
      <h1 class="h5 fw-bold mt-2 mb-1">${esc(s.unit.hcode)} ${esc(s.unit.name)}</h1>
      <div class="small text-muted">${esc(s.round.title)}</div>
      <div class="small text-muted">ส่งเมื่อ ${fmtDate(s.submitted_at)} · แก้ไขล่าสุด ${fmtDate(s.updated_at)}</div>
    </div>

    ${s.status === 'returned' ? `<div class="alert alert-danger"><b>ส่งกลับแก้ไขแล้ว:</b> ${esc(s.review_note || '-')}</div>` : ''}

    ${profile.role === 'admin' && s.status === 'submitted' ? `
      <div class="card p-3 mb-4 no-print">
        <label class="form-label" for="returnNote">ส่งกลับให้หน่วยงานแก้ไข (ระบุสิ่งที่ต้องแก้)</label>
        <textarea class="form-control mb-2" id="returnNote" rows="2" placeholder="เช่น ใบแจ้งหนี้ค่าไฟฟ้าไม่ครบ 12 เดือน"></textarea>
        <div><button class="btn btn-outline-danger btn-sm" id="btnReturn"><i class="bi bi-arrow-return-left me-1"></i>ส่งกลับแก้ไข</button></div>
      </div>` : ''}

    <section class="card p-4 mb-4">
      <div class="section-title"><span class="num">1</span>หน่วยงานและผู้ประสานงาน</div>
      ${rows([
        ['ตำบล / อำเภอ / จังหวัด', `${s.subdistrict || '-'} / ${s.district || '-'} / ${s.unit.province || '-'}`],
        ['เขตสุขภาพ', s.unit.region],
        ['ผู้ประสานงาน', s.contact_name],
        ['ตำแหน่ง', s.contact_position],
        ['เบอร์มือถือ', s.contact_phone],
        ['E-mail', s.contact_email],
        ['ID LINE', s.contact_line],
      ])}
    </section>

    <section class="card p-4 mb-4">
      <div class="section-title"><span class="num">2</span>ระบบ Solar เดิม</div>
      ${rows([
        ['เคยติดตั้งระบบ Solar', r.has_existing_solar],
        ...(r.has_existing_solar === 'เคย' ? [
          ['อาคารที่ติดตั้งระบบเดิม', r.existing_building],
          ['กำลังผลิตติดตั้งรวม (kW)', fmtNum(r.existing_kw)],
          ['สภาพระบบ', r.existing_condition],
          ['ปี พ.ศ. ที่ได้รับการสนับสนุน', r.existing_support_year],
          ['หน่วยงานที่สนับสนุน', r.existing_support_agency],
          ['ใบขนานไฟ', r.cod_permit],
        ] : []),
      ])}
    </section>

    <section class="card p-4 mb-4">
      <div class="section-title"><span class="num">3</span>อาคารที่จะติดตั้ง (${esc(r.building_count ?? '-')} อาคาร)</div>
      ${rows([
        ['เคยดัดแปลงอาคาร', r.building_modified],
        ['อาคารที่มีการใช้ไฟฟ้าสูง', r.high_load_building],
        ['ลักษณะการใช้ไฟฟ้า', r.load_profile],
      ])}
      ${buildings.data.map((b) => `
        <div class="card building-card p-3 mt-3">
          <div class="fw-bold mb-2">อาคารที่ ${b.seq}</div>
          ${rows(buildingKeys.map((k) => [buildingLabels[k], b[k]]))}
        </div>`).join('')}
      <div class="mt-3"><div class="fw-semibold mb-2">${esc(ATTACHMENTS.blueprint.label)}</div>${fileList('blueprint')}</div>
    </section>

    <section class="card p-4 mb-4">
      <div class="section-title"><span class="num">4</span>ความมั่นคงของระบบไฟฟ้า</div>
      ${rows([
        ['อยู่ปลายสายส่งการไฟฟ้า', r.end_of_line],
        ['ความถี่ไฟฟ้าดับ', r.outage_frequency],
        ['ช่วงเวลาไฟฟ้าดับบ่อยที่สุด', r.outage_time],
      ])}
    </section>

    <section class="card p-4 mb-4">
      <div class="section-title"><span class="num">5</span>ค่าไฟฟ้าย้อนหลัง 12 เดือน</div>
      <div class="table-responsive">
        <table class="table table-sm bill-table">
          <thead class="table-light"><tr><th>เดือน</th>${BILL_FIELDS.map((f) => `<th class="text-end">${esc(f.label)}</th>`).join('')}</tr></thead>
          <tbody>
            ${bills.data.map((b) => `<tr><td>${esc(months[b.month_no - 1] || `เดือนที่ ${b.month_no}`)}</td>
              ${BILL_FIELDS.map((f) => `<td class="text-end">${fmtNum(b[f.key])}</td>`).join('')}</tr>`).join('')}
          </tbody>
          <tfoot><tr class="fw-bold"><td>รวม</td><td class="text-end">${fmtNum(totalCost)}</td><td></td><td></td><td class="text-end">${fmtNum(totalFt)}</td></tr></tfoot>
        </table>
      </div>
      <div class="mt-2"><div class="fw-semibold mb-2">${esc(ATTACHMENTS.electric_bill.label)}</div>${fileList('electric_bill')}</div>
    </section>`;

  main.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) openAttachment(open.dataset.open);
    if (e.target.closest('#btnReturn')) {
      const note = document.getElementById('returnNote').value.trim();
      if (!note) return toast('กรุณาระบุสิ่งที่ต้องแก้ไข', 'danger');
      if (!confirm('ส่งกลับให้หน่วยงานแก้ไข?')) return;
      const { error: err } = await sb.rpc('return_submission', { p_id: id, p_note: note });
      if (err) return toast(errMsg(err), 'danger');
      toast('ส่งกลับแก้ไขแล้ว');
      setTimeout(() => location.reload(), 800);
    }
  });
}
