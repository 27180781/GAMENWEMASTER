/**
 * חיבור המסך הראשי לשידור החי (מסך הצפייה, ‎?view=‎).
 *
 * פעיל רק במשחק אונליין — כשהטלפונים הם מקור ההצבעות ויש קוד חדר — ורק כשיש
 * מזהה משחק (ממנו נגזר מפתח השידור, token.ts). GameHost מעביר בכל רינדור את
 * מה שמוצג עכשיו (`frame`); המצב עצמו נבנה ונשלח לכל היותר כמה פעמים בשנייה
 * (publisher.ts), עם כל כללי ההסתרה (snapshot.ts).
 *
 * שום כשל כאן לא נוגע במשחק: אין חיבור — המשחק ממשיך כרגיל, והשידור מנסה שוב.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AudioManager } from '../app/AudioManager.ts';
import { imageRevealBlurFor, imageRevealOf } from '../engine/imageReveal.ts';
import { NO_MEDIA, nextMediaClock, type MediaClock } from './mediaClock.ts';
import { LivePublisher, type PublisherStatus } from './publisher.ts';
import { RevealThumbs } from './revealThumb.ts';
import { LiveSnapshotBuilder, type LiveHostInput } from './snapshot.ts';
import { SoundTrack } from './soundTrack.ts';
import { livePublishKey, liveRelayBase, liveViewToken, liveViewUrl } from './token.ts';

/** מה ש-GameHost מעביר: כל מה שמוצג, בלי מה שהשידור מחשב בעצמו. */
export type LiveHostFrame = Omit<
  LiveHostInput,
  'sound' | 'cues' | 'applause' | 'revealThumb' | 'mediaStartedAt' | 'scoresPage'
>;

export interface LivePublisherHandle {
  /** AllScoresScreen מדווח איזה עמוד מוצג — כדי שהצופים יראו את אותו עמוד. */
  onScoresPage: (page: number) => void;
  status: PublisherStatus | null;
  /** קישור הצפייה של המשחק (null כשהשידור כבוי או עוד מחושב). */
  viewUrl: string | null;
}

export function useLivePublisher({
  enabled,
  gameId,
  roomId,
  audio,
  frame,
}: {
  enabled: boolean;
  gameId: string;
  roomId: string;
  audio: AudioManager;
  frame: LiveHostFrame;
}): LivePublisherHandle {
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const publisherRef = useRef<LivePublisher | null>(null);
  const scoresPageRef = useRef(0);
  const mediaRef = useRef<MediaClock>(NO_MEDIA);
  const [status, setStatus] = useState<PublisherStatus | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  const active = enabled && gameId.trim() !== '' && roomId.trim() !== '';

  // useLayoutEffect ולא useEffect: מוזיקת מסך הפתיחה מתחילה באפקט של GameHost
  // כבר בקומיט הראשון, ואפקט רגיל כאן היה מחבר את המאזין אחריו — כך הצופים
  // לא שמעו אותה אף פעם. אפקט layout רץ לפני כל האפקטים הרגילים של הקומיט.
  useLayoutEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let publisher: LivePublisher | null = null;
    const track = new SoundTrack();
    const builder = new LiveSnapshotBuilder();
    const thumbs = new RevealThumbs(() => publisherRef.current?.poke());
    audio.setObserver((event) => {
      if (track.record(event)) publisherRef.current?.poke();
    });

    const build = () => {
      const f = frameRef.current;
      let revealThumb: string | null = null;
      const slide = f.game.questions[f.state.currentSlideIndex];
      const reveal = slide === undefined ? null : imageRevealOf(slide);
      if (
        slide !== undefined &&
        reveal !== null &&
        f.state.phase !== 'results' &&
        f.state.phase !== 'ended'
      ) {
        const t = f.timer;
        const elapsed =
          t === null ? null : t.elapsedMs + (t.paused ? 0 : Math.max(0, Date.now() - t.sampledAt));
        const blur = imageRevealBlurFor(f.state.phase, reveal.blur, elapsed, reveal.durationMs);
        revealThumb = thumbs.get(slide.question.src, blur);
      }
      return builder.build({
        ...f,
        sound: track.sound,
        cues: track.cues,
        applause: track.applause,
        revealThumb,
        mediaStartedAt: mediaRef.current.at,
        scoresPage: scoresPageRef.current,
      });
    };

    void (async () => {
      try {
        const publishKey = await livePublishKey(gameId, roomId);
        const viewToken = await liveViewToken(publishKey);
        if (cancelled) return;
        publisher = new LivePublisher({
          relayBase: liveRelayBase(),
          viewToken,
          publishKey,
          snapshot: build,
          onStatus: (s) => setStatus(s),
        });
        publisherRef.current = publisher;
        setViewUrl(liveViewUrl(viewToken));
      } catch {
        // אין Web Crypto (הקשר לא מאובטח) — אין שידור, המשחק ממשיך כרגיל.
      }
    })();

    return () => {
      cancelled = true;
      audio.setObserver(null);
      publisher?.stop();
      publisherRef.current = null;
      setStatus(null);
      setViewUrl(null);
    };
  }, [active, gameId, roomId, audio]);

  // מתי התחילה המדיה החוסמת הנוכחית — כדי שצופה שנכנס באמצע יקפוץ לאותה נקודה.
  // הזמן שבו עמדה מתחת לשכבה חוסמת לא נספר (mediaClock.ts).
  const mediaKey =
    frame.state.activeMedia === null
      ? null
      : `${frame.state.currentSlideId}:${frame.state.activeMedia}`;
  const mediaHeld = frame.paused;
  useEffect(() => {
    mediaRef.current = nextMediaClock(mediaRef.current, mediaKey, mediaHeld, Date.now());
  }, [mediaKey, mediaHeld]);

  // כל רינדור של המסך הראשי — אולי משהו השתנה. הבנייה עצמה מוגבלת בקצב.
  useEffect(() => {
    publisherRef.current?.poke();
  });

  const onScoresPage = useCallback((page: number) => {
    scoresPageRef.current = page;
    publisherRef.current?.poke();
  }, []);

  return { onScoresPage, status, viewUrl };
}
