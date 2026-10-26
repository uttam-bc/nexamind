import React, { useState } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  Calendar,
  X,
  Trash2,
  Filter,
} from 'lucide-react';
import { api } from '../api';
import FeatureHeader from './FeatureHeader';
import { notify, confirmDialog } from '../context/ToastContext';
import { formatMoney } from '../lib/format';

const MAX_AMOUNT = 1_000_000_000_000;

export default function FinanceTracker({
  workspaceId,
  financeSummary,
  transactions,
  onRefreshFinance,
  onBack,
}) {
  const [showLogModal, setShowLogModal] = useState(false);
  const [txType, setTxType] = useState('expense');
  const [txAmount, setTxAmount] = useState('');
  const [txCategory, setTxCategory] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'income' | 'expense'
  const [searchQuery, setSearchQuery] = useState('');
  const [txError, setTxError] = useState('');

  const handleLogTransaction = async (e) => {
    e.preventDefault();
    const amount = parseFloat(txAmount);
    setTxError('');
    if (!Number.isFinite(amount) || amount <= 0) {
      setTxError('Enter an amount greater than zero.');
      return;
    }
    if (amount > MAX_AMOUNT) {
      setTxError('Amounts are limited to 1,000,000,000,000.');
      return;
    }
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
      if (onRefreshFinance) await onRefreshFinance();
    } catch (err) {
      setTxError(err.message || 'Could not save the transaction.');
    }
  };

  const handleDeleteTransaction = async (tx) => {
    if (
      !(await confirmDialog(
        `Remove this ${tx.type} of $${Number(tx.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })} (${tx.category})?`,
        { confirmLabel: 'Remove' }
      ))
    ) {
      return;
    }
    try {
      await api.deleteTransaction(workspaceId, tx.id);
      if (onRefreshFinance) await onRefreshFinance();
      notify('Transaction removed.', 'success');
    } catch (err) {
      notify(err.message || 'Could not remove the transaction.', 'error');
    }
  };

  const exportCSV = () => {
    if (!transactions || transactions.length === 0) {
      notify('No transactions to export.', 'info');
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
    link.setAttribute(
      'download',
      `NexaMind_Finance_Ledger_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredTransactions = (transactions || []).filter((t) => {
    if (filterType === 'income' && t.type !== 'income') return false;
    if (filterType === 'expense' && t.type !== 'expense') return false;
    if (searchQuery.trim()) {
      return (
        t.category?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.date?.includes(searchQuery)
      );
    }
    return true;
  });

  // Never substitute example numbers: missing figures render as a dash.
  const cashBalance = financeSummary?.cash_balance;
  const totalIncome = financeSummary?.total_income;
  const totalExpenses = financeSummary?.total_expenses;
  // runway_months is null when the workspace isn't burning cash.
  const runwayMonths = financeSummary?.runway_months;
  const runwayLabel = !financeSummary
    ? '—'
    : runwayMonths == null
      ? 'No burn'
      : `${runwayMonths} ${runwayMonths === 1 ? 'Month' : 'Months'}`;

  return (
    <div className="h-full flex flex-col space-y-5 max-w-7xl mx-auto pb-6 font-sans text-slate-900 select-none">
      <FeatureHeader
        title="Financial Ledger & Runway"
        icon={DollarSign}
        badge={null}
        onBack={onBack}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-200 shadow-xs transition"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>Export CSV</span>
            </button>
            <button
              onClick={() => setShowLogModal(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-xs transition active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Transaction</span>
            </button>
          </div>
        }
      />

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Cash Balance */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums font-bold text-slate-500">
              Cash Balance
            </span>
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 tracking-tight">
            {formatMoney(cashBalance)}
          </div>
          <p className="text-xs tabular-nums text-emerald-500 font-semibold">Available Liquidity</p>
        </div>

        {/* Total Income */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums font-bold text-slate-500">
              Total Inflow
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 border border-emerald-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-500 tracking-tight">
            {formatMoney(totalIncome, { sign: '+' })}
          </div>
          <p className="text-xs tabular-nums text-slate-500">Revenue & Grants</p>
        </div>

        {/* Total Expenses */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums font-bold text-slate-500">
              Total Outflow
            </span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 border border-rose-100 flex items-center justify-center">
              <TrendingDown className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-rose-500 tracking-tight">
            {typeof totalExpenses === 'number' ? formatMoney(-totalExpenses) : '—'}
          </div>
          <p className="text-xs tabular-nums text-slate-500">Operational & Cloud Burn</p>
        </div>

        {/* Runway Months */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs tabular-nums font-bold text-slate-500">
              Runway Forecast
            </span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-violet-500 border border-purple-100 flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-violet-500 tracking-tight">
            {runwayLabel}
          </div>
          <p className="text-xs tabular-nums text-slate-500 font-semibold">
            {financeSummary ? `Net burn ${formatMoney(Number(financeSummary.net_burn_rate || 0))}/mo (90-day avg)` : 'No figures loaded yet'}
          </p>
        </div>
      </div>

      {/* Ledger Table Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4 flex-1 flex flex-col">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filterType === 'all'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-100'
              }`}
            >
              All Transactions
            </button>
            <button
              onClick={() => setFilterType('income')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filterType === 'income'
                  ? 'bg-emerald-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Inflow (+)
            </button>
            <button
              onClick={() => setFilterType('expense')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                filterType === 'expense'
                  ? 'bg-rose-500 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-100'
              }`}
            >
              Outflow (-)
            </button>
          </div>

          <input aria-label="Filter category or date"
            type="text"
            placeholder="Filter category or date…"
            className="bg-slate-100 border border-slate-200 focus:border-indigo-600 rounded-xl px-3.5 py-1.5 text-xs text-slate-900 focus:outline-none transition w-56 tabular-nums"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Transactions Table */}
        <div className="flex-1 overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 tabular-nums text-xs bg-slate-50">
                <th className="py-3 px-4">TYPE</th>
                <th className="py-3 px-4">CATEGORY</th>
                <th className="py-3 px-4">DATE</th>
                <th className="py-3 px-4 text-right">AMOUNT</th>
                <th className="py-3 px-4 text-right w-16"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-900">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                    No transactions recorded. Click "+ Log Transaction" to add your first expense or income item!
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition group">
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs tabular-nums font-bold px-2 py-0.5 rounded ${
                          tx.type === 'income'
                            ? 'bg-emerald-50 text-emerald-500 border border-emerald-200'
                            : 'bg-rose-50 text-rose-500 border border-rose-200'
                        }`}
                      >
                        {tx.type}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium">
                      {tx.category}
                      {tx.description && <div className="text-xs font-normal text-slate-500">{tx.description}</div>}
                    </td>
                    <td className="py-3 px-4 tabular-nums text-slate-500">{String(tx.date || '').slice(0, 10)}</td>
                    <td
                      className={`py-3 px-4 text-right font-bold tabular-nums ${
                        tx.type === 'income' ? 'text-emerald-500' : 'text-rose-500'
                      }`}
                    >
                      {tx.type === 'income' ? '+' : '-'}$
                      {tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteTransaction(tx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition opacity-70 group-hover:opacity-100"
                        title="Remove transaction"
                        aria-label={`Remove ${tx.category} transaction`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Transaction Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div data-modal className="bg-white p-6 rounded-2xl border border-slate-200 max-w-sm w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Log Financial Transaction</h3>
            <form onSubmit={handleLogTransaction} className="space-y-3">
              <div className="flex gap-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setTxType('expense')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                    txType === 'expense'
                      ? 'bg-white text-rose-500 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  Expense Outflow
                </button>
                <button
                  type="button"
                  onClick={() => setTxType('income')}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                    txType === 'income'
                      ? 'bg-white text-emerald-500 shadow-sm'
                      : 'text-slate-500'
                  }`}
                >
                  Income Inflow
                </button>
              </div>

              <div>
                <label htmlFor="finance-tracker-field-1" className="text-xs font-bold text-slate-700">Amount ($)</label>
                <input id="finance-tracker-field-1"
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 2500"
                  className="w-full bg-slate-100 border border-slate-200 focus:border-indigo-600 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none"
                  value={txAmount}
                  onChange={(e) => setTxAmount(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="finance-tracker-field-2" className="text-xs font-bold text-slate-700">Category / Label</label>
                <input id="finance-tracker-field-2"
                  type="text"
                  required
                  placeholder="e.g. Cloud Infrastructure, Payroll, Grant"
                  className="w-full bg-slate-100 border border-slate-200 focus:border-indigo-600 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none"
                  value={txCategory}
                  onChange={(e) => setTxCategory(e.target.value)}
                />
              </div>

              <div>
                <label htmlFor="finance-tracker-field-3" className="text-xs font-bold text-slate-700">Date</label>
                <input id="finance-tracker-field-3"
                  type="date"
                  required
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLogModal(false)}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-xl text-xs font-bold shadow-sm"
                >
                  Save Entry
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
