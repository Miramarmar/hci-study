// ── CONFIGURATION (REPLACE WITH NEW KEYS) ──────────────────────
import { KEYS } from './config.js';

const SUPABASE_URL   = 'https://xvaokacldkgofkoldpdu.supabase.co';
const SUPABASE_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2YW9rYWNsZGtnb2Zrb2xkcGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTMyNTc2NCwiZXhwIjoyMDg2OTAxNzY0fQ.OqaGtCYUbSO_WqBWpGjjLT46BsakX9r-AhSFpPpnSLk';
const GEMINI_API_KEY = 'AIzaSyBTVahljaKw20ZogNk0awcIVlB2vN0C9As';
const STUDY_PREFIX   = 'HCI2026';

const PERSONAS = {
    control: {
        name: 'Research Assistant',
        icon: '📊',
        color: '#3d5a80',
        temp: 0.2,
        system: `You are a neutral, strictly factual educational assistant.
        - Only objective, verified information. Formal academic language.
        - No exclamation marks or emotional language. No praise or encouragement.
        - Concise. Stay on topic only.`
    },
    test: {
        name: 'Learning Coach',
        icon: '🌟',
        color: '#2d8653',
        temp: 0.75,
        system: `You are a warm, enthusiastic, emotionally supportive learning coach.
        - Be genuinely excited to help. Start with positive acknowledgement ("Great question!").
        - Encouraging, motivating language. Celebrate curiosity and effort.
        - Make ideas feel approachable and exciting.
        - End with an invitation to explore further ("What else would you like to discover?").
        - Be persuasive: make the student feel learning is meaningful and rewarding.`
    }
};

// ── UTILITIES & API HELPERS ──────────────────────
const $ = id => document.getElementById(id);
const hdrs = {
    'apikey': SUPABASE_ANON,
    'Authorization': `Bearer ${SUPABASE_ANON}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

const sb = {
    async get(t, q = '') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?${q}`, { headers: hdrs });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async insert(t, d) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}`, { method: 'POST', headers: hdrs, body: JSON.stringify(d) });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async update(t, q, d) {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?${q}`, { method: 'PATCH', headers: hdrs, body: JSON.stringify(d) });
        if (!r.ok) throw new Error(await r.text());
    }
};

function makeId() {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 4; i++) s += c[Math.floor(Math.random() * c.length)];
    return `${STUDY_PREFIX}-${s}`;
}

// ── STATE ──────────────────────
let student = null, convId = null, history = [], persona = null;

// ── INITIALIZATION ──────────────────────
async function init() {
    try {
        let sid, attempts = 0;
        while (attempts < 5) {
            sid = makeId();
            const ex = await sb.get('students', `student_id=eq.${sid}&select=student_id`);
            if (!ex.length) break;
            attempts++;
        }
        const group = Math.random() < 0.5 ? 'control' : 'test';
        const [row] = await sb.insert('students', { student_id: sid, study_group: group, has_started: false });
        student = row; persona = PERSONAS[group];
        $('genSpinner').style.display = 'none';
        $('idDisplay').textContent = sid;
        $('idBadge').style.display = 'block';
        $('startBtn').style.display = 'block';
    } catch (e) {
        console.error("Init Error:", e);
        $('genSpinner').style.display = 'none';
        $('errMsg').textContent = 'Could not connect. Check your API keys or internet.';
    }
}

// ── EVENT LISTENERS ──────────────────────
$('startBtn').addEventListener('click', async () => {
    $('startBtn').disabled = true;
    $('overlay').style.display = 'flex';
    try {
        const [conv] = await sb.insert('conversations', { student_id: student.student_id, study_group: student.study_group, messages: [], active: true });
        convId = conv.id;
        await sb.update('students', `student_id=eq.${student.student_id}`, { has_started: true, last_active: new Date().toISOString() });
        $('overlay').style.display = 'none';
        launchChat();
    } catch (e) {
        $('overlay').style.display = 'none';
        $('errMsg').textContent = 'Connection error. Please refresh.';
        $('startBtn').disabled = false;
    }
});

function launchChat() {
    document.documentElement.style.setProperty('--accent', persona.color);
    $('hdrAvatar').textContent = persona.icon;
    $('hdrName').textContent = persona.name;
    $('hdrId').textContent = `ID: ${student.student_id}`;
    $('welcomeScreen').style.display = 'none';
    $('chatScreen').style.display = 'flex';
    const w = student.study_group === 'test'
        ? `Hello! I'm so excited to be your learning companion today! 🌟 Ask me anything about the topic — what would you like to discover first?`
        : `Hello. I am your educational assistant for this session. Please enter your question about the study topic.`;
    addBubble('assistant', w);
    $('msgInput').focus();
}

$('sendBtn').addEventListener('click', send);
$('msgInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('msgInput').addEventListener('input', () => { $('msgInput').style.height = 'auto'; $('msgInput').style.height = Math.min($('msgInput').scrollHeight, 120) + 'px'; });

async function send() {
    const text = $('msgInput').value.trim();
    if (!text || $('sendBtn').disabled) return;
    $('msgInput').value = ''; $('msgInput').style.height = 'auto'; $('sendBtn').disabled = true;
    addBubble('user', text);
    history.push({ role: 'user', content: text, ts: new Date().toISOString() });
    const typing = showTyping();
    try {
        const reply = await callGemini(text);
        typing.remove(); 
        addBubble('assistant', reply);
        history.push({ role: 'assistant', content: reply, ts: new Date().toISOString() });
        await save();
    } catch (e) {
        typing.remove(); 
        addBubble('assistant', `Error: ${e.message}. Please check your API key.`);
        console.error(e);
    }
    $('sendBtn').disabled = false; $('msgInput').focus();
}

async function callGemini(msg) {
    const ctx = history.slice(-10).map(m => `${m.role === 'user' ? 'Student' : 'Assistant'}: ${m.content}`).join('\n');
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: `${persona.system}\n\nContext:\n${ctx}\n\nStudent: ${msg}` }] }],
            generationConfig: { temperature: persona.temp, maxOutputTokens: 800 }
        })
    });

    const d = await res.json();
    if (!res.ok) throw new Error(d.error?.message || "API request failed");
    return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No response generated.';
}

async function save() {
    if (!convId) return;
    try { await sb.update('conversations', `id=eq.${convId}`, { messages: history, message_count: history.length, last_updated: new Date().toISOString() }); }
    catch (e) { console.warn("Save Error:", e); }
}

$('endBtn').addEventListener('click', async () => {
    if (!confirm('End your session?')) return;
    await sb.update('conversations', `id=eq.${convId}`, { active: false, ended_at: new Date().toISOString(), messages: history, message_count: history.length });
    document.body.innerHTML = `<div style="height:100vh;display:flex;align-items:center;justify-content:center;font-family:'DM Sans',sans-serif;background:#f4f6fa;text-align:center;padding:2rem;"><div><div style="font-size:3rem;margin-bottom:1rem;">✅</div><h2 style="font-size:1.6rem;margin-bottom:.75rem;">Session Complete</h2><p style="color:#6b7a8d;">Your data has been saved. Please proceed to the post-test.</p></div></div>`;
});

function addBubble(role, text) {
    const wrap = document.createElement('div'); wrap.className = `msg ${role}`;
    const av = document.createElement('div'); av.className = 'msg-av'; av.textContent = role === 'user' ? '👤' : persona.icon;
    const body = document.createElement('div');
    const bub = document.createElement('div'); bub.className = 'bubble'; bub.textContent = text;
    const ts = document.createElement('div'); ts.className = 'ts'; ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    body.appendChild(bub); body.appendChild(ts); wrap.appendChild(av); wrap.appendChild(body);
    $('messages').appendChild(wrap); $('messages').scrollTop = $('messages').scrollHeight;
    return wrap;
}

function showTyping() {
    const wrap = document.createElement('div'); wrap.className = 'msg assistant';
    wrap.innerHTML = `<div class="msg-av">${persona?.icon || '🤖'}</div><div><div class="bubble" style="padding:.6rem 1rem;"><div class="dots"><span></span><span></span><span></span></div></div></div>`;
    $('messages').appendChild(wrap); $('messages').scrollTop = $('messages').scrollHeight;
    return wrap;
}

// Auto-save every 30 seconds
setInterval(() => { if (convId && history.length) save(); }, 30000);

// Run init
init();
