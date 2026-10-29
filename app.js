// =====================================================================
// ฟังก์ชันกลางที่ทุกหน้าใช้ร่วมกัน
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// แบบสำรวจแต่ละชนิด เปิดด้วยหน้าไหน (เพิ่มแบบสำรวจใหม่ที่นี่)
export const SURVEY_PAGES = {
  solar_budget: 'solar-budget.html',
};

export const STATUS = {
  none:      { label: 'ยังไม่เริ่ม',      cls: 'secondary' },
  draft:     { label: 'บันทึกร่าง',       cls: 'warning'   },
  submitted: { label: 'ส่งแล้ว',          cls: 'success'   },
  returned:  { label: 'ส่งกลับแก้ไข',     cls: 'danger'    },
};

export function statusBadge(status) {
  const s = STATUS[status || 'none'] || STATUS.none;
  return `<span class="badge text-bg-${s.cls}">${s.label}</span>`;
}

// ป้องกันข้อความที่ผู้ใช้กรอกถูกตีความเป็น HTML
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// รหัสสุ่มสำหรับตั้งชื่อไฟล์ (crypto.randomUUID ใช้ได้เฉพาะ https)
export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtNum(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '-';
  return Number(value).toLocaleString('th-TH', { maximumFractionDigits: digits });
}

export function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  return b >= 1048576 ? `${fmtNum(b / 1048576, 1)} MB` : `${fmtNum(Math.max(1, b / 1024), 0)} KB`;
}

// ข้อความแจ้งเตือนมุมจอ
export function toast(message, type = 'success') {
  let box = document.getElementById('toastBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toastBox';
    box.className = 'toast-container position-fixed top-0 end-0 p-3';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  el.className = `toast align-items-center text-bg-${type} border-0`;
  el.role = 'alert';
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${esc(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>`;
  box.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: type === 'danger' ? 8000 : 4000 });
  el.addEventListener('hidden.bs.toast', () => el.remove());
  t.show();
}

// แปลงข้อความ error จาก Supabase ให้อ่านง่าย
export function errMsg(error) {
  const m = error?.message || String(error);
  if (/Invalid login credentials/i.test(m)) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (/already registered/i.test(m)) return 'อีเมลนี้สมัครสมาชิกแล้ว กรุณาเข้าสู่ระบบ';
  if (/Password should be/i.test(m)) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
  if (/Email not confirmed/i.test(m)) return 'อีเมลยังไม่ได้ยืนยัน (ผู้ดูแลระบบต้องปิด Confirm email)';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต';
  if (/mime type|invalid_mime/i.test(m)) return 'รองรับเฉพาะไฟล์ PDF เท่านั้น';
  if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return 'ไฟล์มีขนาดใหญ่เกินกำหนด';
  return m;
}

// ดึงข้อมูลเกิน 1,000 แถว (Supabase จำกัด 1,000 แถวต่อครั้ง)
export async function fetchAll(buildQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

// ต้อง login ก่อน ไม่งั้นกลับไปหน้าแรก
export async function requireSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.replace('index.html');
    throw new Error('not logged in');
  }
  return session;
}

// โปรไฟล์ผู้ใช้ + ข้อมูลหน่วยงาน
export async function loadProfile() {
  const session = await requireSession();
  const { data, error } = await sb
    .from('profiles')
    .select('id, email, full_name, role, hcode, unit:units(hcode, name, unit_type, region, province, district, subdistrict)')
    .eq('id', session.user.id)
    .single();
  if (error) throw error;
  return data;
}

export async function logout() {
  await sb.auth.signOut();
  location.replace('index.html');
}

// แถบเมนูด้านบน
export function renderNav(profile) {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const who = profile.role === 'admin'
    ? 'ผู้ดูแลระบบ (ส่วนกลาง)'
    : (profile.unit ? `${profile.unit.hcode} ${profile.unit.name}` : 'ยังไม่ผูกหน่วยงาน');
  nav.innerHTML = `
    <nav class="navbar navbar-expand navbar-dark app-navbar mb-4">
      <div class="container">
        <a class="navbar-brand fw-bold" href="home.html"><i class="bi bi-sun me-2"></i>${esc(APP_NAME)}</a>
        <div class="d-flex align-items-center gap-2 small">
          ${profile.role === 'admin' ? '<a class="btn btn-sm btn-light" href="admin.html"><i class="bi bi-speedometer2"></i><span class="d-none d-sm-inline ms-1">ส่วนกลาง</span></a>' : ''}
          <span class="text-white-50 d-none d-md-inline">${esc(who)}</span>
          <button class="btn btn-sm btn-outline-light" id="btnLogout"><i class="bi bi-box-arrow-right"></i><span class="d-none d-sm-inline ms-1">ออกจากระบบ</span></button>
        </div>
      </div>
    </nav>`;
  document.getElementById('btnLogout').addEventListener('click', logout);
}

// ให้ Excel เก็บเป็นข้อความ ไม่ตัดเลข 0 ข้างหน้า (รหัสหน่วยงาน, เบอร์โทร)
export function asText(value) {
  return value === null || value === undefined || value === '' ? '' : `="${String(value).replace(/"/g, '""')}"`;
}

// สร้างไฟล์ CSV (มี BOM ให้ Excel อ่านภาษาไทยได้)
export function downloadCsv(filename, header, rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// เปิดไฟล์แนบ (ลิงก์ชั่วคราว 1 ชั่วโมง)
export async function openAttachment(path) {
  const { data, error } = await sb.storage.from('attachments').createSignedUrl(path, 3600);
  if (error) return toast(errMsg(error), 'danger');
  window.open(data.signedUrl, '_blank', 'noopener');
}

export function showError(container, error) {
  container.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle me-2"></i>${esc(errMsg(error))}</div>`;
}
