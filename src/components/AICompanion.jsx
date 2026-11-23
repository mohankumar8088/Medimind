import React, { useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, Compass, HelpCircle, Mic, MicOff, Send, ShieldCheck, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import './AICompanion.css';

const API = import.meta.env.VITE_API_URL || '/api';
const VOICE_LANGUAGES = [{code:'en-IN',label:'English'},{code:'hi-IN',label:'हिन्दी'},{code:'kn-IN',label:'ಕನ್ನಡ'},{code:'te-IN',label:'తెలుగు'},{code:'ta-IN',label:'தமிழ்'}];
const GUIDES = {
  upload_report: {
    section: 'reports', title: 'Upload a medical report', steps: [
      { target: 'upload-report', title: 'Choose your report', body: 'Select a PDF, image, DOCX or TXT file. MediMind extracts the text and prepares a plain-language explanation.' },
      { target: 'report-library', title: 'Find saved reports', body: 'Your uploaded reports appear here. Open one to review its explanation and ask follow-up questions.' },
      { target: 'report-question', title: 'Ask about a report', body: 'After opening a saved report, type a question here in everyday language.' },
    ],
  },
  understand_report: {
    section: 'reports', title: 'Understand a report', steps: [
      { target: 'report-library', title: 'Open a saved report', body: 'Choose a report from your library. Its plain-language explanation appears in the overview.' },
      { target: 'report-explanation', title: 'Read the explanation', body: 'Review the summary and use the speaker button to hear it aloud.' },
      { target: 'report-question', title: 'Ask a follow-up', body: 'Type a question here to get a plain-language reply based on the selected report.' },
    ],
  },
  explore_research: {
    section: 'research', title: 'Explore rare-disease research', steps: [
      { target: 'research-report', title: 'Choose report context', body: 'Optionally select a saved report. You can also describe a finding without choosing a report.' },
      { target: 'research-question', title: 'Describe a finding', body: 'Enter a general question or finding. Avoid names and identifying details.' },
      { target: 'research-search', title: 'Search the literature', body: 'MediMind searches PubMed and presents cautious research leads with links. These are not a diagnosis.' },
      { target: 'research-evidence-question', title: 'Ask about the evidence', body: 'After results appear, use this box to ask what the cited studies mean.' },
    ],
  },
  health_timeline: { section: 'timeline', title: 'Review your health timeline', steps: [{ target: 'twin-build', title: 'Build the timeline', body: 'Compare dates and observations across the reports saved to your account.' }, { target: 'twin-results', title: 'Review the sources', body: 'Each observation names the reports it used. Discuss important trends with your clinician.' }] },
  medication_plan: { section: 'medications', title: 'Set up your medication plan', steps: [
    { target: 'medication-scan', title: 'Scan a prescription', body: 'Optionally upload a prescription and review its draft against the original.' },
    { target: 'medication-name', title: 'Medicine name', body: 'Enter the name exactly as written on the prescription.' },
    { target: 'medication-dose', title: 'Dose', body: 'Copy the prescribed dose exactly. MediMind does not choose or change doses.' },
    { target: 'medication-frequency', title: 'Frequency', body: 'Enter the schedule exactly as prescribed.' },
    { target: 'medication-times', title: 'Reminder times', body: 'Optional: add times in 24-hour format, separated by commas.' },
    { target: 'medication-instructions', title: 'Prescription instructions', body: 'Copy any instructions exactly as provided by your clinician or pharmacist.' },
    { target: 'medication-save', title: 'Save the entry', body: 'Check each field against the original prescription before saving.' },
    { target: 'medication-reminders', title: 'Enable reminders', body: 'Optional browser reminders work only while MediMind remains open.' },
  ] },
  emergency_profile: { section: 'emergency', title: 'Create an emergency profile', steps: [
    { target: 'emergency-name', title: 'Name', body: 'Enter the name you want shown to someone helping you.' },
    { target: 'emergency-allergies', title: 'Known allergies', body: 'List allergies you know about, or leave this blank if none are known.' },
    { target: 'emergency-conditions', title: 'Medical conditions', body: 'Add relevant conditions you want included in the profile.' },
    { target: 'emergency-medications', title: 'Current medications', body: 'List current medicines you want available to someone assisting you.' },
    { target: 'emergency-blood-group', title: 'Blood group', body: 'Choose a group only if you know it; otherwise leave “Not provided”.' },
    { target: 'emergency-contact', title: 'Emergency contact', body: 'Enter the contact name and phone number.' },
    { target: 'emergency-share', title: 'Select sharing fields', body: 'Choose only the details you want visible through the temporary QR link.' },
    { target: 'emergency-save', title: 'Save the profile', body: 'Save your details. Saving updates also revokes an active QR link.' },
    { target: 'emergency-create-link', title: 'Create a QR link', body: 'Create the temporary link after selecting the fields you want to share.' },
  ] },
  care_conversation: {
    section: 'care', title: 'Start a doctor conversation', steps: [
      { target: 'doctor-username', title: 'Enter a doctor username', body: 'Use the exact username of a registered doctor. MediMind checks the username before opening a conversation.' },
      { target: 'care-continue', title: 'Continue to the conversation', body: 'After the username is verified, you can exchange saved text messages, voice notes and reports.' },
      { target: 'care-message', title: 'Write a message', body: 'After the conversation opens, type your message here.' },
      { target: 'care-voice', title: 'Record a voice note', body: 'Use the microphone in the open conversation to record an audio message.' },
      { target: 'care-attach', title: 'Share a report', body: 'Open the attachment menu in the conversation to select or upload a report.' },
    ],
  },
  doctor_care: {
    section: 'care', title: 'Open a patient conversation', steps: [
      { target: 'care-session-list', title: 'Choose a patient conversation', body: 'Select a conversation from your saved patient list. Messages stay in the conversation history.' },
      { target: 'care-message', title: 'Write a message', body: 'After opening a conversation, type your message here.' },
      { target: 'care-voice', title: 'Record a voice note', body: 'Use the microphone to record an audio message.' },
      { target: 'care-attach', title: 'Share a report', body: 'Open the attachment menu to select or upload a report.' },
    ],
  },
};

const FIELD_TARGETS = {
  report_upload: ['reports', 'upload-report'],
  report_library: ['reports', 'report-library'],
  report_explanation: ['reports', 'report-explanation'],
  report_question: ['reports', 'report-question'],
  research_report: ['research', 'research-report'],
  research_question: ['research', 'research-question'],
  research_search: ['research', 'research-search'],
  research_evidence_question: ['research', 'research-evidence-question'],
  timeline_build: ['timeline', 'twin-build'],
  timeline_results: ['timeline', 'twin-results'],
  medication_upload: ['medications', 'medication-scan'],
  medication_name: ['medications', 'medication-name'],
  medication_dose: ['medications', 'medication-dose'],
  medication_frequency: ['medications', 'medication-frequency'],
  medication_times: ['medications', 'medication-times'],
  medication_instructions: ['medications', 'medication-instructions'],
  medication_save: ['medications', 'medication-save'],
  medication_reminders: ['medications', 'medication-reminders'],
  medication_review_add: ['medications', 'medication-review-add'],
  emergency_name: ['emergency', 'emergency-name'],
  emergency_allergies: ['emergency', 'emergency-allergies'],
  emergency_conditions: ['emergency', 'emergency-conditions'],
  emergency_medications: ['emergency', 'emergency-medications'],
  emergency_blood_group: ['emergency', 'emergency-blood-group'],
  emergency_contact: ['emergency', 'emergency-contact'],
  emergency_share_display_name: ['emergency', 'emergency-share-display_name'],
  emergency_share_allergies: ['emergency', 'emergency-share-allergies'],
  emergency_share_conditions: ['emergency', 'emergency-share-conditions'],
  emergency_share_medications: ['emergency', 'emergency-share-medications'],
  emergency_share_blood_group: ['emergency', 'emergency-share-blood_group'],
  emergency_share_emergency_contact: ['emergency', 'emergency-share-emergency_contact'],
  emergency_share: ['emergency', 'emergency-share'],
  emergency_save: ['emergency', 'emergency-save'],
  emergency_create_link: ['emergency', 'emergency-create-link'],
  emergency_revoke: ['emergency', 'emergency-revoke'],
  doctor_username: ['care', 'doctor-username'],
  care_continue: ['care', 'care-continue'],
  care_sessions: ['care', 'care-session-list'],
  care_message: ['care', 'care-message'],
  care_voice: ['care', 'care-voice'],
  care_attach: ['care', 'care-attach'],
  care_share_report_select: ['care', 'care-share-report-select'],
  care_share_report: ['care', 'care-share-report'],
  care_upload_report: ['care', 'care-upload-report'],
  care_send: ['care', 'care-send'],
};

const suggestions = [
  'Help me upload a report',
  'Review my health timeline',
  'Explore rare-disease research',
  'Set up my medication plan',
  'Create an emergency profile',
  'Start a doctor conversation',
];

function pageLabel(page) {
  return ({ reports: 'My reports', timeline:'Health timeline', research: 'Rare disease research', medications:'Medication plan', emergency:'Emergency profile', care: 'Care conversations' })[page] || 'MediMind';
}

export default function AICompanion({ page, role = 'patient', token, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('ask');
  const [language, setLanguage] = useState('en-IN');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([{ role: 'assistant', text: "Hi, I’m MediMind Companion. Ask me to take you to a specific field, such as ‘known allergies’, or choose Guide Me for a field-by-field walkthrough." }]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState('');
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [tour, setTour] = useState(null);
  const [tourAnchor, setTourAnchor] = useState(null);
  const [pendingField, setPendingField] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const highlightedRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (!pendingField || page !== pendingField.section) return undefined;
    const timer = window.setTimeout(() => {
      setTour({ title: 'Field help', steps: [{ target: pendingField.target, title: pendingField.title, body: pendingField.message }], index: 0 });
      setPendingField(null);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [page, pendingField]);

  useEffect(() => {
    if (!tour) {
      highlightedRef.current?.classList.remove('companion-guide-highlight');
      highlightedRef.current = null;
      setTourAnchor(null);
      return undefined;
    }
    let active = true;
    const step = tour.steps[tour.index];
    highlightedRef.current?.classList.remove('companion-guide-highlight');
    highlightedRef.current = null;
    const selector = step?.target ? `[data-guide-target="${step.target}"]` : null;
    const target = selector ? document.querySelector(selector) : null;
    if (!target) {
      setTourAnchor(null);
      return undefined;
    }
    highlightedRef.current = target;
    target.classList.add('companion-guide-highlight');
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    const updatePosition = () => {
      if (!active) return;
      const rect = target.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 28);
      const left = Math.max(14, Math.min(rect.left, window.innerWidth - width - 14));
      const top = Math.max(14, Math.min(rect.bottom + 12, window.innerHeight - 205));
      setTourAnchor({ left, top, width });
    };
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      target.classList.remove('companion-guide-highlight');
      if (highlightedRef.current === target) highlightedRef.current = null;
    };
  }, [tour]);

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
    window.speechSynthesis?.cancel();
    highlightedRef.current?.classList.remove('companion-guide-highlight');
  }, []);

  const startGuide = (guideId) => {
    const guide = GUIDES[guideId];
    if (!guide) return;
    setTour(null);
    onNavigate(guide.section);
    window.setTimeout(() => {
      setTour({ title: guide.title, steps: guide.steps, index: 0 });
      setOpen(false);
    }, 180);
  };

  const handleAction = (reply) => {
    if (reply.action === 'NAVIGATE' && (role !== 'doctor' || reply.section === 'care') && ['reports', 'timeline', 'research', 'medications', 'emergency', 'care'].includes(reply.section)) {
      onNavigate(reply.section);
      return;
    }
    if (reply.action === 'GUIDE' && GUIDES[reply.guide_id] && (role !== 'doctor' || GUIDES[reply.guide_id].section === 'care' && reply.guide_id !== 'care_conversation')) {
      startGuide(reply.guide_id);
      return;
    }
    if (reply.action === 'FIELD_HELP' && FIELD_TARGETS[reply.field_id]) {
      const [section, target] = FIELD_TARGETS[reply.field_id];
      if (role === 'doctor' && section !== 'care') return;
      setTour(null);
      setOpen(false);
      setPendingField({ section, target, title: 'What to enter', message: reply.message });
      if (section !== page || reply.field_id === 'report_upload') onNavigate(section);
    }
  };

  const sendMessage = async (raw = input) => {
    const message = raw.trim();
    if (!message || busy) return;
    setMessages(current => [...current, { role: 'user', text: message }]);
    setInput(''); setNotice(''); setBusy(true);
    try {
      const response = await fetch(`${API}/companion/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message, current_page: page, mode, language }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || 'The companion is unavailable right now.');
      const reply = { role: 'assistant', text: result.message || 'I can help you navigate MediMind.' };
      setMessages(current => [...current, reply]);
      handleAction(result);
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', text: error.message || 'I could not reach MediMind. Please try again.' }]);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const startVoiceInput = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setNotice('Voice input is not available in this browser. You can type your request instead.'); return; }
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const recognition = new Recognition();
    recognition.lang = language; recognition.continuous = false; recognition.interimResults = false;
    recognition.onstart = () => { setListening(true); setNotice('Listening… your transcript will appear here for review.'); };
    recognition.onresult = event => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setInput(transcript); setNotice(transcript ? 'Review the transcript, then press Send.' : 'No speech was detected. Please try again.');
      window.setTimeout(() => inputRef.current?.focus(), 50);
    };
    recognition.onerror = event => { setNotice(event.error === 'not-allowed' ? 'Microphone access was blocked. You can type your request instead.' : 'Voice input stopped. You can type your request instead.'); setListening(false); };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { setListening(false); setNotice('Voice input could not start. Please type your request.'); }
  };

  const speakReply = (text, index) => {
    if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) { setNotice('Voice playback is not available in this browser.'); return; }
    if (speakingIndex === index) { window.speechSynthesis.cancel(); setSpeakingIndex(null); return; }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language; utterance.rate = 0.95;
    utterance.onend = () => setSpeakingIndex(null); utterance.onerror = () => setSpeakingIndex(null);
    window.speechSynthesis.cancel(); setSpeakingIndex(index); window.speechSynthesis.speak(utterance);
  };

  const advanceTour = (direction) => {
    if (!tour) return;
    const next = tour.index + direction;
    if (next < 0 || next >= tour.steps.length) { setTour(null); return; }
    setTour({ ...tour, index: next });
  };

  return <>
    {open ? <section className="companion-panel" aria-label="MediMind AI Companion">
      <header className="companion-header"><div className="companion-avatar"><Bot size={19}/></div><div className="companion-title"><b>MediMind Companion</b><small><span/> Here to help · {pageLabel(page)}</small></div><button type="button" className="companion-close" aria-label="Close assistant" onClick={() => { setOpen(false); recognitionRef.current?.stop?.(); setListening(false); window.speechSynthesis?.cancel(); setSpeakingIndex(null); }}><X size={18}/></button></header>
      <div className="companion-mode" role="tablist" aria-label="Assistant mode"><button type="button" role="tab" aria-selected={mode==='ask'} className={mode==='ask'?'active':''} onClick={() => setMode('ask')}><HelpCircle size={14}/> Ask AI</button><button type="button" role="tab" aria-selected={mode==='guide'} className={mode==='guide'?'active':''} onClick={() => setMode('guide')}><Compass size={14}/> Guide Me</button><label className="companion-language"><span>Voice</span><select aria-label="Assistant language" value={language} onChange={e=>setLanguage(e.target.value)}>{VOICE_LANGUAGES.map(item=><option key={item.code} value={item.code}>{item.label}</option>)}</select></label></div>
      <div className="companion-messages" ref={scrollRef} aria-live="polite">
        {messages.map((entry, index) => <div key={`${index}-${entry.role}`} className={`companion-message ${entry.role}`}><div className="companion-bubble">{entry.text}</div>{entry.role==='assistant'&&<button className={`companion-speak ${speakingIndex===index?'active':''}`} type="button" aria-label={speakingIndex===index?'Stop speaking':'Hear response'} title={speakingIndex===index?'Stop speaking':'Hear response'} onClick={() => speakReply(entry.text,index)}>{speakingIndex===index?<VolumeX size={14}/>:<Volume2 size={14}/>}</button>}</div>)}
        {busy&&<div className="companion-typing"><span/><span/><span/> Thinking…</div>}
      </div>
      {messages.length===1&&<div className="companion-suggestions"><span>Try asking</span>{(role==='doctor'?['How do I open a patient conversation?','How do I send a message?']:suggestions).map(item=><button key={item} type="button" disabled={busy} onClick={() => sendMessage(item)}>{item}<ChevronDown size={12}/></button>)}</div>}
      {notice&&<div className="companion-notice" role="status">{notice}</div>}
      <div className="companion-privacy"><ShieldCheck size={13}/> Website help only. Don’t include personal health details.</div>
      <form className="companion-composer" onSubmit={event => { event.preventDefault(); sendMessage(); }}>
        <button type="button" className={`companion-mic ${listening?'listening':''}`} aria-label={listening?'Stop voice input':'Dictate a request'} title={listening?'Stop voice input':'Dictate a request'} onClick={startVoiceInput}><Mic size={17}/></button>
        <input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder={mode==='guide'?'Which feature or field should I walk you through?':'Ask for a field, e.g. known allergies…'} maxLength={1200} aria-label="Ask MediMind Companion" />
        <button type="submit" className="companion-send" aria-label="Send request" disabled={busy||!input.trim()}><Send size={16}/></button>
      </form>
      <small className="companion-footnote">Microphone access is used only after you tap the mic.</small>
    </section> : <button type="button" className="companion-launcher" aria-label="Open MediMind AI Companion" onClick={() => setOpen(true)}><Bot size={25}/><span className="companion-launcher-spark"><Sparkles size={11}/></span></button>}

    {tour&&<div className="companion-tour-card" style={tourAnchor||{}} role="dialog" aria-live="polite" aria-label="Step-by-step guide">
      <div className="companion-tour-eyebrow">{tour.title} · Step {tour.index+1} of {tour.steps.length}</div>
      <h3>{tour.steps[tour.index].title}</h3><p>{tour.steps[tour.index].body}</p>
      <div className="companion-tour-controls"><button type="button" className="tour-stop" onClick={() => setTour(null)}>End guide</button><div>{tour.index>0&&<button type="button" onClick={() => advanceTour(-1)}>Back</button>}<button type="button" className="tour-next" onClick={() => advanceTour(1)}>{tour.index===tour.steps.length-1?'Done':'Next'}</button></div></div>
    </div>}
  </>;
}
