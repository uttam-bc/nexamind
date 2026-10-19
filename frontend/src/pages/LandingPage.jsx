import React, { useState } from 'react';
import {
  Sparkles,
  Bot,
  FileText,
  MessageSquare,
  FolderKanban,
  Video,
  ShieldCheck,
  Zap,
  ArrowRight,
  CheckCircle2,
  Users,
  Brain,
  Database,
  Cpu,
  Layers,
  Mail,
  Send,
  HelpCircle,
  Code2,
  Lock,
  ChevronRight,
  Globe,
  Star,
  Check,
  Loader2,
} from 'lucide-react';
import { api, setAuthToken } from '../api';

export default function LandingPage({
  onLogin,
  onRegister,
  onLoginSuccess,
  authLoading: propAuthLoading,
  authError: propAuthError,
  setAuthError: propSetAuthError,
}) {
  const [activeNav, setActiveNav] = useState('home'); // 'home' | 'product' | 'about' | 'contact'
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
  });
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState('');

  // Contact form state
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [contactSubmitted, setContactSubmitted] = useState(false);

  const handleOpenAuth = (mode = 'login') => {
    setAuthMode(mode);
    setShowAuthModal(true);
    setLocalError('');
    if (propSetAuthError) propSetAuthError('');
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    if (propSetAuthError) propSetAuthError('');

    const email = form.email.trim();
    const password = form.password;
    const name = form.name.trim();
    const username = form.username.trim();

    if (!email || !password) {
      setLocalError('Please enter both email and password.');
      return;
    }
    if (authMode === 'register' && !name) {
      setLocalError('Please enter your full name.');
      return;
    }

    setLocalLoading(true);

    try {
      if (authMode === 'register') {
        let authResult;
        if (onRegister) {
          authResult = await onRegister(name, email, password, username);
        } else {
          authResult = await api.register(name, email, password, username || undefined);
        }

        const token = authResult?.access_token;
        const user = authResult?.user;
        if (token) {
          setAuthToken(token);
          if (onLoginSuccess) {
            onLoginSuccess(token, user);
          }
        }
      } else {
        let authResult;
        if (onLogin) {
          authResult = await onLogin(email, password);
        } else {
          authResult = await api.login(email, password);
        }

        const token = authResult?.access_token;
        const user = authResult?.user;
        if (token) {
          setAuthToken(token);
          if (onLoginSuccess) {
            onLoginSuccess(token, user);
          }
        }
      }
    } catch (err) {
      setLocalError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleContactSubmit = (e) => {
    e.preventDefault();
    if (!contactForm.email || !contactForm.message) return;
    setContactSubmitted(true);
    setTimeout(() => {
      setContactForm({ name: '', email: '', subject: '', message: '' });
      setContactSubmitted(false);
    }, 4000);
  };

  const scrollToSection = (id) => {
    setActiveNav(id);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900 font-sans antialiased selection:bg-indigo-500 selection:text-white overflow-y-auto overflow-x-hidden">
      {/* ------------------------------------------------------------- */}
      {/* 1. TOP NAVIGATION HEADER                                       */}
      {/* ------------------------------------------------------------- */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/80 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Brand Logo */}
          <div
            onClick={() => scrollToSection('home')}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <img
              src="/logo.png"
              alt="NexaMind Logo"
              className="h-8 md:h-9 w-auto object-contain transition-transform group-hover:scale-[1.02]"
            />
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
            <button
              onClick={() => scrollToSection('home')}
              className={`hover:text-indigo-600 transition ${
                activeNav === 'home' ? 'text-indigo-600 font-bold' : ''
              }`}
            >
              Home
            </button>
            <button
              onClick={() => scrollToSection('product')}
              className={`hover:text-indigo-600 transition ${
                activeNav === 'product' ? 'text-indigo-600 font-bold' : ''
              }`}
            >
              Product & Features
            </button>
            <button
              onClick={() => scrollToSection('memory')}
              className={`hover:text-indigo-600 transition ${
                activeNav === 'memory' ? 'text-indigo-600 font-bold' : ''
              }`}
            >
              AI Memory Engine
            </button>
            <button
              onClick={() => scrollToSection('about')}
              className={`hover:text-indigo-600 transition ${
                activeNav === 'about' ? 'text-indigo-600 font-bold' : ''
              }`}
            >
              About Us
            </button>
            <button
              onClick={() => scrollToSection('contact')}
              className={`hover:text-indigo-600 transition ${
                activeNav === 'contact' ? 'text-indigo-600 font-bold' : ''
              }`}
            >
              Contact
            </button>
          </nav>

          {/* Action CTAs */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => handleOpenAuth('login')}
              className="text-xs font-bold text-slate-700 hover:text-indigo-600 px-3.5 py-2 rounded-xl hover:bg-slate-100 transition"
            >
              Sign In
            </button>
            <button
              onClick={() => handleOpenAuth('register')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-md shadow-indigo-600/25 hover:shadow-indigo-600/40 hover:-translate-y-0.5 transition active:translate-y-0 flex items-center gap-1.5"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------- */}
      {/* 2. HERO SECTION                                                */}
      {/* ------------------------------------------------------------- */}
      <section id="home" className="pt-16 pb-20 md:pt-24 md:pb-28 overflow-hidden relative">
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-indigo-200/40 blur-[130px] rounded-full" />
          <div className="absolute top-1/3 left-1/4 w-[400px] h-[300px] bg-purple-200/30 blur-[100px] rounded-full" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-8">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-bold shadow-sm animate-fade-in">
            <Sparkles className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
            <span>Autonomous Agentic AI with Continuous Workspace Memory</span>
          </div>

          {/* Main Headline */}
          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-slate-900 tracking-tight max-w-5xl mx-auto leading-[1.1]">
            One Unified Operating System for{' '}
            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 bg-clip-text text-transparent">
              High-Velocity Teams
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-base sm:text-xl text-slate-600 max-w-3xl mx-auto font-sans leading-relaxed">
            Stop switching between Notion, Teams, Jira, and Zoom. NexaMind unifies
            direct-write documents, channel chat with @username invitations, sprint Kanban tasks,
            and HD video calls — orchestrated by an <strong>Agentic AI Copilot</strong> with 4-stage continuous memory.
          </p>

          {/* Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <button
              onClick={() => handleOpenAuth('register')}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm px-8 py-3.5 rounded-2xl shadow-lg shadow-indigo-600/30 hover:shadow-indigo-600/50 hover:-translate-y-0.5 transition flex items-center justify-center gap-2"
            >
              <span>Launch Your Free Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => scrollToSection('product')}
              className="w-full sm:w-auto bg-white hover:bg-slate-50 text-slate-800 font-bold text-sm px-8 py-3.5 rounded-2xl border border-slate-300 shadow-sm transition hover:border-slate-400"
            >
              Explore Live Architecture
            </button>
          </div>

          {/* Trust Metrics */}
          <div className="pt-10 grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-4xl mx-auto text-left border-t border-slate-200/80">
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono">4-Stage</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Continuous Memory Pipeline</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-indigo-600 font-mono">Gemini 2.0</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Multimodal Intelligence</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono">1-Click</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">Group Join Codes & DMs</div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 font-mono">Direct-Write</div>
              <div className="text-xs text-slate-500 font-medium mt-0.5">WYSIWYG Markdown Docs</div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 3. PRODUCT & CORE FEATURES SHOWCASE                            */}
      {/* ------------------------------------------------------------- */}
      <section id="product" className="py-20 bg-white border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
              Product Suite
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Engineered for Complete Team Synergy
            </h2>
            <p className="text-slate-600 text-sm sm:text-base">
              Every feature directly communicates with the central AI memory, giving your team superhuman leverage.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Feature 1: Notion Direct-Write Docs */}
            <div className="bg-slate-50 border border-slate-200 hover:border-indigo-300 rounded-3xl p-6 shadow-sm hover:shadow-md transition space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Direct-Write Docs</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Write directly in formatted view without dual-mode conversions. Markdown headings, live interactive checkboxes, callouts, and slash block commands work inline seamlessly.
              </p>
              <div className="pt-2 text-xs font-bold text-indigo-600 flex items-center gap-1">
                <span>WYSIWYG Engine</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Feature 2: High-Contrast Teams Chat & DMs */}
            <div className="bg-slate-50 border border-slate-200 hover:border-indigo-300 rounded-3xl p-6 shadow-sm hover:shadow-md transition space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-violet-100 text-violet-600 flex items-center justify-center font-bold">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Teams Chat & @User DMs</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                High-contrast readable typography, rich threaded discussions, emoji reactions, and direct messaging with any teammate invited by their unique @username.
              </p>
              <div className="pt-2 text-xs font-bold text-violet-600 flex items-center gap-1">
                <span>Instant WebSockets</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Feature 3: Sprint Kanban with Status Routing */}
            <div className="bg-slate-50 border border-slate-200 hover:border-indigo-300 rounded-3xl p-6 shadow-sm hover:shadow-md transition space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center font-bold">
                <FolderKanban className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Sprint Kanban Tasks</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Create tasks directly into To Do, In Progress, or Done columns. Priority badges, subtasks, assignment, and autonomous agent task management.
              </p>
              <div className="pt-2 text-xs font-bold text-amber-600 flex items-center gap-1">
                <span>Direct Status Select</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>

            {/* Feature 4: HD Video Meetings with AI MoM */}
            <div className="bg-slate-50 border border-slate-200 hover:border-indigo-300 rounded-3xl p-6 shadow-sm hover:shadow-md transition space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold">
                <Video className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">HD Video Meetings</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Launch instant video syncs with real-time audio speech-to-text and automated Minutes of the Meeting (MoM) synthesis with zero fake placeholders.
              </p>
              <div className="pt-2 text-xs font-bold text-rose-600 flex items-center gap-1">
                <span>Automated Minutes</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 4. AI MEMORY WORKFLOW: INGESTION -> EXTRACTION -> ...          */}
      {/* ------------------------------------------------------------- */}
      <section id="memory" className="py-20 bg-slate-900 text-white relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-400 bg-indigo-950/80 px-3 py-1 rounded-full border border-indigo-800">
              Agentic Intelligence Architecture
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              4-Stage Continuous Memory Engine
            </h2>
            <p className="text-slate-400 text-sm sm:text-base">
              The Agentic AI doesn't just chat — it constantly ingests, extracts, consolidates, and stores workspace context to take autonomous action.
            </p>
          </div>

          {/* Workflow Diagram */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
            {/* Step 1: Ingestion */}
            <div className="bg-slate-800/80 border border-slate-700 p-6 rounded-2xl space-y-3 relative group hover:border-indigo-500 transition">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold font-mono text-sm">
                01
              </div>
              <h4 className="font-bold text-base text-white flex items-center gap-2">
                <Database className="w-4 h-4 text-indigo-400" /> Ingestion
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Watches and listens to raw content across <strong>Documents</strong>, <strong>Chat Threads</strong>, <strong>Sprint Tasks</strong>, and <strong>Video Calls</strong>.
              </p>
            </div>

            {/* Step 2: Extraction */}
            <div className="bg-slate-800/80 border border-slate-700 p-6 rounded-2xl space-y-3 relative group hover:border-violet-500 transition">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 text-violet-400 flex items-center justify-center font-bold font-mono text-sm">
                02
              </div>
              <h4 className="font-bold text-base text-white flex items-center gap-2">
                <Cpu className="w-4 h-4 text-violet-400" /> Extraction
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Uses Google Gemini AI to distill concrete <strong>facts</strong>, approved <strong>decisions</strong>, assigned <strong>action items</strong>, and concepts.
              </p>
            </div>

            {/* Step 3: Consolidation */}
            <div className="bg-slate-800/80 border border-slate-700 p-6 rounded-2xl space-y-3 relative group hover:border-amber-500 transition">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold font-mono text-sm">
                03
              </div>
              <h4 className="font-bold text-base text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400" /> Consolidation
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Deduplicates new items against existing knowledge nodes, links references, and computes importance weights (0.1 - 1.0).
              </p>
            </div>

            {/* Step 4: Storage & Agentic AI */}
            <div className="bg-slate-800/80 border border-slate-700 p-6 rounded-2xl space-y-3 relative group hover:border-emerald-500 transition">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold font-mono text-sm">
                04
              </div>
              <h4 className="font-bold text-base text-white flex items-center gap-2">
                <Brain className="w-4 h-4 text-emerald-400" /> Storage & Agent
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Persisted in <code>ai_memories</code>. Injected into Agentic AI sessions so the Copilot can recall anything, reason, and take action.
              </p>
            </div>
          </div>

          {/* Interactive Agentic Prompt Box Demo */}
          <div className="bg-slate-950 border border-slate-800 rounded-3xl p-6 sm:p-8 max-w-4xl mx-auto shadow-2xl space-y-4 font-mono text-xs text-slate-300">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-indigo-400 font-bold">
                <Bot className="w-4 h-4" />
                <span>NexaMind Agentic Copilot Session</span>
              </div>
              <span className="text-[10px] text-emerald-400 bg-emerald-950 px-2.5 py-0.5 rounded-full border border-emerald-800">
                ● Memory Active
              </span>
            </div>

            <div className="space-y-3 text-slate-400">
              <p className="text-indigo-300">
                &gt; user: "Create an urgent task to implement Gemini streaming with status in_progress and assign to @alex"
              </p>
              <p className="text-slate-300 pl-4 border-l-2 border-indigo-500 leading-relaxed">
                ⚡ Agent: I retrieved relevant context from your <strong>Architecture RFC Document</strong> and <strong>Sprint 42 Meeting Minutes</strong>.<br />
                ✅ Executed <code>create_task(title='Implement Gemini streaming', status='in_progress', priority='urgent')</code>.<br />
                ✅ Extracted and stored new memory item into <code>ai_memories</code>.<br />
                Task is live on your Kanban board and notified to @alex!
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 5. ABOUT US SECTION                                            */}
      {/* ------------------------------------------------------------- */}
      <section id="about" className="py-20 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
              About Us
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
              Built for Modern Software Builders
            </h2>
            <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
              We started NexaMind with a singular goal: eliminate context switching and bring autonomous agentic intelligence into daily engineering workflows.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-slate-900">Privacy & Isolation</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Workspaces are strictly isolated. Your team's docs, audio transcripts, and code never leave your protected boundaries.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center font-bold">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-slate-900">Zero Latency Sync</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Powered by FastAPI asynchronous architecture, WebSockets live state broadcasting, and instant local-first state caching.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Brain className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-slate-900">Continuous AI Memory</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Unlike generic LLMs that forget after every chat, NexaMind holds past session threads and episodic memory across weeks of work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 6. CONTACT US SECTION                                          */}
      {/* ------------------------------------------------------------- */}
      <section id="contact" className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Left Description */}
            <div className="space-y-6">
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                  Get In Touch
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mt-3">
                  We'd Love to Hear From You
                </h2>
                <p className="text-slate-600 text-sm mt-2 leading-relaxed">
                  Have questions about NexaMind, feature requests, or enterprise deployment? Our engineering team is here to assist.
                </p>
              </div>

              <div className="space-y-4 pt-4 text-xs text-slate-600">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Mail className="w-4 h-4" />
                  </div>
                  <span>support@nexamind.app</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                    <Globe className="w-4 h-4" />
                  </div>
                  <span>github.com/nexamind/nexamind</span>
                </div>
              </div>
            </div>

            {/* Right Contact Form */}
            <div className="bg-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
              {contactSubmitted ? (
                <div className="text-center py-12 space-y-3">
                  <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">Message Received!</h3>
                  <p className="text-xs text-slate-600">
                    Thank you for reaching out. Our team will review your message and reply promptly.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Your Name</label>
                      <input
                        type="text"
                        required
                        placeholder="Alex Mitchell"
                        className="w-full bg-white border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition"
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Email Address</label>
                      <input
                        type="email"
                        required
                        placeholder="alex@company.com"
                        className="w-full bg-white border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Subject</label>
                    <input
                      type="text"
                      placeholder="Product question or feedback"
                      className="w-full bg-white border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition"
                      value={contactForm.subject}
                      onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Message</label>
                    <textarea
                      required
                      rows={4}
                      placeholder="Tell us what you'd like to achieve with NexaMind..."
                      className="w-full bg-white border border-slate-200 focus:border-indigo-600 rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition resize-none"
                      value={contactForm.message}
                      onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 rounded-xl shadow-md transition flex items-center justify-center gap-2"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Message</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- */}
      {/* 7. FOOTER                                                      */}
      {/* ------------------------------------------------------------- */}
      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800 text-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/logo-white.png"
              alt="NexaMind"
              className="h-6 w-auto object-contain opacity-90"
            />
            <span className="text-slate-400 text-xs">— The Agentic AI Workspace</span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={() => scrollToSection('home')} className="hover:text-white transition">
              Home
            </button>
            <button onClick={() => scrollToSection('product')} className="hover:text-white transition">
              Features
            </button>
            <button onClick={() => scrollToSection('about')} className="hover:text-white transition">
              About
            </button>
            <button onClick={() => scrollToSection('contact')} className="hover:text-white transition">
              Contact
            </button>
            <button onClick={() => handleOpenAuth('login')} className="hover:text-indigo-400 transition font-bold">
              Sign In
            </button>
          </div>
        </div>
      </footer>

      {/* ------------------------------------------------------------- */}
      {/* 8. AUTH MODAL (LOGIN & REGISTRATION)                           */}
      {/* ------------------------------------------------------------- */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-8 shadow-2xl relative space-y-6">
            {/* Close Button */}
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1 rounded-lg"
            >
              ✕
            </button>

            {/* Modal Header */}
            <div className="text-center space-y-1.5">
              <div className="flex items-center justify-center mx-auto mb-1">
                <img src="/logo-mark.png" alt="NexaMind" className="h-11 w-auto object-contain" />
              </div>
              <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                {authMode === 'login' ? 'Sign In to NexaMind' : 'Create Free Account'}
              </h3>
              <p className="text-xs text-slate-500 font-sans">
                {authMode === 'login'
                  ? 'Access your workspaces, persistent memories, and teams'
                  : 'Start your personal and team workspace in seconds'}
              </p>
            </div>

            {/* Error Notice */}
            {(localError || propAuthError) && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl font-medium animate-in fade-in">
                {localError || propAuthError}
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAuthSubmit} className="space-y-3.5">
              {authMode === 'register' && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Jason Bourne"
                      className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition font-sans"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Unique Username</span>
                      <span className="text-[10px] text-slate-400 font-normal">For chat invitations</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-2.5 text-slate-400 font-mono text-xs">@</span>
                      <input
                        type="text"
                        required
                        placeholder="jason_bourne"
                        className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-600 focus:bg-white rounded-xl pl-8 pr-4 py-2.5 text-xs text-slate-900 outline-none transition font-mono"
                        value={form.username}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            username: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">
                  {authMode === 'login' ? 'Email or @Username' : 'Email Address'}
                </label>
                <input
                  type={authMode === 'login' ? 'text' : 'email'}
                  required
                  placeholder={authMode === 'login' ? 'jason@gmail.com or @jason_bourne' : 'jason@gmail.com'}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition font-sans"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-xs text-slate-900 outline-none transition font-sans"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>

              <button
                type="submit"
                disabled={localLoading || propAuthLoading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs py-3 rounded-xl shadow-md shadow-indigo-600/30 transition flex items-center justify-center gap-2 mt-2 cursor-pointer"
              >
                {(localLoading || propAuthLoading) ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{authMode === 'register' ? 'Creating Account & Launching...' : 'Authenticating...'}</span>
                  </>
                ) : authMode === 'login' ? (
                  <span>Sign In to Workspace</span>
                ) : (
                  <span>Create Account & Launch</span>
                )}
              </button>
            </form>

            {/* Toggle Login / Register */}
            <div className="text-center pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  if (setAuthError) setAuthError('');
                }}
                className="text-xs text-indigo-600 hover:underline font-semibold"
              >
                {authMode === 'login'
                  ? "Don't have an account? Create one free"
                  : 'Already registered? Sign In'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
