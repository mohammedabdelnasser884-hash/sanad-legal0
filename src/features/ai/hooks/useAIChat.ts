import { useState } from 'react';
import { recordError } from '../../../systemHealth';
import type { MappedCase } from '../../../hooks/useAppData';
import type { AIMessage, LegalArticle } from './aiAssistantTypes';

// ─────────────────────────────────────────────────────────
//  useAIChat — منقول حرفيًا من useAIAssistant.ts (دفعة 5):
//  input/loading + sendMessage. صفر تغيير في المنطق أو الصياغة.
// ─────────────────────────────────────────────────────────
interface UseAIChatParams {
    messages: AIMessage[];
    setMessages: (msgs: AIMessage[] | ((prev: AIMessage[]) => AIMessage[])) => void;
    hasKey: boolean | null;
    keyLoading: boolean;
    setShowKeyInput: (v: boolean) => void;
    selectedCase: MappedCase | null;
    retrieveLegalArticles: (query: string) => Promise<LegalArticle[]>;
    buildLegalContextBlock: (articles: LegalArticle[] | null | undefined, forDocument?: boolean) => string;
    callAI: (prompt: string | null, history: AIMessage[] | null, legalContextBlock?: string) => Promise<string>;
}

export function useAIChat({
    messages, setMessages, hasKey, keyLoading, setShowKeyInput,
    selectedCase, retrieveLegalArticles, buildLegalContextBlock, callAI,
}: UseAIChatParams) {
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);

    const MAX_HISTORY_MESSAGES = 16; // آخر 8 أسئلة + 8 ردود

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || loading) return;
        // 🆕 مبقاش فيه اشتراط مفتاح شخصي قبل الإرسال — الـ edge function
        // (ai-chat) بقى بيستخدم مفتاح المنصة تلقائيًا ضمن السقف المجاني
        // اليومي. لو السقف خلص ومفيش مفتاح شخصي، السيرفر هو اللي بيرجّع
        // رسالة الخطأ الواضحة (بتتلقط في catch تحت)، مش الفرونت إند.
        setInput('');
        // ✅ اتشال .type|| الميتة بموافقة جيمي — العمود مش موجود أصلاً،
        // case_type هو العمود الحقيقي الوحيد.
        const caseContext = selectedCase
            ? ` [سياق القضية: ${selectedCase.title} | النوع: ${selectedCase.type} | المحكمة: ${selectedCase.court} | الحالة: ${selectedCase.status}]`
            : '';
        const newMessages = [...messages, {role:'user' as const, text: text + caseContext}];
        setMessages((prev: AIMessage[]) =>[...prev, {role:'user', text}]);
        setLoading(true);
        try {
            const retrieved = await retrieveLegalArticles(text);
            const legalContextBlock = buildLegalContextBlock(retrieved);
            // قطّع التاريخ قبل الإرسال لتجنب تجاوز context window
            const trimmedMessages = newMessages.slice(-MAX_HISTORY_MESSAGES);
            const reply = await callAI(null, trimmedMessages, legalContextBlock);
            setMessages((p: AIMessage[]) =>[...p,{role:'assistant',text:reply, references: retrieved}]);
        } catch(e) {
            const _msg = e instanceof Error ? e.message : String(e);
            const isKeyError = _msg?.includes('401')||_msg?.includes('invalid')||_msg?.includes('key');
            // 🆕 لو السيرفر رجّع رسالة عربية واضحة ومقصودة للمستخدم (زي
            // "وصلت للحد المجاني اليومي..."، "الجلسة منتهية"، "الحساب معطّل")
            // نعرضها زي ما هي بدل استبدالها برسالة عامة مالهاش لازمة —
            // المستخدم محتاج يعرف فعليًا هو واقف عند إيه. أي رسالة مش
            // عربية (خطأ شبكة/تقني) لسه بتاخد الرسالة العامة زي الأول.
            const isUserFacingMessage = /[\u0600-\u06FF]/.test(_msg);
            const msg = isKeyError
                ? '🔑 API Key غير صحيح. اضغط زر المفتاح لتحديثه.'
                : isUserFacingMessage
                    ? _msg
                    : '⚠️ تعذّر الحصول على رد من المساعد الذكي. حاول تاني بعد قليل. لو المشكلة استمرت، تواصل مع الدعم.';
            if (!isKeyError && !isUserFacingMessage) {
                recordError('ai_chat', _msg, {label:'المساعد الذكي', message: msg});
            }
            setMessages((p: AIMessage[]) =>[...p,{role:'assistant',text:msg}]);
        }
        setLoading(false);
    };

    return { input, setInput, loading, setLoading, sendMessage };
}
