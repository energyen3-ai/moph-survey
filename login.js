import { sb, toast, errMsg } from './app.js';

// ถ้า login อยู่แล้ว ไปหน้าหลักเลย
const { data: { session } } = await sb.auth.getSession();
if (session) location.replace('home.html');

function busy(form, on) {
  form.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });
}

document.getElementById('tabLogin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  busy(form, true);
  const { error } = await sb.auth.signInWithPassword({
    email: document.getElementById('loginEmail').value.trim(),
    password: document.getElementById('loginPassword').value,
  });
  busy(form, false);
  if (error) return toast(errMsg(error), 'danger');
  location.replace('home.html');
});

document.getElementById('tabRegister').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const password = document.getElementById('regPassword').value;
  if (password !== document.getElementById('regPassword2').value) {
    return toast('รหัสผ่านทั้งสองช่องไม่ตรงกัน', 'danger');
  }
  busy(form, true);
  const { data, error } = await sb.auth.signUp({
    email: document.getElementById('regEmail').value.trim(),
    password,
    options: { data: { full_name: document.getElementById('regName').value.trim() } },
  });
  busy(form, false);
  if (error) return toast(errMsg(error), 'danger');
  if (data.session) {
    location.replace('home.html');
  } else {
    toast('สมัครสำเร็จ กรุณายืนยันอีเมล แล้วเข้าสู่ระบบ', 'success');
  }
});

document.getElementById('linkForgot').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim()
    || prompt('กรอกอีเมลที่ใช้สมัคร เพื่อรับลิงก์ตั้งรหัสผ่านใหม่');
  if (!email) return;
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('reset.html', location.href).href,
  });
  if (error) return toast(errMsg(error), 'danger');
  toast('ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว', 'success');
});
