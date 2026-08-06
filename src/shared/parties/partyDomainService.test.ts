import { describe, it, expect } from 'vitest';
import {
    getPartyState,
    isLinkedState,
    isOrphanState,
    isPartyOrphaned,
    canEditPartyFields,
    canToggleIsClient,
    canUnlinkParty,
    canCreateNewClientFromParty,
    getPartyStateMessage,
    getPartyStateBadge,
    isOrphanedLink,
    type PartyDomainContext,
    type PartyLinkState,
} from './partyDomainService';

// ══════════════════════════════════════════════════════════════════
// تستات partyDomainService — خطة توحيد قفل الطرف، المرحلة 1
// (5 أغسطس 2026). كل تست هنا بيغطي حالة واحدة من الخمس حالات الموحّدة
// (MANUAL / LINKED / ORPHAN_PARTY / ORPHAN / PRIMARY_CLIENT) + قواعد
// الصلاحيات المبنية عليها — بمعزل تام عن أي فورم أو نداء db.
// ══════════════════════════════════════════════════════════════════

const ctx = (primaryClientId: string | null, clientIds: string[]): PartyDomainContext => ({
    primaryClientId,
    clients: clientIds.map((id) => ({ id })),
});

describe('getPartyState', () => {
    it('MANUAL: client_id فاضي', () => {
        expect(getPartyState({ client_id: null }, ctx(null, []))).toBe('MANUAL');
    });

    it('PRIMARY_CLIENT: الطرف هو الموكل الأساسي والموكل لسه موجود', () => {
        expect(getPartyState({ client_id: 'c1' }, ctx('c1', ['c1']))).toBe('PRIMARY_CLIENT');
    });

    it('ORPHAN: الطرف هو الموكل الأساسي لكن الموكل اتمسح/مش مرئي', () => {
        expect(getPartyState({ client_id: 'c1' }, ctx('c1', []))).toBe('ORPHAN');
    });

    it('LINKED: طرف ثانوي مربوط بموكل حي (مش الأساسي)', () => {
        expect(getPartyState({ client_id: 'c2' }, ctx('c1', ['c1', 'c2']))).toBe('LINKED');
    });

    it('ORPHAN_PARTY: طرف ثانوي مربوط بموكل اتمسح (باگ 5.1 القديم)', () => {
        expect(getPartyState({ client_id: 'c2' }, ctx('c1', ['c1']))).toBe('ORPHAN_PARTY');
    });

    it('ORPHAN_PARTY: طرف ثانوي مربوط بموكل ومفيش primaryClientId أصلًا (جلسة/قضية مش مربوطة)', () => {
        expect(getPartyState({ client_id: 'c2' }, ctx(null, []))).toBe('ORPHAN_PARTY');
    });

    it('LINKED: طرف ثانوي ومفيش primaryClientId، لكن الموكل لسه موجود', () => {
        expect(getPartyState({ client_id: 'c2' }, ctx(null, ['c2']))).toBe('LINKED');
    });
});

describe('isLinkedState / isOrphanState', () => {
    const cases: [PartyLinkState, boolean, boolean][] = [
        // [state, isLinked, isOrphan]
        ['MANUAL', false, false],
        ['LINKED', true, false],
        ['PRIMARY_CLIENT', true, false],
        ['ORPHAN', false, true],
        ['ORPHAN_PARTY', false, true],
    ];
    it.each(cases)('%s → isLinkedState=%s, isOrphanState=%s', (state, linked, orphan) => {
        expect(isLinkedState(state)).toBe(linked);
        expect(isOrphanState(state)).toBe(orphan);
    });
});

describe('isPartyOrphaned', () => {
    it('بيرجع true لطرف أساسي orphan', () => {
        expect(isPartyOrphaned({ client_id: 'c1' }, ctx('c1', []))).toBe(true);
    });
    it('بيرجع true لطرف ثانوي orphan', () => {
        expect(isPartyOrphaned({ client_id: 'c2' }, ctx('c1', ['c1']))).toBe(true);
    });
    it('بيرجع false لطرف مربوط لسه حي', () => {
        expect(isPartyOrphaned({ client_id: 'c1' }, ctx('c1', ['c1']))).toBe(false);
    });
    it('بيرجع false لطرف يدوي', () => {
        expect(isPartyOrphaned({ client_id: null }, ctx('c1', ['c1']))).toBe(false);
    });
});

describe('canEditPartyFields', () => {
    it('ممنوع (false) للحالات المربوطة فعليًا', () => {
        expect(canEditPartyFields('LINKED')).toBe(false);
        expect(canEditPartyFields('PRIMARY_CLIENT')).toBe(false);
    });
    it('مسموح (true) للحالات اليدوية أو orphan', () => {
        expect(canEditPartyFields('MANUAL')).toBe(true);
        expect(canEditPartyFields('ORPHAN')).toBe(true);
        expect(canEditPartyFields('ORPHAN_PARTY')).toBe(true);
    });
});

describe('canToggleIsClient', () => {
    it('نفس منطق canEditPartyFields بالظبط', () => {
        (['MANUAL', 'LINKED', 'ORPHAN_PARTY', 'ORPHAN', 'PRIMARY_CLIENT'] as PartyLinkState[]).forEach((state) => {
            expect(canToggleIsClient(state)).toBe(canEditPartyFields(state));
        });
    });
});

describe('canUnlinkParty', () => {
    it('ممنوع بس لو مفيش ربط أصلًا (MANUAL)', () => {
        expect(canUnlinkParty('MANUAL')).toBe(false);
    });
    it('مسموح لأي طرف عنده client_id — بما فيه ORPHAN_PARTY (إصلاح باگ 5.1)', () => {
        expect(canUnlinkParty('LINKED')).toBe(true);
        expect(canUnlinkParty('PRIMARY_CLIENT')).toBe(true);
        expect(canUnlinkParty('ORPHAN')).toBe(true);
        expect(canUnlinkParty('ORPHAN_PARTY')).toBe(true);
    });
});

describe('canCreateNewClientFromParty', () => {
    it('مسموح لـ MANUAL و ORPHAN_PARTY بس', () => {
        expect(canCreateNewClientFromParty('MANUAL')).toBe(true);
        expect(canCreateNewClientFromParty('ORPHAN_PARTY')).toBe(true);
    });
    it('ممنوع للحالات الأخرى (بما فيها ORPHAN — بيتم من تاب بيانات القضية)', () => {
        expect(canCreateNewClientFromParty('LINKED')).toBe(false);
        expect(canCreateNewClientFromParty('PRIMARY_CLIENT')).toBe(false);
        expect(canCreateNewClientFromParty('ORPHAN')).toBe(false);
    });
});

describe('getPartyStateMessage', () => {
    it('null لـ MANUAL', () => {
        expect(getPartyStateMessage('MANUAL')).toBeNull();
    });
    it('رسالة "مربوط" للحالات الحية', () => {
        expect(getPartyStateMessage('LINKED')).toMatch(/مربوط بموكل/);
        expect(getPartyStateMessage('PRIMARY_CLIENT')).toMatch(/مربوط بموكل/);
    });
    it('رسالة "اتحذف" لحالات orphan', () => {
        expect(getPartyStateMessage('ORPHAN')).toMatch(/اتحذف/);
        expect(getPartyStateMessage('ORPHAN_PARTY')).toMatch(/اتحذف/);
    });
});

describe('getPartyStateBadge (خطة توحيد قفل الطرف — المرحلة 3، Badges/UI)', () => {
    it('null لـ MANUAL (بيانات يدوية بحتة — مفيش شارة)', () => {
        expect(getPartyStateBadge('MANUAL')).toBeNull();
    });
    it('🟢 لـ PRIMARY_CLIENT', () => {
        const badge = getPartyStateBadge('PRIMARY_CLIENT');
        expect(badge?.emoji).toBe('🟢');
        expect(badge?.label).toBe('موكل المكتب');
    });
    it('🔵 لـ LINKED', () => {
        const badge = getPartyStateBadge('LINKED');
        expect(badge?.emoji).toBe('🔵');
        expect(badge?.label).toBe('مربوط بموكل');
    });
    it('🟠 لـ ORPHAN', () => {
        const badge = getPartyStateBadge('ORPHAN');
        expect(badge?.emoji).toBe('🟠');
        expect(badge?.label).toBe('موكل محذوف');
    });
    it('🟣 لـ ORPHAN_PARTY (لون مختلف عن ORPHAN رغم نفس النص)', () => {
        const badge = getPartyStateBadge('ORPHAN_PARTY');
        expect(badge?.emoji).toBe('🟣');
        expect(badge?.label).toBe('موكل محذوف');
        expect(badge?.className).not.toBe(getPartyStateBadge('ORPHAN')?.className);
    });
    it('كل الحالات غير MANUAL بترجع className فيها ألوان Tailwind', () => {
        (['PRIMARY_CLIENT', 'LINKED', 'ORPHAN', 'ORPHAN_PARTY'] as PartyLinkState[]).forEach((state) => {
            expect(getPartyStateBadge(state)?.className).toMatch(/text-.*bg-.*border-/);
        });
    });
});

describe('isOrphanedLink (مستوى القضية/الجلسة — client_id + كائن الموكل مباشرة)', () => {
    it('false لو مفيش client_id أصلًا', () => {
        expect(isOrphanedLink(null, null)).toBe(false);
        expect(isOrphanedLink(undefined, undefined)).toBe(false);
    });
    it('false لو client_id موجود والموكل موجود', () => {
        expect(isOrphanedLink('c1', { id: 'c1' })).toBe(false);
    });
    it('true لو client_id موجود والموكل مش موجود (اتمسح/مش مرئي)', () => {
        expect(isOrphanedLink('c1', null)).toBe(true);
    });
});
