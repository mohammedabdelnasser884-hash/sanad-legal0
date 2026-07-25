import React from 'react';
import { I } from '../../constants';
import { Inp } from '@/shared/ui/Inp';
import DatePicker from '@/shared/ui/DatePicker';

interface ReminderForm {
  title: string;
  due_date: string;
  notes: string;
}

interface AddReminderFormProps {
  showForm: boolean;
  setShowForm: (v: boolean) => void;
  form: ReminderForm;
  setForm: (fn: (p: ReminderForm) => ReminderForm) => void;
  handleSave: () => void;
  saving: boolean;
}

function AddReminderForm({
  showForm, setShowForm, form, setForm, handleSave, saving,
}: AddReminderFormProps) {
  return showForm && React.createElement('div',{className:"bg-premium-card border border-purple-500/20 rounded-2xl p-4 space-y-3 slide-up"},
            React.createElement('h4',{className:"text-xs font-black text-purple-400"},"🔔 تذكير جديد"),
            React.createElement(Inp,{label:"عنوان التذكير",value:form.title,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>setForm((p: ReminderForm) =>({...p,title:e.target.value})),placeholder:"مثال: تقديم مذكرة دفاع...",required:true,'data-testid':'new-reminder-title'}),
            React.createElement(DatePicker,{label:"تاريخ التذكير",value:form.due_date,onChange:(v: string) =>setForm((p: ReminderForm) =>({...p,due_date:v})),required:true,testId:'new-reminder-date-trigger',dayTestId:'new-reminder-date-day'}),
            React.createElement(Inp,{label:"ملاحظات",value:form.notes,onChange:(e: React.ChangeEvent<HTMLInputElement>) =>setForm((p: ReminderForm) =>({...p,notes:e.target.value})),placeholder:"تفاصيل إضافية...",'data-testid':'new-reminder-notes'}),
            React.createElement('div',{className:"flex gap-2"},
                React.createElement('button',{onClick:handleSave,disabled:saving,'data-testid':'new-reminder-save',className:"flex-1 py-2.5 bg-gradient-to-tr from-purple-600 to-purple-400 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95"},
                    saving?React.createElement(I.Spin):React.createElement(I.Check),"حفظ"),
                React.createElement('button',{onClick:()=>setShowForm(false),className:"px-4 py-2.5 bg-white/5 text-slate-400 rounded-xl text-xs font-bold active:scale-95"},"إلغاء")
            )
        );
}

export default AddReminderForm;
