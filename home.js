import {
  sb, esc, toast, errMsg, loadProfile, renderNav, statusBadge, fmtDate, showError, SURVEY_PAGES,
} from './app.js';

const main = document.getElementById('main');

try {
  const profile = await loadProfile();
  renderNav(profile);

  if (profile.role === 'admin') {
    location.replace('admin.html');
  } else if (!profile.hcode) {
    renderClaim();
  } else {
    await renderUnitHome(profile);
  }
} catch (e) {
  if (e.message !== 'not logged in') showError(main, e);
}

// ผูกบัญชีกับหน่วยงาน
function renderClaim() {
  main.innerHTML = `
    <div class="card p-4 mx-auto" style="max-width: 520px;">
      <h1 class="h5 fw-bold mb-2"><i class="bi bi-link-45deg me-2"></i>ผูกบัญชีกับหน่วยงาน</h1>
      <p class="text-muted small">กรอกรหัสหน่วยงาน 5 หลัก และรหัสลงทะเบียนที่ได้รับจากส่วนกลาง (ทำครั้งเดียว)</p>
      <form id="formClaim">
        <div class="mb-3">
          <label class="form-label" for="claimHcode">รหัสหน่วยงาน (5 หลัก)</label>
          <input class="form-control" id="claimHcode" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" required placeholder="เช่น 01234">
        </div>
        <div class="mb-3">
          <label class="form-label" for="claimCode">รหัสลงทะเบียน</label>
          <input class="form-control text-uppercase" id="claimCode" required placeholder="เช่น AB12CD34">
        </div>
        <button class="btn btn-primary w-100" type="submit">ยืนยัน</button>
      </form>
    </div>`;

  document.getElementById('formClaim').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.rpc('claim_unit', {
      p_hcode: document.getElementById('claimHcode').value,
      p_code: document.getElementById('claimCode').value,
    });
    btn.disabled = false;
    if (error) return toast(errMsg(error), 'danger');
    toast('ผูกบัญชีกับหน่วยงานเรียบร้อย', 'success');
    setTimeout(() => location.reload(), 800);
  });
}

// หน้าหลักของ รพ. : แสดงรอบสำรวจที่เปิดอยู่ และสถานะการส่ง
async function renderUnitHome(profile) {
  const [{ data: rounds, error: e1 }, { data: subs, error: e2 }] = await Promise.all([
    sb.from('survey_rounds').select('*').order('fiscal_year', { ascending: false }),
    sb.from('submissions').select('id, round_id, status, submitted_at, updated_at, review_note'),
  ]);
  if (e1 || e2) throw e1 || e2;

  const byRound = Object.fromEntries(subs.map((s) => [s.round_id, s]));
  const u = profile.unit;

  const cards = rounds
    .filter((r) => r.is_open || byRound[r.id])
    .map((r) => {
      const s = byRound[r.id];
      const page = SURVEY_PAGES[r.survey_code];
      const canEdit = r.is_open && (!s || s.status !== 'submitted');
      const btnLabel = !s ? 'เริ่มกรอกแบบสำรวจ' : (canEdit ? 'กรอกต่อ / แก้ไข' : 'ดูข้อมูลที่ส่ง');
      return `
        <div class="col-lg-6">
          <div class="card h-100 p-4">
            <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
              <span class="badge text-bg-light border">ปีงบประมาณ ${esc(r.fiscal_year)}</span>
              ${statusBadge(s?.status)}
            </div>
            <h2 class="h6 fw-bold">${esc(r.title)}</h2>
            <div class="small text-muted mb-3">
              ${r.closes_at ? `ปิดรับ: ${fmtDate(r.closes_at)}<br>` : ''}
              ${s?.submitted_at ? `ส่งเมื่อ: ${fmtDate(s.submitted_at)}` : (s ? `แก้ไขล่าสุด: ${fmtDate(s.updated_at)}` : '')}
              ${!r.is_open ? '<span class="text-danger">ปิดรับข้อมูลแล้ว</span>' : ''}
            </div>
            ${s?.status === 'returned' ? `<div class="alert alert-danger small py-2"><b>ส่วนกลางขอให้แก้ไข:</b> ${esc(s.review_note || '-')}</div>` : ''}
            ${page ? `<a class="btn btn-${canEdit ? 'primary' : 'outline-primary'} mt-auto" href="${page}?round=${r.id}">${btnLabel}</a>` : ''}
          </div>
        </div>`;
    }).join('');

  main.innerHTML = `
    <div class="hero p-4 mb-4">
      <div class="small text-muted">หน่วยงานของท่าน</div>
      <div class="h5 fw-bold mb-1">${esc(u.hcode)} ${esc(u.name)}</div>
      <div class="small text-muted">${esc(u.unit_type || '')} · จ.${esc(u.province || '-')} · ${esc(u.region || '')}</div>
    </div>
    <h1 class="h5 fw-bold mb-3"><i class="bi bi-clipboard-check me-2"></i>แบบสำรวจ</h1>
    <div class="row g-3">${cards || '<div class="col"><div class="alert alert-light border">ขณะนี้ยังไม่มีแบบสำรวจที่เปิดรับข้อมูล</div></div>'}</div>`;
}
