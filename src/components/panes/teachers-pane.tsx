"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2, Pencil, X, CalendarOff, Clock } from "lucide-react";

export function TeachersPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const setActiveTeacherId = useAppStore((s) => s.setActiveTeacherId);
  const setPane = useAppStore((s) => s.setPane);
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<any>({ name: "", employeeNumber: "", specialization: "", email: "", phone: "", status: "ACTIVE", requiredWorkload: 24, maxDailyPeriods: 7, minDailyPeriods: 0, requiredSeventh: 2, maxSeventh: 3 });
  const [availabilityTeacherId, setAvailabilityTeacherId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["teachers", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/teachers?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const teachers = (data?.teachers || []).filter((t: any) =>
    !search || t.name.includes(search) || t.employeeNumber.includes(search)
  );

  const save = useMutation({
    mutationFn: async () => {
      const url = editing ? `/api/teachers/${editing.id}` : "/api/teachers";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, schoolId: activeSchoolId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
      setShowForm(false);
      setEditing(null);
      setForm({ name: "", employeeNumber: "", specialization: "", email: "", phone: "", status: "ACTIVE", requiredWorkload: 24, maxDailyPeriods: 7, minDailyPeriods: 0, requiredSeventh: 2, maxSeventh: 3 });
      qc.invalidateQueries({ queryKey: ["teachers", activeSchoolId] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/teachers/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teachers", activeSchoolId] }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{tr("nav_teachers", lang)} ({teachers.length})</h1>
        <div className="flex gap-2 items-center">
          <Input placeholder={tr("search", lang)} value={search} onChange={(e) => setSearch(e.target.value)} className="w-48" />
          <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); }}>
            <Plus className="w-4 h-4" /> {tr("add", lang)}
          </Button>
        </div>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{editing ? tr("edit", lang) : tr("add", lang)}</CardTitle>
            <Button size="icon" variant="ghost" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={tr("name", lang)}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label={lang === "ar" ? "الرقم الوظيفي" : "Employee #"}><Input value={form.employeeNumber} onChange={(e) => setForm({ ...form, employeeNumber: e.target.value })} /></Field>
            <Field label={lang === "ar" ? "التخصص" : "Specialization"}><Input value={form.specialization} onChange={(e) => setForm({ ...form, specialization: e.target.value })} /></Field>
            <Field label={tr("email", lang)}><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={lang === "ar" ? "الهاتف" : "Phone"}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={lang === "ar" ? "النصاب" : "Required WL"}><Input type="number" value={form.requiredWorkload} onChange={(e) => setForm({ ...form, requiredWorkload: Number(e.target.value) })} /></Field>
            <Field label={lang === "ar" ? "أقصى/يوم" : "Max/Day"}><Input type="number" value={form.maxDailyPeriods} onChange={(e) => setForm({ ...form, maxDailyPeriods: Number(e.target.value) })} /></Field>
            <Field label={lang === "ar" ? "أدنى/يوم" : "Min/Day"}><Input type="number" value={form.minDailyPeriods} onChange={(e) => setForm({ ...form, minDailyPeriods: Number(e.target.value) })} /></Field>
            <Field label={lang === "ar" ? "سابعة مطلوبة" : "Required 7th"}><Input type="number" value={form.requiredSeventh} onChange={(e) => setForm({ ...form, requiredSeventh: Number(e.target.value) })} /></Field>
            <Field label={lang === "ar" ? "أقصى سابعة" : "Max 7th"}><Input type="number" value={form.maxSeventh} onChange={(e) => setForm({ ...form, maxSeventh: Number(e.target.value) })} /></Field>
            <div className="flex justify-end md:col-span-4">
              <Button onClick={() => save.mutate()} disabled={!form.name || !form.employeeNumber}>{tr("save", lang)}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("name", lang)}</TableHead>
                <TableHead>Emp #</TableHead>
                <TableHead>{lang === "ar" ? "التخصص" : "Specialization"}</TableHead>
                <TableHead>{lang === "ar" ? "المواد" : "Subjects"}</TableHead>
                <TableHead>{lang === "ar" ? "الإشغالات" : "Duties"}</TableHead>
                <TableHead>WL</TableHead>
                <TableHead>{tr("actions", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teachers.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">
                    <button
                      className="text-blue-600 hover:underline"
                      onClick={() => { setActiveTeacherId(t.id); setPane("timetable"); }}
                    >
                      {t.name}
                    </button>
                  </TableCell>
                  <TableCell><Badge variant="outline">{t.employeeNumber}</Badge></TableCell>
                  <TableCell>{t.specialization || "—"}</TableCell>
                  <TableCell>{t._count?.subjects ?? 0}</TableCell>
                  <TableCell>{t._count?.duties ?? 0}</TableCell>
                  <TableCell>{t.requiredWorkload}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" title="Availability" onClick={() => setAvailabilityTeacherId(t.id)}>
                      <Clock className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(t);
                      setForm({
                        name: t.name, employeeNumber: t.employeeNumber, specialization: t.specialization || "",
                        email: t.email || "", phone: t.phone || "", status: t.status,
                        requiredWorkload: t.requiredWorkload, maxDailyPeriods: t.maxDailyPeriods,
                        minDailyPeriods: t.minDailyPeriods, requiredSeventh: t.requiredSeventh, maxSeventh: t.maxSeventh,
                      });
                      setShowForm(true);
                    }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(t.id)}>
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AvailabilityDialog teacherId={availabilityTeacherId} onClose={() => setAvailabilityTeacherId(null)} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

const DAYS = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"];
function AvailabilityDialog({ teacherId, onClose }: { teacherId: string | null; onClose: () => void }) {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const [slots, setSlots] = useState<any>({});
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [periodsPerDay, setPeriodsPerDay] = useState(7);
  const [loading, setLoading] = useState(true);

  // Load teacher + school
  useQuery({
    queryKey: ["avail-load", teacherId],
    queryFn: async () => {
      if (!teacherId) return null;
      const tr = await fetch(`/api/teachers/${teacherId}`, { cache: "no-store" });
      const tj = await tr.json();
      const sr = await fetch(`/api/schools/${activeSchoolId}`, { cache: "no-store" });
      const sj = await sr.json();
      const ppd = sj.school?.periodsPerDay || 7;
      setPeriodsPerDay(ppd);
      const wd = (sj.school?.workingDays || "SUN,MON,TUE,WED,THU").split(",");
      const map: any = {};
      for (const d of wd) for (let p = 1; p <= ppd; p++) map[`${d}_${p}`] = "AVAILABLE";
      for (const a of tj.teacher?.availability || []) {
        map[`${a.day}_${a.period}`] = a.state;
      }
      setSlots(map);
      setDaysOff((tj.teacher?.daysOff || []).map((d: any) => d.day));
      setLoading(false);
      return null;
    },
    enabled: !!teacherId,
  });

  const save = useMutation({
    mutationFn: async () => {
      const slotArr = Object.entries(slots).map(([k, s]) => {
        const [d, p] = k.split("_");
        return { day: d, period: Number(p), state: s };
      });
      const r = await fetch("/api/teacher-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId, slots: slotArr, daysOff }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
      onClose();
    },
  });

  if (!teacherId) return null;

  const wd = ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"];

  const stateColors: Record<string, string> = {
    AVAILABLE: "bg-emerald-500",
    PREFERRED: "bg-blue-500",
    UNAVAILABLE: "bg-red-500",
    FORBIDDEN: "bg-slate-800",
  };

  return (
    <Dialog open={!!teacherId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{lang === "ar" ? "توفر المعلم" : "Teacher Availability"}</DialogTitle>
        </DialogHeader>
        {loading ? <div>...</div> : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs">{lang === "ar" ? "أيام الإجازة" : "Days off"}:</span>
              {DAYS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDaysOff((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])}
                  className={`px-2 py-1 rounded text-xs border ${daysOff.includes(d) ? "bg-slate-900 text-white" : "bg-white dark:bg-slate-900 border-slate-200"}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="border border-slate-300 p-1 bg-slate-100 dark:bg-slate-800">{tr("name", lang)}</th>
                    {Array.from({ length: periodsPerDay }, (_, i) => (
                      <th key={i} className="border border-slate-300 p-1 bg-slate-100 dark:bg-slate-800">P{i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((d) => (
                    <tr key={d}>
                      <td className="border border-slate-300 p-1 font-medium">{d}</td>
                      {Array.from({ length: periodsPerDay }, (_, i) => {
                        const p = i + 1;
                        const k = `${d}_${p}`;
                        const state = slots[k] || "AVAILABLE";
                        const off = daysOff.includes(d);
                        return (
                          <td key={p} className="border border-slate-300 p-0.5">
                            <button
                              disabled={off}
                              onClick={() => {
                                const next: Record<string, string> = {
                                  AVAILABLE: "PREFERRED",
                                  PREFERRED: "UNAVAILABLE",
                                  UNAVAILABLE: "FORBIDDEN",
                                  FORBIDDEN: "AVAILABLE",
                                };
                                setSlots({ ...slots, [k]: next[state] });
                              }}
                              className={`w-full h-8 rounded text-[10px] text-white ${off ? "bg-slate-300 dark:bg-slate-700" : stateColors[state]}`}
                            >
                              {off ? "" : state[0]}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {Object.entries(stateColors).map(([s, c]) => (
                <div key={s} className="flex items-center gap-1"><span className={`w-3 h-3 ${c} rounded`} /> {s}</div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>{tr("cancel", lang)}</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>{tr("save", lang)}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
