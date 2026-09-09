'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Clock, Plus, Check, Trash2, Edit2, Users, Star, ArrowRight,
  ShieldCheck, AlertCircle, Search, RefreshCw, X, Calendar, Sparkles
} from 'lucide-react';
import {
  proxy,
  type ShiftTemplateRow,
  type ShiftGroupRow,
  type ShiftRosterRow,
  type ShiftGroupMemberRow,
} from '@/lib/format';
import { ConfirmDialog } from '@/components/ConfirmDialog';

const DAYS_MAP = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatErrorDetail(detail: unknown): string {
  if (!detail) return 'An unexpected error occurred';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return item.msg || item.message || JSON.stringify(item);
        }
        return String(item);
      })
      .filter(Boolean)
      .join(', ');
  }
  if (typeof detail === 'object') {
    const obj = detail as any;
    return obj.msg || obj.message || obj.detail || JSON.stringify(detail);
  }
  return String(detail);
}

export default function ShiftManagementPage() {
  const [activeTab, setActiveTab] = useState<'templates' | 'groups' | 'roster'>('templates');

  // Shifts state
  const [shifts, setShifts] = useState<ShiftTemplateRow[]>([]);
  const [defaultShiftId, setDefaultShiftId] = useState<string | null>(null);
  const [loadingShifts, setLoadingShifts] = useState(true);

  // Groups state
  const [groups, setGroups] = useState<ShiftGroupRow[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(true);

  // Roster state
  const [roster, setRoster] = useState<ShiftRosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterSourceFilter, setRosterSourceFilter] = useState<'all' | 'direct' | 'group' | 'default'>('all');

  // Employee directory for pickers
  const [allEmployees, setAllEmployees] = useState<{ id: string; emp_code: string; full_name: string }[]>([]);

  // Shift Template Modal state
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [shiftForm, setShiftForm] = useState({
    name: '',
    start_time: '09:30',
    end_time: '18:30',
    break_minutes: 60,
    grace_minutes: 15,
    half_day_after_minutes: 240,
    full_day_after_minutes: 450,
    cutover_hour: 5,
    working_days: [0, 1, 2, 3, 4, 5],
  });
  const [shiftModalSaving, setShiftModalSaving] = useState(false);
  const [shiftModalError, setShiftModalError] = useState<string | null>(null);

  // Shift Group Modal state
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupTimingMode, setGroupTimingMode] = useState<'existing' | 'custom'>('existing');
  const [customTiming, setCustomTiming] = useState({
    start_time: '10:00',
    end_time: '17:00',
    break_minutes: 60,
    grace_minutes: 15,
    working_days: [0, 1, 2, 3, 4, 5],
  });
  const [groupForm, setGroupForm] = useState({
    name: '',
    description: '',
    shift_template_id: '',
    employee_ids: [] as string[],
  });
  const [groupMemberSearch, setGroupMemberSearch] = useState('');
  const [groupModalSaving, setGroupModalSaving] = useState(false);
  const [groupModalError, setGroupModalError] = useState<string | null>(null);

  // Direct Assign Modal state
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<ShiftRosterRow | null>(null);
  const [assignTimingMode, setAssignTimingMode] = useState<'existing' | 'custom'>('existing');
  const [assignCustomTiming, setAssignCustomTiming] = useState({
    start_time: '10:00',
    end_time: '17:00',
    break_minutes: 60,
    grace_minutes: 15,
    working_days: [0, 1, 2, 3, 4, 5],
  });
  const [assignShiftId, setAssignShiftId] = useState('');
  const [assignEffectiveFrom, setAssignEffectiveFrom] = useState('');
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Status feedback toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: unknown, type: 'success' | 'error' = 'success') => {
    setToast({ message: formatErrorDetail(message), type });
    setTimeout(() => setToast(null), 4000);
  };

  // Confirmation dialog state (replaces browser confirm alert)
  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    type: 'group' | 'shift';
    id: string;
    name: string;
    busy: boolean;
  } | null>(null);

  // -------------------------------------------------------------------------
  // Data Fetching
  // -------------------------------------------------------------------------

  const fetchShifts = async () => {
    setLoadingShifts(true);
    try {
      const res = await fetch(proxy('/api/v1/admin/shifts'));
      if (res.ok) {
        const data = await res.json();
        setShifts(data.shifts || []);
        setDefaultShiftId(data.default_shift_template_id || null);
      }
    } catch {
      showToast('Could not load shift templates', 'error');
    } finally {
      setLoadingShifts(false);
    }
  };

  const fetchGroups = async () => {
    setLoadingGroups(true);
    try {
      const res = await fetch(proxy('/api/v1/admin/shifts/groups'));
      if (res.ok) {
        const data = await res.json();
        setGroups(Array.isArray(data) ? data : []);
      }
    } catch {
      showToast('Could not load shift groups', 'error');
    } finally {
      setLoadingGroups(false);
    }
  };

  const fetchRoster = async () => {
    setLoadingRoster(true);
    try {
      const res = await fetch(proxy('/api/v1/admin/shifts/roster'));
      if (res.ok) {
        const data = await res.json();
        const rows = Array.isArray(data) ? data : [];
        setRoster(rows);
        setAllEmployees(rows.map(r => ({ id: r.employee_id, emp_code: r.emp_code, full_name: r.full_name })));
      }
    } catch {
      showToast('Could not load employee roster', 'error');
    } finally {
      setLoadingRoster(false);
    }
  };

  useEffect(() => {
    fetchShifts();
    fetchGroups();
    fetchRoster();
  }, []);

  // -------------------------------------------------------------------------
  // Actions: Shifts & Org Default
  // -------------------------------------------------------------------------

  const handleSetDefaultShift = async (shiftId: string) => {
    try {
      const res = await fetch(proxy('/api/v1/admin/shifts/default'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shift_template_id: shiftId }),
      });
      if (res.ok) {
        setDefaultShiftId(shiftId);
        showToast('Default organization shift updated');
        fetchShifts();
        fetchRoster();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Could not update default shift', 'error');
      }
    } catch {
      showToast('Network error setting default shift', 'error');
    }
  };

  const openCreateShiftModal = () => {
    setEditingShiftId(null);
    setShiftForm({
      name: '',
      start_time: '09:30',
      end_time: '18:30',
      break_minutes: 60,
      grace_minutes: 15,
      half_day_after_minutes: 240,
      full_day_after_minutes: 450,
      cutover_hour: 5,
      working_days: [0, 1, 2, 3, 4, 5],
    });
    setShiftModalError(null);
    setShiftModalOpen(true);
  };

  const openEditShiftModal = (shift: ShiftTemplateRow) => {
    setEditingShiftId(shift.id);
    setShiftForm({
      name: shift.name,
      start_time: shift.start_time,
      end_time: shift.end_time,
      break_minutes: shift.break_minutes,
      grace_minutes: shift.grace_minutes,
      half_day_after_minutes: shift.half_day_after_minutes,
      full_day_after_minutes: shift.full_day_after_minutes,
      cutover_hour: shift.cutover_hour,
      working_days: shift.working_days || [0, 1, 2, 3, 4, 5],
    });
    setShiftModalError(null);
    setShiftModalOpen(true);
  };

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setShiftModalSaving(true);
    setShiftModalError(null);

    const url = editingShiftId
      ? proxy(`/api/v1/admin/shifts/${editingShiftId}`)
      : proxy('/api/v1/admin/shifts');
    const method = editingShiftId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shiftForm),
      });
      if (res.ok) {
        setShiftModalOpen(false);
        showToast(editingShiftId ? 'Shift template updated' : 'Shift template created');
        fetchShifts();
        fetchRoster();
      } else {
        const err = await res.json();
        setShiftModalError(err.detail || 'Could not save shift template');
      }
    } catch {
      setShiftModalError('Failed to communicate with server');
    } finally {
      setShiftModalSaving(false);
    }
  };

  const handleDeleteShift = (shiftId: string, shiftName: string) => {
    setConfirmDelete({
      open: true,
      type: 'shift',
      id: shiftId,
      name: shiftName,
      busy: false,
    });
  };

  // -------------------------------------------------------------------------
  // Actions: Shift Groups
  // -------------------------------------------------------------------------

  const openCreateGroupModal = () => {
    setEditingGroupId(null);
    setGroupTimingMode('existing');
    setCustomTiming({
      start_time: '10:00',
      end_time: '17:00',
      break_minutes: 60,
      grace_minutes: 15,
      working_days: [0, 1, 2, 3, 4, 5],
    });
    setGroupForm({
      name: '',
      description: '',
      shift_template_id: shifts[0]?.id || '',
      employee_ids: [],
    });
    setGroupMemberSearch('');
    setGroupModalError(null);
    setGroupModalOpen(true);
  };

  const openEditGroupModal = (group: ShiftGroupRow) => {
    setEditingGroupId(group.id);
    setGroupTimingMode('existing');
    setCustomTiming({
      start_time: group.shift_template_start || '10:00',
      end_time: group.shift_template_end || '17:00',
      break_minutes: 60,
      grace_minutes: 15,
      working_days: [0, 1, 2, 3, 4, 5],
    });
    setGroupForm({
      name: group.name,
      description: group.description || '',
      shift_template_id: group.shift_template_id,
      employee_ids: group.members.map(m => m.employee_id),
    });
    setGroupMemberSearch('');
    setGroupModalError(null);
    setGroupModalOpen(true);
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (groupTimingMode === 'existing' && !groupForm.shift_template_id) {
      setGroupModalError('Please select a shift template for this group');
      return;
    }
    if (groupTimingMode === 'custom') {
      if (!customTiming.start_time || !customTiming.end_time) {
        setGroupModalError('Please specify both start time and end time');
        return;
      }
      if (!customTiming.working_days || customTiming.working_days.length === 0) {
        setGroupModalError('Please select at least one working day');
        return;
      }
    }
    setGroupModalSaving(true);
    setGroupModalError(null);

    let templateId = groupForm.shift_template_id;

    // If Custom Timing chosen, automatically create the new shift template on the fly!
    if (groupTimingMode === 'custom') {
      const shiftName = `${groupForm.name.trim() || 'Custom'} (${customTiming.start_time}-${customTiming.end_time})`;
      try {
        const createShiftRes = await fetch(proxy('/api/v1/admin/shifts'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: shiftName,
            start_time: customTiming.start_time,
            end_time: customTiming.end_time,
            break_minutes: customTiming.break_minutes,
            grace_minutes: customTiming.grace_minutes,
            half_day_after_minutes: 240,
            full_day_after_minutes: 450,
            cutover_hour: 5,
            working_days: customTiming.working_days,
          }),
        });

        if (!createShiftRes.ok) {
          const err = await createShiftRes.json().catch(() => null);
          setGroupModalError(err?.detail || 'Could not create custom shift template');
          setGroupModalSaving(false);
          return;
        }

        const createdShift = await createShiftRes.json();
        templateId = createdShift.id;
        fetchShifts();
      } catch {
        setGroupModalError('Failed to create custom shift template');
        setGroupModalSaving(false);
        return;
      }
    }

    const url = editingGroupId
      ? proxy(`/api/v1/admin/shifts/groups/${editingGroupId}`)
      : proxy('/api/v1/admin/shifts/groups');
    const method = editingGroupId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...groupForm,
          shift_template_id: templateId,
        }),
      });
      if (res.ok) {
        setGroupModalOpen(false);
        showToast(editingGroupId ? 'Shift group updated' : 'Shift group created with custom timing');
        fetchGroups();
        fetchRoster();
      } else {
        const err = await res.json();
        setGroupModalError(err.detail || 'Could not save shift group');
      }
    } catch {
      setGroupModalError('Failed to communicate with server');
    } finally {
      setGroupModalSaving(false);
    }
  };

  const handleDeleteGroup = (groupId: string, groupName: string) => {
    setConfirmDelete({
      open: true,
      type: 'group',
      id: groupId,
      name: groupName,
      busy: false,
    });
  };

  // -------------------------------------------------------------------------
  // Actions: Employee Roster & Direct Assignments
  // -------------------------------------------------------------------------

  const openAssignModal = (employee: ShiftRosterRow) => {
    setAssignTarget(employee);
    setAssignTimingMode('existing');
    setAssignCustomTiming({
      start_time: employee.effective_shift_start || '10:00',
      end_time: employee.effective_shift_end || '17:00',
      break_minutes: 60,
      grace_minutes: 15,
      working_days: [0, 1, 2, 3, 4, 5],
    });
    setAssignShiftId(employee.effective_shift_id || shifts[0]?.id || '');
    setAssignEffectiveFrom(new Date().toISOString().slice(0, 10));
    setAssignError(null);
    setAssignModalOpen(true);
  };

  const handleSaveDirectAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTarget) return;

    if (assignTimingMode === 'existing' && !assignShiftId) {
      setAssignError('Please select a shift template');
      return;
    }
    if (assignTimingMode === 'custom') {
      if (!assignCustomTiming.start_time || !assignCustomTiming.end_time) {
        setAssignError('Please specify both start time and end time');
        return;
      }
      if (!assignCustomTiming.working_days || assignCustomTiming.working_days.length === 0) {
        setAssignError('Please select at least one working day');
        return;
      }
    }

    setAssignSaving(true);
    setAssignError(null);

    let templateId = assignShiftId;

    if (assignTimingMode === 'custom') {
      const shiftName = `${assignTarget.full_name} (${assignCustomTiming.start_time}-${assignCustomTiming.end_time})`;
      try {
        const createShiftRes = await fetch(proxy('/api/v1/admin/shifts'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: shiftName,
            start_time: assignCustomTiming.start_time,
            end_time: assignCustomTiming.end_time,
            break_minutes: assignCustomTiming.break_minutes,
            grace_minutes: assignCustomTiming.grace_minutes,
            half_day_after_minutes: 240,
            full_day_after_minutes: 450,
            cutover_hour: 5,
            working_days: assignCustomTiming.working_days,
          }),
        });

        if (!createShiftRes.ok) {
          const err = await createShiftRes.json().catch(() => null);
          setAssignError(err?.detail || 'Could not create custom shift template');
          setAssignSaving(false);
          return;
        }

        const createdShift = await createShiftRes.json();
        templateId = createdShift.id;
        fetchShifts();
      } catch {
        setAssignError('Failed to create custom shift template');
        setAssignSaving(false);
        return;
      }
    }

    try {
      const res = await fetch(proxy('/api/v1/admin/shifts/assign'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: assignTarget.employee_id,
          shift_template_id: templateId,
          effective_from: assignEffectiveFrom || undefined,
        }),
      });
      if (res.ok) {
        setAssignModalOpen(false);
        showToast(`Direct shift assigned to ${assignTarget.full_name}`);
        fetchRoster();
      } else {
        const err = await res.json();
        setAssignError(err.detail || 'Could not assign shift');
      }
    } catch {
      setAssignError('Failed to communicate with server');
    } finally {
      setAssignSaving(false);
    }
  };

  const handleClearDirectAssign = async (employee: ShiftRosterRow) => {
    if (!confirm(`Reset direct shift override for ${employee.full_name}? They will inherit group or organization default.`)) return;
    try {
      const res = await fetch(proxy(`/api/v1/admin/shifts/assign/${employee.employee_id}`), {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast(`Override cleared for ${employee.full_name}`);
        fetchRoster();
      } else {
        const err = await res.json();
        showToast(err.detail || 'Could not clear shift override', 'error');
      }
    } catch {
      showToast('Network error clearing shift override', 'error');
    }
  };

  // -------------------------------------------------------------------------
  // Filtered Roster
  // -------------------------------------------------------------------------

  const filteredRoster = useMemo(() => {
    return roster.filter(row => {
      const matchesSearch =
        row.full_name.toLowerCase().includes(rosterSearch.toLowerCase()) ||
        row.emp_code.toLowerCase().includes(rosterSearch.toLowerCase()) ||
        (row.department && row.department.toLowerCase().includes(rosterSearch.toLowerCase()));

      const matchesSource =
        rosterSourceFilter === 'all' || row.source === rosterSourceFilter;

      return matchesSearch && matchesSource;
    });
  }, [roster, rosterSearch, rosterSourceFilter]);

  // Filtered employees for Group Member selection
  const filteredEmployeesForGroup = useMemo(() => {
    if (!groupMemberSearch) return allEmployees;
    const q = groupMemberSearch.toLowerCase();
    return allEmployees.filter(
      e => e.full_name.toLowerCase().includes(q) || e.emp_code.toLowerCase().includes(q)
    );
  }, [allEmployees, groupMemberSearch]);

  return (
    <div className="space-y-6 fade-in-up pb-12">
      {/* Toast Feedback */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold backdrop-blur-md transition-all ${
            toast.type === 'error'
              ? 'bg-rose-950/80 border-rose-500/40 text-rose-200'
              : 'bg-emerald-950/80 border-emerald-500/40 text-emerald-200'
          }`}
        >
          {toast.type === 'error' ? <AlertCircle className="size-4 text-rose-400" /> : <Check className="size-4 text-emerald-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-semibold uppercase tracking-widest text-ink-3">
            <Clock className="size-4 text-ink-2" />
            <span>Workforce Management · PRD Phase 5</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-black uppercase tracking-tight text-ink mt-1">
            Shift Management Hub
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-ink-3 font-mono">
            Deterministic shift resolution: Direct Override → Shift Group → Org Default
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 rounded-2xl glass-panel border border-line">
          <button
            onClick={() => setActiveTab('templates')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'templates'
                ? 'bg-surface-2 text-ink shadow-sm border border-line'
                : 'text-ink-3 hover:text-ink hover:bg-surface-2/40'
            }`}
          >
            <Clock className="size-3.5" />
            <span>Shifts & Default</span>
            <span className="ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-surface-3 text-ink-2">
              {shifts.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('groups')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'groups'
                ? 'bg-surface-2 text-ink shadow-sm border border-line'
                : 'text-ink-3 hover:text-ink hover:bg-surface-2/40'
            }`}
          >
            <Users className="size-3.5" />
            <span>Shift Groups</span>
            <span className="ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-surface-3 text-ink-2">
              {groups.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('roster')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'roster'
                ? 'bg-surface-2 text-ink shadow-sm border border-line'
                : 'text-ink-3 hover:text-ink hover:bg-surface-2/40'
            }`}
          >
            <ShieldCheck className="size-3.5" />
            <span>Employee Roster</span>
            <span className="ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-surface-3 text-ink-2">
              {roster.length}
            </span>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------------- */}
      {/* TAB 1: SHIFTS & ORG DEFAULT                                         */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'templates' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-ink font-mono">
                Organization Shift Templates
              </h2>
              <p className="text-xs text-ink-3 font-mono mt-0.5">
                Configure timing schedules and declare the company-wide default shift.
              </p>
            </div>
            <button
              onClick={openCreateShiftModal}
              className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-xs font-bold text-ground hover:opacity-90 transition-all shadow-sm"
            >
              <Plus className="size-3.5" />
              <span>Create Shift</span>
            </button>
          </div>

          {loadingShifts ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-48 rounded-2xl glass-panel border border-line animate-pulse" />
              ))}
            </div>
          ) : shifts.length === 0 ? (
            <div className="rounded-2xl glass-panel border border-line p-8 text-center text-ink-3">
              <Clock className="size-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No shift templates configured yet.</p>
              <button
                onClick={openCreateShiftModal}
                className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink hover:bg-surface-3"
              >
                <Plus className="size-3" />
                <span>Add Your First Shift</span>
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shifts.map(shift => {
                const isDefault = shift.id === defaultShiftId || shift.is_default;
                return (
                  <div
                    key={shift.id}
                    className={`rounded-2xl glass-panel border p-5 transition-all duration-300 flex flex-col justify-between relative group ${
                      isDefault
                        ? 'border-amber-500/50 bg-amber-500/5 shadow-md shadow-amber-500/5'
                        : 'border-line hover:bg-surface-2/40'
                    }`}
                  >
                    <div>
                      {/* Badge bar */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="text-xs font-mono font-bold uppercase tracking-wider text-ink">
                          {shift.name}
                        </span>
                        {isDefault ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-500 border border-amber-500/30">
                            <Star className="size-3 fill-amber-500" />
                            <span>Org Default</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleSetDefaultShift(shift.id)}
                            className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-ink-3 hover:text-amber-400 hover:underline transition-all"
                          >
                            Set as default
                          </button>
                        )}
                      </div>

                      {/* Main Timing */}
                      <div className="text-2xl font-black font-display text-ink tracking-tight">
                        {shift.start_time} — {shift.end_time}
                      </div>

                      {/* Parameters Grid */}
                      <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-line/60 text-xs">
                        <div>
                          <span className="text-[10px] font-mono text-ink-3 uppercase block">Break</span>
                          <span className="font-semibold text-ink font-mono">{shift.break_minutes} min</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-mono text-ink-3 uppercase block">Grace</span>
                          <span className="font-semibold text-ink font-mono">{shift.grace_minutes} min</span>
                        </div>
                      </div>

                      {/* Working Days */}
                      <div className="mt-3">
                        <span className="text-[10px] font-mono text-ink-3 uppercase block mb-1">Working Days</span>
                        <div className="flex gap-1">
                          {DAYS_MAP.map((day, idx) => {
                            const active = (shift.working_days || []).includes(idx);
                            return (
                              <span
                                key={day}
                                className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                                  active
                                    ? 'bg-surface-3 text-ink font-bold border border-line'
                                    : 'text-ink-3/40 bg-surface-2/20'
                                }`}
                              >
                                {day[0]}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="mt-6 pt-3 border-t border-line flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditShiftModal(shift)}
                          className="p-1.5 rounded-lg border border-line bg-surface-2 text-ink-2 hover:text-ink hover:bg-surface-3 transition-all"
                          title="Edit Shift"
                        >
                          <Edit2 className="size-3.5" />
                        </button>
                        {!isDefault && (
                          <button
                            onClick={() => handleDeleteShift(shift.id, shift.name)}
                            className="p-1.5 rounded-lg border border-line bg-surface-2 text-ink-3 hover:text-rose-400 hover:border-rose-500/40 transition-all"
                            title="Delete Shift"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>

                      {!isDefault && (
                        <button
                          onClick={() => handleSetDefaultShift(shift.id)}
                          className="text-xs font-semibold text-ink-2 hover:text-ink flex items-center gap-1"
                        >
                          <span>Make Default</span>
                          <ArrowRight className="size-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 2: SHIFT GROUPS                                                 */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'groups' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-ink font-mono">
                Department & Team Shift Groups
              </h2>
              <p className="text-xs text-ink-3 font-mono mt-0.5">
                Assign specific shifts to groups of employees with multi-checkbox selection (PRD §8.4).
              </p>
            </div>
            <button
              onClick={openCreateGroupModal}
              className="flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-xs font-bold text-ground hover:opacity-90 transition-all shadow-sm"
            >
              <Plus className="size-3.5" />
              <span>Create Shift Group</span>
            </button>
          </div>

          {loadingGroups ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {[1, 2].map(i => (
                <div key={i} className="h-44 rounded-2xl glass-panel border border-line animate-pulse" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-2xl glass-panel border border-line p-8 text-center text-ink-3">
              <Users className="size-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm font-medium">No shift groups created yet.</p>
              <p className="text-xs font-mono mt-1 text-ink-3">
                Groups allow assigning a night, evening, or weekend schedule to multiple employees at once.
              </p>
              <button
                onClick={openCreateGroupModal}
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink hover:bg-surface-3"
              >
                <Plus className="size-3" />
                <span>Create Group</span>
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map(group => (
                <div
                  key={group.id}
                  className="rounded-2xl glass-panel border border-line p-5 hover:bg-surface-2/40 transition-all duration-300 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold text-ink text-base">{group.name}</h3>
                        {group.description && (
                          <p className="text-xs text-ink-3 font-mono mt-0.5">{group.description}</p>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold px-2.5 py-1 rounded-xl bg-surface-3 border border-line text-ink">
                        <Clock className="size-3 text-ink-2" />
                        <span>{group.shift_template_name}</span>
                        <span className="text-[10px] text-ink-3 font-normal">
                          ({group.shift_template_start}–{group.shift_template_end})
                        </span>
                      </span>
                    </div>

                    <div className="mt-4 pt-3 border-t border-line/60">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-mono uppercase text-ink-3">
                          Assigned Members ({group.member_count})
                        </span>
                      </div>
                      {group.members.length === 0 ? (
                        <p className="text-xs text-ink-3 font-mono italic">No members assigned to this group yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto bx-scroll">
                          {group.members.map(m => (
                            <span
                              key={m.employee_id}
                              className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-lg bg-surface-2 border border-line text-ink"
                            >
                              <span>{m.full_name}</span>
                              <span className="text-ink-3 text-[9px]">({m.emp_code})</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-line flex items-center justify-end gap-2">
                    <button
                      onClick={() => openEditGroupModal(group)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface-2 text-xs font-semibold text-ink hover:bg-surface-3 transition-all"
                    >
                      <Edit2 className="size-3" />
                      <span>Edit & Members</span>
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.id, group.name)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface-2 text-xs font-semibold text-ink-3 hover:text-rose-400 hover:border-rose-500/30 transition-all"
                    >
                      <Trash2 className="size-3" />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* TAB 3: EMPLOYEE ROSTER                                              */}
      {/* ------------------------------------------------------------------- */}
      {activeTab === 'roster' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-ink font-mono">
                Employee Shift Roster & Effective Policy
              </h2>
              <p className="text-xs text-ink-3 font-mono mt-0.5">
                Displays resolved shift for every employee according to PRD §8.5 hierarchy.
              </p>
            </div>

            <button
              onClick={fetchRoster}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface-2 text-xs font-mono text-ink-3 hover:text-ink hover:bg-surface-3 transition-all"
            >
              <RefreshCw className="size-3" />
              <span>Refresh</span>
            </button>
          </div>

          {/* Search and Filters Bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-2xl glass-panel border border-line">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="text"
                placeholder="Search employee name, code, or department..."
                value={rosterSearch}
                onChange={e => setRosterSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-line bg-surface-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-1 focus:ring-ink"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-mono text-ink-3">Source:</label>
              <select
                value={rosterSourceFilter}
                onChange={e => setRosterSourceFilter(e.target.value as any)}
                className="rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink font-mono"
              >
                <option value="all">All Sources</option>
                <option value="direct">Direct Override</option>
                <option value="group">Group Shift</option>
                <option value="default">Org Default</option>
              </select>
            </div>
          </div>

          {/* Table */}
          {loadingRoster ? (
            <div className="rounded-2xl glass-panel border border-line p-8 text-center text-ink-3 font-mono text-xs animate-pulse">
              Computing deterministic shift roster...
            </div>
          ) : filteredRoster.length === 0 ? (
            <div className="rounded-2xl glass-panel border border-line p-8 text-center text-ink-3 font-mono text-xs">
              No employees matched the current filters.
            </div>
          ) : (
            <div className="rounded-2xl glass-panel border border-line overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-surface-2/40 text-[10px] font-mono uppercase tracking-wider text-ink-3">
                      <th className="py-3 px-4">Employee</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Effective Shift</th>
                      <th className="py-3 px-4">Source & Priority</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/60">
                    {filteredRoster.map(row => {
                      const isDirect = row.source === 'direct';
                      const isGroup = row.source === 'group';

                      return (
                        <tr key={row.employee_id} className="hover:bg-surface-2/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-ink">{row.full_name}</div>
                            <div className="text-[10px] font-mono text-ink-3">
                              {row.emp_code} {row.designation ? `· ${row.designation}` : ''}
                            </div>
                          </td>

                          <td className="py-3 px-4 text-ink-2 font-mono">
                            {row.department || '—'}
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-bold text-ink flex items-center gap-1.5">
                              <span>{row.effective_shift_name}</span>
                            </div>
                            <div className="text-[11px] font-mono text-ink-3">
                              {row.effective_shift_start} — {row.effective_shift_end}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            {isDirect ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                                <span>Direct Override</span>
                              </span>
                            ) : isGroup ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                <span>Group: {row.group_name}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-surface-3 text-ink-3 border border-line">
                                <span>Org Default</span>
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openAssignModal(row)}
                                className="px-2.5 py-1 rounded-lg border border-line bg-surface-2 text-ink hover:bg-surface-3 text-[11px] font-medium transition-all"
                              >
                                {isDirect ? 'Change Override' : 'Assign Override'}
                              </button>
                              {isDirect && (
                                <button
                                  onClick={() => handleClearDirectAssign(row)}
                                  className="px-2 py-1 rounded-lg border border-line text-ink-3 hover:text-rose-400 hover:border-rose-500/30 text-[11px] transition-all"
                                  title="Reset to Group or Default"
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT SHIFT TEMPLATE                                 */}
      {/* ------------------------------------------------------------------- */}
      {shiftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ground/80 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl glass-panel border border-line bg-surface p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-display text-lg font-black uppercase tracking-tight text-ink">
                {editingShiftId ? 'Edit Shift Template' : 'Create New Shift Template'}
              </h3>
              <button
                onClick={() => setShiftModalOpen(false)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            {shiftModalError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                {shiftModalError}
              </div>
            )}

            <form onSubmit={handleSaveShift} className="space-y-4 text-xs">
              <div>
                <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                  Shift Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Morning Shift, Night Shift, General"
                  value={shiftForm.name}
                  onChange={e => setShiftForm({ ...shiftForm, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                    Start Time (HH:MM) *
                  </label>
                  <input
                    type="time"
                    required
                    value={shiftForm.start_time}
                    onChange={e => setShiftForm({ ...shiftForm, start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink font-mono"
                  />
                </div>
                <div>
                  <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                    End Time (HH:MM) *
                  </label>
                  <input
                    type="time"
                    required
                    value={shiftForm.end_time}
                    onChange={e => setShiftForm({ ...shiftForm, end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                    Break Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={shiftForm.break_minutes}
                    onChange={e => setShiftForm({ ...shiftForm, break_minutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink font-mono"
                  />
                </div>
                <div>
                  <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                    Grace Period (Minutes)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={shiftForm.grace_minutes}
                    onChange={e => setShiftForm({ ...shiftForm, grace_minutes: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1.5">
                  Working Days
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS_MAP.map((day, idx) => {
                    const isSelected = shiftForm.working_days.includes(idx);
                    return (
                      <button
                        type="button"
                        key={day}
                        onClick={() => {
                          const next = isSelected
                            ? shiftForm.working_days.filter(d => d !== idx)
                            : [...shiftForm.working_days, idx].sort();
                          setShiftForm({ ...shiftForm, working_days: next });
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition-all ${
                          isSelected
                            ? 'bg-ink text-ground border-ink'
                            : 'bg-surface-2 text-ink-3 border-line hover:text-ink'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-line flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShiftModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-line bg-surface-2 text-ink-3 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={shiftModalSaving}
                  className="px-5 py-2 rounded-xl bg-ink text-ground font-bold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {shiftModalSaving ? 'Saving...' : editingShiftId ? 'Update Shift' : 'Create Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL: CREATE / EDIT SHIFT GROUP                                    */}
      {/* ------------------------------------------------------------------- */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ground/80 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl glass-panel border border-line bg-surface p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-display text-lg font-black uppercase tracking-tight text-ink">
                {editingGroupId ? 'Edit Shift Group' : 'Create New Shift Group'}
              </h3>
              <button
                onClick={() => setGroupModalOpen(false)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            {groupModalError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                {groupModalError}
              </div>
            )}

            <form onSubmit={handleSaveGroup} className="space-y-4 text-xs flex-1 flex flex-col overflow-y-auto bx-scroll pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                    Group Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Interns, Night Support, Ops"
                    value={groupForm.name}
                    onChange={e => setGroupForm({ ...groupForm, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink"
                  />
                </div>

                <div>
                  <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                    Description (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 3-month engineering interns"
                    value={groupForm.description}
                    onChange={e => setGroupForm({ ...groupForm, description: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink"
                  />
                </div>
              </div>

              {/* Timing Mode Toggle & Inputs */}
              <div className="border border-line rounded-2xl p-3.5 bg-surface-2/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-ink text-[10px] uppercase font-bold flex items-center gap-1.5">
                    <Clock className="size-3.5 text-ink-2" />
                    Shift Schedule & Timing *
                  </span>
                  <div className="flex bg-surface-2 p-0.5 rounded-xl border border-line text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() => setGroupTimingMode('existing')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        groupTimingMode === 'existing'
                          ? 'bg-ink text-ground font-bold shadow-sm'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      Existing Template
                    </button>
                    <button
                      type="button"
                      onClick={() => setGroupTimingMode('custom')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 ${
                        groupTimingMode === 'custom'
                          ? 'bg-ink text-ground font-bold shadow-sm'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      <Sparkles className="size-3" />
                      Set Custom Timing
                    </button>
                  </div>
                </div>

                {groupTimingMode === 'existing' ? (
                  <div>
                    <select
                      value={groupForm.shift_template_id}
                      onChange={e => setGroupForm({ ...groupForm, shift_template_id: e.target.value })}
                      className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                    >
                      <option value="">Select shift template...</option>
                      {shifts.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.start_time} - {s.end_time})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          Start Time (HH:MM) *
                        </label>
                        <input
                          type="time"
                          required
                          value={customTiming.start_time}
                          onChange={e => setCustomTiming({ ...customTiming, start_time: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          End Time (HH:MM) *
                        </label>
                        <input
                          type="time"
                          required
                          value={customTiming.end_time}
                          onChange={e => setCustomTiming({ ...customTiming, end_time: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          Break (Minutes)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={customTiming.break_minutes}
                          onChange={e => setCustomTiming({ ...customTiming, break_minutes: Number(e.target.value) })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          Grace Period (Minutes)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={customTiming.grace_minutes}
                          onChange={e => setCustomTiming({ ...customTiming, grace_minutes: Number(e.target.value) })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                        Working Days ({customTiming.working_days.length} selected)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS_MAP.map((day, idx) => {
                          const isSelected = customTiming.working_days.includes(idx);
                          return (
                            <button
                              type="button"
                              key={day}
                              onClick={() => {
                                const next = isSelected
                                  ? customTiming.working_days.filter(d => d !== idx)
                                  : [...customTiming.working_days, idx].sort();
                                setCustomTiming({ ...customTiming, working_days: next });
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border transition-all ${
                                isSelected
                                  ? 'bg-ink text-ground border-ink'
                                  : 'bg-surface text-ink-3 border-line hover:text-ink'
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Multi-Employee Checkbox Selection (PRD §8.4) */}
              <div className="flex-1 flex flex-col border border-line rounded-2xl p-3 bg-surface-2/30 overflow-hidden">
                <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-line">
                  <span className="font-mono text-ink text-[10px] uppercase font-bold">
                    Select Member Employees ({groupForm.employee_ids.length} selected)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setGroupForm({
                          ...groupForm,
                          employee_ids: allEmployees.map(e => e.id),
                        })
                      }
                      className="text-[10px] font-mono text-ink-2 hover:underline"
                    >
                      Select All
                    </button>
                    <span className="text-ink-3">·</span>
                    <button
                      type="button"
                      onClick={() => setGroupForm({ ...groupForm, employee_ids: [] })}
                      className="text-[10px] font-mono text-ink-2 hover:underline"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="relative mb-2">
                  <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                  <input
                    type="text"
                    placeholder="Search employees..."
                    value={groupMemberSearch}
                    onChange={e => setGroupMemberSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-line bg-surface text-xs text-ink"
                  />
                </div>

                <div className="flex-1 overflow-y-auto bx-scroll divide-y divide-line/40 max-h-48 pr-1">
                  {filteredEmployeesForGroup.map(emp => {
                    const isChecked = groupForm.employee_ids.includes(emp.id);
                    return (
                      <label
                        key={emp.id}
                        className="flex items-center justify-between py-2 px-2 hover:bg-surface rounded-lg cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => {
                              const next = e.target.checked
                                ? [...groupForm.employee_ids, emp.id]
                                : groupForm.employee_ids.filter(id => id !== emp.id);
                              setGroupForm({ ...groupForm, employee_ids: next });
                            }}
                            className="rounded border-line text-ink focus:ring-ink"
                          />
                          <span className="font-medium text-ink">{emp.full_name}</span>
                        </div>
                        <span className="font-mono text-[10px] text-ink-3">{emp.emp_code}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="pt-3 border-t border-line flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setGroupModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-line bg-surface-2 text-ink-3 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={groupModalSaving}
                  className="px-5 py-2 rounded-xl bg-ink text-ground font-bold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {groupModalSaving ? 'Saving...' : editingGroupId ? 'Update Group' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* MODAL: DIRECT SHIFT ASSIGNMENT OVERRIDE                             */}
      {/* ------------------------------------------------------------------- */}
      {assignModalOpen && assignTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ground/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl glass-panel border border-line bg-surface p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="font-display text-lg font-black uppercase tracking-tight text-ink">
                  Direct Shift Override
                </h3>
                <p className="text-xs font-mono text-ink-3 mt-0.5">
                  Assign custom shift schedule to {assignTarget.full_name} ({assignTarget.emp_code})
                </p>
              </div>
              <button
                onClick={() => setAssignModalOpen(false)}
                className="p-1 rounded-lg text-ink-3 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            {assignError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
                {assignError}
              </div>
            )}

            <form onSubmit={handleSaveDirectAssign} className="space-y-4 text-xs max-h-[85vh] overflow-y-auto bx-scroll pr-1">
              {/* Timing Mode Toggle & Inputs */}
              <div className="border border-line rounded-2xl p-3.5 bg-surface-2/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-ink text-[10px] uppercase font-bold flex items-center gap-1.5">
                    <Clock className="size-3.5 text-ink-2" />
                    Shift Schedule & Timing *
                  </span>
                  <div className="flex bg-surface-2 p-0.5 rounded-xl border border-line text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() => setAssignTimingMode('existing')}
                      className={`px-3 py-1 rounded-lg transition-all ${
                        assignTimingMode === 'existing'
                          ? 'bg-ink text-ground font-bold shadow-sm'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      Existing
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignTimingMode('custom')}
                      className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 ${
                        assignTimingMode === 'custom'
                          ? 'bg-ink text-ground font-bold shadow-sm'
                          : 'text-ink-2 hover:text-ink'
                      }`}
                    >
                      <Sparkles className="size-3" />
                      Custom
                    </button>
                  </div>
                </div>

                {assignTimingMode === 'existing' ? (
                  <div>
                    <select
                      value={assignShiftId}
                      onChange={e => setAssignShiftId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                    >
                      <option value="">Select shift template...</option>
                      {shifts.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.start_time} - {s.end_time}) {s.id === defaultShiftId ? '— Org Default' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          Start Time (HH:MM) *
                        </label>
                        <input
                          type="time"
                          required
                          value={assignCustomTiming.start_time}
                          onChange={e => setAssignCustomTiming({ ...assignCustomTiming, start_time: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          End Time (HH:MM) *
                        </label>
                        <input
                          type="time"
                          required
                          value={assignCustomTiming.end_time}
                          onChange={e => setAssignCustomTiming({ ...assignCustomTiming, end_time: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          Break (Minutes)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={assignCustomTiming.break_minutes}
                          onChange={e => setAssignCustomTiming({ ...assignCustomTiming, break_minutes: Number(e.target.value) })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                      <div>
                        <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                          Grace Period (Minutes)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={assignCustomTiming.grace_minutes}
                          onChange={e => setAssignCustomTiming({ ...assignCustomTiming, grace_minutes: Number(e.target.value) })}
                          className="w-full px-3 py-2 rounded-xl border border-line bg-surface text-ink font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                        Working Days ({assignCustomTiming.working_days.length} selected)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {DAYS_MAP.map((day, idx) => {
                          const isSelected = assignCustomTiming.working_days.includes(idx);
                          return (
                            <button
                              type="button"
                              key={day}
                              onClick={() => {
                                const next = isSelected
                                  ? assignCustomTiming.working_days.filter(d => d !== idx)
                                  : [...assignCustomTiming.working_days, idx].sort();
                                setAssignCustomTiming({ ...assignCustomTiming, working_days: next });
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border transition-all ${
                                isSelected
                                  ? 'bg-ink text-ground border-ink'
                                  : 'bg-surface text-ink-3 border-line hover:text-ink'
                              }`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="font-mono text-ink-2 uppercase text-[10px] block mb-1">
                  Effective From Date *
                </label>
                <input
                  type="date"
                  required
                  value={assignEffectiveFrom}
                  onChange={e => setAssignEffectiveFrom(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-line bg-surface-2 text-ink font-mono"
                />
              </div>

              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-amber-400" />
                  <span>Deterministic Hierarchy Rule</span>
                </div>
                <p className="text-ink-2">
                  This direct assignment takes highest priority and overrides both any Shift Group the employee is in and the organization default shift.
                </p>
              </div>

              <div className="pt-3 border-t border-line flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-line bg-surface-2 text-ink-3 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignSaving}
                  className="px-5 py-2 rounded-xl bg-ink text-ground font-bold hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {assignSaving ? 'Saving...' : 'Apply Direct Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sleek in-app deletion confirmation dialog (replaces browser confirm) */}
      {confirmDelete && (
        <ConfirmDialog
          open={confirmDelete.open}
          title={confirmDelete.type === 'group' ? 'Delete Shift Group' : 'Delete Shift Template'}
          consequence={
            confirmDelete.type === 'group'
              ? `Are you sure you want to delete shift group "${confirmDelete.name}"? All member employees will automatically revert to the organization default shift, and an update will be delivered directly to their inbox.`
              : `Are you sure you want to delete shift template "${confirmDelete.name}"? This cannot be undone.`
          }
          confirmLabel={confirmDelete.type === 'group' ? 'Delete Group' : 'Delete Shift'}
          tone="danger"
          busy={confirmDelete.busy}
          onClose={() => setConfirmDelete(null)}
          onConfirm={async () => {
            if (confirmDelete.type === 'group') {
              setConfirmDelete({ ...confirmDelete, busy: true });
              try {
                const res = await fetch(proxy(`/api/v1/admin/shifts/groups/${confirmDelete.id}`), {
                  method: 'DELETE',
                });
                if (res.ok) {
                  showToast(`Shift group "${confirmDelete.name}" deleted`);
                  fetchGroups();
                  fetchRoster();
                  setConfirmDelete(null);
                } else {
                  const err = await res.json().catch(() => null);
                  showToast(formatErrorDetail(err?.detail || 'Could not delete shift group'), 'error');
                  setConfirmDelete(null);
                }
              } catch {
                showToast('Network error deleting shift group', 'error');
                setConfirmDelete(null);
              }
            } else {
              setConfirmDelete({ ...confirmDelete, busy: true });
              try {
                const res = await fetch(proxy(`/api/v1/admin/shifts/${confirmDelete.id}`), {
                  method: 'DELETE',
                });
                if (res.ok) {
                  showToast(`Shift "${confirmDelete.name}" deleted`);
                  fetchShifts();
                  fetchRoster();
                  setConfirmDelete(null);
                } else {
                  const err = await res.json().catch(() => null);
                  showToast(formatErrorDetail(err?.detail || 'Could not delete shift'), 'error');
                  setConfirmDelete(null);
                }
              } catch {
                showToast('Network error deleting shift', 'error');
                setConfirmDelete(null);
              }
            }
          }}
        />
      )}
    </div>
  );
}
