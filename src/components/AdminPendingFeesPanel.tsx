import React, { useMemo, useState } from 'react';
import { CheckCircle2, Download, Filter, Search } from 'lucide-react';
import { AdmissionApplication, InstituteSettings, StudentRecord } from '../types';

interface AdminPendingFeesPanelProps {
  students: StudentRecord[];
  applications: AdmissionApplication[];
  settings: InstituteSettings;
}

export const AdminPendingFeesPanel: React.FC<AdminPendingFeesPanelProps> = ({
  students,
  applications,
  settings,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterClass, setFilterClass] = useState<string>('');

  const pendingPayees = useMemo(() => {
    const list: {
      id: string;
      name: string;
      identifier: string;
      mobile: string;
      classOrCourse: string;
      batch: string;
      feeAmount: number;
      paidAmount: number;
      balance: number;
      status: string;
      isApplication?: boolean;
    }[] = [];

    students.forEach((s) => {
      const balance = Math.max(0, (s.feeAmount || 0) - (s.paidAmount || 0));
      const status = (s.paymentStatus || '').trim().toUpperCase();
      if (status === 'PENDING' || status === 'PARTIAL' || balance > 0) {
        list.push({
          id: s.studentId,
          name: s.studentName,
          identifier: s.studentId,
          mobile: s.studentMobile || '',
          classOrCourse: `${s.studentClass || ''} • ${s.course || ''}`,
          batch: s.batch || '',
          feeAmount: s.feeAmount || 0,
          paidAmount: s.paidAmount || 0,
          balance,
          status: status || (balance > 0 ? 'PENDING' : 'PAID'),
        });
      }
    });

    applications
      .filter((a) => a.status === 'approved' || a.status === 'pending')
      .forEach((a) => {
        const balance = Math.max(0, (a.feeAmount || 0) - (a.paidAmount || 0));
        const status = (a.paymentStatus || '').trim().toUpperCase();
        if (status === 'PENDING' || status === 'PARTIAL' || balance > 0) {
          if (!list.some((l) => l.identifier === a.applicationNumber || l.identifier === a.studentId)) {
            list.push({
              id: a.id,
              name: a.studentName,
              identifier: a.applicationNumber,
              mobile: a.studentMobile || a.studentWhatsapp || '',
              classOrCourse: `${a.studentClass || ''} • ${a.course || ''}`,
              batch: a.batch || '',
              feeAmount: a.feeAmount || 0,
              paidAmount: a.paidAmount || 0,
              balance,
              status: status || 'PENDING',
              isApplication: true,
            });
          }
        }
      });

    return list.sort((a, b) => b.balance - a.balance);
  }, [students, applications]);

  const filteredPayees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pendingPayees.filter((p) => {
      if (q) {
        const hit =
          p.name.toLowerCase().includes(q) ||
          p.identifier.toLowerCase().includes(q) ||
          p.mobile.includes(q) ||
          p.classOrCourse.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (filterStatus !== 'ALL' && p.status !== filterStatus) return false;
      if (filterClass && !p.classOrCourse.toLowerCase().includes(filterClass.toLowerCase())) return false;
      return true;
    });
  }, [pendingPayees, searchQuery, filterStatus, filterClass]);

  const totalOutstandingBalance = useMemo(
    () => filteredPayees.reduce((sum, p) => sum + p.balance, 0),
    [filteredPayees]
  );

  const handleNotifyWhatsapp = (item: { name: string; identifier: string; mobile: string; balance: number }) => {
    const cleanMob = item.mobile.replace(/[^0-9]/g, '');
    const phone = cleanMob.length === 10 ? `91${cleanMob}` : cleanMob;
    const msg = `Hello ${item.name}, this is a fee payment reminder from ${settings.instituteName || 'The Zone of Chemistry'}. Your pending fee balance is ₹${item.balance.toLocaleString('en-IN')}. Please clear your dues at your earliest convenience. Thank you! — Sonu Sir (#BABA)`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const handleExportCsv = () => {
    const headers = ['Name', 'Identifier', 'Mobile', 'Class & Course', 'Batch', 'Fee Amount', 'Paid Amount', 'Balance Due', 'Status'];
    const rows = filteredPayees.map((p) => [
      `"${p.name}"`,
      `"${p.identifier}"`,
      `"${p.mobile}"`,
      `"${p.classOrCourse}"`,
      `"${p.batch}"`,
      p.feeAmount,
      p.paidAmount,
      p.balance,
      `"${p.status}"`,
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `pending_fees_report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg sm:text-xl font-bold text-gray-900">
            Pending &amp; Partial Fees Manager
          </h2>
          <p className="text-xs sm:text-sm text-gray-500">
            Querying Firestore for students and applicants with PENDING or PARTIAL fee statuses.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          disabled={filteredPayees.length === 0}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white hover:bg-gray-50 border border-gray-200 disabled:opacity-40 text-gray-700 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer shadow-2xs"
        >
          <Download className="w-4 h-4 text-violet-600" />
          Export Pending CSV
        </button>
      </div>

      {/* Summary KPI Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="app-card rounded-2xl p-4">
          <p className="text-[11px] sm:text-xs text-gray-500">Outstanding Accounts</p>
          <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-amber-600 tabular-nums">
            {filteredPayees.length}
          </p>
        </div>
        <div className="app-card rounded-2xl p-4 sm:p-3 col-span-2">
          <p className="text-[11px] sm:text-xs text-gray-500">Total Outstanding Balance</p>
          <p className="mt-1 font-mono text-xl sm:text-2xl font-bold text-red-600 tabular-nums">
            ₹{totalOutstandingBalance.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="app-card rounded-2xl p-3.5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, ID, phone..."
            className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 pl-9 pr-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400 shrink-0" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-xs text-gray-900 focus:outline-none"
          >
            <option value="ALL">All Statuses (Pending &amp; Partial)</option>
            <option value="PENDING">PENDING Only</option>
            <option value="PARTIAL">PARTIAL Only</option>
          </select>
        </div>

        <input
          type="text"
          value={filterClass}
          onChange={(e) => setFilterClass(e.target.value)}
          placeholder="Filter by class or course..."
          className="w-full rounded-xl bg-gray-50 focus:bg-white border border-gray-200 focus:border-violet-500 px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none"
        />
      </div>

      {/* Clean Table View */}
      <div className="app-card rounded-2xl p-5 space-y-4">
        {filteredPayees.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            No matching students with pending or partial fee status found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-gray-500 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3">Student Name &amp; ID / App No</th>
                  <th className="py-3 px-3">Class &amp; Course</th>
                  <th className="py-3 px-3">Batch</th>
                  <th className="py-3 px-3 text-right">Fee / Paid</th>
                  <th className="py-3 px-3 text-right">Remaining Balance</th>
                  <th className="py-3 px-3 text-center">Payment Status</th>
                  <th className="py-3 px-3 text-right">WhatsApp Reminder</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredPayees.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3.5 px-3">
                      <p className="font-bold text-gray-900">{p.name}</p>
                      <p className="font-mono text-xs text-violet-700 tabular-nums">
                        {p.identifier} {p.isApplication ? '(App)' : ''}
                      </p>
                    </td>
                    <td className="py-3.5 px-3 text-gray-700">{p.classOrCourse}</td>
                    <td className="py-3.5 px-3 text-gray-600">{p.batch || '—'}</td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums">
                      <span className="text-gray-900">₹{p.feeAmount.toLocaleString('en-IN')}</span>
                      <span className="text-gray-400 mx-1">/</span>
                      <span className="text-emerald-600">₹{p.paidAmount.toLocaleString('en-IN')}</span>
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono font-bold text-red-600 tabular-nums text-sm">
                      ₹{p.balance.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          p.status === 'PENDING'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleNotifyWhatsapp(p)}
                        disabled={!p.mobile}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-2xs cursor-pointer"
                        title={p.mobile ? `Send WhatsApp reminder to ${p.mobile}` : 'No mobile number available'}
                      >
                        <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                          <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
                        </svg>
                        Notify ({p.mobile || 'No Mobile'})
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
