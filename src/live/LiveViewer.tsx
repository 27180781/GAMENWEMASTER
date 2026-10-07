/**
 * מסך הצפייה (‎?view=<קוד>‎) — המסך הראשי של משחק אונליין, בשידור חי: בלי
 * מקלדת, בלי כפתורי משחק ובלי שום דרך להשפיע על המסך עצמו.
 *
 * הוא מרנדר את אותם רכיבים כמו GameHost, באותו סדר שכבות, מתוך מצב המסך
 * שהמסך הראשי משדר (subscriber.ts → mirrorEngine.ts). **שינוי במה שהמסך
 * הראשי מציג (GameHost.tsx, החלק שאחרי `return (`) צריך להשתקף גם כאן.**
 *
 * מה שיש לצופה בלבד: הפעלת צליל (דפדפנים לא מנגנים קול בלי נגיעה של
 * המשתמש — עד אז סרטונים מתנגנים מושתקים), מסך מלא, ולמי שכותב את שמו —
 * שלט הצבעה ליד המסך (VotePad.tsx), שעונה דרך שרת ההצבעות בדיוק כמו טלפון.
 * כשהמנחה משדר וידאו (תוספת בתשלום, video/) — חלון עם המצלמה והקול שלו.
 */

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AudioManager, type SoundChannel } from '../app/AudioManager.ts';
import { JOIN_DIAL_DISPLAY } from '../app/urlParams.ts';
import { EMPTY_ROSTER, type RosterData } from '../app/roster.ts';
import type { GameState } from '../engine/index.ts';
import { setAvatarColorOverrides } from '../render/avatar.ts';
import { BetResultsOverlay } from '../render/BetResultsOverlay.tsx';
import { GroupConnectScreen } from '../render/GroupConnectScreen.tsx';
import { GroupStandingsOverlay } from '../render/GroupStandingsOverlay.tsx';
import {
  LiveMirrorContext,
  MediaClockContext,
  MediaMutedContext,
  MediaPauseContext,
} from '../render/mediaPause.ts';
import { QrCode } from '../render/QrCode.tsx';
import { RaffleOverlay } from '../render/RaffleOverlay.tsx';
import {
  AllScoresScreen,
  LobbyScreen,
  WinnersListScreen,
  WinnersScreen,
} from '../render/screens.tsx';
import { SlideView } from '../render/SlideView.tsx';
import { SnakesLaddersBoard } from '../render/SnakesLaddersBoard.tsx';
import { Stage } from '../render/Stage.tsx';
import { themeRootProps } from '../render/theme.ts';
import type { TimerView } from '../render/TimerRing.tsx';
import { VotesBreakdown } from '../render/VotesBreakdown.tsx';
import { mirrorEngine } from './mirrorEngine.ts';
import { JoinCard, VotePad } from './VotePad.tsx';
import { joinFields, padRoom, postToVoteServer, savePlayerName } from './votePad.ts';
import { mirrorSoundActions } from './soundTrack.ts';
import { LiveSubscriber, type ViewerConnection, type ViewerUpdate } from './subscriber.ts';
import { isViewToken, liveRelayBase } from './token.ts';
import type { LiveSnapshot, LiveTimer } from './types.ts';
import { HostVideoTile, useHostVideoReceiver } from './video/HostVideoTile.tsx';
import { setHostVideoSound } from './video/hostVideoElement.ts';
import './liveViewer.css';

const SOUND_CHANNELS: readonly SoundChannel[] = [
  'playersConnecting',
  'showQuestion',
  'winners',
  'winnersList',
  'generic',
  'timer',
  'inShowAns',
];

function channelOf(channel: string): SoundChannel {
  return (SOUND_CHANNELS as readonly string[]).includes(channel)
    ? (channel as SoundChannel)
    : 'generic';
}

/** הטיימר ברגע `now` (שעון מקומי), מתוך העוגן שהמסך הראשי שלח. */
export function timerFromAnchor(anchor: LiveTimer, anchorLocalAt: number, now: number): TimerView {
  const ran = anchor.paused ? 0 : Math.max(0, now - anchorLocalAt);
  return {
    remaining: Math.max(0, anchor.remaining - ran / 1000),
    total: anchor.total,
    paused: anchor.paused,
    elapsedMs: anchor.elapsedMs + ran,
    sampledAt: now,
  };
}

/** הודעת המצב לצופה, או null כשהכול תקין. */
function connectionNotice(connection: ViewerConnection, hasSnapshot: boolean): string | null {
  switch (connection) {
    case 'live':
      return null;
    case 'outdated':
      return 'המסך הראשי עודכן לגרסה חדשה — רעננו את הדף';
    case 'offline':
      return 'החיבור נותק — מתחברים מחדש…';
    case 'waiting':
      return hasSnapshot ? 'ממתינים למסך הראשי…' : null;
    case 'connecting':
      return hasSnapshot ? 'מתחברים…' : null;
  }
}

/** מסך המתנה — לפני שהמסך הראשי שידר משהו. */
function WaitingScreen({ connection }: { connection: ViewerConnection }) {
  const text =
    connection === 'offline'
      ? 'אין חיבור לשרת — מנסים שוב…'
      : connection === 'outdated'
        ? 'המסך הראשי עודכן לגרסה חדשה — רעננו את הדף'
        : connection === 'connecting'
          ? 'מתחברים…'
          : 'המשחק יופיע כאן ברגע שהמנחה יפתח אותו';
  return (
    <div className="live-waiting" dir="rtl">
      <div className="live-waiting-box">
        <div className="live-waiting-icon">📺</div>
        <h1>מסך הצפייה</h1>
        <p>{text}</p>
        {connection !== 'outdated' && <span className="spinner" />}
      </div>
    </div>
  );
}

/** מה שמוצג כשהמסך לא הצליח להצטייר — עד העדכון הבא מהמסך הראשי. */
function ScreenFallback() {
  return (
    <div className="live-waiting" dir="rtl">
      <div className="live-waiting-box">
        <div className="live-waiting-icon">📺</div>
        <h1>מסך הצפייה</h1>
        <p>ממתינים לעדכון מהמסך הראשי…</p>
        <span className="spinner" />
      </div>
    </div>
  );
}

interface RenderGuardProps {
  /** מתחלף בכל עדכון מהמסך הראשי — ואז מנסים לצייר שוב. */
  resetKey: unknown;
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * שגיאה בציור (למשל מצב ממסך ראשי בגרסה אחרת) לא משאירה דף ריק ולא עוצרת את
 * החיבור: מוצג `fallback`, והעדכון הבא מנסה שוב.
 */
class RenderGuard extends Component<RenderGuardProps, { failed: boolean; key: unknown }> {
  state = { failed: false, key: this.props.resetKey };

  static getDerivedStateFromProps(
    props: RenderGuardProps,
    state: { failed: boolean; key: unknown },
  ): { failed: boolean; key: unknown } | null {
    return props.resetKey === state.key ? null : { failed: false, key: props.resetKey };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function LiveViewer({ token, voteServerUrl }: { token: string; voteServerUrl: string }) {
  if (!isViewToken(token)) {
    return (
      <div className="live-viewer">
        <div className="live-waiting" dir="rtl">
          <div className="live-waiting-box">
            <div className="live-waiting-icon">🔗</div>
            <h1>הקישור אינו תקין</h1>
            <p>בקשו מהמנחה את קישור הצפייה שוב.</p>
          </div>
        </div>
      </div>
    );
  }
  return <ValidLiveViewer token={token} voteServerUrl={voteServerUrl} />;
}

/**
 * ‏ask — חלונית השם פתוחה (בכניסה, או כשביקשו להחליף שם / לחזור להצבעה);
 * watch — רק צופים; play — עם שלט הצבעה, בשם הזה.
 */
type PlayerMode =
  { phase: 'ask'; name: string | null } | { phase: 'watch' } | { phase: 'play'; name: string };

function ValidLiveViewer({ token, voteServerUrl }: { token: string; voteServerUrl: string }) {
  const [update, setUpdate] = useState<ViewerUpdate>({
    snapshot: null,
    connection: 'connecting',
    toLocal: (t) => t,
  });

  const relayBase = useMemo(() => liveRelayBase(), []);
  useEffect(() => {
    const subscriber = new LiveSubscriber({ relayBase, viewToken: token, onUpdate: setUpdate });
    subscriber.start();
    return () => subscriber.stop();
  }, [relayBase, token]);

  useEffect(() => {
    document.title = 'מסך צפייה · חוויה בקליק';
  }, []);

  const snap = update.snapshot;
  // השלט צריך את קוד החדר — הוא מגיע עם המסך הראשון מהמסך הראשי.
  const room = snap === null ? null : padRoom(snap);
  const [player, setPlayer] = useState<PlayerMode>({ phase: 'ask', name: null });

  // הצטרפות (‎/game/join‎): המשתתף מופיע בלובי של המסך הראשי. גם כשקוד החדר
  // או השם מתחלפים.
  const playName = player.phase === 'play' ? player.name : null;
  useEffect(() => {
    if (playName === null || room === null) return;
    void postToVoteServer(voteServerUrl, '/game/join', joinFields(room, playName));
  }, [playName, room, voteServerUrl]);

  const join = (name: string) => {
    savePlayerName(name);
    setPlayer({ phase: 'play', name });
  };
  const previousName = player.phase === 'ask' ? player.name : null;
  const cancelAsk = () =>
    setPlayer(previousName !== null ? { phase: 'play', name: previousName } : { phase: 'watch' });

  const pad =
    snap !== null && room !== null && player.phase === 'play' ? (
      <RenderGuard resetKey={snap} fallback={<aside className="live-pad" />}>
        <VotePad
          snap={snap}
          name={player.name}
          voteServerUrl={voteServerUrl}
          onChangeName={() => setPlayer({ phase: 'ask', name: player.name })}
          onClose={() => setPlayer({ phase: 'watch' })}
        />
      </RenderGuard>
    ) : null;
  const overlay =
    snap !== null && room !== null && player.phase === 'ask' ? (
      <JoinCard
        initialName={player.name}
        gameName={snap.game.name}
        changing={player.name !== null}
        onJoin={join}
        onWatch={cancelAsk}
      />
    ) : null;
  const playButton =
    room !== null && player.phase === 'watch' ? (
      <button
        type="button"
        className="live-btn live-btn--play"
        onClick={() => setPlayer({ phase: 'ask', name: null })}
        title="שלט הצבעה"
      >
        🙋 להצבעה
      </button>
    ) : null;

  // וידאו המנחה: מתחברים רק כשהמנחה משדר ורק כל עוד הצופה לא הסתיר אותו.
  const hostVideo = snap?.video ?? null;
  const [videoHidden, setVideoHidden] = useState(false);
  const receiver = useHostVideoReceiver(
    relayBase,
    token,
    hostVideo === null || videoHidden ? null : hostVideo.gen,
  );
  const video =
    hostVideo !== null && !videoHidden && receiver.phase !== 'unavailable'
      ? (soundOn: boolean) => (
          <HostVideoTile
            receiver={receiver}
            video={hostVideo}
            soundOn={soundOn}
            onHide={() => setVideoHidden(true)}
          />
        )
      : null;
  const videoButton =
    hostVideo !== null && videoHidden ? (
      <button
        type="button"
        className="live-btn"
        onClick={() => setVideoHidden(false)}
        title="הצגת הווידאו של המנחה"
      >
        🎥 המנחה
      </button>
    ) : null;
  const extraControl =
    playButton === null && videoButton === null ? null : (
      <>
        {videoButton}
        {playButton}
      </>
    );

  return (
    <RenderGuard
      resetKey={snap}
      fallback={
        <div className="live-viewer">
          <ScreenFallback />
        </div>
      }
    >
      <ViewerChrome
        connection={update.connection}
        hasSnapshot={snap !== null}
        soundSource={snap}
        toLocal={update.toLocal}
        pad={pad}
        video={video}
        overlay={overlay}
        extraControl={extraControl}
      >
        {(soundOn) =>
          snap === null ? (
            <WaitingScreen connection={update.connection} />
          ) : (
            <RenderGuard resetKey={snap} fallback={<ScreenFallback />}>
              <LiveScreen snap={snap} toLocal={update.toLocal} soundOn={soundOn} />
            </RenderGuard>
          )
        }
      </ViewerChrome>
    </RenderGuard>
  );
}

/**
 * מה שמסביב למסך: הפעלת צליל, מסך מלא והודעת חיבור. הכפתורים נעלמים אחרי
 * כמה שניות בלי תנועה, וחוזרים בנגיעה — כדי שלא יסתירו את המשחק. עם שלט
 * הצבעה (`pad`) או וידאו של המנחה (`video`) המסך מתכווץ ומפנה להם עמודה: בצד,
 * או מתחת בטלפון לאורך.
 */
function ViewerChrome({
  connection,
  hasSnapshot,
  soundSource,
  toLocal,
  pad = null,
  video = null,
  overlay = null,
  extraControl = null,
  children,
}: {
  connection: ViewerConnection;
  hasSnapshot: boolean;
  soundSource: LiveSnapshot | null;
  toLocal: (hostTime: number) => number;
  pad?: ReactNode;
  /** חלון הווידאו של המנחה — לפי מצב הצליל. */
  video?: ((soundOn: boolean) => ReactNode) | null;
  overlay?: ReactNode;
  extraControl?: ReactNode;
  children: (soundOn: boolean) => ReactNode;
}) {
  const [soundOn, setSoundOn] = useState(false);
  const [controlsShown, setControlsShown] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const hideTimer = useRef<number | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const seqRef = useRef({ sound: -1, cue: -1 });

  const showControls = useCallback(() => {
    setControlsShown(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsShown(false), 4000);
  }, []);

  useEffect(() => {
    showControls();
    window.addEventListener('pointermove', showControls);
    window.addEventListener('pointerdown', showControls);
    const onFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.removeEventListener('pointermove', showControls);
      window.removeEventListener('pointerdown', showControls);
      document.removeEventListener('fullscreenchange', onFullscreen);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [showControls]);

  useEffect(
    () => () => {
      audioRef.current?.dispose();
      audioRef.current = null;
    },
    [],
  );

  const toggleSound = () => {
    // הקול של המנחה הולך עם שאר הצליל, ונפתח בתוך הלחיצה (hostVideoElement.ts).
    setHostVideoSound(!soundOn);
    if (soundOn) {
      audioRef.current?.stopAll();
      setSoundOn(false);
      return;
    }
    // נוצר בתוך הלחיצה — כך הדפדפן מתיר לו לנגן.
    audioRef.current ??= new AudioManager();
    // הסאונד הנוכחי (מוזיקת רקע בלולאה) מתחיל מיד; אפקטים שעברו — לא.
    seqRef.current = { sound: -1, cue: seqRef.current.cue };
    setSoundOn(true);
  };

  // שיקוף הסאונד של המסך הראשי.
  const sound = soundSource?.sound;
  const cues = soundSource?.cues;
  useEffect(() => {
    if (sound === undefined || cues === undefined) return;
    const lastCue = cues.reduce((max, cue) => Math.max(max, cue.seq), -1);
    const audio = audioRef.current;
    if (!soundOn || audio === null) {
      // כבוי: רק זוכרים עד איפה הגענו, כדי שהפעלה לא תנגן אפקטים ישנים.
      seqRef.current = { sound: seqRef.current.sound, cue: Math.max(seqRef.current.cue, lastCue) };
      return;
    }
    const result = mirrorSoundActions(
      sound,
      cues,
      seqRef.current.sound,
      seqRef.current.cue,
      Date.now(),
      toLocal,
    );
    seqRef.current = { sound: result.lastSeq, cue: result.lastCueSeq };
    for (const action of result.actions) {
      if (action.type === 'play')
        audio.play(channelOf(action.channel), action.src, { loop: action.loop });
      else if (action.type === 'applause') audio.playApplause();
      else if (action.type === 'cue') audio.playCue(action.kind);
      else audio.stopAll();
    }
  }, [sound, cues, soundOn, toLocal]);

  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  const toggleFullscreen = () => {
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  };

  const notice = connectionNotice(connection, hasSnapshot);
  const hasSide = pad !== null || video !== null;
  // עם עמודה בצד הכפתורים יושבים בה, תמיד גלויים — ולא על המסך, שקטן אז.
  const controls = (
    <div
      className={`live-controls${hasSide ? ' live-controls--docked' : ''}${controlsShown || !soundOn || hasSide ? ' is-shown' : ''}`}
      dir="rtl"
    >
      <button
        type="button"
        className={`live-btn${soundOn ? '' : ' live-btn--call'}`}
        onClick={toggleSound}
        title={soundOn ? 'השתקה' : 'הפעלת צליל'}
      >
        {soundOn ? '🔊' : '🔇 הפעלת צליל'}
      </button>
      {canFullscreen && (
        <button
          type="button"
          className="live-btn"
          onClick={toggleFullscreen}
          title={fullscreen ? 'יציאה ממסך מלא' : 'מסך מלא'}
        >
          {fullscreen ? '🗗' : '⛶'}
        </button>
      )}
      {extraControl}
    </div>
  );
  return (
    <div
      className={`live-viewer${hasSide ? ' has-side' : ''}${video !== null ? ' has-video' : ''}`}
    >
      <div className="live-screen-area">
        {children(soundOn)}
        {notice !== null && (
          <div className="live-notice" role="status" dir="rtl">
            {notice}
          </div>
        )}
        {!hasSide && controls}
        {!hasSide && (
          <div className="live-rotate-hint" dir="rtl">
            סובבו את הטלפון לרוחב למסך גדול יותר
          </div>
        )}
      </div>
      {hasSide && (
        <div className={`live-side${pad === null ? ' live-side--video' : ''}`}>
          {video?.(soundOn)}
          {pad}
          {controls}
        </div>
      )}
      {overlay}
    </div>
  );
}

/** המסך עצמו — אותן שכבות כמו ב-GameHost, לקריאה בלבד. */
function LiveScreen({
  snap,
  toLocal,
  soundOn,
}: {
  snap: LiveSnapshot;
  toLocal: (hostTime: number) => number;
  soundOn: boolean;
}) {
  const engine = useMemo(() => mirrorEngine(snap), [snap]);
  const state = snap.state as GameState;
  const setting = snap.game.setting;
  const names = snap.names;
  const nameOf = useCallback((id: string) => names[id] ?? '', [names]);
  const roster = useMemo<RosterData>(
    () => ({
      ...EMPTY_ROSTER,
      categories: snap.roster.categories,
      memberships: snap.roster.memberships,
    }),
    [snap.roster],
  );

  // אותו צבע לכל שחקן כמו במסך הראשי (המזהים כאן הם כינויים — ראו aliases.ts).
  const colors = snap.colors;
  useMemo(() => setAvatarColorOverrides(new Map(Object.entries(colors))), [colors]);
  useEffect(() => () => setAvatarColorOverrides(null), []);

  // הטיימר ממשיך לרוץ מקומית מהעוגן האחרון (כמו המסך הראשי, כל 200ms).
  const anchor = snap.timer;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (anchor === null || anchor.paused) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [anchor]);
  const timer =
    anchor === null ? null : timerFromAnchor(anchor, toLocal(anchor.at), Math.max(now, Date.now()));

  const stage = snap.stage;
  const overlays = snap.overlays;
  const join = snap.join;
  const slide = engine.getCurrentSlide();
  const mediaStartedAt = snap.mediaAt === null ? null : toLocal(snap.mediaAt);

  return (
    <div
      className={`game-root${join.show && stage !== 'opening' ? ' has-banner' : ''}`}
      dir="rtl"
      {...themeRootProps(setting)}
    >
      <LiveMirrorContext.Provider value={true}>
        <MediaPauseContext.Provider value={snap.paused}>
          <MediaMutedContext.Provider value={!soundOn}>
            <MediaClockContext.Provider value={mediaStartedAt}>
              <Stage fit="parent">
                {join.show && stage !== 'opening' && (
                  <div className="join-banner">
                    📞 להצטרפות למשחק חייגו <b>{JOIN_DIAL_DISPLAY}</b> והקישו את קוד המשחק:{' '}
                    <b className="join-banner-code">{join.code}</b>
                    {join.qr !== '' && <QrCode value={join.qr} size={40} className="qr-banner" />}
                  </div>
                )}
                {stage === 'opening' && (
                  <LobbyScreen
                    engine={engine}
                    players={snap.lobby}
                    {...(join.qr !== '' ? { qrUrl: join.qr } : {})}
                    {...(join.show
                      ? { joinInfo: { dial: JOIN_DIAL_DISPLAY, code: join.code } }
                      : {})}
                  />
                )}
                {overlays.lobby && stage !== 'opening' && (
                  <div className="lobby-overlay">
                    <LobbyScreen
                      engine={engine}
                      players={snap.lobby}
                      {...(join.qr !== '' ? { qrUrl: join.qr } : {})}
                      {...(join.show
                        ? { joinInfo: { dial: JOIN_DIAL_DISPLAY, code: join.code } }
                        : {})}
                    />
                  </div>
                )}
                {stage === 'playing' && (
                  <>
                    <SlideView
                      engine={engine}
                      state={state}
                      timer={timer}
                      reveal={snap.reveal}
                      players={snap.players}
                      leaders={snap.leaders}
                      functionStatus={snap.fn.status}
                      functionDetail={snap.fn.detail}
                      nameOf={nameOf}
                      roster={roster}
                      liveCorrectCount={snap.liveCorrectCount}
                    />
                    <span className="slide-counter" dir="ltr">
                      {state.currentSlideIndex + 1}/{snap.game.slideCount}
                    </span>
                  </>
                )}
                {stage === 'winners' && (
                  <WinnersScreen engine={engine} nameOf={nameOf} revealed={snap.winnersRevealed} />
                )}
                {stage === 'scoreboard' && (
                  <AllScoresScreen engine={engine} nameOf={nameOf} page={snap.scoresPage} />
                )}

                {stage === 'playing' && overlays.leaders && (
                  <div className="leaders-overlay">
                    <WinnersListScreen engine={engine} nameOf={nameOf} roster={roster} />
                  </div>
                )}
                {stage === 'playing' && overlays.votes && (
                  <VotesBreakdown
                    slide={slide}
                    votes={state.votesBySlide[state.currentSlideId] ?? {}}
                    nameOf={nameOf}
                    ansIsNumber={setting.ansIsNumber}
                  />
                )}
                {stage === 'playing' && overlays.board !== null && (
                  <SnakesLaddersBoard
                    board={overlays.board.board}
                    groups={overlays.board.groups}
                    progression={overlays.board.progression}
                  />
                )}
                {stage === 'playing' && overlays.bet !== null && (
                  <BetResultsOverlay
                    outcomes={state.betOutcomes[state.currentSlideId] ?? {}}
                    nameOf={nameOf}
                    title={overlays.bet.title}
                  />
                )}
                {stage === 'playing' && overlays.groups !== null && (
                  <GroupStandingsOverlay
                    roster={roster}
                    scores={state.scores}
                    answerTimes={state.answerTimes}
                    nameOf={nameOf}
                    categoryIndex={overlays.groups.categoryIndex}
                    groupBonus={snap.groupBonus}
                  />
                )}
                {overlays.connect !== null && (
                  <GroupConnectScreen
                    categoryName={overlays.connect.categoryName}
                    groups={overlays.connect.groups}
                    counts={overlays.connect.counts}
                    total={overlays.connect.total}
                  />
                )}
                {overlays.raffle !== null && (
                  <RaffleOverlay
                    key={overlays.raffle.run}
                    entries={overlays.raffle.entries}
                    winner={overlays.raffle.winner}
                  />
                )}
              </Stage>
            </MediaClockContext.Provider>
          </MediaMutedContext.Provider>
        </MediaPauseContext.Provider>
      </LiveMirrorContext.Provider>
    </div>
  );
}
