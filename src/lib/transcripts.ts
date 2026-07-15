export interface TranscriptChapter {
  title: string;
  description: string;
  startTime: number;
  endTime: number;
  /** Anchor slug for the transcription section (v3). */
  slug?: string;
}

export interface Transcript {
  schemaVersion: 2 | 3;
  videoId: string;
  language: string;
  source?: string;
  /** Cohesive ~500-char SEO description of the video topics (v3). */
  seoDescription?: string;
  chapters: TranscriptChapter[];
  summary: string;
  transcription: string;
}

const files = import.meta.glob<Transcript>("../data/transcripts/*.json", {
  eager: true,
  import: "default",
});

const BY_ID: Record<string, Transcript> = {};
for (const path in files) {
  const t = files[path];
  if (t?.videoId) BY_ID[t.videoId] = t;
}

export function getTranscript(videoId: string): Transcript | null {
  return BY_ID[videoId] ?? null;
}

/** "0:00", "6:40", "1:18:05" for a segment start in seconds. */
export function segmentTime(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}
