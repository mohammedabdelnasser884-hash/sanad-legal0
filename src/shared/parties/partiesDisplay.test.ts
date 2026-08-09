// ══════════════════════════════════════════════════════════════
//  partiesDisplay.test.ts — تيستات derivePartiesDisplay/derivePartiesLine
//  بعد إصلاح المسمى القانوني الجامع العام (8 أغسطس 2026). شوف
//  partiesDisplay.ts للسياق الكامل.
// ══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { derivePartiesDisplay, derivePartiesLine, deriveFullPartiesDisplay, deriveFullPartiesLine, type PartyDisplayRow } from './partiesDisplay';

describe('derivePartiesDisplay', () => {
  it('بيدّي أولوية للاسم الحقيقي من case_parties لو موجودة، حتى لو legal_title صفة عامة', () => {
    const parties: PartyDisplayRow[] = [
      { side: 'plaintiff', name: 'حسام الدين محمد احمد' },
      { side: 'plaintiff', name: 'حسن محمد احمد' },
    ];
    const result = derivePartiesDisplay(parties, {
      plaintiffLegalTitle: 'متهمين',
      defendant: 'شركة بيت التأمين السعودي',
    });
    expect(result.plaintiff).toBe('حسام الدين محمد احمد وآخرون');
  });

  it('مفيش case_parties خالص + legal_title صفة عامة → بيرجع للاسم المفرد القديم (fallback.plaintiff)، مش الصفة', () => {
    const result = derivePartiesDisplay([], {
      plaintiff: 'حسام الدين محمد احمد',
      plaintiffLegalTitle: 'متهمين',
    });
    expect(result.plaintiff).toBe('حسام الدين محمد احمد');
  });

  it('مفيش case_parties خالص + legal_title مسمى مميّز فعلي → بيُستخدم زي ما هو', () => {
    const result = derivePartiesDisplay([], {
      plaintiff: 'حسام الدين محمد احمد',
      plaintiffLegalTitle: 'ورثة المرحوم أحمد علي',
    });
    expect(result.plaintiff).toBe('ورثة المرحوم أحمد علي');
  });
});

describe('derivePartiesLine', () => {
  it('بيركّب سطر "فلان ضد فلان" من الأسماء الحقيقية بدل صفة عامة', () => {
    const parties: PartyDisplayRow[] = [
      { side: 'plaintiff', name: 'حسام الدين محمد احمد' },
      { side: 'plaintiff', name: 'حسن محمد احمد' },
      { side: 'defendant', name: 'شركة بيت التأمين السعودي' },
    ];
    const line = derivePartiesLine(parties, { plaintiffLegalTitle: 'متهمين' });
    expect(line).toBe('حسام الدين محمد احمد وآخرون ضد شركة بيت التأمين السعودي');
  });
});

describe('deriveFullPartiesDisplay / deriveFullPartiesLine (كارت القضية بالليستة)', () => {
  it('بيسرد كل الأسماء مفصولة بفاصلة عربية، مش الأول بس + "وآخرون"', () => {
    const parties: PartyDisplayRow[] = [
      { side: 'plaintiff', name: 'حسام الدين محمد احمد' },
      { side: 'plaintiff', name: 'حسن محمد احمد' },
      { side: 'defendant', name: 'شركة بيت التأمين السعودي' },
    ];
    const result = deriveFullPartiesDisplay(parties, {});
    expect(result.plaintiff).toBe('حسام الدين محمد احمد، حسن محمد احمد');
    expect(result.defendant).toBe('شركة بيت التأمين السعودي');
    expect(deriveFullPartiesLine(parties, {})).toBe(
      'حسام الدين محمد احمد، حسن محمد احمد ضد شركة بيت التأمين السعودي'
    );
  });

  it('مفيش case_parties خالص → بيرجع لنفس فولباك derivePartiesDisplay بالظبط', () => {
    const result = deriveFullPartiesDisplay([], {
      plaintiff: 'حسام الدين محمد احمد',
      plaintiffLegalTitle: 'متهمين',
    });
    expect(result.plaintiff).toBe('حسام الدين محمد احمد');
  });
});
