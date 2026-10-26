import React, { useState, useEffect, useRef } from 'react';
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
  KeyRound,
  MailCheck,
  RefreshCw,
  ArrowLeft,
  Menu,
  X,
  AlertCircle,
  User,
  CalendarDays,
  Search,
  Wrench,
} from 'lucide-react';
import { api, setAuthToken } from '../api';
import { useDialog } from '../lib/dialog';
import { useReveal, useScrollSpy } from '../lib/reveal';
import Logo from '../components/ui/Logo';
import ThemeToggle from '../components/ui/ThemeToggle';
import WorkspaceSwitch from '../components/WorkspaceSwitch';
import { roomTransition, originOf } from '../lib/viewTransition';

const NAV_SECTIONS = [
  ['home', 'Home'],
  ['product', 'Product'],
  ['workspaces', 'Solo & Group'],
  ['memory', 'Copilot'],
  ['contact', 'Contact'],
];
const SECTION_IDS = NAV_SECTIONS.map(([id]) => id);

// Each row shows a real screen of the app (captured with demonstration data) and only features that
// exist (see PRODUCT.md).
const FEATURES = [
  {
    title: 'Pages that start from what you already have',
    body: 'Write in Markdown with images, or drop in a .docx, PDF or text file and get an editable page. Export any page back to Word or Markdown.',
    facts: ['One library for pages and uploads', 'Previews for PDFs, images and media'],
    image: '/landing/feature-docs.jpg',
    size: [2336, 1460],
    alt: 'Docs: the page list beside the Sprint 14 retro page, with export and formatting tools',
  },
  {
    title: 'Channels the whole team can follow',
    body: 'Public and private channels, direct messages, reactions and attachments, all live. Mentions land in your notifications.',
    facts: ['Calls start from any direct message', 'Share pages and files into a conversation'],
    image: '/landing/feature-channels.jpg',
    size: [2400, 1120],
    alt: 'The general channel with messages from Sam, Kim and Priya',
  },
  {
    title: 'A calendar that reads your minutes',
    body: 'Events and scheduled meetings sit together. Dates said in meetings or written in docs come back as suggestions, quoting where they came from.',
    facts: ['Click a day to see, edit or delete its events', 'Meetings open straight from their entry'],
    image: '/landing/feature-calendar.jpg',
    size: [2336, 1460],
    alt: 'The October calendar with today selected and suggested dates beside it',
  },
  {
    title: 'A sprint board fed by your meetings',
    body: 'To do, in progress and done. When meeting minutes are approved, their action items become tasks with owners.',
    facts: ['Priorities and due dates', 'Real Git repositories beside it, with pull requests and reviews'],
    image: '/landing/feature-sprint.jpg',
    size: [2336, 1240],
    alt: 'The sprint board with tasks in To Do, In Progress and Done',
  },
];

const STEPS = [
  { title: 'It looks things up first', body: 'The Copilot searches what it has learned from your pages and meetings before it answers.' },
  { title: 'It uses the same actions you do', body: 'Tasks, events and pages it creates show up where you would expect them, made through the app’s own tools.' },
  { title: 'It leaves blanks empty', body: 'Without a date or an owner, it asks or leaves the field empty instead of inventing one.' },
];

export default function LandingPage({
  onLogin,
  onRegister,
  onLoginSuccess,
  authLoading: propAuthLoading,
  authError: propAuthError,
  setAuthError: propSetAuthError,
}) {
  const [activeNav, setActiveNav] = useState('home');
  const pageRef = useRef(null);
  const [demoRoom, setDemoRoom] = useState('solo');
  useReveal(pageRef);
  useScrollSpy(SECTION_IDS, setActiveNav);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [form, setForm] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
  });
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');

  // Email verification (OTP) states
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpCountdown, setOtpCountdown] = useState(0);
  const [devOtpNotice, setDevOtpNotice] = useState(null);

  // Password reset states
  const [resetStep, setResetStep] = useState('email'); // 'email' | 'code'
  const [resetCode, setResetCode] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');

  // Google OAuth states. The button is only offered when the server has a client ID.
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState(null);

  // Contact form state
  const [contactForm, setContactForm] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
    website: '', // honeypot, hidden from people
  });
  const [contactStatus, setContactStatus] = useState('idle'); // 'idle' | 'sending' | 'sent' | 'error'
  const [contactError, setContactError] = useState('');

  // OTP Countdown Timer
  useEffect(() => {
    if (otpCountdown <= 0) return;
    const timer = setInterval(() => {
      setOtpCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [otpCountdown]);

  // Load Google Client ID on mount
  useEffect(() => {
    let cancelled = false;
    api.getGoogleConfig()
      .then((cfg) => {
        if (!cancelled && cfg?.client_id) {
          setGoogleClientId(cfg.client_id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Links like /#contact open at that section.
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, '');
    if (SECTION_IDS.includes(id)) {
      setActiveNav(id);
      document.getElementById(id)?.scrollIntoView();
    }
  }, []);

  // Render official Google button when modal opens
  useEffect(() => {
    if (!googleClientId || !showAuthModal || authMode === 'forgot') return;

    const setupGoogleBtn = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (resp) => {
            if (resp?.credential) {
              handleGoogleCredentialResponse(resp.credential);
            }
          },
        });
        const container = document.getElementById('google-btn-container');
        if (container) {
          container.innerHTML = '';
          window.google.accounts.id.renderButton(container, {
            theme: 'outline',
            size: 'large',
            width: 320,
            text: 'continue_with',
            shape: 'rectangular',
          });
        }
      }
    };

    const t = setTimeout(setupGoogleBtn, 80);
    return () => clearTimeout(t);
  }, [showAuthModal, googleClientId, authMode]);

  const resetAuthState = () => {
    setLocalError('');
    setNotice('');
    setOtpSent(false);
    setOtp('');
    setDevOtpNotice(null);
    setResetStep('email');
    setResetCode('');
    setResetNewPassword('');
    if (propSetAuthError) propSetAuthError('');
  };

  const handleOpenAuth = (mode = 'login') => {
    setAuthMode(mode);
    setShowAuthModal(true);
    setMobileNavOpen(false);
    resetAuthState();
  };

  const closeAuthModal = () => {
    setShowAuthModal(false);
    resetAuthState();
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    resetAuthState();
  };

  const authDialogRef = useDialog(showAuthModal, closeAuthModal);

  const handleGoogleCredentialResponse = async (credential) => {
    setGoogleLoading(true);
    setLocalError('');
    if (propSetAuthError) propSetAuthError('');

    try {
      const authResult = await api.loginWithGoogle(credential);
      const token = authResult?.access_token;
      const user = authResult?.user;
      if (token) {
        setAuthToken(token);
        if (onLoginSuccess) {
          onLoginSuccess(token, user);
        }
      }
    } catch (err) {
      setLocalError(err.message || 'Google authentication failed');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleClick = () => {
    if (googleClientId && window.google?.accounts?.id) {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp) => {
          if (resp?.credential) {
            handleGoogleCredentialResponse(resp.credential);
          }
        },
      });
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          setLocalError('Google sign-in was dismissed or blocked by the browser. You can sign in with email instead.');
        }
      });
    } else {
      setLocalError("Google sign-in couldn't load. Check your connection or sign in with email.");
    }
  };

  const handleSendOtp = async (e) => {
    if (e) e.preventDefault();
    setLocalError('');
    if (propSetAuthError) propSetAuthError('');

    const email = form.email.trim();
    const name = form.name.trim();

    if (!name) {
      setLocalError('Please enter your full name first.');
      return;
    }
    if (!email) {
      setLocalError('Please enter a valid email address.');
      return;
    }
    if (!form.password || form.password.length < 8) {
      setLocalError('Password must be at least 8 characters long.');
      return;
    }

    setLocalLoading(true);
    try {
      const res = await api.sendOtp(email, 'register');
      setOtpSent(true);
      setOtpCountdown(60);
      if (res?.dev_code) {
        setDevOtpNotice('Development mode: your code is ' + res.dev_code);
        setOtp(res.dev_code);
      } else {
        setDevOtpNotice(null);
      }
    } catch (err) {
      setLocalError(err.message || 'Failed to send confirmation code. Please check your email.');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleResetRequest = async () => {
    const email = form.email.trim();
    if (!email) {
      setLocalError('Enter the email address of your account.');
      return;
    }
    setLocalLoading(true);
    try {
      const res = await api.sendOtp(email, 'reset_password');
      setResetStep('code');
      setOtpCountdown(60);
      setNotice(res?.message || 'If an account uses this address, we sent it a reset code.');
      if (res?.dev_code) {
        setDevOtpNotice('Development mode: your code is ' + res.dev_code);
        setResetCode(res.dev_code);
      }
    } catch (err) {
      setLocalError(err.message || 'Could not send a reset code. Please try again.');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleResetSubmit = async () => {
    if (!/^\d{6}$/.test(resetCode.trim())) {
      setLocalError('Enter the 6-digit code from the email.');
      return;
    }
    if (resetNewPassword.length < 8 || !/[a-zA-Z]/.test(resetNewPassword) || !/\d/.test(resetNewPassword)) {
      setLocalError('New password must be at least 8 characters, with letters and numbers.');
      return;
    }
    setLocalLoading(true);
    try {
      await api.resetPassword(form.email.trim(), resetCode.trim(), resetNewPassword);
      setAuthMode('login');
      resetAuthState();
      setForm({ ...form, password: '' });
      setNotice('Your password was changed and other sessions were signed out. Sign in with the new password.');
    } catch (err) {
      setLocalError(err.message || 'Could not reset the password.');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    if (propSetAuthError) propSetAuthError('');

    if (authMode === 'forgot') {
      if (resetStep === 'email') await handleResetRequest();
      else await handleResetSubmit();
      return;
    }

    const email = form.email.trim();
    const password = form.password;
    const name = form.name.trim();
    const username = form.username.trim();

    if (authMode === 'register') {
      if (!otpSent) {
        await handleSendOtp();
        return;
      }

      if (!otp.trim()) {
        setLocalError('Please enter the 6-digit verification code sent to your email.');
        return;
      }

      setLocalLoading(true);
      try {
        let authResult;
        if (onRegister) {
          authResult = await onRegister(name, email, password, username, otp.trim());
        } else {
          authResult = await api.register(name, email, password, username || undefined, otp.trim());
        }

        const token = authResult?.access_token;
        const user = authResult?.user;
        if (token) {
          setAuthToken(token);
          if (onLoginSuccess) {
            onLoginSuccess(token, user);
          }
        }
      } catch (err) {
        setLocalError(err.message || 'Registration failed. Please check your verification code.');
      } finally {
        setLocalLoading(false);
      }
      return;
    }

    if (!email || !password) {
      setLocalError('Please enter both email and password.');
      return;
    }

    setLocalLoading(true);
    try {
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
    } catch (err) {
      setLocalError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setContactError('');
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) {
      setContactError('Please fill in your name, email and message.');
      return;
    }
    setContactStatus('sending');
    try {
      await api.sendContactMessage(contactForm);
      setContactStatus('sent');
      setContactForm({ name: '', email: '', subject: '', message: '', website: '' });
    } catch (err) {
      setContactStatus('error');
      setContactError(err.message || 'Your message could not be sent. Please try again.');
    }
  };

  const scrollToSection = (id) => {
    setActiveNav(id);
    setMobileNavOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const sectionLink = (id) => ({
    href: `#${id}`,
    onClick: (e) => {
      e.preventDefault();
      scrollToSection(id);
    },
    'aria-current': activeNav === id ? 'location' : undefined,
  });

  const errorText = localError || propAuthError;

  // The Solo/Group demo switches the page's own room, revealed from the control like in the app.
  const switchDemo = (mode, event) => {
    const next = mode === 'personal' ? 'solo' : 'group';
    if (next === demoRoom) return;
    const apply = () => {
      document.documentElement.dataset.workspace = next;
      setDemoRoom(next);
    };
    // A keyboard press changes at once; a click reveals from the pointer.
    const origin = originOf(event);
    if (origin) roomTransition(origin, apply);
    else apply();
  };

  // A real screenshot of the home screen, light or dark to match the page.
  const shot = (alt, room, { eager = false } = {}) => (
    <>
      <img
        src={`/landing/dashboard-light-${room}.jpg`}
        alt={alt}
        width="1440"
        height="900"
        loading={eager ? 'eager' : 'lazy'}
        fetchpriority={eager ? 'high' : undefined}
        className="block h-auto w-full dark:hidden"
      />
      <img
        src={`/landing/dashboard-dark-${room}.jpg`}
        alt={alt}
        width="1440"
        height="900"
        loading="lazy"
        className="hidden h-auto w-full dark:block"
      />
    </>
  );

  return (
    <div ref={pageRef} className="min-h-screen w-full bg-white text-slate-900 font-sans antialiased overflow-x-clip">
      <a href="#home" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-pill focus:bg-white focus:px-4 focus:py-2 focus:shadow-panel">
        Skip to content
      </a>

      {/* 1. HEADER */}
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-4 sm:px-6">
          <a {...sectionLink('home')} className="rounded-lg" aria-label="NexaMind home">
            <Logo alt="NexaMind" className="h-7" />
          </a>
          <nav aria-label="Main" className="hidden items-center gap-1 text-sm md:flex">
            {NAV_SECTIONS.slice(1).map(([id, label]) => (
              <a
                key={id}
                {...sectionLink(id)}
                className={`rounded-lg px-3 py-1.5 transition-colors duration-fast ${
                  activeNav === id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => handleOpenAuth('login')}
              className="rounded-pill px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-fast hover:bg-slate-100 hover:text-slate-900"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => handleOpenAuth('register')}
              className="hidden items-center gap-1.5 rounded-pill bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors duration-fast hover:bg-slate-700 dark:bg-[#ededea] dark:text-[#141513] dark:hover:bg-[#ffffff] sm:inline-flex press"
            >
              Get started
            </button>
            <button
              type="button"
              onClick={() => setMobileNavOpen((open) => !open)}
              className="rounded-pill p-2 text-slate-700 hover:bg-slate-100 md:hidden"
              aria-expanded={mobileNavOpen}
              aria-controls="landing-mobile-nav"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            >
              {mobileNavOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
        {mobileNavOpen && (
          <nav id="landing-mobile-nav" aria-label="Main" className="animate-slide-up border-t border-slate-200 bg-white px-4 py-3 md:hidden">
            <ul className="space-y-1">
              {NAV_SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a {...sectionLink(id)} className="block rounded-xl px-3 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                    {label}
                  </a>
                </li>
              ))}
              <li className="pt-2">
                <button type="button" onClick={() => handleOpenAuth('register')} className="w-full rounded-pill bg-slate-900 px-4 py-2.5 text-sm font-medium text-white dark:bg-[#ededea] dark:text-[#141513]">
                  Get started
                </button>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main>
        {/* 2. HERO: the product itself is the picture. */}
        <section id="home" className="scroll-mt-16 pt-16 md:pt-24">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
            <div className="grid items-end gap-8 lg:grid-cols-12">
              <h1 className="animate-rise font-serif text-[3.25rem] leading-[0.98] tracking-[-0.02em] text-slate-900 sm:text-7xl lg:col-span-8 lg:text-[5.5rem]">
                Docs, chat, meetings and code. <span className="text-slate-500">One calm place.</span>
              </h1>
              <div className="animate-rise lg:col-span-4 lg:pb-3" style={{ animationDelay: '90ms' }}>
                <p className="text-base leading-relaxed text-slate-600 sm:text-lg">
                  NexaMind is the workspace for small teams: pages, channels, video meetings with minutes, a calendar, a sprint board
                  and real Git, with a Copilot that knows what your team decided.
                </p>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleOpenAuth('register')}
                    className="inline-flex items-center gap-2 rounded-pill bg-slate-900 px-6 py-3 text-sm font-medium text-white transition-colors duration-fast hover:bg-slate-700 dark:bg-[#ededea] dark:text-[#141513] dark:hover:bg-[#ffffff] press"
                  >
                    Create your workspace <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <a {...sectionLink('product')} className="rounded-pill px-4 py-3 text-sm font-medium text-slate-700 transition-colors duration-fast hover:text-slate-900">
                    See the product
                  </a>
                </div>
              </div>
            </div>

            <figure className="mt-14 md:mt-20 [perspective:1800px]">
              <div className="preview-settle overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel md:rounded-3xl">
                {shot('NexaMind home for the Orbit Labs workspace: a greeting with today’s next meeting, open tasks, docs, channels and the day’s schedule', 'group', { eager: true })}
              </div>
              <figcaption className="mt-3 text-center text-xs text-slate-500">The real app, shown with demonstration data.</figcaption>
            </figure>
          </div>
        </section>

        {/* 3. PRODUCT: one row per tool, each with its real screen. */}
        <section id="product" className="scroll-mt-16 py-24 md:py-32">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
            <h2 data-reveal className="max-w-3xl font-serif text-4xl leading-[1.05] tracking-[-0.01em] text-slate-900 sm:text-6xl">
              Stop switching between five apps.
            </h2>
            <p data-reveal className="mt-5 max-w-xl text-base leading-relaxed text-slate-600">
              Every tool is a real one, and they share one workspace: a decision made in a meeting becomes a task, and a page can be
              found again from chat.
            </p>

            <div className="mt-20 space-y-24 md:space-y-32">
              {FEATURES.map((f, i) => (
                <div key={f.title} className="grid items-center gap-10 lg:grid-cols-12">
                  <div data-reveal className={`lg:col-span-4 ${i % 2 ? 'lg:order-2 lg:col-start-9' : ''}`}>
                    <h3 className="text-2xl font-semibold tracking-[-0.01em] text-slate-900">{f.title}</h3>
                    <p className="mt-3 leading-relaxed text-slate-600">{f.body}</p>
                    <ul className="mt-5 space-y-2">
                      {f.facts.map((fact) => (
                        <li key={fact} className="flex items-start gap-2.5 text-sm text-slate-700">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
                          {fact}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div data-reveal className={`lg:col-span-8 ${i % 2 ? 'lg:order-1 lg:col-start-1' : ''}`}>
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      <img src={f.image} alt={f.alt} width={f.size[0]} height={f.size[1]} loading="lazy" decoding="async" className="block h-auto w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. SOLO & GROUP: try the switch; the page changes room the way the app does. */}
        <section id="workspaces" className="scroll-mt-16 bg-slate-50 py-24 transition-colors duration-panel md:py-32">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-12">
            <div data-reveal className="lg:col-span-4">
              <h2 className="font-serif text-4xl leading-[1.05] tracking-[-0.01em] text-slate-900 sm:text-5xl">
                Focus alone. Build together.
              </h2>
              <p className="mt-5 leading-relaxed text-slate-600">
                {demoRoom === 'solo'
                  ? 'Your Solo workspace is yours: your pages, tasks, calendar and direct messages, in deep teal.'
                  : 'A Group workspace is the team’s: channels, meetings with minutes, the sprint board and repositories, in plum.'}
              </p>
              <WorkspaceSwitch isSolo={demoRoom === 'solo'} onChange={switchDemo} className="mt-7 w-64" />
              <p className="mt-3 text-xs text-slate-500">Try it: this is the switch from the app.</p>
            </div>
            <div data-reveal className="lg:col-span-8">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
                {shot(demoRoom === 'solo' ? 'A Solo workspace home: personal tasks, docs and a 1:1 today' : 'A Group workspace home: sprint tasks, channels and the team’s schedule', demoRoom)}
              </div>
            </div>
          </div>
        </section>

        {/* 5. COPILOT */}
        <section id="memory" className="scroll-mt-16 py-24 md:py-32">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
            <h2 data-reveal className="max-w-3xl font-serif text-4xl leading-[1.05] tracking-[-0.01em] text-slate-900 sm:text-6xl">
              A Copilot that answers from your workspace.
            </h2>
            <figure data-reveal className="mt-14 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-panel">
              <img
                src="/landing/feature-copilot.jpg"
                alt="Copilot creating the high-priority task Draft the beta FAQ on request, with a link to the board"
                width="1440"
                height="500"
                loading="lazy"
                decoding="async"
                className="block h-auto w-full"
              />
            </figure>
            <ol className="mt-14 grid gap-10 border-t border-slate-200 pt-10 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} data-reveal style={{ transitionDelay: `${i * 80}ms` }}>
                  <h3 className="text-lg font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-slate-600">{step.body}</p>
                </li>
              ))}
            </ol>
            <p data-reveal className="mt-12 text-sm text-slate-500">
              Runs on Gemini with a Groq fallback. Bring your own Gemini key; it is stored encrypted on the server, never in the browser.
            </p>
          </div>
        </section>

        {/* 6. CONTACT */}
        <section id="contact" className="scroll-mt-16 border-t border-slate-200 py-24 md:py-32">
          <div className="mx-auto grid max-w-[1200px] items-start gap-12 px-4 sm:px-6 lg:grid-cols-12">
            <div data-reveal className="lg:col-span-5">
              <h2 className="font-serif text-4xl leading-[1.05] tracking-[-0.01em] text-slate-900 sm:text-5xl">Talk to us.</h2>
              <p className="mt-4 leading-relaxed text-slate-600">Questions, feature requests or help with deployment. We reply by email.</p>
              <p className="mt-6 flex items-center gap-2.5 text-sm text-slate-700">
                <Mail className="h-4 w-4 text-indigo-600" aria-hidden="true" /> support@nexamind.app
              </p>
            </div>
            <div data-reveal className="rounded-2xl bg-slate-50 p-6 sm:p-8 lg:col-span-7">
              {contactStatus === 'sent' ? (
                <div className="space-y-3 py-12 text-center" role="status">
                  <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-700" aria-hidden="true" />
                  <h3 className="text-lg font-semibold text-slate-900">Message sent</h3>
                  <p className="text-sm text-slate-600">Thanks for getting in touch. We’ll reply by email.</p>
                  <button type="button" onClick={() => setContactStatus('idle')} className="text-sm font-medium text-indigo-700 hover:underline">
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleContactSubmit} className="space-y-4" noValidate>
                  {contactError && (
                    <div id="contact-error" role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                      {contactError}
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label htmlFor="contact-name" className="text-sm font-medium text-slate-700">Your name</label>
                      <input id="contact-name" name="name" type="text" required autoComplete="name" maxLength={255} placeholder="Alex Mitchell" className="input-base py-2.5 text-sm" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="contact-email" className="text-sm font-medium text-slate-700">Email address</label>
                      <input id="contact-email" name="email" type="email" required autoComplete="email" spellCheck={false} maxLength={255} placeholder="alex@company.com" className="input-base py-2.5 text-sm" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="contact-subject" className="text-sm font-medium text-slate-700">Subject (optional)</label>
                    <input id="contact-subject" name="subject" type="text" maxLength={255} placeholder="Product question or feedback" className="input-base py-2.5 text-sm" value={contactForm.subject} onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="contact-message" className="text-sm font-medium text-slate-700">Message</label>
                    <textarea id="contact-message" name="message" required rows={4} maxLength={5000} placeholder="Tell us what you’d like to do with NexaMind…" className="input-base resize-none py-2.5 text-sm" value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} />
                  </div>
                  {/* Honeypot: invisible to people and assistive tech, often filled in by bots. */}
                  <div className="hidden" aria-hidden="true">
                    <label htmlFor="contact-website">Website</label>
                    <input id="contact-website" type="text" tabIndex={-1} autoComplete="off" value={contactForm.website} onChange={(e) => setContactForm({ ...contactForm, website: e.target.value })} />
                  </div>
                  <button type="submit" disabled={contactStatus === 'sending'} className="inline-flex w-full items-center justify-center gap-2 rounded-pill bg-slate-900 py-3 text-sm font-medium text-white transition-colors duration-fast hover:bg-slate-700 dark:bg-[#ededea] dark:text-[#141513] dark:hover:bg-[#ffffff] disabled:opacity-60 press">
                    {contactStatus === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-3.5 w-3.5" aria-hidden="true" />}
                    <span>{contactStatus === 'sending' ? 'Sending…' : 'Send message'}</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="px-4 pb-24 sm:px-6">
          <div data-reveal className="mx-auto max-w-[1200px] rounded-3xl bg-indigo-600 px-6 py-16 text-center transition-colors duration-panel sm:px-12">
            <h2 className="font-serif text-4xl leading-[1.05] text-white sm:text-6xl">Bring your team’s work together.</h2>
            <p className="mx-auto mt-4 max-w-md text-indigo-50">Start with your own Solo workspace in a minute, then invite the team with a code.</p>
            <button
              type="button"
              onClick={() => handleOpenAuth('register')}
              className="mt-8 inline-flex items-center gap-2 rounded-pill bg-[#ffffff] px-6 py-3 text-sm font-medium text-[#1f201d] transition-colors duration-fast hover:bg-[#f2f2f0] press"
            >
              Create your workspace <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </section>
      </main>

      {/* 7. FOOTER */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-4">
            <Logo alt="NexaMind" className="h-6" />
            <span className="text-slate-500">© {new Date().getFullYear()} NexaMind</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {NAV_SECTIONS.slice(1).map(([id, label]) => (
              <a key={id} {...sectionLink(id)} className="text-slate-600 hover:text-slate-900">{label}</a>
            ))}
            <button type="button" onClick={() => handleOpenAuth('login')} className="text-slate-600 hover:text-slate-900">Sign in</button>
          </nav>
        </div>
      </footer>

      {/* ------------------------------------------------------------- */}
      {/* 8. AUTH MODAL (LOGIN & REGISTRATION)                           */}
      {/* ------------------------------------------------------------- */}
      {showAuthModal && (
        <div
          className="fixed inset-0 bg-slate-950/50 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={closeAuthModal}
        >
          <div
            ref={authDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-dialog-title"
            aria-describedby="auth-dialog-desc"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-panel relative space-y-5 max-h-[90vh] overflow-y-auto outline-none animate-scale-in"
          >
            <button
              type="button"
              onClick={closeAuthModal}
              aria-label="Close sign-in dialog"
              className="absolute top-5 right-5 text-slate-500 hover:text-slate-800 p-1.5 rounded-lg transition hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>

            {/* Modal Header */}
            <div className="text-center space-y-1.5">
              <div className="flex items-center justify-center mx-auto mb-1">
                <img src="/logo-mark.png" alt="" className="h-11 w-auto object-contain" />
              </div>
              <h2 id="auth-dialog-title" className="font-serif text-3xl text-slate-900">
                {authMode === 'login'
                  ? 'Sign In to NexaMind'
                  : authMode === 'forgot'
                  ? 'Reset Your Password'
                  : otpSent
                  ? 'Verify Your Email'
                  : 'Create Free Account'}
              </h2>
              <p id="auth-dialog-desc" className="text-sm text-slate-600">
                {authMode === 'login'
                  ? 'Access your workspaces, persistent memories, and teams'
                  : authMode === 'forgot'
                  ? resetStep === 'email'
                    ? "Enter your account's email and we'll send you a reset code"
                    : 'Enter the code from the email and choose a new password'
                  : otpSent
                  ? 'Enter the 6-digit confirmation code sent to your inbox'
                  : 'Start your personal and team workspace in seconds'}
              </p>
            </div>

            {/* Google Sign-In: offered only when the server is configured for it */}
            {googleClientId && authMode !== 'forgot' && !otpSent && (
              <div className="space-y-2 pt-1">
                <div id="google-btn-container" className="w-full flex justify-center min-h-[44px]">
                  <button
                    type="button"
                    onClick={handleGoogleClick}
                    disabled={googleLoading || localLoading}
                    className="w-full flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm py-3 px-4 rounded-xl border border-slate-300 shadow-sm hover:shadow transition cursor-pointer disabled:opacity-50"
                  >
                    {googleLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-slate-500" aria-hidden="true" />
                    ) : (
                      <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                      </svg>
                    )}
                    <span>{googleLoading ? 'Signing in with Google…' : 'Continue with Google'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <div className="h-px bg-slate-200 flex-1" />
                  <span className="text-xs text-slate-500 font-medium">or with email</span>
                  <div className="h-px bg-slate-200 flex-1" />
                </div>
              </div>
            )}

            {notice && !errorText && (
              <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl">
                {notice}
              </div>
            )}

            {errorText && (
              <div id="auth-error" role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-xl font-medium flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-700" aria-hidden="true" />
                <span>{errorText}</span>
              </div>
            )}

            {devOtpNotice && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl font-mono text-center">
                {devOtpNotice}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-3.5" noValidate aria-describedby={errorText ? 'auth-error' : undefined}>
              {authMode === 'forgot' ? (
                <div className="space-y-3.5">
                  <div className="space-y-1">
                    <label htmlFor="reset-email" className="text-xs font-bold text-slate-700">Email Address</label>
                    <input
                      id="reset-email"
                      type="email"
                      required
                      autoComplete="email"
                      disabled={resetStep === 'code'}
                      className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-sm text-slate-900 transition disabled:opacity-70"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      data-autofocus
                    />
                  </div>
                  {resetStep === 'code' && (
                    <>
                      <div className="space-y-1">
                        <label htmlFor="reset-code" className="text-xs font-bold text-slate-700">Reset code</label>
                        <input
                          id="reset-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          required
                          maxLength={6}
                          className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-center text-lg tracking-[0.3em] font-mono text-slate-900 transition"
                          value={resetCode}
                          onChange={(e) => setResetCode(e.target.value.replace(/[^0-9]/g, ''))}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="reset-password" className="text-xs font-bold text-slate-700">New password</label>
                        <input
                          id="reset-password"
                          type="password"
                          required
                          minLength={8}
                          autoComplete="new-password"
                          aria-describedby="reset-password-hint"
                          className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-sm text-slate-900 transition"
                          value={resetNewPassword}
                          onChange={(e) => setResetNewPassword(e.target.value)}
                        />
                        <p id="reset-password-hint" className="text-xs text-slate-600">At least 8 characters, with letters and numbers.</p>
                      </div>
                      <div className="flex items-center justify-between text-xs px-1">
                        <span className="text-slate-600">Didn't receive the email?</span>
                        <button
                          type="button"
                          disabled={otpCountdown > 0 || localLoading}
                          onClick={handleResetRequest}
                          className="text-indigo-600 hover:text-indigo-700 disabled:text-slate-500 font-semibold"
                        >
                          {otpCountdown > 0 ? `Resend code (${otpCountdown}s)` : 'Resend code'}
                        </button>
                      </div>
                    </>
                  )}
                  <button
                    type="submit"
                    disabled={localLoading}
                    className="w-full bg-slate-900 hover:bg-slate-700 dark:bg-[#ededea] dark:text-[#141513] disabled:opacity-50 text-white font-medium text-sm py-3 rounded-pill transition-colors flex items-center justify-center gap-2 press"
                  >
                    {localLoading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                    <span>{resetStep === 'email' ? 'Send reset code' : 'Set new password'}</span>
                  </button>
                </div>
              ) : authMode === 'register' && otpSent ? (
                <div className="space-y-4 animate-fade-in">
                  <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-center space-y-1.5">
                    <div className="flex items-center justify-center text-indigo-600 mb-1">
                      <MailCheck className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <div className="text-sm font-bold text-slate-900">Check your inbox</div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      If <span className="font-bold text-indigo-700">{form.email}</span> can receive email, we sent it a 6-digit code.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpSent(false);
                        setOtp('');
                        setLocalError('');
                        setDevOtpNotice(null);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 font-semibold underline mt-1 cursor-pointer"
                    >
                      <ArrowLeft className="w-3 h-3" aria-hidden="true" />
                      <span>Change email or details</span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="register-otp" className="text-xs font-bold text-slate-700 flex items-center justify-between">
                      <span>Verification Code</span>
                      <span className="text-xs text-slate-500 font-normal">Valid for 10 min</span>
                    </label>
                    <input
                      id="register-otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      maxLength={6}
                      placeholder="123456"
                      className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-3 text-center text-2xl tracking-[0.35em] font-mono font-bold text-slate-900 transition"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                      data-autofocus
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs px-1">
                    <span className="text-slate-600">Didn't receive the email?</span>
                    <button
                      type="button"
                      disabled={otpCountdown > 0 || localLoading}
                      onClick={handleSendOtp}
                      className="text-indigo-600 hover:text-indigo-700 disabled:text-slate-500 font-semibold flex items-center gap-1 cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${localLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                      <span>{otpCountdown > 0 ? `Resend code (${otpCountdown}s)` : 'Resend Code'}</span>
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={localLoading || propAuthLoading}
                    className="w-full bg-slate-900 hover:bg-slate-700 dark:bg-[#ededea] dark:text-[#141513] disabled:opacity-50 text-white font-medium text-sm py-3 rounded-pill transition-colors flex items-center justify-center gap-2 press"
                  >
                    {localLoading || propAuthLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>Verifying & Setting Up Workspace…</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        <span>Confirm & Complete Registration</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <>
                  {authMode === 'register' && (
                    <>
                      <div className="space-y-1">
                        <label htmlFor="register-name" className="text-xs font-bold text-slate-700">Full Name</label>
                        <input
                          id="register-name"
                          type="text"
                          required
                          autoComplete="name"
                          placeholder="e.g. Jason Bourne"
                          className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-sm text-slate-900 transition"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          data-autofocus
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="register-username" className="text-xs font-bold text-slate-700 flex items-center justify-between">
                          <span>Unique Username</span>
                          <span className="text-xs text-slate-500 font-normal">For chat invitations</span>
                        </label>
                        <div className="relative">
                          <span className="absolute left-3.5 top-2.5 text-slate-500 font-mono text-sm" aria-hidden="true">@</span>
                          <input
                            id="register-username"
                            type="text"
                            required
                            autoComplete="username"
                            placeholder="jason_bourne"
                            className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl pl-8 pr-4 py-2.5 text-sm text-slate-900 transition font-mono"
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
                    <label htmlFor="auth-email" className="text-xs font-bold text-slate-700">
                      {authMode === 'login' ? 'Email or @Username' : 'Email Address'}
                    </label>
                    <input
                      id="auth-email"
                      type={authMode === 'login' ? 'text' : 'email'}
                      required
                      autoComplete={authMode === 'login' ? 'username' : 'email'}
                      placeholder={authMode === 'login' ? 'jason@gmail.com or @jason_bourne' : 'jason@gmail.com'}
                      className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-sm text-slate-900 transition"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      {...(authMode === 'login' ? { 'data-autofocus': true } : {})}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor="auth-password" className="text-xs font-bold text-slate-700">Password</label>
                      {authMode === 'login' && (
                        <button
                          type="button"
                          onClick={() => switchAuthMode('forgot')}
                          className="text-xs font-semibold text-indigo-600 hover:underline"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      id="auth-password"
                      type="password"
                      required
                      placeholder="••••••••"
                      aria-describedby={authMode === 'register' ? 'auth-password-hint' : undefined}
                      className="w-full bg-slate-50 border border-slate-300 focus:border-indigo-600 focus:bg-white rounded-xl px-4 py-2.5 text-sm text-slate-900 transition"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      minLength={authMode === 'register' ? 8 : undefined}
                      autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                    />
                    {authMode === 'register' && (
                      <p id="auth-password-hint" className="text-xs text-slate-600">At least 8 characters, with letters and numbers.</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={localLoading || propAuthLoading}
                    className="w-full bg-slate-900 hover:bg-slate-700 dark:bg-[#ededea] dark:text-[#141513] disabled:opacity-50 text-white font-medium text-sm py-3 rounded-pill transition-colors flex items-center justify-center gap-2 press"
                  >
                    {localLoading || propAuthLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                        <span>{authMode === 'register' ? 'Sending Code…' : 'Signing In…'}</span>
                      </>
                    ) : authMode === 'login' ? (
                      <span>Sign In to Workspace</span>
                    ) : (
                      <>
                        <span>Verify Email & Send Code</span>
                        <ArrowRight className="w-4 h-4" aria-hidden="true" />
                      </>
                    )}
                  </button>
                </>
              )}
            </form>

            <div className="text-center pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => switchAuthMode(authMode === 'register' ? 'login' : authMode === 'forgot' ? 'login' : 'register')}
                className="text-sm text-indigo-600 hover:underline font-semibold cursor-pointer pt-3"
              >
                {authMode === 'login'
                  ? "Don't have an account? Create one free"
                  : authMode === 'forgot'
                  ? 'Back to Sign In'
                  : 'Already registered? Sign In'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
