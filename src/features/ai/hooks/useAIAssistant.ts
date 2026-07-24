import React, { useState, useEffect, useRef } from 'react';
import { COUNTRY_CONFIGS } from '../../../constants';
import { db } from '../../../supabaseClient';
import type { ClientRow, ProfileRow } from '../../../types';
import type { MappedCase } from '../../../hooks/useAppData';
import type { CasePartyRow } from '../../cases/hooks/useCaseDetailActions';
import { GROQ_MODELS, DOC_TEMPLATES, colorMap } from './aiAssistantTypes';
import { useAIApiKey } from './useAIApiKey';
import { useAILegalEngine } from './useAILegalEngine';
import { useAITopics } from './useAITopics';
import { useAIChat } from './useAIChat';
import { useAIDocumentGenerator } from './useAIDocumentGenerator';

export function useAIAssistant(cases: MappedCase[], clients: ClientRow[], profile: ProfileRow | null, country: string) {
    const [mode, setMode] = useState('menu');
    const [selectedModel, setSelectedModel] = useState('llama-3.3-70b-versatile');
    const { hasKey, keyLoading, showKeyInput, setShowKeyInput, saveKey } = useAIApiKey(profile);

    const {
        topics, setTopics, activeTopicId, setActiveTopicId,
        showTopics, setShowTopics, newTopic, deleteTopic,
        messages, setMessages,
    } = useAITopics(profile, country);

    const [selectedCase, setSelectedCase] = useState<MappedCase | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const today = new Date().toLocaleDateString('ar-SA-u-nu-latn', {year:'numeric',month:'long',day:'numeric'});

    const activeCfg = COUNTRY_CONFIGS[country||'SA'];

    // 🆕 (خطة "سد فجوات عرض الأطراف" — مرحلة 3-ب، 24 يوليو 2026): فتش مستقل
    // لصفوف case_parties الخاصة بالقضية المختارة حاليًا في شاشة الـAI —
    // القرار كان فتش مستقل (لا اعتماد على تمرير caseParties من CaseDetailView)
    // لأن مساعد الذكاء الاصطناعي بيتفتح كعنصر عام من CommandDock (App.tsx)،
    // مش متداخل جوّه CaseDetailView، فمفيش caseParties جاهزة أصلًا تتمرر منه.
    // فشل الاستعلام (مشكلة اتصال) بيرجّع array فاضية = فولباك كامل لسلوك
    // ما قبل المرحلة دي (الاسم المفرد/المسمى القانوني بس، بلا قائمة كاملة).
    const [selectedCaseParties, setSelectedCaseParties] = useState<CasePartyRow[]>([]);
    useEffect(() => {
        if (!selectedCase) { setSelectedCaseParties([]); return; }
        let cancelled = false;
        db.from('case_parties').select('*').eq('case_id', selectedCase.id).order('sort_order', { ascending: true })
            .then(({ data, error }) => {
                if (cancelled) return;
                setSelectedCaseParties(error ? [] : ((data as unknown as CasePartyRow[]) || []));
            })
            .catch(() => { if (!cancelled) setSelectedCaseParties([]); });
        return () => { cancelled = true; };
    }, [selectedCase?.id]);

    const { buildLegalContextBlock, retrieveLegalArticles, callAI } = useAILegalEngine(profile, activeCfg, today, selectedModel);

    const { input, setInput, loading, setLoading, sendMessage } = useAIChat({
        messages, setMessages, hasKey, keyLoading, setShowKeyInput,
        selectedCase, retrieveLegalArticles, buildLegalContextBlock, callAI,
    });

    const {
        docType, setDocType, docFields, sf,
        generatedDoc, setGeneratedDoc, generatingDoc,
        copied, copyDoc, printDoc, downloadPDF, generateDocument,
        missingCritical: docMissingCritical, canGenerate: canGenerateDoc,
    } = useAIDocumentGenerator({
        profile, activeCfg, today, selectedCase, hasKey, setShowKeyInput,
        retrieveLegalArticles, buildLegalContextBlock, callAI,
        caseParties: selectedCaseParties,
    });

    useEffect(()=>{
        messagesEndRef.current?.scrollIntoView({behavior:'smooth'});
    },[messages, loading]);

  return {
    mode, setMode,
    selectedModel, setSelectedModel, GROQ_MODELS,
    hasKey, keyLoading, showKeyInput, setShowKeyInput, saveKey,
    messages, setMessages, input, setInput, loading, setLoading,
    topics, setTopics, activeTopicId, setActiveTopicId,
    showTopics, setShowTopics, newTopic, deleteTopic,
    selectedCase, setSelectedCase, selectedCaseParties,
    docType, setDocType, docFields, sf,
    generatedDoc, setGeneratedDoc, generatingDoc,
    copied, copyDoc, printDoc, downloadPDF, generateDocument,
    docMissingCritical, canGenerateDoc,
    sendMessage, inputRef, messagesEndRef,
    today, activeCfg, DOC_TEMPLATES, colorMap,
    buildLegalContextBlock, retrieveLegalArticles, callAI,
  };
}
