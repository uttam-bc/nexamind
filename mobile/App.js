import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import { mobileApi, setAuthToken } from './src/api';

export default function App() {
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWs, setActiveWs] = useState(null);

  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('demo@nexamind.app');
  const [password, setPassword] = useState('password123');
  const [name, setName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [currentTab, setCurrentTab] = useState('dashboard'); // 'dashboard' | 'tasks' | 'sessions' | 'finance'
  const [tasks, setTasks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [finance, setFinance] = useState(null);

  // AI Agent Chat State
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (token) {
      loadUserData();
    }
  }, [token]);

  useEffect(() => {
    if (activeWs) {
      loadWorkspaceData(activeWs.id);
    }
  }, [activeWs, currentTab]);

  const handleAuth = async () => {
    setAuthLoading(true);
    setAuthError('');
    try {
      let res;
      if (authMode === 'login') {
        res = await mobileApi.login(email, password);
      } else {
        res = await mobileApi.register(name, email, password);
      }
      setAuthToken(res.access_token);
      setToken(res.access_token);
    } catch (err) {
      setAuthError(err.message || 'Auth failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const loadUserData = async () => {
    try {
      const u = await mobileApi.getMe();
      setUser(u);
      const wsList = await mobileApi.listWorkspaces();
      setWorkspaces(wsList);
      if (wsList.length > 0) setActiveWs(wsList[0]);
    } catch (err) {
      console.error(err);
      setToken('');
    }
  };

  const loadWorkspaceData = async (wsId) => {
    try {
      if (currentTab === 'dashboard' || currentTab === 'tasks') {
        const t = await mobileApi.listTasks(wsId);
        setTasks(t);
      }
      if (currentTab === 'dashboard' || currentTab === 'sessions') {
        const s = await mobileApi.listSessions(wsId);
        setSessions(s);
      }
      if (currentTab === 'dashboard' || currentTab === 'finance') {
        const f = await mobileApi.getFinanceSummary(wsId);
        setFinance(f);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAiAsk = async () => {
    if (!aiPrompt.trim() || !activeWs || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await mobileApi.chatWithAgent(activeWs.id, aiPrompt);
      setAiResponse(res.response);
      setAiPrompt('');
      loadWorkspaceData(activeWs.id);
    } catch (err) {
      setAiResponse(`Error: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  if (!token || !user) {
    return (
      <SafeAreaView style={styles.authContainer}>
        <StatusBar barStyle="light-content" />
        <View style={styles.authCard}>
          <Text style={styles.authLogo}>NexaMind</Text>
          <Text style={styles.authSubtitle}>Mobile AI-Powered Workspace</Text>

          {authError ? <Text style={styles.errorText}>{authError}</Text> : null}

          {authMode === 'register' && (
            <TextInput
              style={styles.input}
              placeholder="Full Name"
              placeholderTextColor="#64748b"
              value={name}
              onChangeText={setName}
            />
          )}

          <TextInput
            style={styles.input}
            placeholder="Email Address"
            placeholderTextColor="#64748b"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#64748b"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <TouchableOpacity style={styles.primaryButton} onPress={handleAuth} disabled={authLoading}>
            {authLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
            style={{ marginTop: 16 }}
          >
            <Text style={styles.switchAuthText}>
              {authMode === 'login'
                ? "Don't have an account? Register"
                : 'Already have an account? Sign In'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>NexaMind</Text>
          <Text style={styles.headerWs}>
            {activeWs ? activeWs.name : 'Workspace'}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => {
            setAuthToken('');
            setToken('');
          }}
          style={styles.logoutBtn}
        >
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Content Area */}
      <ScrollView style={styles.content}>
        {currentTab === 'dashboard' && (
          <View style={styles.tabContent}>
            {/* Metric Cards */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Open Tasks</Text>
                <Text style={styles.metricValue}>
                  {tasks.filter((t) => t.status !== 'done').length}
                </Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricLabel}>Runway</Text>
                <Text style={styles.metricValue}>
                  {finance?.runway_months ? `${finance.runway_months}m` : 'Profitable'}
                </Text>
              </View>
            </View>

            {/* AI Assistant */}
            <View style={styles.aiCard}>
              <Text style={styles.aiCardTitle}>🤖 AI Agent Assistant</Text>
              {aiResponse ? (
                <Text style={styles.aiResponseText}>{aiResponse}</Text>
              ) : (
                <Text style={styles.aiHelperText}>
                  Ask anything or tell the agent: "Create tasks from yesterday's meeting", "Check runway", etc.
                </Text>
              )}
              <View style={styles.aiInputRow}>
                <TextInput
                  style={styles.aiInput}
                  placeholder="Ask AI agent..."
                  placeholderTextColor="#64748b"
                  value={aiPrompt}
                  onChangeText={setAiPrompt}
                />
                <TouchableOpacity
                  style={styles.aiSendBtn}
                  onPress={handleAiAsk}
                  disabled={aiLoading}
                >
                  <Text style={styles.aiSendBtnText}>
                    {aiLoading ? '...' : 'Send'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {currentTab === 'tasks' && (
          <View style={styles.tabContent}>
            <Text style={styles.sectionTitle}>Kanban Tasks</Text>
            {tasks.map((task) => (
              <View key={task.id} style={styles.taskCard}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskStatus}>Status: {task.status}</Text>
              </View>
            ))}
          </View>
        )}

        {currentTab === 'sessions' && (
          <View style={styles.tabContent}>
            <Text style={styles.sectionTitle}>Meeting Sessions</Text>
            {sessions.map((s) => (
              <View key={s.id} style={styles.sessionCard}>
                <Text style={styles.sessionTitle}>{s.title}</Text>
                {s.ai_summary ? (
                  <Text style={styles.sessionSummary}>{s.ai_summary}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}

        {currentTab === 'finance' && (
          <View style={styles.tabContent}>
            <Text style={styles.sectionTitle}>Financial Health</Text>
            <View style={styles.financeCard}>
              <Text style={styles.financeBalance}>
                ${finance?.cash_balance?.toLocaleString() || '0.00'}
              </Text>
              <Text style={styles.financeLabel}>Cash Balance</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Nav */}
      <View style={styles.bottomNav}>
        {[
          { id: 'dashboard', label: 'Home' },
          { id: 'tasks', label: 'Tasks' },
          { id: 'sessions', label: 'Meetings' },
          { id: 'finance', label: 'Finance' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.navItem, currentTab === tab.id && styles.navItemActive]}
            onPress={() => setCurrentTab(tab.id)}
          >
            <Text
              style={[
                styles.navItemText,
                currentTab === tab.id && styles.navItemTextActive,
              ]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090d16' },
  authContainer: { flex: 1, backgroundColor: '#090d16', justifyContent: 'center', alignItems: 'center', padding: 20 },
  authCard: { width: '100%', backgroundColor: '#0f172a', padding: 24, borderRadius: 16, borderWidth: 1, borderColor: '#1e293b' },
  authLogo: { fontSize: 28, fontWeight: 'bold', color: '#818cf8', textAlign: 'center' },
  authSubtitle: { fontSize: 13, color: '#94a3b8', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  input: { backgroundColor: '#1e293b', color: '#f8fafc', borderRadius: 10, padding: 14, fontSize: 14, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  primaryButton: { backgroundColor: '#4f46e5', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  primaryButtonText: { color: '#ffffff', fontWeight: 'bold', fontSize: 15 },
  switchAuthText: { color: '#818cf8', textAlign: 'center', fontSize: 13 },
  errorText: { color: '#f43f5e', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  header: { height: 60, borderBottomWidth: 1, borderColor: '#1e293b', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, backgroundColor: '#0f172a' },
  headerTitle: { fontSize: 17, fontWeight: 'bold', color: '#f8fafc' },
  headerWs: { fontSize: 11, color: '#818cf8' },
  logoutBtn: { padding: 6 },
  logoutBtnText: { color: '#94a3b8', fontSize: 12 },
  content: { flex: 1 },
  tabContent: { padding: 16, gap: 14 },
  metricsGrid: { flexDirection: 'row', gap: 10 },
  metricCard: { flex: 1, backgroundColor: '#0f172a', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#1e293b' },
  metricLabel: { fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', fontWeight: '600' },
  metricValue: { fontSize: 20, fontWeight: 'bold', color: '#f8fafc', marginTop: 4 },
  aiCard: { backgroundColor: '#0f172a', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#4f46e5' },
  aiCardTitle: { fontSize: 14, fontWeight: 'bold', color: '#818cf8', marginBottom: 6 },
  aiHelperText: { fontSize: 12, color: '#64748b', marginBottom: 12, lineHeight: 18 },
  aiResponseText: { fontSize: 13, color: '#e2e8f0', marginBottom: 12, lineHeight: 20 },
  aiInputRow: { flexDirection: 'row', gap: 8 },
  aiInput: { flex: 1, backgroundColor: '#1e293b', color: '#f8fafc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13 },
  aiSendBtn: { backgroundColor: '#4f46e5', paddingHorizontal: 14, justifyContent: 'center', borderRadius: 8 },
  aiSendBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#f8fafc', marginBottom: 6 },
  taskCard: { backgroundColor: '#0f172a', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#1e293b', marginBottom: 8 },
  taskTitle: { fontSize: 14, fontWeight: '600', color: '#f8fafc' },
  taskStatus: { fontSize: 11, color: '#818cf8', marginTop: 4, textTransform: 'capitalize' },
  sessionCard: { backgroundColor: '#0f172a', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#1e293b', marginBottom: 8 },
  sessionTitle: { fontSize: 14, fontWeight: '600', color: '#f8fafc' },
  sessionSummary: { fontSize: 12, color: '#94a3b8', marginTop: 6, lineHeight: 18 },
  financeCard: { backgroundColor: '#0f172a', padding: 20, borderRadius: 12, borderWidth: 1, borderColor: '#1e293b', alignItems: 'center' },
  financeBalance: { fontSize: 26, fontWeight: 'bold', color: '#34d399' },
  financeLabel: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  bottomNav: { height: 60, borderTopWidth: 1, borderColor: '#1e293b', flexDirection: 'row', backgroundColor: '#0f172a' },
  navItem: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  navItemActive: { borderTopWidth: 2, borderColor: '#4f46e5' },
  navItemText: { fontSize: 12, color: '#64748b', fontWeight: '500' },
  navItemTextActive: { color: '#818cf8', fontWeight: 'bold' },
});
