"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2, Pencil, X } from "lucide-react";

const SUBJECT_TYPES = [
  { code: "THEORY", ar: "نظري", en: "Theory" },
  { code: "PRACTICAL", ar: "تطبيقي", en: "Practical" },
  { code: "LABORATORY", ar: "مختبر", en: "Laboratory" },
  { code: "SPORT", ar: "رياضي", en: "Sport" },
  { code: "ACTIVITY", ar: "نشاط", en: "Activity" },
  { code: "OTHER", ar: "أخرى", en: "Other" },
];

const ROOM_TYPES = [
  { code: "CLASSROOM", ar: "غرفة صف", en: "Classroom" },
  { code: "LABORATORY", ar: "مختبر", en: "Laboratory" },
  { code: "COMPUTER_LAB", ar: "مختبر حاسوب", en: "Computer Lab" },
  { code: "SPORTS_HALL", ar: "قاعة رياضية", en: "Sports Hall" },
  { code: "AUDITORIUM", ar: "قاعة كبار", en: "Auditorium" },
  { code: "ACTIVITY_ROOM", ar: "قاعة نشاط", en: "Activity Room" },
  { code: "SPECIAL", ar: "خاصة", en: "Special" },
];

export function SubjectsPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ name: "", code: "", type: "THEORY", defaultWeekly: 3, maxPerDay: 2, minGap: 0, consecutive: false, preferredPeriods: "", forbiddenPeriods: "", requiredRoomType: "", priority: 100, color: "#0ea5e9" });

  const { data } = useQuery({
    queryKey: ["subjects", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/subjects?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const subjects = data?.subjects || [];

  const save = useMutation({
    mutationFn: async () => {
      const url = editing ? `/api/subjects/${editing.id}` : "/api/subjects";
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
      setForm({ name: "", code: "", type: "THEORY", defaultWeekly: 3, maxPerDay: 2, minGap: 0, consecutive: false, preferredPeriods: "", forbiddenPeriods: "", requiredRoomType: "", priority: 100, color: "#0ea5e9" });
      qc.invalidateQueries({ queryKey: ["subjects", activeSchoolId] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/subjects/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["subjects", activeSchoolId] }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tr("nav_subjects", lang)} ({subjects.length})</h1>
        <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); }}>
          <Plus className="w-4 h-4" /> {tr("add", lang)}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{editing ? tr("edit", lang) : tr("add", lang)} {tr("nav_subjects", lang)}</CardTitle>
            <Button size="icon" variant="ghost" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <FieldText label={tr("name", lang)} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <FieldText label={tr("code", lang)} value={form.code} onChange={(v) => setForm({ ...form, code: v })} />
            <div>
              <Label className="text-xs">{tr("type", lang)}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBJECT_TYPES.map((t) => <SelectItem key={t.code} value={t.code}>{lang === "ar" ? t.ar : t.en}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <FieldNumber label={lang === "ar" ? "حصص أسبوعية" : "Weekly"} value={form.defaultWeekly} onChange={(v) => setForm({ ...form, defaultWeekly: v })} />
            <FieldNumber label={lang === "ar" ? "أقصى/يوم" : "Max/Day"} value={form.maxPerDay} onChange={(v) => setForm({ ...form, maxPerDay: v })} />
            <FieldNumber label={lang === "ar" ? "فجوة دنيا" : "Min Gap"} value={form.minGap} onChange={(v) => setForm({ ...form, minGap: v })} />
            <FieldNumber label={lang === "ar" ? "أولوية" : "Priority"} value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} />
            <div>
              <Label className="text-xs">{lang === "ar" ? "نوع الغرفة" : "Room Type"}</Label>
              <Select value={form.requiredRoomType || "_"} onValueChange={(v) => setForm({ ...form, requiredRoomType: v === "_" ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_">{lang === "ar" ? "أي" : "Any"}</SelectItem>
                  {ROOM_TYPES.map((t) => <SelectItem key={t.code} value={t.code}>{lang === "ar" ? t.ar : t.en}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{lang === "ar" ? "اللون" : "Color"}</Label>
              <Input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
            <FieldText label={lang === "ar" ? "حصص مفضلة" : "Preferred"} value={form.preferredPeriods} onChange={(v) => setForm({ ...form, preferredPeriods: v })} placeholder="1,2,3" />
            <FieldText label={lang === "ar" ? "حصص ممنوعة" : "Forbidden"} value={form.forbiddenPeriods} onChange={(v) => setForm({ ...form, forbiddenPeriods: v })} placeholder="6,7" />
            <div className="flex items-end gap-2">
              <Switch checked={form.consecutive} onCheckedChange={(c) => setForm({ ...form, consecutive: c })} />
              <Label className="text-xs">{lang === "ar" ? "متتالية" : "Consecutive"}</Label>
            </div>
            <div className="flex justify-end md:col-span-3">
              <Button onClick={() => save.mutate()} disabled={!form.name || !form.code}>{tr("save", lang)}</Button>
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
                <TableHead>{tr("code", lang)}</TableHead>
                <TableHead>{tr("type", lang)}</TableHead>
                <TableHead>Weekly</TableHead>
                <TableHead>Max/Day</TableHead>
                <TableHead>{lang === "ar" ? "نوع الغرفة" : "Room Type"}</TableHead>
                <TableHead>{tr("actions", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded" style={{ background: s.color }} />
                      <span className="font-medium">{s.name}</span>
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{s.code}</Badge></TableCell>
                  <TableCell>{SUBJECT_TYPES.find((t) => t.code === s.type)?.[lang === "ar" ? "ar" : "en"] || s.type}</TableCell>
                  <TableCell>{s.defaultWeekly}</TableCell>
                  <TableCell>{s.maxPerDay}</TableCell>
                  <TableCell>{s.requiredRoomType || "—"}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(s);
                      setForm({
                        name: s.name, code: s.code, type: s.type, defaultWeekly: s.defaultWeekly,
                        maxPerDay: s.maxPerDay, minGap: s.minGap, consecutive: s.consecutive,
                        preferredPeriods: s.preferredPeriods, forbiddenPeriods: s.forbiddenPeriods,
                        requiredRoomType: s.requiredRoomType || "", priority: s.priority, color: s.color || "#0ea5e9",
                      });
                      setShowForm(true);
                    }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(s.id)}>
                      <Trash2 className="w-3 h-3 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FieldText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function FieldNumber({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
