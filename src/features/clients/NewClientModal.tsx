import React, { useState, useMemo, useEffect } from 'react';
import { toast } from '../../shared/lib/notifications';
import { validatePhone, validateEmail } from '../../shared/lib/validation';
import { validateFullNameParts } from '../../shared/lib/clientValidation';
import { I } from '../../constants';
import { Inp } from '@/shared/ui/Inp';
import { PoaInput } from '@/shared/ui/PoaInput';
import { Sel } from '@/shared/ui/Sel';
import { FileUploadField } from '@/shared/ui/FileUploadField';
import { useFormDraft } from '@/shared/hooks/useFormDraft';
import { useUnsavedChangesGuard } from '@/shared/hooks/useUnsavedChangesGuard';

interface NewClientForm {
    full_name: string;
    type: string;
    phone: string;
    phone2: string;
    email: string;
    address: string;
    notes: string;
    national_id: string;
    cr_number: string;
    kin_name: string;
    kin_phone: string;
}

interface NewClientModalProps {
    onClose: () => void;
    onSave: (form: NewClientForm, idFile: File | null, poaFile: File | null) => void | boolean | Promise<void | boolean>;
    loading?: boolean;
    // ⚡ NEW: بيانات مبدئية بتيجي من قضية/جلسة مستقلة (اسم المدعي، رقمه
    // القومي، رقم توكيله) — بتتعمل بيها pre-fill للفورم بدل ما يبدأ فاضي.
    // Partial لأن مفيش ضمان إن كل الحقول دي متوفرة في السياق اللي فتح منه.
    initialData?: Partial<NewClientForm>;
    // ⚡ NEW: نص توضيحي صغير بيبان أعلى الموديل لما يتفتح من جوه قضية/جلسة
    // (مثلاً "هيتربط تلقائيًا بالقضية رقم ١٢٣") — عشان المستخدم يبقى واعي
    // إن دي مش عملية إنشاء موكل مستقلة.
    contextLabel?: string | null;
}

// أرقام بس، وبالظبط 14 رقم — بيتقص أي حرف مش رقم أول بأول (نفس نمط
// onlyDigits المستخدم في NewCaseModal/NewStandaloneSessionModal)
const onlyDigits = (v: string, max = 14) => v.replace(/\D/g, '').slice(0, max);

// ── حقل تحذير صغير تحت أي input ──
function WarnHint({msg}: {msg?: string | null}){
    if(!msg) return null;
    return React.createElement('p',{className:"text-[9px] text-amber-400 mt-1 mr-1"},"⚠️ "+msg);
}

function NewClientModal({onClose,onSave,loading,initialData,contextLabel}: NewClientModalProps){
    const [form,setForm]=useState<NewClientForm>({full_name:'',type:'individual',phone:'',phone2:'',email:'',address:'',notes:'',national_id:'',cr_number:'',kin_name:'',kin_phone:'',...initialData});
    const [idFile,setIdFile]=useState<File | null>(null);
    const [idPreview,setIdPreview]=useState<string | null>(null);
    const [poaFile,setPoaFile]=useState<File | null>(null);
    const [poaPreview,setPoaPreview]=useState<string | null>(null);
    const s=<K extends keyof NewClientForm>(k: K,v: NewClientForm[K])=>setForm((p) =>({...p,[k]:v}));

    // ══════════════ حفظ مسودة تلقائي (خطة 1 أغسطس 2026) ══════════════
    // بيغطي حقول الفورم النصية بس — ملفات الصور (idFile/poaFile) مش
    // قابلة للتخزين في localStorage (مش JSON) وبتضيع أصلاً لو التطبيق
    // اتقفل، فمش جزء من المسودة.
    // ⚠️ قرار (مش موجود في الخطة الأصلية، اتخد أثناء التنفيذ): لما
    // الموديل ده بيتفتح بـinitialData (من جوه قضية/جلسة — "إنشاء موكل
    // جديد من هذه البيانات")، الحفظ التلقائي بيتعطّل تمامًا. السبب: مفيش
    // معرّف ثابت للسياق ده (مش مرتبط بقضية/جلسة بعينها بمعرّف واحد ثابت)
    // عشان نبني بيه مفتاح مسودة مميز، فلو سبنا الحفظ شغال بمفتاح عام
    // ('new-client')، ممكن مسودة اتكتبت وقت إنشاء موكل من طرف في قضية
    // معينة ترجع تتسترجع غلط وقت إنشاء موكل من سياق مختلف تمامًا.
    const isContextualFlow = !!initialData && Object.keys(initialData).length > 0;
    const draftEnabled = !isContextualFlow;
    const isClientDraftEmpty = (f: NewClientForm) =>
        !f.full_name.trim() && !f.phone.trim() && !f.phone2.trim() && !f.email.trim() &&
        !f.address.trim() && !f.notes.trim() && !f.national_id.trim() && !f.cr_number.trim() &&
        !f.kin_name.trim() && !f.kin_phone.trim();
    const draft = useFormDraft<NewClientForm>({ key: 'new-client', data: form, enabled: draftEnabled, isEmpty: isClientDraftEmpty });

    useEffect(() => {
        if (!draft.restoredDraft) return;
        setForm(draft.restoredDraft);
        toast('📝 تم استرجاع بيانات كنت بتكتبها قبل كده');
        draft.dismissRestoredDraft();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft.restoredDraft]);

    // تحذير قبل الإغلاق — في السياق المرتبط بقضية/جلسة (initialData) بردو
    // نفعّله (الفورم ممكن يبقى فيه بيانات مكتوبة/مُحمّلة مسبقًا)، حتى لو
    // الحفظ التلقائي نفسه معطّل ليه. useUnsavedChangesGuard بياخد أول قيمة
    // لـform (وقت الفتح) كـbaseline تلقائيًا، مفيش داعي لـstate إضافي.
    const { guardedClose, confirmModal } = useUnsavedChangesGuard(form, form, onClose);

    const phoneWarn = useMemo(()=>validatePhone(form.phone), [form.phone]);
    const phoneWarn2 = useMemo(()=>validatePhone(form.phone2), [form.phone2]);
    const emailWarn = useMemo(()=>validateEmail(form.email), [form.email]);

    const pickId=(file: File | null | undefined)=>{
        if(!file)return;
        setIdFile(file);
        setIdPreview(URL.createObjectURL(file));
    };
    const pickPoa=(file: File | null | undefined)=>{
        if(!file)return;
        setPoaFile(file);
        setPoaPreview(URL.createObjectURL(file));
    };

    // 🔒 FIX (تشخيص لوجز E2E — 30 يوليو 2026): كانت z-50 — بعد فيكس
    // الـmodal stack في useNavigation.ts (المودال اللي فاتح قبل NewClientModal
    // بقى فاضل متركب فعليًا بدل ما يتقفل)، أي مودال فاتح NewClientModal من
    // جواه بـz-[60] (مودال ما بعد حفظ الجلسة المستقلة، تعديل قضية، ربط جلسة
    // من التفاصيل...) كان بيتقفل فوقه فعليًا (z-index أعلى) ويمنع أي كليك
    // عليه خالص — ده سبب فشل معدلة توقيت جديدة في standalone-sessions.spec.ts
    // تست 5/session-update.spec.ts (الكليك على save-client-button نفسه كان
    // بيعلق). z-[80] أعلى من أي مودال ممكن NewClientModal يتفتح من جواه
    // (z-50/z-[60]/z-[70])، وأقل من تأكيدات الحذف (z-[90]) وتأكيد الخروج
    // (z-[9999]) عمدًا — لسه ممكن يظهروا فوقه لو احتاج الأمر.
    return React.createElement(React.Fragment, null,
    confirmModal,
    React.createElement('div',{className:"fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm",onClick:(e: React.MouseEvent<HTMLDivElement>) =>{if(e.target===e.currentTarget)guardedClose();}},
        React.createElement('div',{className:"bg-premium-card w-full max-w-lg rounded-t-3xl border-t border-white/10 p-6 pb-10 shadow-2xl slide-up max-h-[90vh] overflow-y-auto no-scrollbar"},
            React.createElement('div',{className:"w-10 h-1 bg-white/20 rounded-full mx-auto mb-5"}),
            React.createElement('div',{className:"flex items-center justify-between mb-5"},
                React.createElement('h3',{className:"text-sm font-black text-white flex items-center gap-2"},
                    React.createElement('span',{className:"w-1 h-4 bg-emerald-400 rounded-full"}),
                    "إضافة موكل جديد"
                ),
                React.createElement('button',{onClick:guardedClose,className:"w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white active:scale-90 transition-all"},"✕")
            ),
            // ⚡ NEW: تنبيه الربط التلقائي — بيبان بس لو الموديل اتفتح من
            // جوه قضية/جلسة (contextLabel موجود).
            contextLabel && React.createElement('div',{className:"mb-4 -mt-1 px-3 py-2 rounded-xl bg-premium-gold/10 border border-premium-gold/20"},
                React.createElement('p',{className:"text-[10px] font-bold text-premium-gold"},"🔗 "+contextLabel)
            ),
            React.createElement('div',{className:"space-y-4"},
                // بيانات أساسية
                React.createElement(Inp,{label:"الاسم الكامل",value:form.full_name,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('full_name',e.target.value),placeholder:"مثال: محمد أحمد علي",required:true,'data-testid':'new-client-name'}),
                React.createElement(Inp,{label:"العنوان",value:form.address,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('address',e.target.value),placeholder:"العنوان التفصيلي"}),
                React.createElement('div',{className:"grid grid-cols-2 gap-3"},
                    React.createElement(Sel,{label:"نوع الموكل",required:true,value:form.type,onChange:(e: React.ChangeEvent<HTMLSelectElement>) =>s('type',e.target.value),options:[
                        {value:'individual',label:'فرد'},
                        {value:'company',label:'شركة'},
                        {value:'government',label:'جهة حكومية'}
                    ]}),
                    React.createElement('div',null,
                        React.createElement(Inp,{label:"رقم الهاتف",value:form.phone,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('phone',e.target.value),placeholder:"05xxxxxxxx",required:true,'data-testid':'new-client-phone'}),
                        React.createElement(WarnHint,{msg:phoneWarn})
                    )
                ),
                React.createElement('div',null,
                    React.createElement(Inp,{label:"رقم هاتف ثاني",value:form.phone2,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('phone2',e.target.value),placeholder:"رقم بديل"}),
                    React.createElement(WarnHint,{msg:phoneWarn2})
                ),
                React.createElement('div',null,
                    React.createElement(Inp,{label:"البريد الإلكتروني",type:"email",value:form.email,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('email',e.target.value),placeholder:"client@email.com"}),
                    React.createElement(WarnHint,{msg:emailWarn})
                ),

                // فاصل قريب الدرجة الأولى
                React.createElement('div',{className:"border-t border-white/5 pt-2"},
                    React.createElement('p',{className:"text-[10px] font-black text-blue-400/80 mb-3"},"— قريب الدرجة الأولى —")
                ),
                React.createElement('div',{className:"grid grid-cols-2 gap-3"},
                    React.createElement(Inp,{label:"اسم القريب",value:form.kin_name,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('kin_name',e.target.value),placeholder:"الاسم الكامل"}),
                    React.createElement('div',null,
                        React.createElement(Inp,{label:"هاتف القريب",value:form.kin_phone,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('kin_phone',e.target.value),placeholder:"05xxxxxxxx"}),
                        React.createElement(WarnHint,{msg:validatePhone(form.kin_phone)})
                    )
                ),

                // فاصل
                React.createElement('div',{className:"border-t border-white/5 pt-2"},
                    React.createElement('p',{className:"text-[10px] font-black text-slate-500 mb-3"},"— المستندات الرسمية —")
                ),

                // الرقم القومي
                React.createElement(Inp,{label:"الرقم القومي",value:form.national_id,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>s('national_id',onlyDigits(e.target.value)),placeholder:"14 رقم",required:true,inputMode:"numeric",maxLength:14,'data-testid':'new-client-national-id'}),

                // بيانات التوكيل — سطر كامل: رقم / حرف / سنة / مكتب توثيق
                React.createElement(PoaInput,{value:form.cr_number,onChange:(v: string) =>s('cr_number',v)}),

                // رفع الصور
                React.createElement(FileUploadField,{
                    label:"صورة البطاقة الشخصية",
                    hint:"JPG أو PNG — حجم أقصى 5MB",
                    onChange:pickId,
                    preview:idPreview
                }),
                React.createElement(FileUploadField,{
                    label:"صورة التوكيل",
                    hint:"JPG أو PNG — حجم أقصى 5MB",
                    onChange:pickPoa,
                    preview:poaPreview
                }),

                // ملاحظات
                React.createElement('div',null,
                    React.createElement('label',{className:"block text-[10px] font-bold text-slate-400 mb-1.5"},"ملاحظات"),
                    React.createElement('textarea',{
                        value:form.notes,onChange:(e: React.ChangeEvent<HTMLTextAreaElement>) =>s('notes',e.target.value),
                        placeholder:"أي معلومات إضافية عن الموكل...",rows:3,
                        className:"w-full p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600 resize-none transition-colors",
                        style:{fontFamily:'Cairo,sans-serif'}
                    })
                ),

                React.createElement('button',{
                    disabled:loading,
                    'data-testid':'save-client-button',
                    onClick:async ()=>{
                        if(!form.full_name.trim()){toast('يرجى إدخال اسم الموكل',true);return;}
                        const nameErr = validateFullNameParts(form.full_name);
                        if(nameErr){toast(nameErr,true);return;}
                        if(!form.phone.trim()){toast('يرجى إدخال رقم الهاتف',true);return;}
                        if(!form.type){toast('يرجى اختيار نوع الموكل',true);return;}
                        if(!form.national_id.trim()){toast('يرجى إدخال الرقم القومي',true);return;}
                        if(form.national_id.length!==14){toast('⚠️ الرقم القومي لازم يكون 14 رقم بالظبط',true);return;}
                        const warnings = [phoneWarn, phoneWarn2, emailWarn].filter(Boolean);
                        if(warnings.length>0) toast('⚠️ تنبيه: '+warnings[0]+' — تم الحفظ رغم ذلك');
                        const result = await onSave(form,idFile,poaFile);
                        // 🔒 FIX (قرارات مفتوحة — خطة حفظ المسودات، 3 أغسطس 2026):
                        // بننتظر نتيجة onSave ونمسح المسودة بس لو نجح الحفظ فعلاً
                        // (result !== false)، مش بمجرد الضغط على الزرار زي الأول.
                        if (result !== false) draft.clearDraft();
                    },
                    className:"w-full py-3.5 bg-gradient-to-tr from-emerald-500 to-emerald-400 text-white rounded-xl font-black text-sm shadow-md flex items-center justify-center gap-2 disabled:opacity-60 active:scale-95 transition-transform mt-2"
                },loading?React.createElement(I.Spin):React.createElement(I.Person),loading?'جاري الرفع والحفظ...':'حفظ الموكل ☁️')
            )
        )
    ));
}

export default NewClientModal;
