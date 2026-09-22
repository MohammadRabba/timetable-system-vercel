"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore, useLangStore } from "@/lib/store";
import { tr } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

const DUTY_TYPES = ["SUPERVISION", "DUTY", "ADMIN", "RESERVE", "ACTIVITY", "MEETING", "OTHER"];

export function DutiesPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({
    teacherId: "", type: "DUTY", title: "", day: "SUN", period: 1, location: "", notes: "",
  });

  const { data: dutiesData } = useQuery({
    queryKey: ["duties", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/duties?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const { data: teachersData } = useQuery({
    queryKey: ["teachers", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/teachers?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });

  const duties = dutiesData?.duties || [];
  const teachers = teachersData?.teachers || [];

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/duties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, schoolId: activeSchoolId }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحفظ" : "Saved");
      setShowForm(false);
      setForm({ teacherId: "", type: "DUTY", title: "", day: "SUN", period: 1, location: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["duties", activeSchoolId] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/duties/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["duties", activeSchoolId] }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tr("nav_duties", lang)} ({duties.length})</h1>
        <Button size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-4 h-4" /> {tr("add", lang)}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">{tr("nav_teachers", lang)}</Label>
              <Select value={form.teacherId} onValueChange={(v) => setForm({ ...form, teacherId: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{teachers.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{tr("type", lang)}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DUTY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{tr("name", lang)}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{lang === "ar" ? "اليوم" : "Day"}</Label>
              <Select value={form.day} onValueChange={(v) => setForm({ ...form, day: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{lang === "ar" ? "الحصة" : "Period"}</Label>
              <Input type="number" min={1} max={10} value={form.period} onChange={(e) => setForm({ ...form, period: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">{lang === "ar" ? "المكان" : "Location"}</Label>
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex justify-end md:col-span-4">
              <Button onClick={() => save.mutate()} disabled={!form.teacherId || !form.title}>{tr("save", lang)}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("nav_teachers", lang)}</TableHead>
                <TableHead>{tr("type", lang)}</TableHead>
                <TableHead>{tr("name", lang)}</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>{lang === "ar" ? "المكان" : "Location"}</TableHead>
                <TableHead>{tr("actions", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {duties.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.teacher?.name}</TableCell>
                  <TableCell><Badge variant="outline">{d.type}</Badge></TableCell>
                  <TableCell>{d.title}</TableCell>
                  <TableCell>{d.day}</TableCell>
                  <TableCell>P{d.period}</TableCell>
                  <TableCell>{d.location || "—"}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(d.id)}>
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
