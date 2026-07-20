/**
 * תצוגת השקופית הנוכחית: מדיה חוסמת (openMedia/endMedia) במסך מלא,
 * רקע שכבתי (backgroundMedia / slidBackgroundMedia / triviaMedia),
 * ותוכן לפי סוג השקופית.
 */

import { type GameEngine, type GameState, type Slide } from '../engine/index.ts';
import { MediaPlayer } from './MediaPlayer.tsx';
import { QuestionSlide, type RailPlayer, type RevealState } from './QuestionSlide.tsx';
import { SubjectSlide } from './SubjectSlide.tsx';
import { WinnersListScreen, WinnersScreen } from './screens.tsx';
import type { RosterData } from '../app/roster.ts';
import type { TimerView } from './TimerRing.tsx';

interface SlideViewProps {
  engine: GameEngine;
  state: GameState;
  timer: TimerView | null;
  reveal: RevealState;
  /** עונים אחרונים (שכבר עברו רזולוציה לשם) — לאווטרים המתעופפים. */
  players: RailPlayer[];
  /** חמשת הראשונים שענו נכונה על השקופית — לפס המובילים בחשיפה. */
  leaders: RailPlayer[];
  /** מצב שליחת שקופית "פונקציה" ל-API (רלוונטי רק ל-type: "function"). */
  functionStatus?: 'idle' | 'sending' | 'sent' | 'error';
  /** טקסט נלווה לשקופית פונקציה (למשל "12 שחקנים הוסרו מהמשחק"). */
  functionDetail?: string;
  /** פותר שם לפי מזהה — לשקופית פונקציה מסוג "screen" (מנצחים/מובילים). */
  nameOf?: (voterId: string) => string;
  /** מרשם הקבוצות — לשקופית פונקציה מסוג "screen"/"leaderboard". */
  roster?: RosterData;
  /** סיום מדיה חוסמת (סרטון/יוטיוב) — למעבר אוטומטי אם מוגדר playToEnd. */
  onBlockingMediaEnded?: () => void;
}

/** מסך שקופית "פונקציה" — פעולת מערכת (API / ניקוד / משתתפים) עם חיווי מצב. */
function FunctionScreen({
  action,
  status,
  detail,
}: {
  action: string;
  status: 'idle' | 'sending' | 'sent' | 'error';
  detail: string;
}) {
  let icon = '⚡';
  let text: string;
  // כשל בשליחת ה-API הוא קריטי — מציגים הנחיה ברורה לעצור ולפנות לתמיכה.
  let apiFailed = false;
  if (action === 'score') {
    icon = '🔄';
    text = status === 'error' ? '⚠ פעולת ניקוד לא מוכרת' : '✓ הניקוד אופס';
  } else if (action === 'players') {
    icon = '👋';
    text = status === 'error' ? '⚠ פעולת משתתפים לא תקינה' : detail || '✓ עודכנו המשתתפים';
  } else if (status === 'error') {
    icon = '⛔';
    text = 'השליחה נכשלה';
    apiFailed = true;
  } else {
    text = status === 'sent' ? '✓ הנתונים נשלחו' : 'שולח נתונים…';
  }
  return (
    <div className="screen slide-screen function-screen">
      <div className="screen-content">
        <div className={`function-card function-card--${status}`}>
          <div className="function-icon">{icon}</div>
          <p className="function-text">{text}</p>
          {apiFailed && (
            <p className="function-support">אין להמשיך — יש ליצור קשר עם התמיכה</p>
          )}
          {status === 'sending' && <div className="spinner" />}
        </div>
      </div>
    </div>
  );
}

/**
 * רקע השקופית. תמונת השאלה (question.src) אינה רקע — בחלק מהקבצים
 * backgroundMedia מצביע לאותה תמונה; במקרה כזה מתעלמים ממנה ונופלים
 * לרקע הרגיל (triviaMedia). רקע ספציפי אמיתי הוא ערך שונה מתמונת השאלה.
 */
export function slideBackgroundSrc(slide: Slide, triviaMedia: string): string {
  const questionImage = slide.question.src;
  const isNotQuestionImage = (src: string) => src !== '' && src !== questionImage;

  if (isNotQuestionImage(slide.backgroundMedia.src)) return slide.backgroundMedia.src;
  if (isNotQuestionImage(slide.setting.slidBackgroundMedia.src)) {
    return slide.setting.slidBackgroundMedia.src;
  }
  const votable = slide.type === 'trivia' || slide.type === 'survey' || slide.type === 'ans_images';
  if (votable) return triviaMedia;
  return '';
}

export function SlideView({
  engine,
  state,
  timer,
  reveal,
  players,
  leaders,
  functionStatus = 'idle',
  functionDetail = '',
  nameOf,
  roster,
  onBlockingMediaEnded,
}: SlideViewProps) {
  const slide = engine.getCurrentSlide();

  // שקופית "פונקציה" — לפי הפעולה: מסך מנצחים/מובילים, או חיווי API/ניקוד/משתתפים.
  if (slide.type === 'function') {
    const fn = slide.function;
    if (fn?.action === 'screen') {
      return fn.screen?.type === 'leaderboard' ? (
        <WinnersListScreen engine={engine} {...(nameOf ? { nameOf } : {})} {...(roster ? { roster } : {})} />
      ) : (
        <WinnersScreen engine={engine} {...(nameOf ? { nameOf } : {})} />
      );
    }
    return <FunctionScreen action={fn?.action ?? 'api'} status={functionStatus} detail={functionDetail} />;
  }

  // מדיה חוסמת — מסך מלא. סרטון/יוטיוב מדווחים onEnded ל-onBlockingMediaEnded
  // (המעבר בפועל מותנה ב-playToEnd, נקבע ב-GameHost); לתמונה אין "סיום" והמעבר
  // שלה מטופל בטיימר ב-GameHost. אם אין handler — נשמרת ההתנהגות הידנית (רווח/0).
  if (state.activeMedia !== null) {
    const src = state.activeMedia === 'open' ? slide.openMedia.src : slide.endMedia.src;
    return (
      <div className="screen slide-media-screen">
        <MediaPlayer src={src} {...(onBlockingMediaEnded ? { onEnded: onBlockingMediaEnded } : {})} />
      </div>
    );
  }

  let background = slideBackgroundSrc(slide, engine.getGame().setting.triviaMedia.src);
  // שקופית טקסט (subject) — הרקע הוא מדיית המסך הראשי מהג'ייסון (gameMedia),
  // אלא אם לשקופית יש רקע ייעודי משלה. מעליו בועת הצבע הראשי עם טקסט משני.
  if (slide.type === 'subject' && background === '') {
    background = engine.getGame().setting.gameMedia.src;
  }

  return (
    <div className="screen slide-screen">
      {background !== '' && (
        <div className="screen-background">
          <MediaPlayer src={background} asBackground />
        </div>
      )}
      <div className="screen-content slide-content">
        {slide.type === 'subject' ? (
          <SubjectSlide slide={slide} command={state.subjectCommand} />
        ) : slide.type === 'media' ? (
          // שקופית מדיה בלי מדיה פעילה — מצב חולף בלבד (רקע נקי, בלי טקסט)
          <span aria-hidden="true" />
        ) : (
          <QuestionSlide
            slide={slide}
            state={state}
            ansIsNumber={engine.getGame().setting.ansIsNumber}
            timer={timer}
            reveal={reveal}
            players={players}
            leaders={leaders}
            title={engine.getGame().setting.titleThroughoutGame}
            logo={engine.getGame().setting.logo.src}
          />
        )}
      </div>
    </div>
  );
}
