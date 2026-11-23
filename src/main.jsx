import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownToLine, ArrowRight, AudioLines, BookOpen, Brain, Check, ChevronDown, CircleHelp, ClipboardList, FileText, HeartPulse, History, LogOut, Menu, MessageCircle, Mic, Paperclip, Pill, Plus, QrCode, Search, Send, ShieldCheck, Sparkles, Stethoscope, Upload, UserRound, Users, Volume2, VolumeX, X } from 'lucide-react';
import './styles.css';
import AICompanion from './components/AICompanion.jsx';

const API = import.meta.env.VITE_API_URL || '/api';
const modules = [
  { id: 'reports', label: 'My reports', sub: 'Understand your results', icon: FileText },
  { id: 'timeline', label: 'Health timeline', sub: 'See the bigger picture', icon: Activity },
  { id: 'research', label: 'Rare disease research', sub: 'Explore the evidence', icon: Brain },
  { id: 'medications', label: 'Medication plan', sub: 'Review & set reminders', icon: Pill },
  { id: 'emergency', label: 'Emergency profile', sub: 'Share essentials securely', icon: QrCode },
  { id: 'care', label: 'Care conversations', sub: 'Stay connected', icon: MessageCircle },
];
function App() {
  const [emergencyToken] = useState(() => new URLSearchParams(window.location.search).get('emergency'));
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem('mm_user')); } catch { return null; } });
  const [token, setToken] = useState(() => localStorage.getItem('mm_token'));
  const activeToken = useRef(token);
  const [authMode, setAuthMode] = useState('signup');
  const [section, setSection] = useState(() => { try { return JSON.parse(localStorage.getItem('mm_user'))?.role === 'doctor' ? 'care' : 'reports'; } catch { return 'reports'; } });
  const [reports, setReports] = useState([]);
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const auth = async (data, mode) => {
    setError(''); setBusy(true);
    try { const r = await fetch(`${API}/auth/${mode}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(data) }); const j = await r.json(); if (!r.ok) throw new Error(j.detail || 'Could not sign in.'); localStorage.setItem('mm_token', j.access_token); localStorage.setItem('mm_user', JSON.stringify(j.user)); activeToken.current = j.access_token; setReports([]); setSelected(null); setAnalysis(''); setSection(j.user.role === 'doctor' ? 'care' : 'reports'); setToken(j.access_token); setUser(j.user); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const logout = () => { activeToken.current = null; localStorage.removeItem('mm_token'); localStorage.removeItem('mm_user'); setUser(null); setToken(null); setReports([]); setSelected(null); setAnalysis(''); setSection('reports'); setBusy(false); setAuthMode('signin'); };
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const visibleModules = user?.role === 'doctor' ? modules.filter(module => module.id === 'care') : modules;
  const activeSection = user?.role === 'doctor' ? 'care' : section;
  const upload = async file => {
    if (!file) return;
    if (!token) { setError('Sign in to securely save and review a report.'); return; }
    const requestToken = token;
    setBusy(true); setError('');
    try { const body = new FormData(); body.append('file', file); const r = await fetch(`${API}/reports`, { method:'POST', headers, body }); const j = await r.json(); if (!r.ok) throw new Error(j.detail || 'Upload failed.'); if (activeToken.current !== requestToken) return; setReports(v => [j, ...v]); setSelected(j); setAnalysis(j.explanation || ''); }
    catch(e) { if (activeToken.current === requestToken) setError(e.message); } finally { if (activeToken.current === requestToken) setBusy(false); }
  };
  const openReport = async item => { if (!item) { setSelected(null); setAnalysis(''); return; } setSelected(item); setAnalysis(item.explanation || ''); if (!token || item._id?.startsWith('sample')) return; const requestToken = token; setBusy(true); try { const r = await fetch(`${API}/reports/${item._id}`, {headers}); const j = await r.json(); if (activeToken.current === requestToken && r.ok) { setSelected(j); setAnalysis(j.explanation || ''); } } finally { if (activeToken.current === requestToken) setBusy(false); } };
  useEffect(() => {
    let active = true;
    if (!token || user?.role !== 'patient') {
      setReports([]);
      return () => { active = false; };
    }
    const requestToken = token;
    const loadReports = async () => {
      try {
        const r = await fetch(`${API}/reports`, {headers});
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || 'Could not load your reports.');
        if (!Array.isArray(data)) throw new Error('Unexpected response when loading reports.');
        if (active && activeToken.current === requestToken) setReports(data);
      } catch (e) {
        if (active && activeToken.current === requestToken) {
          setReports([]);
          setError(e.message);
        }
      }
    };
    loadReports();
    return () => { active = false; };
  }, [token, user?.role]);
  if (emergencyToken) return <EmergencyPublicPage token={emergencyToken} />;
  if (!user) return <AuthScreen onAuth={auth} busy={busy} error={error} initialMode={authMode} />;
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><HeartPulse size={21}/></div><span>medi<span className="brand-light">mind</span></span><button className="mobile-close" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-label">YOUR SPACE</div>
      <nav>{visibleModules.map(m=><button key={m.id} data-guide-target={`nav-${m.id}`} className={`nav-item ${activeSection===m.id?'active':''}`} onClick={()=>{setSection(m.id);setSelected(null);setMobileNav(false);setError('');}}><m.icon size={19}/><span className="nav-copy"><b>{m.label}</b><small>{m.sub}</small></span>{activeSection===m.id&&<span className="nav-dot"/>}</button>)}</nav>
      <div className="side-bottom"><div className="privacy-note"><ShieldCheck size={17}/><span>Your health information is private to your account.</span></div><button className="profile" onClick={logout}><div className="avatar">{user.username?.[0]?.toUpperCase() || 'M'}</div><span><b>{user.username}</b><small>{user.role === 'doctor'?'Care provider':'Patient account'}</small></span><LogOut size={16} className="logout"/></button></div>
    </aside>
    {mobileNav&&<button className="scrim" aria-label="Close menu" onClick={()=>setMobileNav(false)}/>}
    <main className="main-area"><header className="topbar"><button className="menu-button" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><b>{visibleModules.find(m=>m.id===activeSection)?.label}</b></div><div className="top-right"><span className="secure"><ShieldCheck size={15}/> Private workspace</span><div className="top-avatar">{user.username?.[0]?.toUpperCase()||'M'}</div></div></header>
      <div className="content">
        {error&&<div className="alert"><CircleHelp size={17}/>{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}
        {activeSection==='reports'&&<ReportsPage reports={reports} selected={selected} analysis={analysis} busy={busy} onUpload={upload} onSelect={openReport} token={token} />}
        {activeSection==='timeline'&&<HealthTimelinePage token={token} headers={headers} />}
        {activeSection==='research'&&<ResearchPage reports={reports} token={token} headers={headers} />}
        {activeSection==='medications'&&<MedicationPage token={token} headers={headers} />}
        {activeSection==='emergency'&&<EmergencyPage token={token} headers={headers} />}
        {activeSection==='care'&&<CarePage user={user} token={token} headers={headers} reports={reports} onReportUploaded={report=>setReports(current=>[report,...current.filter(item=>item._id!==report._id)])} />}
      </div>
      <footer className="footer-disclaimer"><ShieldCheck size={15}/><span>MediMind helps you understand health information. It does not provide a diagnosis or replace care from a qualified professional.</span></footer>
    </main>
    <AICompanion page={activeSection} role={user.role} token={token} onNavigate={target=>{if(user.role==='doctor'&&target!=='care')return;setSection(target);setMobileNav(false);setError('');if(target==='reports')setSelected(null);}} />
  </div>;
}

function AuthScreen({onAuth,busy,error,initialMode}) {
  const [mode,setMode]=useState(initialMode); const [role,setRole]=useState('patient'); const [email,setEmail]=useState(''); const [username,setUsername]=useState(''); const [password,setPassword]=useState('');
  return <div className="auth-wrap"><div className="auth-left"><div className="brand auth-brand"><div className="brand-mark"><HeartPulse size={21}/></div><span>medi<span className="brand-light">mind</span></span></div><div className="auth-story"><div className="eyebrow"><span className="eyebrow-dot"/> A CLEARER WAY TO CARE</div><h1>Your health story,<br/><em>all in one place.</em></h1><p>Make sense of your medical reports, explore trusted research and stay connected with the people who care for you.</p><div className="auth-points"><span><Check size={15}/> Understand your results</span><span><Check size={15}/> Keep your records together</span><span><Check size={15}/> Bring better questions to care</span></div></div><div className="auth-quote"><div className="quote-icon"><Sparkles size={18}/></div><p>Clarity can make all the difference.</p><small>A little more understanding, every day.</small></div><div className="auth-left-foot">Made for your health journey <HeartPulse size={13}/></div></div>
    <div className="auth-right"><div className="auth-form-wrap"><div className="auth-mobile-brand brand"><div className="brand-mark"><HeartPulse size={21}/></div><span>medi<span className="brand-light">mind</span></span></div><div className="auth-heading"><div className="auth-symbol"><UserRound size={21}/></div><div className="eyebrow">YOUR PERSONAL HEALTH SPACE</div><h2>{mode==='signup'?'Create your account':'Welcome back'}</h2><p>{mode==='signup'?'A calmer way to understand what matters.':'Sign in to pick up where you left off.'}</p></div>
      <form onSubmit={e=>{e.preventDefault();onAuth({email,username,password,role},mode);}} className="auth-form">{mode==='signup'&&<><label>Email address<input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Username<input autoComplete="username" placeholder="Choose a username" value={username} onChange={e=>setUsername(e.target.value)} minLength={3} required/></label></>}<label>{mode==='signin'?'Email or username':'Password'}{mode==='signin'&&<input autoComplete="username" placeholder="you@example.com or username" value={email} onChange={e=>setEmail(e.target.value)} required/>}{mode==='signin'&&<span className="password-gap"/>}{mode==='signup'&&<span className="password-hint">At least 8 characters</span>}<input type="password" autoComplete={mode==='signup'?'new-password':'current-password'} placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required/></label>
        {mode==='signup'&&<fieldset className="role-picker"><legend>I’m joining as</legend><button type="button" className={role==='patient'?'chosen':''} onClick={()=>setRole('patient')}><HeartPulse size={17}/> Patient</button><button type="button" className={role==='doctor'?'chosen':''} onClick={()=>setRole('doctor')}><Stethoscope size={17}/> Doctor</button></fieldset>}
        {error&&<div className="auth-error">{error}</div>}<button className="primary-button auth-submit" disabled={busy}>{busy?'Please wait…':mode==='signup'?'Create my account':'Sign in'}<ArrowRight size={17}/></button></form><div className="auth-switch">{mode==='signup'?'Already have an account?':'New to MediMind?'} <button onClick={()=>{setMode(mode==='signup'?'signin':'signup');}}>{mode==='signup'?'Sign in':'Create an account'}</button></div><div className="auth-secure"><ShieldCheck size={15}/> Only your account can access your private workspace</div><div className="auth-terms">By continuing, you agree to use MediMind as a support tool alongside professional medical care.</div></div></div>
  </div>;
}

function ReportsPage({reports,selected,analysis,busy,onUpload,onSelect,token}) {
  const [drag,setDrag]=useState(false); const [question,setQuestion]=useState(''); const [answer,setAnswer]=useState(''); const [chatBusy,setChatBusy]=useState(false); const [tab,setTab]=useState('overview'); const [localAnalysis,setLocalAnalysis]=useState(''); const [speaking,setSpeaking]=useState(false);
  const current=selected; const explanation=analysis||localAnalysis;
  useEffect(()=>{setSpeaking(false);return()=>{window.speechSynthesis?.cancel();};},[current?._id]);
  const toggleSpeech=()=>{
    if(!('speechSynthesis' in window)||!window.SpeechSynthesisUtterance){alert('Voice playback is not available in this browser.');return;}
    if(speaking){window.speechSynthesis.cancel();setSpeaking(false);return;}
    const spokenText=explanation.replace(/^#+\s*/gm,'').replace(/^[-*•]\s*/gm,'').replace(/\*\*(.*?)\*\*/g,'$1').trim();
    if(!spokenText)return;
    const utterance=new SpeechSynthesisUtterance(spokenText);
    utterance.lang=navigator.language||'en-US'; utterance.rate=0.95;
    utterance.onstart=()=>setSpeaking(true); utterance.onend=()=>setSpeaking(false); utterance.onerror=()=>setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
  };
  const ask=async e=>{e.preventDefault(); if(!question.trim())return; if(!token){setAnswer('Sign in to chat about your reports.');return;} setChatBusy(true); try{const r=await fetch(`${API}/reports/${current?._id}/chat`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({message:question})});const j=await r.json();setAnswer(j.answer||j.detail||'I could not answer that just now.');setQuestion('');}catch{setAnswer('Unable to reach MediMind right now.');}finally{setChatBusy(false);}};
  const download=async()=>{if(!token||!current||current._id?.startsWith('sample'))return;try{const r=await fetch(`${API}/reports/${current._id}/file`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw Error('Download unavailable.');const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=current.filename;a.click();URL.revokeObjectURL(url);}catch(e){alert(e.message);}};
  return <><div className="page-intro"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR HEALTH, MADE CLEARER</div><h1>My reports <span className="heading-spark"><Sparkles size={20}/></span></h1><p>Understand your results at your own pace, with a little help along the way.</p></div><div className="intro-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><HeartPulse size={29}/></div><div className="float-pill pill-a"><Activity size={15}/></div><div className="float-pill pill-b"><Sparkles size={14}/></div></div></div>
    {current?<><div className="report-detail-top"><button className="text-button" onClick={()=>{setLocalAnalysis('');onSelect(null);}}>← All reports</button><span className="status-chip"><span/> Analysis ready</span></div><div className="detail-card"><div className="detail-heading"><div className="document-icon"><FileText size={21}/></div><div><h2>{current.filename}</h2><p>Added {current.created_at?new Date(current.created_at).toLocaleDateString():current.date||'Today'} · Private to you</p></div><div className="detail-actions"><button className={`icon-button ${speaking?'is-speaking':''}`} type="button" title={speaking?'Stop reading explanation':'Read explanation aloud'} aria-label={speaking?'Stop reading explanation':'Read explanation aloud'} aria-pressed={speaking} onClick={toggleSpeech} disabled={busy||tab!=='overview'||!explanation.trim()}>{speaking?<VolumeX size={18}/>:<Volume2 size={18}/>}</button><button className="icon-button" title="Download report" aria-label="Download report" onClick={download} disabled={!token||current._id?.startsWith('sample')}><ArrowDownToLine size={18}/></button></div></div><div className="detail-tabs"><button className={tab==='overview'?'on':''} onClick={()=>setTab('overview')}>Plain-language overview</button><button className={tab==='original'?'on':''} onClick={()=>setTab('original')}>Extracted text</button></div>{tab==='overview'?<div className="analysis-content">{busy?<div className="loading-state"><span className="spinner"/> Looking through your report…</div>:explanation?<><div className="gentle-note"><Sparkles size={16}/><span>Here’s a simpler way to read this report. Bring any questions to your care team.</span></div><div className="analysis-text" data-guide-target="report-explanation">{explanation.split('\n').filter(Boolean).map((l,i)=><p key={i}>{l.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '• ')}</p>)}</div></>:<div className="empty-analysis"><FileText size={26}/><p>This sample report is a preview. Upload your own report to get a personalized explanation.</p></div>}</div>:<pre className="extracted-text">{current.extracted_text||'Extracted report text will appear here after upload.'}</pre>}</div><div className="report-chat-card"><div className="chat-title"><div className="chat-ai-icon"><Sparkles size={16}/></div><div><h3>A question about this report?</h3><p>Ask in everyday language — I’ll help explain.</p></div></div>{answer&&<div className="chat-answer"><span className="chat-ai-icon small"><Sparkles size={13}/></span><span>{answer}</span></div>}<form className="chat-input" onSubmit={ask}><input data-guide-target="report-question" value={question} onChange={e=>setQuestion(e.target.value)} placeholder="For example, what does this result mean?"/><button aria-label="Send question" disabled={chatBusy}><Send size={17}/></button></form></div></>:<>
    <div className="upload-card" onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);onUpload(e.dataTransfer.files[0]);}}><div className={`upload-inner ${drag?'dragging':''}`}><div className="upload-icon"><Upload size={21}/></div><div className="upload-copy"><h3>Start with a report</h3><p>Upload a PDF, photo, or document — we’ll help make it easier to understand.</p><small>PDF, PNG, JPG, DOCX or TXT · Up to 10 MB</small></div><label className="primary-button upload-button" data-guide-target="upload-report">{busy?'Uploading…':'Choose a file'}<ArrowRight size={16}/><input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,.csv,.webp" onChange={e=>onUpload(e.target.files[0])} disabled={busy}/></label></div><div className="upload-foot"><ShieldCheck size={14}/> Your reports are private and only visible to you.</div></div>
    <div className="section-heading"><div><h2>Your library</h2><p>Reports you’ve added to MediMind</p></div><span className="count-pill">{reports.length} {reports.length===1?'report':'reports'}</span></div><div className="report-list" data-guide-target="report-library">{reports.map((r,i)=><button className="report-row" key={r._id||i} onClick={()=>onSelect(r)}><div className="report-file-icon"><FileText size={19}/></div><div className="report-row-main"><b>{r.filename}</b><span>{r.created_at?new Date(r.created_at).toLocaleDateString():r.date||'Recently added'} · {r.file_type||'Medical report'}</span></div><span className="ready-label"><span/>Ready</span><ArrowRight className="row-arrow" size={16}/></button>)}</div><div className="tip-card"><div className="tip-icon"><BookOpen size={18}/></div><div><b>A helpful tip</b><p>Reports can be full of unfamiliar terms. Start with the summary, then write down anything you’d like to ask your doctor.</p></div></div>
    </>}
  </>;
}

function HealthTimelinePage({token,headers}) {
  const [result,setResult]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const build=async()=>{setBusy(true);setError('');try{const r=await fetch(`${API}/health/twin`,{method:'POST',headers});const j=await r.json();if(!r.ok)throw Error(j.detail||'Could not build your health timeline.');setResult(j);}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <><div className="page-intro"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR RECORDS, CONNECTED</div><h1>Health timeline <span className="heading-spark"><Activity size={20}/></span></h1><p>Bring reports together to notice patterns over time, with their sources clearly shown.</p></div><div className="intro-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><Activity size={27}/></div></div></div>
    <div className="research-warning"><ShieldCheck size={17}/><span><b>A record organizer, not a diagnosis.</b> AI observations are based only on uploaded reports and should be reviewed with a clinician.</span></div>
    <div className="twin-card"><div className="research-card-title"><div className="research-icon"><History size={19}/></div><div><h2>Your health, across reports</h2><p>Private reports are compared only within your account.</p></div></div><button className="primary-button" data-guide-target="twin-build" onClick={build} disabled={busy}>{busy?<><span className="spinner light"/> Comparing reports…</>:<>Build my health timeline <ArrowRight size={16}/></>}</button>{error&&<div className="inline-error">{error}</div>}</div>
    {result&&<div className="twin-results" data-guide-target="twin-results"><div className="twin-summary"><div className="eyebrow"><span className="eyebrow-dot"/> PERSONAL HEALTH SNAPSHOT</div><p>{result.summary}</p><small>{result.disclaimer}</small></div><div className="twin-columns"><section><h2>Report history</h2><div className="timeline-list">{[...(result.timeline||[])].reverse().map((item,i)=><div className="timeline-item" key={item.report_id}><span className="timeline-dot"/><div><b>{item.filename}</b><small>{new Date(item.date).toLocaleDateString()}</small></div><span className="timeline-number">{String(i+1).padStart(2,'0')}</span></div>)}</div></section><section><h2>Evidence-linked observations</h2>{result.observations?.length?result.observations.map((item,i)=><article className="observation-card" key={i}><span className={`observation-kind ${item.kind}`}>{item.kind}</span><b>{item.label}</b><p>{item.note}</p><small>Source: {item.evidence_files?.length?item.evidence_files.join(', '):'No specific report cited'}</small></article>):<div className="history-empty"><p>No comparable trends could be safely identified. More reports may add context.</p></div>}</section></div></div>}
  </>;
}

function MedicationPage({token,headers}) {
  const [items,setItems]=useState([]); const [candidate,setCandidate]=useState([]); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [name,setName]=useState(''); const [dose,setDose]=useState(''); const [frequency,setFrequency]=useState(''); const [times,setTimes]=useState(''); const [instructions,setInstructions]=useState(''); const [notice,setNotice]=useState(''); const notified=useRef(new Set());
  const load=async()=>{try{const r=await fetch(`${API}/medications`,{headers});if(r.ok)setItems(await r.json());}catch{setError('Could not load your medication plan.');}};
  useEffect(()=>{if(token)load();},[token]);
  useEffect(()=>{if(!items.length||!('Notification'in window)||Notification.permission!=='granted')return;const check=()=>{const now=new Date(), hhmm=now.toTimeString().slice(0,5), day=now.toISOString().slice(0,10);for(const m of items)for(const time of m.times||[]){const key=`${day}-${m._id}-${time}`;if(time===hhmm&&!notified.current.has(key)){new Notification('MediMind medication reminder',{body:`Time to review your saved schedule: ${m.name} · ${m.dose||'as listed on your prescription'}`});notified.current.add(key);}}};const id=window.setInterval(check,30000);check();return()=>window.clearInterval(id);},[items]);
  const save=async data=>{setBusy(true);setError('');try{const r=await fetch(`${API}/medications`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)});const j=await r.json();if(!r.ok)throw Error(j.detail||'Could not save medication.');setItems(current=>[j,...current]);return true;}catch(e){setError(e.message);return false;}finally{setBusy(false);}};
  const addManual=async e=>{e.preventDefault();const parsedTimes=times.split(',').map(x=>x.trim()).filter(Boolean);if(parsedTimes.some(x=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(x))){setError('Enter reminder times in 24-hour HH:MM format, separated by commas.');return;}if(await save({name,dose,frequency,times:parsedTimes,instructions})){setName('');setDose('');setFrequency('');setTimes('');setInstructions('');}};
  const scan=async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);setError('');setCandidate([]);try{const body=new FormData();body.append('file',file);const r=await fetch(`${API}/medications/scan`,{method:'POST',headers,body});const j=await r.json();if(!r.ok)throw Error(j.detail||'Could not read this prescription.');setCandidate(j.medications||[]);setNotice(j.notice||'Review all extracted details before saving.');if(!j.medications?.length)setError('No clear medication names were found. You can enter the details manually.');}catch(e){setError(e.message);}finally{setBusy(false);e.target.value='';}};
  const remove=async id=>{try{const r=await fetch(`${API}/medications/${id}`,{method:'DELETE',headers});if(!r.ok)throw Error();setItems(v=>v.filter(x=>x._id!==id));}catch{setError('Could not remove that item.');}};
  const enableReminders=async()=>{if(!('Notification'in window)){setNotice('This browser does not support notifications. Your saved schedule is still available here.');return;}const result=await Notification.requestPermission();setNotice(result==='granted'?'Reminders are enabled while MediMind is open in this browser.':'Notifications were not enabled. You can still view the schedule here.');};
  return <><div className="page-intro"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR PRESCRIPTION, ORGANIZED</div><h1>Medication plan <span className="heading-spark"><Pill size={20}/></span></h1><p>Scan a prescription into a reviewable draft, then keep your schedule in one place.</p></div><div className="intro-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><Pill size={27}/></div></div></div>
    <div className="research-warning"><ShieldCheck size={17}/><span><b>Check every detail against the prescription.</b> MediMind does not recommend or change medicine or dose. No interaction checker is included; ask a pharmacist or clinician about safety.</span></div>
    <div className="medication-grid"><section className="research-card"><div className="research-card-title"><div className="research-icon"><Upload size={19}/></div><div><h2>Scan a prescription</h2><p>AI extracts a draft for you to verify before saving.</p></div></div><label className="primary-button med-scan" data-guide-target="medication-scan">{busy?'Reading…':'Choose prescription'}<Upload size={15}/><input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt" onChange={scan} disabled={busy}/></label>{candidate.map((m,i)=><article className="med-candidate" key={i}><b>{m.name}</b><small>{[m.dose,m.frequency].filter(Boolean).join(' · ')||'Dose and schedule not clearly found'}</small>{m.instructions&&<small>{m.instructions}</small>}<button type="button" className="text-button" disabled={busy} onClick={async()=>{if(await save(m)){setCandidate(v=>v.filter((_,idx)=>idx!==i));setNotice('Added to your medication plan. Please verify it with the original prescription.');}}}>Review & add</button></article>)}</section>
    <section className="research-card"><div className="research-card-title"><div className="research-icon"><Plus size={19}/></div><div><h2>Add a medicine</h2><p>Enter the details exactly as prescribed.</p></div></div><form className="med-form" onSubmit={addManual}><label>Medicine name<input data-guide-target="medication-name" value={name} onChange={e=>setName(e.target.value)} required maxLength={120}/></label><label>Dose on prescription<input value={dose} onChange={e=>setDose(e.target.value)} placeholder="e.g. 1 tablet · 500 mg"/></label><label>Frequency<input value={frequency} onChange={e=>setFrequency(e.target.value)} placeholder="e.g. twice daily"/></label><label>Reminder times <small>(optional, 24-hour time, comma separated)</small><input value={times} onChange={e=>setTimes(e.target.value)} placeholder="08:00, 20:00"/></label><label>Prescription instructions<input value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="e.g. take with food"/></label><button className="primary-button" disabled={busy}>Save to my plan <ArrowRight size={15}/></button></form></section></div>
    {error&&<div className="inline-error">{error}</div>}{notice&&<div className="med-notice" role="status">{notice}</div>}
    <div className="section-heading"><div><h2>Your saved schedule</h2><p>Only you can access these entries.</p></div><button className="text-button" type="button" onClick={enableReminders}>Enable browser reminders</button></div><div className="med-list">{items.length?items.map(m=><article className="med-row" key={m._id}><div className="research-icon"><Pill size={17}/></div><div><b>{m.name}</b><p>{[m.dose,m.frequency].filter(Boolean).join(' · ')||'Follow the original prescription'}</p>{m.instructions&&<small>{m.instructions}</small>}{m.times?.length>0&&<small>Reminder times: {m.times.join(', ')}</small>}</div><button type="button" className="icon-button med-remove" aria-label={`Remove ${m.name}`} onClick={()=>remove(m._id)}><X size={15}/></button></article>):<div className="history-empty"><div className="history-icon"><Pill size={17}/></div><b>No medicines saved yet</b><p>Scan a prescription or add its details above.</p></div>}</div>
    <p className="med-source-note">Notifications run only while this page is open. For urgent or safety questions, contact a pharmacist or clinician.</p>
  </>;
}

const emergencyFields=[['display_name','Name'],['allergies','Known allergies'],['conditions','Medical conditions'],['medications','Current medications'],['blood_group','Blood group'],['emergency_contact','Emergency contact']];
function EmergencyPage({token,headers}) {
  const [profile,setProfile]=useState({display_name:'',allergies:'',conditions:'',medications:'',blood_group:'',emergency_contact:'',share_fields:[]}); const [qr,setQr]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
  useEffect(()=>{fetch(`${API}/emergency/profile`,{headers}).then(r=>r.ok?r.json():null).then(v=>v&&setProfile(v)).catch(()=>setError('Could not load your emergency profile.'));},[token]);
  const change=(key,value)=>setProfile(p=>({...p,[key]:value}));
  const save=async()=>{setBusy(true);setError('');setQr(null);try{const r=await fetch(`${API}/emergency/profile`,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(profile)});const j=await r.json();if(!r.ok)throw Error(j.detail||'Could not save your profile.');setProfile(p=>({...p,share_active:false}));setNotice('Emergency profile saved. Saving updates revokes any QR link that was already active.');}catch(e){setError(e.message);}finally{setBusy(false);}};
  const share=async()=>{setBusy(true);setError('');try{const saved=await fetch(`${API}/emergency/profile`,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(profile)});const savedJson=await saved.json();if(!saved.ok)throw Error(savedJson.detail||'Could not save your profile.');const r=await fetch(`${API}/emergency/share`,{method:'POST',headers});const j=await r.json();if(!r.ok)throw Error(j.detail||'Could not create a secure link.');setQr(j);setProfile(p=>({...p,share_active:true}));setNotice('A private, 24-hour QR link is ready. Anyone with the link can view only the details you selected.');}catch(e){setError(e.message);}finally{setBusy(false);}};
  const revoke=async()=>{setBusy(true);try{const r=await fetch(`${API}/emergency/share/revoke`,{method:'POST',headers});if(!r.ok)throw Error();setQr(null);setProfile(p=>({...p,share_active:false}));setNotice('The emergency QR link has been revoked.');}catch{setError('Could not revoke the link. Try again.');}finally{setBusy(false);}};
  return <><div className="page-intro"><div><div className="eyebrow"><span className="eyebrow-dot"/> PATIENT-CONTROLLED SHARING</div><h1>Emergency profile <span className="heading-spark"><QrCode size={20}/></span></h1><p>Choose essential details and create a time-limited QR link for an emergency.</p></div><div className="intro-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><ShieldCheck size={27}/></div></div></div>
    <div className="research-warning"><ShieldCheck size={17}/><span><b>Your choice, your link.</b> The QR contains no health information itself. It opens only details you choose, expires after 24 hours, and can be revoked. Anyone who scans an active link can view the selected details.</span></div>
    <section className="research-card emergency-form"><div className="research-card-title"><div className="research-icon"><HeartPulse size={19}/></div><div><h2>Emergency essentials</h2><p>Enter only information you want available to someone helping you.</p></div></div><div className="emergency-fields" data-guide-target="emergency-fields">{emergencyFields.map(([key,label])=><label key={key}>{label}{key==='blood_group'?<select value={profile[key]||''} onChange={e=>change(key,e.target.value)}><option value="">Not provided</option>{['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(v=><option key={v}>{v}</option>)}</select>:<input value={profile[key]||''} onChange={e=>change(key,e.target.value)} maxLength={key==='display_name'?80:1000} placeholder={key==='emergency_contact'?'Contact name and phone number':''}/>}</label>)}</div><h3>Choose what the QR link can show</h3><div className="share-checks" data-guide-target="emergency-share">{emergencyFields.map(([key,label])=><label key={key}><input type="checkbox" checked={(profile.share_fields||[]).includes(key)} onChange={e=>change('share_fields',e.target.checked?[...(profile.share_fields||[]),key]:(profile.share_fields||[]).filter(x=>x!==key))}/>{label}</label>)}</div><div className="emergency-actions"><button className="primary-button" type="button" disabled={busy} onClick={save}>{busy?'Saving…':'Save profile'}<Check size={15}/></button><button className="secondary-button" type="button" disabled={busy||!profile.share_fields?.length} onClick={share}>Create 24-hour QR link <QrCode size={15}/></button>{profile.share_active&&<button className="secondary-button" type="button" disabled={busy} onClick={revoke}>Revoke active link <X size={14}/></button>}</div></section>
    {error&&<div className="inline-error">{error}</div>}{notice&&<div className="med-notice" role="status">{notice}</div>}{qr&&<section className="qr-result"><img src={qr.qr_image} alt="Scannable secure emergency profile QR code"/><div><div className="eyebrow"><span className="eyebrow-dot"/> READY TO SHARE</div><h2>Emergency link expires {new Date(qr.expires_at).toLocaleString()}</h2><p>Print or show this QR code only when you choose to share your selected details.</p><a className="secondary-button" href={qr.qr_image} download="medimind-emergency-qr.png">Download QR <ArrowDownToLine size={14}/></a><button className="secondary-button" type="button" onClick={async()=>{try{await navigator.clipboard.writeText(qr.public_url);setNotice("Secure link copied. Share it only with someone you trust.");}catch{setNotice("Copy is unavailable here. You can scan or download the QR instead.");}}}>Copy secure link <Paperclip size={14}/></button><button className="secondary-button" type="button" onClick={revoke} disabled={busy}>Revoke link now <X size={14}/></button></div></section>}
  </>;
}

function EmergencyPublicPage({token}) {
  const [profile,setProfile]=useState(null); const [error,setError]=useState('');
  useEffect(()=>{fetch(`${API}/public/emergency/${encodeURIComponent(token)}`).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.detail||'This link is unavailable.');setProfile(j);}).catch(e=>setError(e.message));},[token]);
  return <div className="public-emergency"><div className="brand"><div className="brand-mark"><HeartPulse size={21}/></div><span>medi<span className="brand-light">mind</span></span></div><div className="public-emergency-card"><div className="locked-icon"><ShieldCheck size={22}/></div><div className="eyebrow">PATIENT-SHARED EMERGENCY DETAILS</div>{profile?<><h1>{profile.display_name||'Emergency profile'}</h1><p>These are the details the profile owner chose to share.</p><div className="public-details">{emergencyFields.filter(([key])=>profile[key]).map(([key,label])=><div key={key}><small>{label}</small><b>{profile[key]}</b></div>)}</div><small className="public-foot">This link is time-limited. For urgent help, contact local emergency services.</small></>:error?<><h1>Link unavailable</h1><p>{error}</p></>:<div className="loading-state"><span className="spinner"/> Loading shared details…</div>}</div></div>;
}

function ResearchPage({reports,token,headers}) {
  const [selected,setSelected]=useState(''); const [query,setQuery]=useState(''); const [result,setResult]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [question,setQuestion]=useState(''); const [answer,setAnswer]=useState(''); const [speaking,setSpeaking]=useState(false);
  useEffect(()=>{setSpeaking(false);return()=>{window.speechSynthesis?.cancel();};},[result?.summary]);
  const toggleResearchSpeech=()=>{
    if(!('speechSynthesis' in window)||!window.SpeechSynthesisUtterance){alert('Voice playback is not available in this browser.');return;}
    if(speaking){window.speechSynthesis.cancel();setSpeaking(false);return;}
    if(!result)return;
    const leads=(result.possibilities||[]).map(x=>`${x.name}. ${x.context||''} ${x.match_note||''}`).join('. ');
    const spokenText=[result.summary,leads,'These are research leads, not a diagnosis.'].filter(Boolean).join('. ').replace(/\s+/g,' ').trim();
    const utterance=new SpeechSynthesisUtterance(spokenText);
    utterance.lang=navigator.language||'en-US'; utterance.rate=0.95;
    utterance.onstart=()=>setSpeaking(true); utterance.onend=()=>setSpeaking(false); utterance.onerror=()=>setSpeaking(false);
    setSpeaking(true); window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
  };
  const run=async e=>{e?.preventDefault(); if(!token){setError('Sign in to explore research using your report.');return;} setBusy(true);setError('');try{const r=await fetch(`${API}/research/rare-disease`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(selected?{report_id:selected}:{text:query})});const j=await r.json();if(!r.ok)throw Error(j.detail||'Research could not be completed.');setResult(j);}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <><div className="page-intro research-intro"><div><div className="eyebrow"><span className="eyebrow-dot"/> EVIDENCE, WITH CONTEXT</div><h1>Explore the less common <span className="heading-spark"><Brain size={20}/></span></h1><p>Search trusted medical literature for context around a health report.</p></div><div className="intro-art research-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-core"><Brain size={27}/></div><div className="float-pill pill-a"><BookOpen size={14}/></div></div></div>
    <div className="research-warning"><ShieldCheck size={17}/><span><b>Research support, not diagnosis.</b> Rare diseases are complex. This tool can surface literature to discuss with a qualified clinician; it cannot determine what condition someone has.</span></div>
    <div className="research-card"><div className="research-card-title"><div className="research-icon"><Search size={19}/></div><div><h2>Start with a report or describe a finding</h2><p>We’ll search PubMed and summarize relevant evidence cautiously.</p></div></div><label className="field-label">Choose a saved report <span>(optional)</span></label><div className="select-wrap"><select data-guide-target="research-report" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">I’ll describe a finding instead</option>{reports.filter(r=>!r._id?.startsWith('sample')).map(r=><option key={r._id} value={r._id}>{r.filename}</option>)}</select><ChevronDown size={16}/></div><label className="field-label">What would you like to explore?</label><textarea className="research-textarea" data-guide-target="research-question" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Share a few symptoms, lab findings, or a question from your report. Avoid names or identifying details." rows="4"/><button className="primary-button research-submit" data-guide-target="research-search" disabled={busy||(!selected&&!query.trim())} onClick={run}>{busy?<><span className="spinner light"/> Searching the literature…</>:<>Search PubMed <ArrowRight size={16}/></>}</button>{error&&<div className="inline-error">{error}</div>}</div>
    {result&&<div className="research-results"><div className="result-top"><div><div className="eyebrow"><span className="eyebrow-dot"/> LITERATURE REVIEW</div><h2>What the evidence may suggest</h2></div><div className="research-actions"><button className={`icon-button ${speaking?'is-speaking':''}`} type="button" title={speaking?'Stop reading research':'Read research aloud'} aria-label={speaking?'Stop reading research':'Read research aloud'} aria-pressed={speaking} onClick={toggleResearchSpeech}>{speaking?<VolumeX size={18}/>:<Volume2 size={18}/>}</button><span className="source-badge"><BookOpen size={14}/> PubMed</span></div></div><div className="result-caveat">These are research leads, not a diagnosis or a measure of likelihood. A clinician can interpret them using the full medical history.</div><div className="result-summary">{result.summary}</div>{result.possibilities?.map((x,i)=><article className="condition-card explainable-condition" key={i}><div className="condition-number">0{i+1}</div><div className="condition-detail"><h3>{x.name}</h3><p>{x.context}</p><small>{x.match_note}</small><div className="evidence-grid">{[['What may fit',x.evidence_for],['What is not established',x.evidence_against],['What is still missing',x.missing_information]].filter(([,v])=>v).map(([label,value])=><div key={label}><b>{label}</b><p>{value}</p></div>)}</div>{x.article_pmids?.length>0&&<small>Evidence: {x.article_pmids.map((id,n)=><React.Fragment key={id}>{n>0?', ':''}<a href={`https://pubmed.ncbi.nlm.nih.gov/${id}/`} target="_blank" rel="noreferrer">PMID {id}</a></React.Fragment>)}</small>}</div></article>)}<div className="papers"><h3>Related PubMed articles</h3>{result.articles?.map(a=><a key={a.pmid} href={`https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/`} target="_blank" rel="noreferrer"><span>{a.title}</span><small>{a.journal} · {a.year} ↗</small></a>)}</div><div className="research-chat"><h3>Ask about this evidence</h3>{answer&&<p className="chat-answer">{answer}</p>}<form className="chat-input" onSubmit={async e=>{e.preventDefault();if(!question.trim())return;try{const r=await fetch(`${API}/research/chat`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({question,context:JSON.stringify({summary:result.summary,possibilities:result.possibilities,articles:result.articles})})});const j=await r.json();setAnswer(j.answer||j.detail);setQuestion('');}catch{setAnswer('Could not reach MediMind right now.');}}}><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What does this study tell us?"/><button><Send size={16}/></button></form></div></div>}
  </>;
}

function CarePage({user,token,headers,reports,onReportUploaded}) {
  const [doctor,setDoctor]=useState(''); const [room,setRoom]=useState(null); const [sessions,setSessions]=useState([]); const [messages,setMessages]=useState([]); const [text,setText]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [recording,setRecording]=useState(false); const [media,setMedia]=useState(null); const [recorder,setRecorder]=useState(null); const [sessionId,setSessionId]=useState(''); const [attachmentOpen,setAttachmentOpen]=useState(false); const [reportChoice,setReportChoice]=useState('');
  const shareableReports=reports.filter(report=>!report._id?.startsWith('sample'));
  useEffect(()=>{if(!token)return; fetch(`${API}/conversations`,{headers}).then(r=>r.ok?r.json():[]).then(setSessions).catch(()=>{});},[token]);
  useEffect(()=>{const el=document.getElementById('message-list');if(el)el.scrollTop=el.scrollHeight;},[messages]);
  const start=async e=>{e.preventDefault();setError('');setBusy(true);try{const r=await fetch(`${API}/conversations`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({doctor_username:doctor})});const j=await r.json();if(!r.ok)throw Error(j.detail||'Could not start a conversation.');setRoom(j);setMessages(j.messages||[]);setSessionId(j._id);setDoctor('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  const load=async id=>{const r=await fetch(`${API}/conversations/${id}`,{headers});const j=await r.json();if(r.ok){setRoom(j);setMessages(j.messages||[]);setSessionId(id);}};
  const send=async (content=text,audio=null)=>{if(!content.trim()&&!audio)return;setBusy(true);try{let r,j;if(audio){const form=new FormData();form.append('file',audio);form.append('transcript',content);r=await fetch(`${API}/conversations/${sessionId}/audio`,{method:'POST',headers,body:form});}else{r=await fetch(`${API}/conversations/${sessionId}/messages`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({content})});}j=await r.json();if(!r.ok)throw Error(j.detail||'Message could not be sent.');setMessages(j.messages||[]);setText('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  const shareSavedReport=async()=>{
    if(!reportChoice||!sessionId)return;
    const targetSession=sessionId;
    setBusy(true);setError('');
    try{const r=await fetch(`${API}/conversations/${targetSession}/reports`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({report_id:reportChoice})});const j=await r.json();if(!r.ok)throw Error(j.detail||'Report could not be shared.');if(sessionId===targetSession){setMessages(j.messages||[]);setAttachmentOpen(false);setReportChoice('');}}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  };
  const uploadAndShareReport=async file=>{
    if(!file||!sessionId)return;
    const targetSession=sessionId;
    let saved=false;
    setBusy(true);setError('');
    try{
      const body=new FormData();body.append('file',file);
      let r=await fetch(`${API}/reports`,{method:'POST',headers,body});
      const report=await r.json();
      if(!r.ok)throw Error(report.detail||'Report upload failed.');
      saved=true;onReportUploaded(report);
      r=await fetch(`${API}/conversations/${targetSession}/reports`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({report_id:report._id})});
      const j=await r.json();
      if(!r.ok)throw Error(j.detail||'Report could not be shared.');
      if(sessionId===targetSession){setMessages(j.messages||[]);setAttachmentOpen(false);setReportChoice('');}
    }catch(e){setError(saved?`Report was saved to My Reports but could not be shared: ${e.message}`:e.message);}
    finally{setBusy(false);}
  };
  const playAudio=async url=>{try{const r=await fetch(`${API.replace(/\/api\/?$/,'')}${url}`,{headers});if(!r.ok)throw Error();const objectUrl=URL.createObjectURL(await r.blob());const audio=new Audio(objectUrl);audio.onended=()=>URL.revokeObjectURL(objectUrl);await audio.play();}catch{setError('This voice note could not be played.');}};
  const downloadSharedReport=async message=>{try{const r=await fetch(`${API.replace(/\/api\/?$/,'')}${message.report_url}`,{headers});if(!r.ok){const j=await r.json();throw Error(j.detail||'Report download failed.');}const objectUrl=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=objectUrl;a.download=message.report_filename||'medical-report';a.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}catch(e){setError(e.message||'This report could not be downloaded.');}};
  const toggleRecord=async()=>{if(recording){recorder?.stop();setRecording(false);return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const rec=new MediaRecorder(stream);const chunks=[];rec.ondataavailable=e=>chunks.push(e.data);rec.onstop=()=>{const blob=new Blob(chunks,{type:rec.mimeType||'audio/webm'});const f=new File([blob],`voice-note-${Date.now()}.webm`,{type:blob.type});setMedia(f);stream.getTracks().forEach(t=>t.stop());};rec.start();setRecorder(rec);setRecording(true);}catch{setError('Please allow microphone access to record a voice note.');}};
  if(!token)return <FeatureSignIn title="Care conversations" text="Sign in to start a conversation and keep your messages safely together."/>;
  return <>
    <div className="care-grid">
      <section className="care-main">
        {room?<>
          <div className="conversation-header">
            <button className="text-button" onClick={()=>{setRoom(null);setAttachmentOpen(false);}}>← Conversations</button>
            <div className="conversation-doctor"><div className="doctor-avatar"><Stethoscope size={17}/></div><span><b>Dr. {room.doctor_username}</b><small>Private conversation · saved automatically</small></span><span className="online-dot"/></div>
          </div>
          <div className="message-list" id="message-list">
            {messages.length===0?<div className="conversation-empty"><div className="empty-bubble"><MessageCircle size={24}/></div><h3>Your conversation starts here</h3><p>Send a message, share a report, or record a voice note.</p></div>:messages.map((m,i)=><div className={`message-row ${m.sender_id===user.id?'mine':''}`} key={i}><div className="message-avatar">{m.sender_role==='doctor'?<Stethoscope size={14}/>:<UserRound size={14}/>}</div><div className="message-body"><small>{m.sender_username} · {new Date(m.created_at).toLocaleString()}</small><div className="message-bubble">{m.audio_url&&<button type="button" className="audio-tag" onClick={()=>playAudio(m.audio_url)}><AudioLines size={15}/> Play voice note</button>}{m.report_id?<button type="button" className="shared-report" onClick={()=>downloadSharedReport(m)} disabled={!m.report_url}><FileText size={17}/><span><b>Shared report</b><small>{m.report_filename||m.content}</small></span><ArrowDownToLine size={15}/></button>:m.content}</div></div></div>)}
          </div>
          <div className="composer-wrap">
            {attachmentOpen&&<div className="attachment-panel">
              <div className="attachment-heading"><Paperclip size={15}/> Share a report</div>
              {shareableReports.length?<div className="report-share-row"><select aria-label="Choose a saved report" value={reportChoice} onChange={e=>setReportChoice(e.target.value)}><option value="">Choose from My Reports</option>{shareableReports.map(report=><option key={report._id} value={report._id}>{report.filename}</option>)}</select><button type="button" onClick={shareSavedReport} disabled={busy||!reportChoice}>{busy?'Sharing…':'Share'}</button></div>:<p className="no-saved-reports">No saved reports yet. Upload one to share it here.</p>}
              <label className="upload-report-action"><Upload size={15}/> Upload and share a new report<input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.txt,.csv,.webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';uploadAndShareReport(file);}}/></label>
            </div>}
            {media&&<div className="audio-pending"><AudioLines size={15}/> Voice note ready to send <button onClick={()=>setMedia(null)}><X size={14}/></button></div>}
            <form className="composer" onSubmit={e=>{e.preventDefault();send(text,media);setMedia(null);}}>
              <button type="button" className={`attach-button ${attachmentOpen?'active':''}`} title="Attach or upload a report" aria-label="Attach or upload a report" aria-expanded={attachmentOpen} onClick={()=>setAttachmentOpen(open=>!open)} disabled={busy}><Paperclip size={17}/></button>
              <button type="button" className={`mic-button ${recording?'recording':''}`} onClick={toggleRecord}><Mic size={18}/></button>
              <input data-guide-target="care-message" value={text} onChange={e=>setText(e.target.value)} placeholder={recording?'Recording… tap microphone to stop':'Write a message…'} disabled={recording}/>
              <button type="submit" className="send-button" disabled={busy||(!text.trim()&&!media)}><Send size={17}/></button>
            </form>
            <small>Messages are saved and remain available in your conversation history.</small>
          </div>
        </>:<>
          <div className="conversation-start"><div className="start-icon"><MessageCircle size={20}/></div><h2>Start a conversation</h2><p>Enter your doctor’s username. We’ll verify it before opening a shared space.</p><form onSubmit={start}><label className="field-label">Doctor’s username</label><div className="doctor-input"><span>@</span><input data-guide-target="doctor-username" value={doctor} onChange={e=>setDoctor(e.target.value)} placeholder="e.g. dr.smith" minLength={3} required/><button className="primary-button" data-guide-target="care-continue" disabled={busy}>{busy?'Checking…':'Continue'}<ArrowRight size={15}/></button></div></form><div className="secure-note"><ShieldCheck size={15}/> Only a registered doctor can be matched.</div></div>
          <div className="care-reassure"><div><AudioLines size={18}/></div><span><b>Text or voice, your choice</b><small>Share a message or record a voice note.</small></span><div><History size={18}/></div><span><b>Always here when you return</b><small>Your conversation history stays saved.</small></span></div>
        </>}
      </section>
      <aside className="care-side" data-guide-target="care-session-list">
        <div className="history-heading"><div><h3>Your conversations</h3><p>{sessions.length} saved {sessions.length===1?'conversation':'conversations'}</p></div><History size={18}/></div>
        {sessions.length?sessions.map(s=><button className={`session-row ${sessionId===s._id?'selected':''}`} key={s._id} onClick={()=>load(s._id)}><div className="doctor-avatar small"><Stethoscope size={15}/></div><div><b>Dr. {s.doctor_username}</b><small>{s.last_message||'Conversation started'}</small></div><span className="session-date">{s.updated_at?new Date(s.updated_at).toLocaleDateString():''}</span></button>):<div className="history-empty"><div className="history-icon"><ClipboardList size={19}/></div><b>No conversations yet</b><p>When you connect with a doctor, your chats will appear here.</p></div>}
        <div className="care-side-note"><ShieldCheck size={15}/><span>Only you and your connected doctor can see these messages.</span></div>
      </aside>
    </div>
    {error&&<div className="inline-error">{error}</div>}
  </>;
}

function FeatureSignIn({title,text}) {return <div className="locked-state"><div className="locked-icon"><ShieldCheck size={24}/></div><div className="eyebrow">YOUR PRIVATE HEALTH SPACE</div><h2>{title}</h2><p>{text}</p><div className="secure-note"><ShieldCheck size={15}/> Sign in from your account to continue.</div></div>;}

createRoot(document.getElementById('root')).render(<App/>);
