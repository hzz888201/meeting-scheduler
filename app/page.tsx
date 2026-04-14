"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Users,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Cloud,
  Save,
  Wifi,
  WifiOff,
  RefreshCw,
  User,
} from "lucide-react";

/**
 * Vercel-deploybare Version
 *
 * 1. Neues Next.js-Projekt anlegen (App Router)
 * 2. Diese Datei als app/page.tsx speichern
 * 3. Abhängigkeiten installieren:
 *    npm install @supabase/supabase-js framer-motion lucide-react
 * 4. Sicherstellen, dass shadcn/ui-Komponenten vorhanden sind:
 *    card, button, input, badge, checkbox, alert
 * 5. In Vercel oder lokal in .env.local konfigurieren:
 *    NEXT_PUBLIC_SUPABASE_URL=...
 *    NEXT_PUBLIC_SUPABASE_ANON_KEY=...
 * 6. Benötigtes Supabase-SQL siehe unten im Kommentarblock der vorherigen Version
 * 7. In Supabase Auth Anonymous sign-ins aktivieren
 */

type AvailabilityMap = Record<string, Record<string, string[]>>;
type PersonAvailability = Record<string, string[]>;

type MeetingRow = {
  poll_id: string;
  participant_name: string;
  owner_user_id: string;
  date_key: string;
  slots: string[];
};

const TIME_SLOTS = [
  { id: "morning", label: "Vormittag 09:00–12:00" },
  { id: "afternoon", label: "Nachmittag 13:00–17:00" },
  { id: "evening", label: "Abend 18:00–21:00" },
] as const;

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DEFAULT_POLL_ID = "team-meeting-demo";

function getPollId(): string {
  if (typeof window === "undefined") return DEFAULT_POLL_ID;
  const params = new URLSearchParams(window.location.search);
  return params.get("poll")?.trim() || DEFAULT_POLL_ID;
}

function getStorageKey(pollId: string): string {
  return `meeting-scheduler-local-${pollId}`;
}

function getProfileKey(pollId: string): string {
  return `meeting-scheduler-profile-${pollId}`;
}

function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return createClient(url, anonKey);
}

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateDE(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  const weekdayMap = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
  return `${d}.${m}.${y} ${weekdayMap[date.getDay()]}`;
}

function getMonthMatrix(currentMonth: Date): Date[][] {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const startDate = new Date(year, month, 1 - firstWeekday);
  const days: Date[] = [];

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    days.push(date);
  }

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return weeks;
}

function slotLabelById(slotId: string): string {
  return TIME_SLOTS.find((slot) => slot.id === slotId)?.label || slotId;
}

function normalizePersonAvailability(input: unknown): PersonAvailability {
  if (!input || typeof input !== "object") return {};
  const next: PersonAvailability = {};

  Object.entries(input as Record<string, unknown>).forEach(([dateKey, slots]) => {
    if (!Array.isArray(slots)) return;
    const cleaned = Array.from(new Set(slots.filter(Boolean))).sort() as string[];
    if (cleaned.length > 0) next[dateKey] = cleaned;
  });

  return next;
}

function inflateRowsToAvailability(rows: Array<{ participant_name: string; date_key: string; slots: string[] }>): AvailabilityMap {
  const result: AvailabilityMap = {};

  rows.forEach((row) => {
    if (!row?.participant_name || !row?.date_key) return;
    if (!result[row.participant_name]) result[row.participant_name] = {};
    result[row.participant_name][row.date_key] = Array.isArray(row.slots)
      ? Array.from(new Set(row.slots)).sort()
      : [];
  });

  return result;
}

function arePersonAvailabilityEqual(a: PersonAvailability, b: PersonAvailability): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;

  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    const aSlots = [...(a[aKeys[i]] || [])].sort();
    const bSlots = [...(b[bKeys[i]] || [])].sort();
    if (aSlots.length !== bSlots.length) return false;
    for (let j = 0; j < aSlots.length; j += 1) {
      if (aSlots[j] !== bSlots[j]) return false;
    }
  }

  return true;
}

function flattenPersonAvailability(personAvailability: PersonAvailability, participantName: string, ownerUserId: string, pollId: string): MeetingRow[] {
  return Object.entries(personAvailability).map(([date_key, slots]) => ({
    poll_id: pollId,
    participant_name: participantName,
    owner_user_id: ownerUserId,
    date_key,
    slots: [...slots].sort(),
  }));
}

export default function Page() {
  const [pollId, setPollId] = useState(DEFAULT_POLL_ID);
  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string>(formatDateKey(new Date()));
  const [participantNameInput, setParticipantNameInput] = useState("");
  const [myName, setMyName] = useState("");
  const [savedMyName, setSavedMyName] = useState("");
  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const [draftAvailability, setDraftAvailability] = useState<PersonAvailability>({});
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<"online" | "local" | "error">("local");
  const [currentUserId, setCurrentUserId] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const activeParticipant = savedMyName || myName;

  useEffect(() => {
    setPollId(getPollId());
    supabaseRef.current = createSupabaseBrowserClient();
    setConnectionStatus(supabaseRef.current ? "online" : "local");
    setAuthReady(!supabaseRef.current);
  }, []);

  async function fetchAllAvailability(showRefreshing = false): Promise<void> {
    const supabase = supabaseRef.current;

    if (!supabase) {
      if (typeof window !== "undefined") {
        const localRaw = localStorage.getItem(getStorageKey(pollId));
        const local = localRaw ? JSON.parse(localRaw) : {};
        setAvailability(local.availability || {});
      }
      return;
    }

    if (showRefreshing) setIsRefreshing(true);

    const { data, error } = await supabase
      .from("meeting_availability")
      .select("participant_name, date_key, slots")
      .eq("poll_id", pollId);

    if (error) {
      setConnectionStatus("error");
      setSaveMessage("Online-Daten konnten nicht geladen werden. Bitte Supabase-Konfiguration, RLS oder Netzwerk prüfen.");
    } else {
      setAvailability(inflateRowsToAvailability((data || []) as Array<{ participant_name: string; date_key: string; slots: string[] }>));
      setConnectionStatus("online");
    }

    if (showRefreshing) setIsRefreshing(false);
  }

  useEffect(() => {
    if (!pollId) return;
    let ignore = false;

    async function init(): Promise<void> {
      setIsLoading(true);

      if (typeof window !== "undefined") {
        const profileRaw = localStorage.getItem(getProfileKey(pollId));
        const profile = profileRaw ? JSON.parse(profileRaw) : {};
        const cachedName = profile.myName || "";
        if (!ignore) {
          setMyName(cachedName);
          setSavedMyName(cachedName);
          setParticipantNameInput(cachedName);
        }
      }

      const supabase = supabaseRef.current;
      if (supabase) {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) {
          if (!ignore) {
            setConnectionStatus("error");
            setSaveMessage("Anmeldestatus konnte nicht gelesen werden. Bitte Supabase Auth prüfen.");
            setAuthError("Anmeldestatus konnte nicht gelesen werden. Bitte Supabase Auth prüfen.");
            setAuthReady(false);
            setIsLoading(false);
          }
          return;
        }

        let activeSession = session;
        if (!activeSession) {
          const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
          if (anonError) {
            if (!ignore) {
              setConnectionStatus("error");
              setSaveMessage("Anonyme Anmeldung fehlgeschlagen. Bitte Anonymous Sign-ins in Supabase Auth aktivieren.");
              setAuthError("Anonyme Anmeldung fehlgeschlagen. Bitte Anonymous Sign-ins in Supabase Auth aktivieren.");
              setAuthReady(false);
              setIsLoading(false);
            }
            return;
          }
          activeSession = anonData.session;
        }

        if (!ignore) {
          setCurrentUserId(activeSession?.user?.id || "");
          setAuthReady(Boolean(activeSession?.user?.id));
          setAuthError("");
        }
      }

      await fetchAllAvailability(false);
      if (!ignore) setIsLoading(false);
    }

    void init();

    return () => {
      ignore = true;
    };
  }, [pollId]);

  useEffect(() => {
    if (!pollId || typeof window === "undefined") return;
    localStorage.setItem(getProfileKey(pollId), JSON.stringify({ myName }));
  }, [myName, pollId]);

  useEffect(() => {
    if (!savedMyName) {
      setDraftAvailability({});
      setIsDirty(false);
      return;
    }

    const committed = normalizePersonAvailability(availability[savedMyName] || {});
    setDraftAvailability(committed);
    setIsDirty(false);
  }, [availability, savedMyName]);

  useEffect(() => {
    if (!pollId || typeof window === "undefined") return;
    localStorage.setItem(getStorageKey(pollId), JSON.stringify({ availability, myName: savedMyName || myName }));
  }, [availability, savedMyName, myName, pollId]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase || !pollId) return;

    const channel = supabase
      .channel(`meeting-poll-${pollId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meeting_availability",
          filter: `poll_id=eq.${pollId}`,
        },
        async () => {
          await fetchAllAvailability(false);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setConnectionStatus("online");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setCurrentUserId(session?.user?.id || "");
      setAuthReady(Boolean(session?.user?.id));
      if (session?.user?.id) {
        setAuthError("");
      }
      if (event === "SIGNED_OUT") {
        setSaveMessage("Anmeldestatus ist abgelaufen. Bitte Seite neu laden, damit die anonyme Anmeldung erneut durchgeführt wird.");
      }
    });

    return () => {
      void supabase.removeChannel(channel);
      subscription.unsubscribe();
    };
  }, [pollId]);

  const participants = useMemo(() => Object.keys(availability).sort(), [availability]);
  const monthLabel = `${currentMonth.getFullYear()} ${currentMonth.toLocaleDateString("de-DE", { month: "long" })}`;
  const weeks = useMemo(() => getMonthMatrix(currentMonth), [currentMonth]);
  const selectedSlots = draftAvailability[selectedDate] || [];

  const allDateSlotKeys = useMemo(() => {
    const keys = new Set<string>();
    Object.values(availability).forEach((personData) => {
      Object.entries(personData || {}).forEach(([dateKey, slots]) => {
        (slots || []).forEach((slot) => keys.add(`${dateKey}__${slot}`));
      });
    });
    return Array.from(keys).sort();
  }, [availability]);

  const commonSlots = useMemo(() => {
    if (participants.length === 0) return [] as Array<{ dateKey: string; slotId: string; slotLabel: string }>;

    return allDateSlotKeys
      .filter((key) => {
        const [dateKey, slotId] = key.split("__");
        return participants.every((person) => {
          const personSlots = availability[person]?.[dateKey] || [];
          return personSlots.includes(slotId);
        });
      })
      .map((key) => {
        const [dateKey, slotId] = key.split("__");
        return { dateKey, slotId, slotLabel: slotLabelById(slotId) };
      });
  }, [allDateSlotKeys, availability, participants]);

  const participantCountPerSlot = useMemo(() => {
    const map: Record<string, number> = {};
    allDateSlotKeys.forEach((key) => {
      const [dateKey, slotId] = key.split("__");
      map[key] = participants.filter((person) => (availability[person]?.[dateKey] || []).includes(slotId)).length;
    });
    return map;
  }, [allDateSlotKeys, availability, participants]);

  const participantSelections = useMemo(() => {
    return participants.map((name) => {
      const personData = availability[name] || {};
      const entries = Object.entries(personData)
        .filter(([, slots]) => Array.isArray(slots) && slots.length > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([dateKey, slots]) => ({
          dateKey,
          labels: [...slots].sort().map((slotId) => slotLabelById(slotId)),
        }));

      return {
        name,
        entries,
        totalCount: entries.reduce((sum, item) => sum + item.labels.length, 0),
      };
    });
  }, [availability, participants]);

  function registerMe(): void {
    const trimmed = participantNameInput.trim();
    if (!trimmed) return;
    setMyName(trimmed);
    setSavedMyName(trimmed);
    setSaveMessage(`Du bearbeitest jetzt die Verfügbarkeit von ${trimmed}.`);
  }

  function toggleSlot(slotId: string): void {
    if (!activeParticipant) return;
    const next = { ...draftAvailability };
    const existing = next[selectedDate] || [];
    const updated = existing.includes(slotId)
      ? existing.filter((s) => s !== slotId)
      : [...existing, slotId];

    if (updated.length === 0) {
      delete next[selectedDate];
    } else {
      next[selectedDate] = [...updated].sort();
    }

    setDraftAvailability(normalizePersonAvailability(next));
    setIsDirty(true);
    setSaveMessage("Es gibt ungespeicherte Änderungen. Gespeichert werden nur deine eigenen Zeiten.");
  }

  function clearSelectedDateForParticipant(): void {
    if (!activeParticipant) return;
    const next = { ...draftAvailability };
    delete next[selectedDate];
    setDraftAvailability(normalizePersonAvailability(next));
    setIsDirty(true);
    setSaveMessage("Die Auswahl für dieses Datum wurde gelöscht. Bitte anschließend speichern.");
  }

  async function saveMyAvailability(): Promise<void> {
    const trimmedName = activeParticipant.trim();
    if (!trimmedName) {
      setSaveMessage("Bitte zuerst einen Namen eingeben und bestätigen.");
      return;
    }

    const supabase = supabaseRef.current;
    if (supabase && (!authReady || !currentUserId)) {
      setSaveMessage("Die anonyme Anmeldung ist noch nicht bereit. Bitte kurz warten und erneut versuchen.");
      return;
    }

    const normalizedDraft = normalizePersonAvailability(draftAvailability);
    setIsSaving(true);
    setSaveMessage("");

    try {
      if (supabase) {
        const { data: myRows, error: fetchMineError } = await supabase
          .from("meeting_availability")
          .select("date_key")
          .eq("poll_id", pollId)
          .eq("owner_user_id", currentUserId);

        if (fetchMineError) throw fetchMineError;

        const savedDates = ((myRows || []) as Array<{ date_key: string }>).map((row) => row.date_key);
        const draftDates = Object.keys(normalizedDraft);
        const datesToDelete = savedDates.filter((dateKey) => !draftDates.includes(dateKey));

        if (datesToDelete.length > 0) {
          const { error: deleteError } = await supabase
            .from("meeting_availability")
            .delete()
            .eq("poll_id", pollId)
            .eq("owner_user_id", currentUserId)
            .in("date_key", datesToDelete);

          if (deleteError) throw deleteError;
        }

        const rowsToUpsert = flattenPersonAvailability(normalizedDraft, trimmedName, currentUserId, pollId);
        if (rowsToUpsert.length > 0) {
          const { error: upsertError } = await supabase
            .from("meeting_availability")
            .upsert(rowsToUpsert, { onConflict: "poll_id,participant_name,date_key" });

          if (upsertError) throw upsertError;
        }

        await fetchAllAvailability(false);
        setConnectionStatus("online");
      } else {
        setAvailability((prev) => ({
          ...prev,
          [trimmedName]: normalizedDraft,
        }));
        setConnectionStatus("local");
      }

      setSavedMyName(trimmedName);
      setMyName(trimmedName);
      setDraftAvailability(normalizedDraft);
      setIsDirty(false);
      setSaveMessage("Deine Verfügbarkeit wurde gespeichert.");
    } catch (error) {
      console.error(error);
      setConnectionStatus(supabase ? "error" : "local");
      setSaveMessage("Speichern fehlgeschlagen. Bitte Tabellenstruktur, RLS-Policy, anonyme Anmeldung und Netzwerk prüfen.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeMyAvailability(): Promise<void> {
    const trimmedName = activeParticipant.trim();
    if (!trimmedName) return;

    const supabase = supabaseRef.current;
    if (supabase && (!authReady || !currentUserId)) {
      setSaveMessage("Die anonyme Anmeldung ist noch nicht bereit. Löschen ist im Moment nicht möglich.");
      return;
    }

    setIsSaving(true);
    try {
      if (supabase) {
        const { error } = await supabase
          .from("meeting_availability")
          .delete()
          .eq("poll_id", pollId)
          .eq("owner_user_id", currentUserId);
        if (error) throw error;
        await fetchAllAvailability(false);
      } else {
        setAvailability((prev) => {
          const next = { ...prev };
          delete next[trimmedName];
          return next;
        });
      }

      setDraftAvailability({});
      setIsDirty(false);
      setSaveMessage("Deine gespeicherten Zeiten wurden gelöscht.");
    } catch (error) {
      console.error(error);
      setSaveMessage("Löschen fehlgeschlagen. Bitte später erneut versuchen.");
    } finally {
      setIsSaving(false);
    }
  }

  function goPrevMonth(): void {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  }

  function goNextMonth(): void {
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  }

  function getHeatForDay(dateKey: string): number {
    if (participants.length === 0) return 0;
    let maxMatched = 0;
    TIME_SLOTS.forEach((slot) => {
      const count = participants.filter((p) => (availability[p]?.[dateKey] || []).includes(slot.id)).length;
      if (count > maxMatched) maxMatched = count;
    });
    return maxMatched;
  }

  const todayKey = formatDateKey(new Date());
  const mySavedAvailability = savedMyName ? normalizePersonAvailability(availability[savedMyName] || {}) : {};
  const hasServerDiff = savedMyName ? !arePersonAvailabilityEqual(mySavedAvailability, draftAvailability) : false;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-2xl shadow-sm md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <CalendarDays className="h-6 w-6" />
                Team-Terminabstimmung
              </CardTitle>
              <p className="text-sm text-slate-600">
                Jede Person bearbeitet und speichert nur ihre eigene Verfügbarkeit. Die Seite meldet sich anonym bei Supabase an und synchronisiert die Daten in Echtzeit.
              </p>
            </CardHeader>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Cloud className="h-5 w-5" />
                Synchronisationsstatus
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                {connectionStatus === "online" ? (
                  <>
                    <Wifi className="h-4 w-4" />
                    <span>Echtzeit-Synchronisierung aktiv</span>
                  </>
                ) : connectionStatus === "local" ? (
                  <>
                    <WifiOff className="h-4 w-4" />
                    <span>Lokaler Demo-Modus</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4" />
                    <span>Verbindung fehlerhaft</span>
                  </>
                )}
              </div>

              <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
                Poll ID: <span className="font-semibold">{pollId}</span>
              </div>

              <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">
                Aktuelle Identität: <span className="font-semibold">{authReady && currentUserId ? `${currentUserId.slice(0, 8)}…` : authError ? "Anmeldung fehlgeschlagen" : "Nicht bereit"}</span>
              </div>

              <Button variant="outline" className="w-full gap-2" onClick={() => void fetchAllAvailability(true)} disabled={isRefreshing || isLoading}>
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                {isRefreshing ? "Wird aktualisiert…" : "Online-Daten aktualisieren"}
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {!supabaseRef.current && (
          <Alert className="rounded-2xl border-amber-200 bg-amber-50">
            <AlertDescription className="text-sm leading-6 text-amber-900">
              NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY sind noch nicht gesetzt. Die Seite läuft nur im lokalen Demo-Modus.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-[1.3fr_0.9fr]">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xl">Datum wählen</CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={goPrevMonth}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="min-w-[150px] text-center font-medium capitalize">{monthLabel}</div>
                  <Button variant="outline" size="icon" onClick={goNextMonth}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2 text-center text-sm text-slate-500">
                {WEEKDAYS.map((day) => (
                  <div key={day} className="py-2 font-medium">
                    {day}
                  </div>
                ))}
              </div>
              <div className="mt-2 grid gap-2">
                {weeks.map((week, i) => (
                  <div key={String(i)} className="grid grid-cols-7 gap-2">
                    {week.map((date) => {
                      const dateKey = formatDateKey(date);
                      const inCurrentMonth = date.getMonth() === currentMonth.getMonth();
                      const isSelected = dateKey === selectedDate;
                      const isToday = dateKey === todayKey;
                      const heat = getHeatForDay(dateKey);
                      const hasOwnSelection = Boolean((draftAvailability[dateKey] || []).length);

                      return (
                        <button
                          key={dateKey}
                          onClick={() => setSelectedDate(dateKey)}
                          className={`min-h-[84px] rounded-2xl border p-2 text-left transition hover:shadow-sm ${
                            isSelected
                              ? "border-2 border-emerald-500 ring-2 ring-emerald-100"
                              : hasOwnSelection
                                ? "border-blue-200 bg-blue-50"
                                : "border-slate-200 bg-white"
                          } ${!inCurrentMonth ? "opacity-40" : "opacity-100"}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-medium ${hasOwnSelection ? "text-blue-700" : "text-slate-900"}`}>{date.getDate()}</span>
                            <div className="flex items-center gap-1">
                              {isToday && <Badge variant="secondary">Heute</Badge>}
                              {heat > 0 && <Badge variant="outline">{heat} frei</Badge>}
                            </div>
                          </div>
                          <div className="mt-3 space-y-1">
                            {TIME_SLOTS.map((slot) => {
                              const key = `${dateKey}__${slot.id}`;
                              const count = participantCountPerSlot[key] || 0;
                              if (count === 0) return null;
                              return (
                                <div key={slot.id} className="text-[11px] text-slate-700">
                                  {slot.label.split(" ")[0]}: {count}/{participants.length || 0}
                                </div>
                              );
                            })}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <User className="h-5 w-5" />
                  Meine Eingabe
                </CardTitle>
                <p className="text-sm text-slate-600">Zuerst den angezeigten Namen eingeben. Die Schreibrechte werden über die anonyme Supabase-Anmeldung gesteuert.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input value={participantNameInput} onChange={(e) => setParticipantNameInput(e.target.value)} placeholder="Deinen Namen eingeben" onKeyDown={(e) => e.key === "Enter" && registerMe()} />
                  <Button onClick={registerMe}>Name bestätigen</Button>
                </div>

                {savedMyName ? (
                  <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
                    Aktuelle Person: <span className="font-semibold">{savedMyName}</span>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Bitte zuerst einen Namen bestätigen.</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">Verfügbarkeit eintragen</CardTitle>
                <p className="text-sm text-slate-600">Aktuelles Datum: {formatDateDE(selectedDate)}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoading ? (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Daten und anonyme Anmeldung werden vorbereitet…</div>
                ) : supabaseRef.current && !authReady ? (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-amber-700">
                    {authError || "Die anonyme Anmeldung ist noch nicht bereit. Bitte Supabase Auth prüfen und die Seite neu laden."}
                  </div>
                ) : !savedMyName ? (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Bitte zuerst deinen Namen bestätigen.</div>
                ) : (
                  <>
                    <div className="space-y-3">
                      {TIME_SLOTS.map((slot) => {
                        const checked = selectedSlots.includes(slot.id);
                        return (
                          <label key={slot.id} className="flex cursor-pointer items-center justify-between rounded-xl border p-3 hover:bg-slate-50">
                            <div>
                              <div className="font-medium">{slot.label}</div>
                              <div className="text-sm text-slate-500">Diese Zeitspanne ankreuzen, wenn du verfügbar bist.</div>
                            </div>
                            <Checkbox checked={checked} onCheckedChange={() => toggleSlot(slot.id)} />
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={clearSelectedDateForParticipant}>
                        Auswahl für diesen Tag löschen
                      </Button>
                      <Button variant="destructive" className="flex-1" onClick={() => void removeMyAvailability()} disabled={isSaving || !savedMyName}>
                        Alle meine Zeiten löschen
                      </Button>
                    </div>

                    <Button className="w-full gap-2" onClick={() => void saveMyAvailability()} disabled={isSaving || !savedMyName || !isDirty}>
                      <Save className="h-4 w-4" />
                      {isSaving ? "Wird gespeichert…" : isDirty ? "Meine Auswahl speichern" : "Gespeichert"}
                    </Button>

                    {hasServerDiff && !isDirty && (
                      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Der lokale Entwurf weicht von den Serverdaten ab. Bitte Auswahl prüfen und erneut speichern.</div>
                    )}
                  </>
                )}

                {saveMessage && <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{saveMessage}</div>}
              </CardContent>
            </Card>

            <Card className="rounded-2xl shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <CheckCircle2 className="h-5 w-5" />
                  Automatisch gefundene gemeinsame Zeiten
                </CardTitle>
              </CardHeader>
              <CardContent>
                {participants.length === 0 ? (
                  <p className="text-sm text-slate-500">Es wurden noch keine Zeiten gespeichert.</p>
                ) : commonSlots.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Derzeit wurde noch kein gemeinsamer Termin für alle gefunden.</div>
                ) : (
                  <div className="space-y-3">
                    {commonSlots.map((item) => (
                      <motion.div key={`${item.dateKey}-${item.slotId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border bg-slate-50 p-3">
                        <div className="font-medium">{formatDateDE(item.dateKey)}</div>
                        <div className="mt-1 text-sm text-slate-600">{item.slotLabel}</div>
                        <div className="mt-2 text-xs text-slate-500">Alle {participants.length} gespeicherten Teilnehmenden sind verfügbar.</div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Users className="h-5 w-5" />
              Teilnehmende
            </CardTitle>
          </CardHeader>
          <CardContent>
            {participants.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Noch keine Teilnehmenden vorhanden.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {participants.map((name) => (
                  <Badge key={name} variant={name === savedMyName ? "default" : "secondary"}>
                    {name}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <UserCheck className="h-5 w-5" />
              Gespeicherte Verfügbarkeiten
            </CardTitle>
            <p className="text-sm text-slate-600">Hier werden nur die bereits im System gespeicherten Daten angezeigt.</p>
          </CardHeader>
          <CardContent>
            {participants.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Noch keine gespeicherten Verfügbarkeiten vorhanden.</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {participantSelections.map((person) => (
                  <div key={person.name} className="rounded-2xl border bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-base font-semibold">{person.name}</div>
                      <Badge variant="secondary">{person.totalCount} Einträge</Badge>
                    </div>

                    {person.entries.length === 0 ? (
                      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Für diese Person wurden noch keine Zeiten gespeichert.</div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {person.entries.map((entry) => (
                          <div key={`${person.name}-${entry.dateKey}`} className="rounded-xl bg-slate-50 p-3">
                            <div className="text-sm font-medium">{formatDateDE(entry.dateKey)}</div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {entry.labels.map((label) => (
                                <Badge key={`${entry.dateKey}-${label}`} variant="outline">
                                  {label}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
