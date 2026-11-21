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
    ],
  },
  understand_report: {
    section: 'reports', title: 'Understand a report', steps: [
      { target: 'report-library', title: 'Open a saved report', body: 'Choose a report from your library. The explanation appears in its overview tab; you can also ask a question below it.' },
    ],
  },
  explore_research: {
    section: 'research', title: 'Explore rare-disease research', steps: [
      { target: 'research-report', title: 'Choose report context', body: 'Optionally select a saved report. You can also describe a finding without choosing a report.' },
      { target: 'research-question', title: 'Describe a finding', body: 'Enter a general question or finding. Avoid names and identifying details.' },
      { target: 'research-search', title: 'Search the literature', body: 'MediMind searches PubMed and presents cautious research leads with links. These are not a diagnosis.' },
    ],
  },
  health_timeline: { section: 'timeline', title: 'Review your health timeline', steps: [{ target: 'twin-build', title: 'Compare your reports', body: 'Gather dates and create a cautious, evidence-linked overview from your saved reports.' }, { target: 'twin-results', title: 'Review the sources', body: 'Each observation names the reports it used. Discuss important trends with your clinician.' }] },
  medication_plan: { section: 'medications', title: 'Set up your medication plan', steps: [{ target: 'medication-scan', title: 'Scan a prescription', body: 'Upload a prescription to create a draft. Check each extracted field against the original before adding it.' }, { target: 'medication-name', title: 'Enter medicine details', body: 'Use the medicine name and instructions exactly as written by your clinician or pharmacist.' }] },
  emergency_profile: { section: 'emergency', title: 'Create an emergency profile', steps: [{ target: 'emergency-fields', title: 'Add emergency essentials', body: 'Only enter details you want to share. Choose each field deliberately.' }, { target: 'emergency-share', title: 'Choose sharing fields', body: 'The temporary QR link exposes only selected details. Anyone who scans it can view them until expiry or revocation.' }] },
  care_conversation: {
    section: 'care', title: 'Start a doctor conversation', steps: [
      { target: 'doctor-username', title: 'Enter a doctor username', body: 'Use the exact username of a registered doctor. MediMind checks the username before opening a conversation.' },
      { target: 'care-continue', title: 'Continue to the conversation', body: 'After the username is verified, you can exchange saved text messages, voice notes and reports.' },
    ],
  },
};

const FIELD_TARGETS = {
  report_upload: ['reports', 'upload-report'],
  report_question: ['reports', 'report-question'],
  research_report: ['research', 'research-report'],
  research_question: ['research', 'research-question'],
  medication_upload: ['medications', 'medication-scan'],
  medication_name: ['medications', 'medication-name'],
  emergency_profile: ['emergency', 'emergency-fields'],
  emergency_share: ['emergency', 'emergency-share'],
  doctor_username: ['care', 'doctor-username'],
  care_message: ['care', 'care-message'],
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
  const [messages, setMessages] = useState([{ role: 'assistant', text: "Hi, I’m MediMind Companion. Ask me how to use a feature, or choose Guide Me for step-by-step help." }]);
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
        <input ref={inputRef} value={input} onChange={event => setInput(event.target.value)} placeholder={mode==='guide'?'What would you like help doing?':'Ask how to use MediMind…'} maxLength={1200} aria-label="Ask MediMind Companion" />
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
