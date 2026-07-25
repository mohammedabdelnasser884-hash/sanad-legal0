import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// خطوة تنظيف الـCI (تقرير المرحلة 4، "الخطوة الجاية") — الجزء الأول.
// بيسجّل وقت بداية تشغيل التستات في ملف مؤقت جوه e2e/، عشان
// global-teardown.ts يقدر يحدد "الصفوف اللي اتعملت بعد بداية التشغيل"
// (الشرط ب من الخطة). لازم ملف مش env var، لإن Playwright بيشغّل
// globalSetup وglobalTeardown كـ Node process منفصل عن process التستات
// نفسها في بعض الحالات، فـ env var مش مضمون ينتقل بينهم.
//
// ⚠️ FIX: المشروع "type": "module" (ESM)، فـ __dirname مش موجود تلقائيًا
// في ملفات .ts زي CommonJS — كان بيرمي "ReferenceError: __dirname is not
// defined" ويكسر e2e بالكامل قبل ما أي تست يشتغل. بنبنيه يدويًا من
// import.meta.url بدل ما نعتمد عليه كمتغيّر global جاهز.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const START_TIME_FILE = path.join(__dirname, '.e2e-start-time');

export default function globalSetup(): void {
  writeFileSync(START_TIME_FILE, new Date().toISOString(), 'utf-8');
}
