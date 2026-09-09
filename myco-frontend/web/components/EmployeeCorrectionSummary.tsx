'use client';

import { useState } from 'react';
import { Status } from '@/components/Status';
import { plainDate } from '@/lib/format';
import { HoverProfile } from '@/components/HoverProfile';

export function EmployeeCorrectionSummary({
  summary,
}: {
  summary: any[];
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (!summary || summary.length === 0) {
    return <div className="text-sm text-ink-3">No employees found.</div>;
  }

  return (
    <div className="space-y-4">
      {summary.map((emp) => {
        const isExpanded = expandedRow === emp.employee_code;
        return (
          <div key={emp.employee_code} className="rounded-xl border border-line bg-surface-2 overflow-hidden">
            <div 
              className="flex justify-between items-center p-4 cursor-pointer hover:bg-surface-3 transition-colors"
              onClick={() => setExpandedRow(isExpanded ? null : emp.employee_code)}
            >
              <div>
                <HoverProfile data={{ name: emp.employee_name, code: emp.employee_code }}>
                  <div className="text-sm font-bold text-ink inline-block">{emp.employee_name}</div>
                </HoverProfile>
                <div className="text-xs text-ink-3 font-mono mt-1">{emp.employee_code}</div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1">
                    Monthly Used
                  </div>
                  <div className="text-sm font-mono font-medium">
                    <span className={emp.used_corrections >= emp.correction_limit ? 'text-red-500' : 'text-ink'}>
                      {emp.used_corrections}
                    </span>
                    <span className="text-ink-3 mx-1">/</span>
                    <span className="text-ink-3">{emp.correction_limit}</span>
                  </div>
                </div>
                
                <div className="text-ink-3">
                  {isExpanded ? '▲' : '▼'}
                </div>
              </div>
            </div>
            
            {isExpanded && (
              <div className="border-t border-line bg-ground p-4">
                {emp.requests.length === 0 ? (
                  <div className="text-xs text-ink-3 py-2">No correction requests found for this employee.</div>
                ) : (
                  <div className="space-y-4">
                    {emp.requests.map((r: any) => (
                      <div key={r.id} className="flex flex-col gap-2 p-3 rounded-lg border border-line/50">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="text-sm font-bold text-ink">{plainDate(r.shift_date)}</div>
                            <div className="flex gap-2 mt-1">
                              <span className="text-xs font-mono font-medium text-ink-2 bg-surface-2 px-2 py-0.5 rounded-md">
                                {r.direction === 'in' ? 'Check-in' : 'Check-out'}
                              </span>
                              <span className="text-xs font-mono font-medium text-ink-2 bg-surface-2 px-2 py-0.5 rounded-md">
                                {new Date(r.claimed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                          <Status value={r.status} isRegularized={r.is_regularized} />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                          <div className="bg-surface-2 p-3 rounded-lg">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1">Employee Explanation</div>
                            <div className="text-xs font-medium text-ink mb-1">{r.category || 'Other'}</div>
                            <div className="text-xs text-ink-2">{r.reason}</div>
                          </div>
                          
                          {(r.decided_note || r.decided_at) && (
                            <div className="bg-surface-2 p-3 rounded-lg">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-ink-3 mb-1">HR Decision</div>
                              <div className="text-xs text-ink-2">{r.decided_note || 'No note provided'}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
