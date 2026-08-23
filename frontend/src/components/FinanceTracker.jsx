import React, { useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Download,
  PieChart,
  Calendar,
  X,
  Edit2,
  Trash2,
} from 'lucide-react';
import { api } from '../api';

export default function FinanceTracker({ workspaceId, financeSummary, transactions, onRefreshFinance }) {
  const [showLogModal, setShowLogModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const [txType, setTxType] = useState('expense');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'income' | 'expense'

  const handleLogTransaction = async (e) => {
    e.preventDefault();
    const amount = parseFloat(txAmount);
    if (isNaN(amount) || amount <= 0) return;
    try {
      await api.createTransaction(workspaceId, {
        type: txType,
        amount,
        category: txCategory.trim() || 'General',
        date: txDate,
      });
      setShowLogModal(false);
      setTxAmount('');
      setTxCategory('');
      await onRefreshFinance();
    } catch (err) {
      alert(`Log transaction error: ${err.message}`);
    }
  };

  const exportCSV = () => {
    if (!transactions || transactions.length === 0) {
      alert('No transactions to export.');
      return;
    }
    const headers = 'ID,Type,Category,Amount,Date\n';
    const rows = transactions
      .map((t) => `"${t.id}","${t.type}","${t.category}",${t.amount},"${t.date}"`)
      .join('\n');
    const csvContent = 'data:text/csv;charset=utf-8,' + headers + rows;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `NexaMind_Finance_Ledger_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredTransactions = (transactions || []).filter((t) => {
    if (filterType === 'income') return t.type === 'income';
    if (filterType === 'expense') return t.type === 'expense';
    return true;
  });

  // Calculate category totals for breakdown
  const categoryTotals = {};
  let totalExpensesForBreakdown = 0;
  (transactions || []).forEach((t) => {
    if (t.type === 'expense') {
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
      totalExpensesForBreakdown += t.amount;
    }
  });

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-100 tracking-tight">
            Workspace Financials & Runway Calculator
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Monitor cash balance, burn rate, runway months, and category cost distributions.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 px-3.5 py-2 rounded-xl text-xs font-semibold border border-slate-800 transition"
            title="Download CSV Ledger"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setShowLogModal(true)}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-lg shadow-indigo-600/30 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Log Transaction</span>
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Cash Balance</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 tracking-tight">
            ${financeSummary?.cash_balance?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <span className="text-[10px] text-slate-500">Available capital</span>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Inflows</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-slate-100 tracking-tight">
            ${financeSummary?.total_income?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <span className="text-[10px] text-slate-500">Lifetime revenue & funding</span>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Outflows</span>
            <ArrowDownRight className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-black text-rose-400 tracking-tight">
            ${financeSummary?.total_expenses?.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '0.00'}
          </div>
          <span className="text-[10px] text-slate-500">Lifetime operational spend</span>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Estimated Runway</span>
            <Clock className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-2xl font-black text-indigo-400 tracking-tight">
            {financeSummary?.runway_months ? `${financeSummary.runway_months} Months` : 'Profitable'}
          </div>
          <span className="text-[10px] text-slate-500">
            Net Burn: ${financeSummary?.net_burn_rate?.toLocaleString() || '0'}/mo
          </span>
        </div>
      </div>

      {/* Main Finance Content: Category Breakdown + Ledger */}
      <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Category Expense Breakdown */}
        <div className="col-span-1 glass-panel p-5 rounded-2xl border border-slate-800 flex flex-col space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <PieChart className="w-4 h-4 text-indigo-400" />
              <span>Spend Breakdown</span>
            </h3>
            <span className="text-[10px] text-slate-500 font-mono">
              ${totalExpensesForBreakdown.toLocaleString()}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
            {Object.entries(categoryTotals).map(([cat, total]) => {
              const pct = totalExpensesForBreakdown > 0 ? (total / totalExpensesForBreakdown) * 100 : 0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-200">{cat}</span>
                    <span className="text-slate-400 font-mono">
                      ${total.toLocaleString()} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {Object.keys(categoryTotals).length === 0 && (
              <div className="text-center text-slate-500 py-12 text-xs">No expense categories logged yet.</div>
            )}
          </div>
        </div>

        {/* Transactions Ledger */}
        <div className="col-span-2 glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col min-h-0 bg-slate-950/40">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
            <h3 className="font-bold text-xs uppercase tracking-wider text-slate-300">
              Transaction Ledger ({filteredTransactions.length})
            </h3>

            <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
              <button
                onClick={() => setFilterType('all')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  filterType === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterType('income')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  filterType === 'income' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Inflows
              </button>
              <button
                onClick={() => setFilterType('expense')}
                className={`px-3 py-1 rounded-lg font-semibold transition ${
                  filterType === 'expense' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Outflows
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {filteredTransactions.map((tx) => (
              <div
                key={tx.id}
                onClick={() => setSelectedTx(tx)}
                className="p-3.5 bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 hover:border-indigo-500/40 rounded-xl flex items-center justify-between text-xs cursor-pointer transition"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold ${
                      tx.type === 'income'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    {tx.type === 'income' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="font-bold text-slate-100">{tx.category}</div>
                    <div className="text-[10px] text-slate-500">{tx.date}</div>
                  </div>
                </div>

                <span
                  className={`font-mono text-sm font-black ${
                    tx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
            ))}

            {filteredTransactions.length === 0 && (
              <div className="text-center text-slate-500 py-12 text-xs">No transactions found.</div>
            )}
          </div>
        </div>
      </div>

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-700 max-w-sm w-full space-y-4 bg-slate-900/95">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="font-bold text-sm text-slate-100">Transaction Details</span>
              <button onClick={() => setSelectedTx(null)} className="text-slate-400 hover:text-slate-200">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 uppercase font-bold text-[10px]">Type</span>
                <span
                  className={`font-bold uppercase ${
                    selectedTx.type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {selectedTx.type}
                </span>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 uppercase font-bold text-[10px]">Category</span>
                <span className="font-bold text-slate-100">{selectedTx.category}</span>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 uppercase font-bold text-[10px]">Amount</span>
                <span className="font-mono font-black text-sm text-slate-100">
                  ${selectedTx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 uppercase font-bold text-[10px]">Date</span>
                <span className="text-slate-200">{selectedTx.date}</span>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedTx(null)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Transaction Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-slate-100">Log Transaction</h3>
            <form onSubmit={handleLogTransaction} className="space-y-4">
              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTxType('income')}
                    className={`py-2 rounded-xl text-xs font-bold transition ${
                      txType === 'income'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    Income (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTxType('expense')}
                    className={`py-2 rounded-xl text-xs font-bold transition ${
                      txType === 'expense'
                        ? 'bg-rose-600 text-white shadow'
                        : 'bg-slate-900 text-slate-400 border border-slate-800'
                    }`}
                  >
                    Expense (-)
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  autoFocus
                  placeholder="5000.00"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Category
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AWS Hosting, Subscriptions, Sales Revenue"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Date
                </label>
                <input
                  type="date"
                  required
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/30"
                >
                  Save Transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
