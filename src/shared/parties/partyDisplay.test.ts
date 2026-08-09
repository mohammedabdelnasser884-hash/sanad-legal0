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

  it('بيتجاهل مسافات فاضية حوالين النص وقت المقارنة', () => {
    expect(isGenericPartyCapacityLabel('  متهمين  ')).toBe(true);
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
