"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import { CalendarDays, Users, CheckCircle2, ChevronLeft, ChevronRight, Save, RefreshCw } from "lucide-react";

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
  { id: "08:00-10:00", label: "08:00–10:00" },
  { id: "10:00-12:00", label: "10:00–12:00" },
  { id: "12:00-14:00", label: "12:00–14:00" },
  { id: "14:00-16:00", label: "14:00–16:00" },
  { id: "16:00-18:00", label: "16:00–18:00" },
  { id: "18:00-20:00", label: "18:00–20:00" },
] as const;

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const VIEW_TABS = ["Day", "Week", "Month", "Year"];
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

function flattenPersonAvailability(personAvailability: PersonAvailability, participantName: string, ownerUserId: string, pollId: string): MeetingRow[] {
  return Object.entries(personAvailability).map(([date_key, slots]) => ({
    poll_id: pollId,
    participant_name: participantName,
    owner_user_id: ownerUserId,
    date_key,
    slots: [...slots].sort(),
  }));
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

function getWeekStart(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = -day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function getWeekDays(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
}

function formatWeekRange(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setDate(weekStart.getDate() + 6);

  const startMonth = weekStart.toLocaleDateString("en-US", { month: "long" });
  const endMonth = end.toLocaleDateString("en-US", { month: "long" });
  const year = end.getFullYear();

  if (weekStart.getMonth() === end.getMonth() && weekStart.getFullYear() === end.getFullYear()) {
    return `${startMonth} ${weekStart.getDate()} – ${end.getDate()}, ${year}`;
  }

  return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${end.getDate()}, ${year}`;
}

export default function Page() {
  const [pollId, setPollId] = useState(DEFAULT_POLL_ID);
  const [weekStart, setWeekStart] = useState<Date>(getWeekStart(new Date()));
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
  const [currentUserId, setCurrentUserId] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const activeParticipant = savedMyName || myName;
  const weekDays = useMemo(() => getWeekDays(weekStart), [weekStart]);

  useEffect(() => {
    setPollId(getPollId());
    supabaseRef.current = createSupabaseBrowserClient();
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
      setSaveMessage("Online-Daten konnten nicht geladen werden. Bitte Supabase-Konfiguration, RLS oder Netzwerk prüfen.");
    } else {
      setAvailability(inflateRowsToAvailability((data || []) as Array<{ participant_name: string; date_key: string; slots: string[] }>));
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
        { event: "*", schema: "public", table: "meeting_availability", filter: `poll_id=eq.${pollId}` },
        async () => {
          await fetchAllAvailability(false);
        }
      )
      .subscribe();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setCurrentUserId(session?.user?.id || "");
      setAuthReady(Boolean(session?.user?.id));
      if (session?.user?.id) setAuthError("");
      if (event === "SIGNED_OUT") setSaveMessage("Die Sitzung ist abgelaufen. Bitte Seite neu laden.");
    });

    return () => {
      void supabase.removeChannel(channel);
      subscription.unsubscribe();
    };
  }, [pollId]);

  const participants = useMemo(() => Object.keys(availability).sort(), [availability]);
  const weekRangeLabel = useMemo(() => formatWeekRange(weekStart), [weekStart]);

  const cellCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(availability).forEach((personData) => {
      Object.entries(personData).forEach(([dateKey, slots]) => {
        slots.forEach((slotId) => {
          const key = `${dateKey}__${slotId}`;
          map[key] = (map[key] || 0) + 1;
        });
      });
    });
    return map;
  }, [availability]);

  const topThreeCellKeys = useMemo(() => {
    const ranked = weekDays
      .flatMap((day) => {
        const dateKey = formatDateKey(day);
        return TIME_SLOTS.map((slot) => ({
          key: `${dateKey}__${slot.id}`,
          dateKey,
          slotId: slot.id,
          count: cellCountMap[`${dateKey}__${slot.id}`] || 0,
        }));
      })
      .filter((item) => item.count > 0)
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
        return a.slotId.localeCompare(b.slotId);
      })
      .slice(0, 3);

    return new Set(ranked.map((item) => item.key));
  }, [cellCountMap, weekDays]);

  const majoritySlots = useMemo(() => {
    const totalParticipants = participants.length;
    if (totalParticipants === 0) return [] as Array<{ dateKey: string; slotId: string; label: string; count: number }>;

    const threshold = totalParticipants / 2;
    const result: Array<{ dateKey: string; slotId: string; label: string; count: number }> = [];

    weekDays.forEach((day) => {
      const dateKey = formatDateKey(day);
      TIME_SLOTS.forEach((slot) => {
        const count = cellCountMap[`${dateKey}__${slot.id}`] || 0;
        if (count > threshold) {
          result.push({ dateKey, slotId: slot.id, label: slot.label, count });
        }
      });
    });

    return result.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return a.slotId.localeCompare(b.slotId);
    });
  }, [cellCountMap, participants.length, weekDays]);

  function registerMe(): void {
    const trimmed = participantNameInput.trim();
    if (!trimmed) return;
    setMyName(trimmed);
    setSavedMyName(trimmed);
  }

  function toggleCell(dateKey: string, slotId: string): void {
    if (!activeParticipant) {
      setSaveMessage("Bitte zuerst deinen Namen bestätigen.");
      return;
    }

    const next = { ...draftAvailability };
    const existing = next[dateKey] || [];
    const updated = existing.includes(slotId) ? existing.filter((s) => s !== slotId) : [...existing, slotId];

    if (updated.length === 0) delete next[dateKey];
    else next[dateKey] = [...updated].sort();

    setDraftAvailability(normalizePersonAvailability(next));
    setIsDirty(true);
    setSaveMessage("");
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
      } else {
        setAvailability((prev) => ({ ...prev, [trimmedName]: normalizedDraft }));
      }

      setSavedMyName(trimmedName);
      setMyName(trimmedName);
      setDraftAvailability(normalizedDraft);
      setIsDirty(false);
      setSaveMessage("Deine Verfügbarkeit wurde gespeichert.");
    } catch (error) {
      console.error(error);
      setSaveMessage("Speichern fehlgeschlagen. Bitte Tabellenstruktur, RLS-Policy, anonyme Anmeldung und Netzwerk prüfen.");
    } finally {
      setIsSaving(false);
    }
  }

  function goPrevWeek(): void {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() - 7);
      return next;
    });
  }

  function goNextWeek(): void {
    setWeekStart((prev) => {
      const next = new Date(prev);
      next.setDate(prev.getDate() + 7);
      return next;
    });
  }

  function goToCurrentWeek(): void {
    setWeekStart(getWeekStart(new Date()));
  }

  const mySavedAvailability = savedMyName ? normalizePersonAvailability(availability[savedMyName] || {}) : {};
  const hasServerDiff = savedMyName ? !arePersonAvailabilityEqual(mySavedAvailability, draftAvailability) : false;

  return (
    <div className="min-h-screen bg-[#f6f7f4] p-3 sm:p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 lg:gap-6">
        <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm sm:px-6 sm:py-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Terminvereinbarer</div>
              <div className="mt-2 text-base text-slate-600 sm:text-lg">Meeting: Weiterentwicklung KS-Schallschutzrechners</div>
            </div>
            <Button variant="outline" className="w-full gap-2 sm:w-auto" onClick={() => void fetchAllAvailability(true)} disabled={isRefreshing || isLoading}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Wird aktualisiert…" : "Aktualisieren"}
            </Button>
          </div>
        </div>

        <Card className="rounded-[28px] border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <Users className="h-5 w-5" />
              Namen eingeben
            </CardTitle>
            <p className="text-sm leading-6 text-slate-600">1. Namen eingeben und auf „Bestätigen“ klicken. 2. Datum und Zeitfenster auswählen. 3. Auf „Auswahl speichern“ klicken.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row">
              <Input value={participantNameInput} onChange={(e) => setParticipantNameInput(e.target.value)} placeholder="Deinen Namen eingeben" onKeyDown={(e) => e.key === "Enter" && registerMe()} className="h-11 rounded-xl" />
              <div className="flex flex-col gap-3 sm:flex-row xl:w-auto">
                <Button onClick={registerMe} className="h-11 rounded-xl">Bestätigen</Button>
                <Button className="h-11 gap-2 rounded-xl" onClick={() => void saveMyAvailability()} disabled={isSaving || !savedMyName || !isDirty}>
                  <Save className="h-4 w-4" />
                  {isSaving ? "Wird gespeichert…" : "Auswahl speichern"}
                </Button>
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Daten und anonyme Anmeldung werden vorbereitet…</div>
            ) : supabaseRef.current && !authReady ? (
              <div className="rounded-2xl border border-dashed border-amber-300 p-4 text-sm text-amber-700">
                {authError || "Die anonyme Anmeldung ist noch nicht bereit. Bitte Supabase Auth prüfen und die Seite neu laden."}
              </div>
            ) : null}

            {hasServerDiff && !isDirty && (
              <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">Der lokale Entwurf weicht von den Serverdaten ab. Bitte erneut auswählen und speichern.</div>
            )}

            {saveMessage && <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">{saveMessage}</div>}
          </CardContent>
        </Card>

        {!supabaseRef.current && (
          <Alert className="rounded-[28px] border-amber-200 bg-amber-50">
            <AlertDescription className="text-sm leading-6 text-amber-900">
              NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY sind noch nicht gesetzt. Die Seite läuft nur im lokalen Demo-Modus.
            </AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden rounded-[28px] border-slate-200 shadow-sm">
          <CardHeader className="gap-4 border-b border-slate-100 pb-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="icon" className="h-14 w-14 rounded-[22px] border border-slate-200 bg-white" onClick={goPrevWeek} aria-label="Vorherige Woche">
                  <ChevronLeft className="h-7 w-7" />
                </Button>
                <div className="min-w-[260px] rounded-[24px] border border-slate-200 bg-white px-6 py-4 text-center text-2xl font-semibold text-slate-900 sm:min-w-[420px] sm:text-3xl">
                  {weekRangeLabel}
                </div>
                <Button variant="ghost" size="icon" className="h-14 w-14 rounded-[22px] border border-slate-200 bg-white" onClick={goNextWeek} aria-label="Nächste Woche">
                  <ChevronRight className="h-7 w-7" />
                </Button>
                <Button variant="outline" className="h-14 rounded-[22px] border-2 border-green-500 px-6 text-lg font-semibold text-green-600 hover:bg-green-50" onClick={goToCurrentWeek}>
                  Today
                </Button>
              </div>
            </div>
            <p className="text-sm text-slate-600">Ein Klick markiert ein Zeitfenster. Ein weiterer Klick entfernt die Auswahl wieder.</p>
          </CardHeader>

          <CardContent className="p-2 sm:p-3 lg:p-5">
            <div className="w-full">
              <div className="grid w-full grid-cols-[72px_repeat(7,minmax(0,1fr))] gap-1.5 sm:grid-cols-[84px_repeat(7,minmax(0,1fr))] sm:gap-2 lg:grid-cols-[110px_repeat(7,minmax(0,1fr))] lg:gap-3">
                <div />
                {weekDays.map((day, index) => {
                  const dateKey = formatDateKey(day);
                  const hasOwnSelection = Boolean((draftAvailability[dateKey] || []).length);
                  const isToday = formatDateKey(day) === formatDateKey(new Date());

                  return (
                    <div key={dateKey} className={`rounded-[18px] sm:rounded-[22px] lg:rounded-[28px] border border-slate-200 bg-white px-1 py-2 text-center sm:px-2 sm:py-3 lg:px-3 lg:py-5 ${hasOwnSelection ? "bg-blue-50" : ""}`}>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">{WEEKDAYS[index]}</div>
                      <div className={`mt-1 text-2xl font-semibold leading-none sm:text-3xl lg:mt-2 lg:text-5xl ${hasOwnSelection ? "text-blue-700" : "text-slate-800"}`}>{day.getDate()}</div>
                      {isToday && <div className="mt-1 text-[10px] text-slate-500 sm:text-xs lg:mt-3 lg:text-sm">Heute</div>}
                    </div>
                  );
                })}

                {TIME_SLOTS.map((slot) => (
                  <React.Fragment key={slot.id}>
                    <div className="flex items-start rounded-[18px] sm:rounded-[22px] lg:rounded-[28px] border border-slate-200 bg-white px-2 py-3 text-xs font-medium text-slate-700 sm:px-3 sm:py-4 sm:text-sm lg:px-4 lg:py-6 lg:text-2xl">
                      {slot.label}
                    </div>
                    {weekDays.map((day) => {
                      const dateKey = formatDateKey(day);
                      const selected = (draftAvailability[dateKey] || []).includes(slot.id);
                      const count = cellCountMap[`${dateKey}__${slot.id}`] || 0;
                      const hasAnySelection = count > 0;
                      const isTopThree = topThreeCellKeys.has(`${dateKey}__${slot.id}`);

                      return (
                        <button
                          key={`${dateKey}-${slot.id}`}
                          onClick={() => toggleCell(dateKey, slot.id)}
                          className={`relative min-h-[72px] rounded-[18px] px-1.5 py-1.5 text-left transition sm:min-h-[92px] sm:rounded-[22px] sm:px-2 sm:py-2 lg:min-h-[138px] lg:rounded-[28px] lg:px-4 lg:py-4 ${
                            isTopThree
                              ? selected
                                ? "border-4 border-blue-500 bg-green-600 text-white"
                                : "border border-slate-200 bg-green-600 text-white"
                              : hasAnySelection
                                ? selected
                                  ? "border-2 border-blue-500 bg-green-100 text-slate-800"
                                  : "border border-slate-200 bg-green-100 text-slate-800"
                                : "border border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex h-full items-end justify-end">
                            {hasAnySelection ? (
                              <Badge
                                variant="outline"
                                className={`px-1.5 py-0.5 text-xs font-semibold sm:px-2 sm:py-1 sm:text-sm lg:text-base ${
                                  isTopThree ? "border-white/40 bg-white/10 text-white" : "border-slate-200 text-slate-700"
                                }`}
                              >
                                {count} / {participants.length}
                              </Badge>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-[28px] border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <CheckCircle2 className="h-5 w-5" />
                Zeitfenster mit Mehrheit
              </CardTitle>
              <p className="text-sm text-slate-600">Angezeigt werden alle Zeitfenster, die von mehr als der Hälfte der Teilnehmenden gewählt wurden – sortiert von den meisten zu den wenigsten Stimmen.</p>
            </CardHeader>
            <CardContent>
              {participants.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Noch keine gespeicherten Teilnehmenden vorhanden.</div>
              ) : majoritySlots.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Für diese Woche liegt derzeit kein Zeitfenster mit Mehrheit vor.</div>
              ) : (
                <div className="space-y-3">
                  {majoritySlots.map((item) => (
                    <motion.div key={`${item.dateKey}-${item.slotId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{formatDateDE(item.dateKey)}</div>
                          <div className="mt-1 text-sm text-slate-600">{item.label}</div>
                        </div>
                        <Badge>{item.count} / {participants.length}</Badge>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                <Users className="h-5 w-5" />
                Teilnehmende
              </CardTitle>
            </CardHeader>
            <CardContent>
              {participants.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-500">Noch keine Teilnehmenden vorhanden.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {participants.map((name) => (
                    <Badge key={name} variant={name === savedMyName ? "default" : "secondary"} className="px-3 py-1.5">
                      {name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
