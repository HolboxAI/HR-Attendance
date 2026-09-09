'use client';

import { useState } from 'react';
import { MapPin, X, Navigation } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import { proxy } from '@/lib/format';

export function LocationDetailDialog({ employeeCode, date }: { employeeCode: string, date?: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{lat: number, lng: number, captured_at: string} | null>(null);
  const searchParams = useSearchParams();

  const fetchLocation = async () => {
    setOpen(true);
    setLoading(true);
    
    // Fallback to URL date or today if not provided explicitly
    const shiftDate = date || searchParams.get('on') || new Date().toISOString().split('T')[0];
    
    try {
      const res = await fetch(proxy(`/api/v1/admin/board/wfh-location?employee_code=${employeeCode}&shift_date=${shiftDate}`));
      if (res.ok) {
        const body = await res.json();
        setData(body.lat ? body : null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          fetchLocation();
        }}
        className="ml-2 inline-flex items-center justify-center p-1 rounded hover:bg-surface-2 text-cyan-600 hover:text-cyan-700 transition-colors"
        title="View GPS Location"
      >
        <MapPin className="size-3.5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div 
            className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-xl border border-line"
            onClick={e => e.stopPropagation()} // Prevent click from bubbling up to row link
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-bold text-ink flex items-center gap-2">
                <Navigation className="size-5 text-cyan-600" />
                WFH Check-in Location
              </h3>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-md text-ink-3 hover:bg-surface-2 transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm font-mono text-ink-3">Loading coordinates...</div>
            ) : data ? (
              <div className="space-y-4">
                <div className="bg-surface-2 p-3 rounded-xl border border-line space-y-1">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-ink-3">Latitude:</span>
                    <span className="text-ink font-semibold">{data.lat.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-ink-3">Longitude:</span>
                    <span className="text-ink font-semibold">{data.lng.toFixed(6)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-mono pt-2 border-t border-line/60 mt-2">
                    <span className="text-ink-3">Captured at:</span>
                    <span className="text-ink">{new Date(data.captured_at).toLocaleTimeString('en-IN')}</span>
                  </div>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${data.lat},${data.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block w-full text-center bg-ink text-surface py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  View on Google Maps
                </a>
              </div>
            ) : (
              <div className="py-8 text-center text-sm font-mono text-ink-3">
                No GPS coordinates recorded for this punch.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
