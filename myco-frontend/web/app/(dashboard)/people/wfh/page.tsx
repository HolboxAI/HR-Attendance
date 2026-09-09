'use client';

import { useState, useEffect } from 'react';
import { MonitorPlay, Check, Loader2, Bell } from 'lucide-react';

import { proxy } from '@/lib/format';

type WFHConfig = {
  id: string;
  emp_code: string;
  full_name: string;
  is_wfh_enabled: boolean;
};

type WFHRequest = {
  id: string;
  shift_date: string;
  reason: string;
  created_at: string;
  employee: { id: string; full_name: string; emp_code: string } | null;
};

export default function WFHConfigPage() {
  const [employees, setEmployees] = useState<WFHConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [requests, setRequests] = useState<WFHRequest[]>([]);
  const [loadingReqs, setLoadingReqs] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(proxy('/api/v1/admin/wfh-config'))
      .then((res) => res.json())
      .then((data) => {
        setEmployees(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch(proxy('/api/v1/admin/wfh/pending'))
      .then((res) => res.json())
      .then((data) => {
        setRequests(Array.isArray(data) ? data : []);
        setLoadingReqs(false);
      })
      .catch(() => setLoadingReqs(false));
  }, []);

  const toggleWfh = async (id: string, current: boolean) => {
    setSaving(id);
    const newValue = !current;

    // Optimistic update
    setEmployees(prev => prev.map(e => e.id === id ? { ...e, is_wfh_enabled: newValue } : e));

    try {
      const res = await fetch(proxy('/api/v1/admin/wfh-config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_ids: [id],
          is_wfh_enabled: newValue,
        }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      // Revert on error
      setEmployees(prev => prev.map(e => e.id === id ? { ...e, is_wfh_enabled: current } : e));
    } finally {
      setSaving(null);
    }
  };

  const decideRequest = async (id: string, status: 'approved' | 'rejected') => {
    setDecidingId(id);
    try {
      const res = await fetch(proxy(`/api/v1/admin/wfh/${id}/decide`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed');
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch {
      alert('Failed to update request. Please try again.');
    } finally {
      setDecidingId(null);
    }
  };

  if (loading || loadingReqs) {
    return (
      <div className="p-8 text-center text-ink-3 font-mono text-sm flex items-center justify-center gap-2">
        <Loader2 className="size-4 animate-spin" />
        Loading WFH configuration...
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink flex items-center gap-2">
          <MonitorPlay className="size-6 text-ink-3" />
          Work From Home
        </h1>
        <p className="text-sm text-ink-3 font-mono mt-1">
          Manage permanent WFH status and review daily WFH requests from employees.
        </p>
      </header>

      {/* Pending Requests Section */}
      {requests.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Bell className="size-4 text-amber-500" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-3 font-mono">
              Pending WFH Requests · {requests.length}
            </h2>
          </div>
          <div className="rounded-2xl border border-amber-500/20 glass-panel overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Date Requested</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{req.employee?.full_name ?? '—'}</div>
                      <div className="font-mono text-xs text-ink-3">{req.employee?.emp_code}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-ink-2 whitespace-nowrap">
                      {req.shift_date}
                    </td>
                    <td className="px-4 py-3 text-ink-2 max-w-xs">
                      <p className="truncate">{req.reason}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => decideRequest(req.id, 'approved')}
                          disabled={decidingId === req.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-600 border border-green-500/20 hover:bg-green-500/20 text-xs font-semibold disabled:opacity-50 transition-all"
                        >
                          {decidingId === req.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                          Approve
                        </button>
                        <button
                          onClick={() => decideRequest(req.id, 'rejected')}
                          disabled={decidingId === req.id}
                          className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 hover:bg-red-500/20 text-xs font-semibold disabled:opacity-50 transition-all"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="rounded-2xl border border-line glass-panel p-6 text-center text-ink-3 font-mono text-sm">
          No pending WFH requests.
        </div>
      )}

      {/* Permanent WFH Toggle Section */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-3 font-mono">
          Permanent WFH Access
        </h2>
        <p className="text-xs text-ink-3 font-mono">
          Employees with permanent WFH enabled bypass the office geofence on the board every day.
        </p>
        <div className="rounded-2xl border border-line glass-panel overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[10px] font-mono font-bold uppercase tracking-widest text-ink-3">
                <th className="px-4 py-3 w-20">Code</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3 text-right">WFH Access</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-ink-3 font-mono text-xs">
                    No employees found.
                  </td>
                </tr>
              ) : (
                employees.map((emp) => (
                  <tr key={emp.id} className="border-b border-line/60 last:border-0 hover:bg-surface-2/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-ink-3 text-xs">{emp.emp_code}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{emp.full_name}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleWfh(emp.id, emp.is_wfh_enabled)}
                        disabled={saving === emp.id}
                        className={`inline-flex items-center justify-center h-8 px-4 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 ${
                          emp.is_wfh_enabled
                            ? 'bg-cyan-500/10 text-cyan-600 border border-cyan-500/20 hover:bg-cyan-500/20'
                            : 'bg-surface-2 text-ink-3 border border-line hover:bg-surface-2/80 hover:text-ink'
                        }`}
                      >
                        {saving === emp.id ? (
                          <Loader2 className="size-3.5 animate-spin mr-1.5" />
                        ) : emp.is_wfh_enabled ? (
                          <Check className="size-3.5 mr-1.5" />
                        ) : null}
                        {emp.is_wfh_enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
