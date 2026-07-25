import { describe, it, expect } from 'vitest';
import { getEdgeFunctionErrorMessage, looksArabicUserMessage } from './edgeFunctionErrors';

describe('getEdgeFunctionErrorMessage', () => {
    it('error فاضي (null/undefined) → يرجع null', async () => {
        expect(await getEdgeFunctionErrorMessage(null)).toBeNull();
        expect(await getEdgeFunctionErrorMessage(undefined)).toBeNull();
    });

    it('error.context.json() فيها { error: "..." } → يرجع الرسالة العربية الحقيقية', async () => {
        const error = {
            message: 'Edge Function returned a non-2xx status code',
            context: {
                json: async () => ({ error: 'وصلت للحد المجاني اليومي للمساعد الذكي.' }),
            },
        };
        expect(await getEdgeFunctionErrorMessage(error)).toBe(
            'وصلت للحد المجاني اليومي للمساعد الذكي.'
        );
    });

    it('json() موجودة لكن من غير حقل error، وfallback لـtext() موجود → يرجع النص', async () => {
        const error = {
            context: {
                json: async () => ({}),
                text: async () => 'رسالة نصية بديلة',
            },
        };
        expect(await getEdgeFunctionErrorMessage(error)).toBe('رسالة نصية بديلة');
    });

    it('json() بترمي استثناء → يتجاهله من غير ما يفشل، ويرجع null (مفيش text() هنا)', async () => {
        const error = {
            context: {
                json: async () => { throw new Error('invalid json'); },
            },
        };
        expect(await getEdgeFunctionErrorMessage(error)).toBeNull();
    });

    it('مفيش context خالص (فشل شبكة عادي) → يرجع null', async () => {
        const error = { message: 'Failed to fetch' };
        expect(await getEdgeFunctionErrorMessage(error)).toBeNull();
    });
});

describe('looksArabicUserMessage', () => {
    it('نص فيه حروف عربية → true', () => {
        expect(looksArabicUserMessage('الجلسة منتهية، سجّل الدخول من جديد')).toBe(true);
    });

    it('نص إنجليزي تقني خام → false', () => {
        expect(looksArabicUserMessage('Edge Function returned a non-2xx status code')).toBe(false);
    });

    it('null أو undefined أو نص فاضي → false', () => {
        expect(looksArabicUserMessage(null)).toBe(false);
        expect(looksArabicUserMessage(undefined)).toBe(false);
        expect(looksArabicUserMessage('')).toBe(false);
    });
});
