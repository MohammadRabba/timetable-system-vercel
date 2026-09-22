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
import { Plus, Trash2, Pencil, X } from "lucide-react";

const ROOM_TYPES = [
  { code: "CLASSROOM", ar: "غرفة صف", en: "Classroom" },
  { code: "LABORATORY", ar: "مختبر", en: "Laboratory" },
  { code: "COMPUTER_LAB", ar: "مختبر حاسوب", en: "Computer Lab" },
  { code: "SPORTS_HALL", ar: "قاعة رياضية", en: "Sports Hall" },
  { code: "AUDITORIUM", ar: "قاعة كبار", en: "Auditorium" },
  { code: "ACTIVITY_ROOM", ar: "قاعة نشاط", en: "Activity Room" },
  { code: "SPECIAL", ar: "خاصة", en: "Special" },
];

export function RoomsPane() {
  const lang = useLangStore((s) => s.lang);
  const activeSchoolId = useAppStore((s) => s.activeSchoolId);
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ name: "", code: "", type: "CLASSROOM", capacity: 30, equipment: "" });

  const { data } = useQuery({
    queryKey: ["rooms", activeSchoolId],
    queryFn: async () => {
      const r = await fetch(`/api/rooms?schoolId=${activeSchoolId || ""}`, { cache: "no-store" });
      return r.json();
    },
    enabled: !!activeSchoolId,
  });
  const rooms = data?.rooms || [];

  const save = useMutation({
    mutationFn: async () => {
      const url = editing ? `/api/rooms/${editing.id}` : "/api/rooms";
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
      setForm({ name: "", code: "", type: "CLASSROOM", capacity: 30, equipment: "" });
      qc.invalidateQueries({ queryKey: ["rooms", activeSchoolId] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/rooms/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rooms", activeSchoolId] }),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{tr("nav_rooms", lang)} ({rooms.length})</h1>
        <Button size="sm" onClick={() => { setShowForm(true); setEditing(null); }}>
          <Plus className="w-4 h-4" /> {tr("add", lang)}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">{tr("name", lang)}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{tr("code", lang)}</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{tr("type", lang)}</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROOM_TYPES.map((t) => <SelectItem key={t.code} value={t.code}>{lang === "ar" ? t.ar : t.en}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{lang === "ar" ? "السعة" : "Capacity"}</Label>
              <Input type="number" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">{lang === "ar" ? "المعدات" : "Equipment"}</Label>
              <Input value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="Projector, Smart Board..." />
            </div>
            <div className="flex items-end md:col-span-2 gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowForm(false)}><X className="w-4 h-4" /></Button>
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
                <TableHead>{lang === "ar" ? "السعة" : "Capacity"}</TableHead>
                <TableHead>{tr("actions", lang)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{r.code}</Badge></TableCell>
                  <TableCell>{ROOM_TYPES.find((t) => t.code === r.type)?.[lang === "ar" ? "ar" : "en"] || r.type}</TableCell>
                  <TableCell>{r.capacity}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(r);
                      setForm({ name: r.name, code: r.code, type: r.type, capacity: r.capacity, equipment: r.equipment || "" });
                      setShowForm(true);
                    }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(r.id)}>
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
