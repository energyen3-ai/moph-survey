// =====================================================================
// ค่าเชื่อมต่อ Supabase
// คัดลอกจาก Supabase > Project Settings > API (หรือ Data API / API Keys)
//   SUPABASE_URL      = Project URL
//   SUPABASE_ANON_KEY = anon public key (หรือ Publishable key)
// ทั้งสองค่านี้เปิดเผยได้ ความปลอดภัยของข้อมูลมาจาก RLS ในฐานข้อมูล
// ห้ามใส่ service_role key หรือ Secret key ในไฟล์นี้เด็ดขาด
// =====================================================================

export const SUPABASE_URL = 'https://srcvcmspaztkvecrwkuh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyY3ZjbXNwYXp0a3ZlY3J3a3VoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMzE3NzgsImV4cCI6MjEwODgwNzc3OH0.bjAPJ8uBJaFioEG4ICspN0e8_OVLzhulRqgkLybpMf0';

// ชื่อระบบที่แสดงบนหน้าเว็บ
export const APP_NAME = 'ระบบสำรวจข้อมูล สป.สธ.';

// ขนาดไฟล์แนบสูงสุด (MB) ต้องไม่เกินค่าที่ตั้งใน Storage bucket (10 MB)
export const MAX_FILE_MB = 10;
