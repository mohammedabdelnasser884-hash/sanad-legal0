// ══════════════════════════════════════════════════════════════
//  partyDisplay.test.ts — تيستات isGenericPartyCapacityLabel/
//  effectiveLegalTitleForDisplay (توحيد المسمى القانوني الجامع —
//  8 أغسطس 2026). شوف partyDisplay.ts للسياق الكامل.
// ══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { isGenericPartyCapacityLabel, effectiveLegalTitleForDisplay } from './partyDisplay';

describe('isGenericPartyCapacityLabel', () => {
  it('بيرجع true لصفة إجرائية عامة بس (تطابق كامل)', () => {
    expect(isGenericPartyCapacityLabel('متهمين')).toBe(true);
    expect(isGenericPartyCapacityLabel('المتهمين')).toBe(true);
    expect(isGenericPartyCapacityLabel('مدعيين')).toBe(true);
    expect(isGenericPartyCapacityLabel('مدعى عليهم')).toBe(true);
    expect(isGenericPartyCapacityLabel('طاعنين')).toBe(true);
    expect(isGenericPartyCapacityLabel('خصوم')).toBe(true);
  });

  it('بيرجع true لـ"ورثة"/"الورثة" لوحدها من غير اسم بعدها', () => {
    expect(isGenericPartyCapacityLabel('ورثة')).toBe(true);
    expect(isGenericPartyCapacityLabel('الورثة')).toBe(true);
  });

  it('بيرجع false لمسمى مميّز فعلي (فيه اسم/تفاصيل زيادة عن الصفة)', () => {
    expect(isGenericPartyCapacityLabel('ورثة المرحوم أحمد علي')).toBe(false);
    expect(isGenericPartyCapacityLabel('الورثة الشرعيون لحسام الدين')).toBe(false);
    expect(isGenericPartyCapacityLabel('شركة بيت التأمين السعودي')).toBe(false);
  });

  it('بيرجع false للنص الفاضي/null/undefined', () => {
    expect(isGenericPartyCapacityLabel('')).toBe(false);
    expect(isGenericPartyCapacityLabel('   ')).toBe(false);
    expect(isGenericPartyCapacityLabel(null)).toBe(false);
    expect(isGenericPartyCapacityLabel(undefined)).toBe(false);
  });

  // ⚡ FIX (تطبيع الألف المقصورة/الياء والتاء المربوطة/الهاء — 9 أغسطس
  // 2026): إملاءات شائعة بديلة كانت بتفوت من المطابقة الحرفية القديمة.
  it('بيرجع true للإملاء الشائع بالياء العادية بدل الألف المقصورة', () => {
    expect(isGenericPartyCapacityLabel('مدعي عليهم')).toBe(true);
    expect(isGenericPartyCapacityLabel('المدعي عليهم')).toBe(true);
    expect(isGenericPartyCapacityLabel('مدعي عليه')).toBe(true);
    expect(isGenericPartyCapacityLabel('مدعي عليها')).toBe(true);
  });

  it('بيرجع true للإملاء الشائع بالهاء بدل التاء المربوطة', () => {
    expect(isGenericPartyCapacityLabel('ورثه')).toBe(true);
    expect(isGenericPartyCapacityLabel('الورثه')).toBe(true);
    expect(isGenericPartyCapacityLabel('متهمه')).toBe(true);
    expect(isGenericPartyCapacityLabel('طالبه')).toBe(true);
  });

  it('بيغطي صيغ الجمع المؤنث لكل الصفات', () => {
    expect(isGenericPartyCapacityLabel('مدعيات')).toBe(true);
    expect(isGenericPartyCapacityLabel('متهمات')).toBe(true);
    expect(isGenericPartyCapacityLabel('مستأنفات')).toBe(true);
    expect(isGenericPartyCapacityLabel('طاعنات')).toBe(true);
    expect(isGenericPartyCapacityLabel('طالبات')).toBe(true);
    expect(isGenericPartyCapacityLabel('مدعى عليهن')).toBe(true);
    expect(isGenericPartyCapacityLabel('مطلوب ضدهن')).toBe(true);
    expect(isGenericPartyCapacityLabel('منفذ ضدهن')).toBe(true);
    expect(isGenericPartyCapacityLabel('وارثة')).toBe(true);
    expect(isGenericPartyCapacityLabel('وارثات')).toBe(true);
  });

  it('بيغطي صيغة المؤنث المفرد لـ"طالب"', () => {
    expect(isGenericPartyCapacityLabel('طالبة')).toBe(true);
    expect(isGenericPartyCapacityLabel('الطالبة')).toBe(true);
  });

  // ⚠️ لازم يفضل false حتى بعد التطبيع — "ورثة المرحوم" فيها اسم زيادة
  // عن الصفة نفسها، فمفروض تتعامل كمسمى مميّز مش صفة عامة.
  it('التطبيع مايخليش مسمى مميّز فعلي يتعامل كصفة عامة بالغلط', () => {
    expect(isGenericPartyCapacityLabel('ورثة المرحوم أحمد علي')).toBe(false);
    expect(isGenericPartyCapacityLabel('ورثه المرحوم أحمد علي')).toBe(false);
  });
});

describe('effectiveLegalTitleForDisplay', () => {
  it('بيرجع "" (يعني استخدم الاسم الحقيقي) لصفة عامة بس', () => {
    expect(effectiveLegalTitleForDisplay('متهمين')).toBe('');
    expect(effectiveLegalTitleForDisplay('مدعيين')).toBe('');
  });

  it('بيرجع النص زي ما هو لمسمى مميّز فعلي', () => {
    expect(effectiveLegalTitleForDisplay('ورثة المرحوم أحمد علي')).toBe('ورثة المرحوم أحمد علي');
  });

  it('بيرجع "" للنص الفاضي/null/undefined', () => {
    expect(effectiveLegalTitleForDisplay('')).toBe('');
    expect(effectiveLegalTitleForDisplay(null)).toBe('');
    expect(effectiveLegalTitleForDisplay(undefined)).toBe('');
  });
});
