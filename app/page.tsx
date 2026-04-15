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
  const diff = day === 0 ? -6 : 1 - day;
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
  const sameMonth = weekStart.getMonth() === end.getMonth() && weekStart.getFullYear() === end.getFullYear();
  const startDay = weekStart.getDate();
  const endDay = end.getDate();

  if (sameMonth) {
    return `${startDay}.–${endDay}. ${weekStart.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}`;
  }

  return `${weekStart.toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
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

  const mySavedAvailability = savedMyName ? normalizePersonAvailability(availability[savedMyName] || {}) : {};
  const hasServerDiff = savedMyName ? !arePersonAvailabilityEqual(mySavedAvailability, draftAvailability) : false;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="text-3xl font-bold text-slate-900">Terminvereinbarer</div>
          <div className="mt-2 text-lg text-slate-700">Meeting: Weiterentwicklung KS-Schallschutzrechners</div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Users className="h-5 w-5" />
                Namen eingeben
              </CardTitle>
              <p className="text-sm text-slate-600">1. Namen eingeben und auf „Bestätigen“ klicken. 2. Datum und Zeitfenster auswählen. 3. Auf „Auswahl speichern“ klicken.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row">
                <Input value={participantNameInput} onChange={(e) => setParticipantNameInput(e.target.value)} placeholder="Deinen Namen eingeben" onKeyDown={(e) => e.key === "Enter" && registerMe()} />
                <Button onClick={registerMe}>Bestätigen</Button>
                <Button className="gap-2" onClick={() => void saveMyAvailability()} disabled={isSaving || !savedMyName || !isDirty}>
                  <Save className="h-4 w-4" />
                  {isSaving ? "Wird gespeichert…" : "Auswahl speichern"}
                </Button>
              </div>

              {isLoading ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Daten und anonyme Anmeldung werden vorbereitet…</div>
              ) : supabaseRef.current && !authReady ? (
                <div className="rounded-xl border border-dashed p-4 text-sm text-amber-700">
                  {authError || "Die anonyme Anmeldung ist noch nicht bereit. Bitte Supabase Auth prüfen und die Seite neu laden."}
                </div>
              ) : null}

              {hasServerDiff && !isDirty && (
                <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Der lokale Entwurf weicht von den Serverdaten ab. Bitte erneut auswählen und speichern.</div>
              )}

              {saveMessage && <div className="rounded-xl bg-slate-100 p-3 text-sm text-slate-600">{saveMessage}</div>}
            </CardContent>
          </Card>

          <div className="flex items-start justify-end">
            <Button variant="outline" className="gap-2" onClick={() => void fetchAllAvailability(true)} disabled={isRefreshing || isLoading}>
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              {isRefreshing ? "Wird aktualisiert…" : "Aktualisieren"}
            </Button>
          </div>
        </div>

        {!supabaseRef.current && (
          <Alert className="rounded-2xl border-amber-200 bg-amber-50">
            <AlertDescription className="text-sm leading-6 text-amber-900">
              NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY sind noch nicht gesetzt. Die Seite läuft nur im lokalen Demo-Modus.
            </AlertDescription>
          </Alert>
        )}

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-xl">Wochenkalender</CardTitle>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={goPrevWeek} aria-label="Vorherige Woche">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-center text-sm font-medium">
                  {weekRangeLabel}
                </div>
                <Button variant="outline" size="icon" onClick={goNextWeek} aria-label="Nächste Woche">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="text-sm text-slate-600">Ein Klick markiert ein Zeitfenster blau. Ein weiterer Klick entfernt die Auswahl wieder.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-[110px_repeat(7,minmax(0,1fr))] gap-2">
              <div />
              {weekDays.map((day, index) => {
                const dateKey = formatDateKey(day);
                const hasOwnSelection = Boolean((draftAvailability[dateKey] || []).length);
                const isToday = formatDateKey(day) === formatDateKey(new Date());

                return (
                  <div key={dateKey} className={`rounded-2xl border p-3 text-center ${hasOwnSelection ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"}`}>
                    <div className="text-xs uppercase tracking-wide text-slate-500">{WEEKDAYS[index]}</div>
                    <div className={`mt-1 text-2xl font-semibold ${hasOwnSelection ? "text-blue-700" : "text-slate-800"}`}>{day.getDate()}</div>
                    {isToday && <div className="mt-1 text-xs text-slate-500">Heute</div>}
                  </div>
                );
              })}

              {TIME_SLOTS.map((slot) => (
                <React.Fragment key={slot.id}>
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-white px-3 py-4 text-sm font-medium text-slate-700">
                    {slot.label}
                  </div>
                  {weekDays.map((day) => {
                    const dateKey = formatDateKey(day);
                    const selected = (draftAvailability[dateKey] || []).includes(slot.id);
                    const count = cellCountMap[`${dateKey}__${slot.id}`] || 0;

                    return (
                      <button
                        key={`${dateKey}-${slot.id}`}
                        onClick={() => toggleCell(dateKey, slot.id)}
                        className={`min-h-[88px] rounded-2xl border p-3 text-left transition ${selected ? "border-blue-400 bg-blue-500 text-white hover:bg-blue-500" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                      >
                        <div className="flex h-full items-end justify-end">
                          <Badge variant="outline" className={selected ? "border-white/40 bg-white/10 text-white" : "border-slate-200 text-slate-700"}>
                            {count} / {participants.length}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-5 w-5" />
              Zeitfenster mit Mehrheit
            </CardTitle>
            <p className="text-sm text-slate-600">Angezeigt werden alle Zeitfenster, die von mehr als der Hälfte der Teilnehmenden gewählt wurden – sortiert von den meisten zu den wenigsten Stimmen.</p>
          </CardHeader>
          <CardContent>
            {participants.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Noch keine gespeicherten Teilnehmenden vorhanden.</div>
            ) : majoritySlots.length === 0 ? (
              <div className="rounded-xl border border-dashed p-4 text-sm text-slate-500">Für diese Woche liegt derzeit kein Zeitfenster mit Mehrheit vor.</div>
            ) : (
              <div className="space-y-3">
                {majoritySlots.map((item) => (
                  <motion.div key={`${item.dateKey}-${item.slotId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border bg-slate-50 p-3">
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
      </div>
    </div>
  );
}
