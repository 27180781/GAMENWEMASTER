/**
 * גלריית המסכים — כלי פיתוח/בדיקה בלבד (gallery.html, מוגש משרת הפיתוח של
 * Vite ואינו חלק מה-build). מרנדר מסך אחד של המשחק, עם הקומפוננטות האמיתיות,
 * בערכת נושא ובצבעים נתונים — כדי לבדוק כל מסך בכל ערכה (ידנית, או אוטומטית
 * ב-tools/theme-shots.mjs).
 *
 * פרמטרים: ?screen=<id>&theme=<id>&colors=<preset>&bg=<url|sample|ריק>&freeze=1
 * בלי screen — אינדקס קישורים לכל המסכים.
 */

import { useEffect, useMemo, useState } from 'react';
import { VISUAL_THEMES } from '../engine/index.ts';
import { Stage } from '../render/Stage.tsx';
import { themeRootProps } from '../render/theme.ts';
import { JOIN_DIAL_DISPLAY } from '../app/urlParams.ts';
import { COLOR_PRESETS, IMAGES, type GalleryContext } from './mockData.ts';
import { SCREENS, findScreen } from './screens.tsx';

export interface GalleryParams {
  screen: string;
  theme: string;
  colors: string;
  bg: string;
  freeze: boolean;
}

export function readParams(search: string): GalleryParams {
  const q = new URLSearchParams(search);
  return {
    screen: q.get('screen') ?? '',
    theme: q.get('theme') ?? 'classic',
    colors: q.get('colors') ?? 'default',
    bg: q.get('bg') ?? '',
    freeze: q.get('freeze') === '1',
  };
}

/**
 * CSS שמקפיא אנימציות ומעברים כדי שהצילומים יהיו דטרמיניסטיים: כל אנימציה
 * "נגמרת" (השהיה שלילית גדולה + עצירה) — אלמנטים שנכנסים באנימציה נראים במצבם
 * הסופי, ואנימציות אינסופיות קופאות בנקודה קבועה. השמות המתעופפים הם החריג:
 * מצבם הסופי שקוף, ולכן כל אחד נעצר בנקודה אחרת לאורך המסלול.
 */
const FREEZE_CSS = `
*, *::before, *::after {
  animation-delay: -60s !important;
  animation-play-state: paused !important;
  transition: none !important;
  caret-color: transparent !important;
}
${[0.45, 0.75, 1.05, 1.35, 1.65, 1.95, 2.2, 0.6, 0.9, 1.2]
  .map((d, i) => `.q-flyer:nth-child(10n+${i + 1}) { animation-delay: -${d}s !important; }`)
  .join('\n')}
`;

function resolveBg(bg: string): string {
  if (bg === 'sample') return IMAGES.busyBackground;
  return bg;
}

function Index() {
  return (
    <div className="gallery-index" dir="rtl">
      <h1>גלריית מסכים</h1>
      <p>
        פרמטרים: <code>screen</code>, <code>theme</code> ({VISUAL_THEMES.join(' / ')}), <code>colors</code> (
        {Object.keys(COLOR_PRESETS).join(' / ')}), <code>bg</code> (כתובת / sample), <code>freeze=1</code>
      </p>
      <table>
        <tbody>
          {SCREENS.map((s) => (
            <tr key={s.id}>
              <td>
                <code>{s.id}</code>
              </td>
              <td>{s.label}</td>
              {VISUAL_THEMES.map((t) => (
                <td key={t}>
                  <a href={`?screen=${s.id}&theme=${t}`}>{t}</a>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScreenView({ params, onReady }: { params: GalleryParams; onReady: (settleMs: number) => void }) {
  const def = findScreen(params.screen);
  const ctx: GalleryContext = {
    theme: params.theme,
    colors: COLOR_PRESETS[params.colors] ?? COLOR_PRESETS['default']!,
    bg: resolveBg(params.bg),
  };
  const built = useMemo(() => (def ? def.build(ctx) : null), [def, ctx.theme, ctx.colors, ctx.bg]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onReady(def?.settleMs ?? 700);
  }, [def, onReady]);

  if (def === undefined || built === null) {
    return (
      <div className="gallery-index" dir="rtl">
        <h1>מסך לא מוכר: {params.screen}</h1>
        <a href="?">לאינדקס</a>
      </div>
    );
  }
  const { game, node, banner } = built;
  return (
    <div className={`game-root${banner ? ' has-banner' : ''}`} dir="rtl" {...themeRootProps(game.setting)}>
      <Stage>
        {banner && (
          <div className="join-banner">
            📞 להצטרפות למשחק חייגו <b>{JOIN_DIAL_DISPLAY}</b> והקישו את קוד המשחק:{' '}
            <b className="join-banner-code">{game.room}</b>
          </div>
        )}
        {node}
        {/* כפתורי הפינה — קיימים תמיד במסך החי (GameHost) */}
        <div className="corner-buttons">
          <button title="הגדרות">⚙</button>
          <button title="שמות וקבוצות">👥</button>
        </div>
      </Stage>
    </div>
  );
}

export function Gallery({ params }: { params: GalleryParams }) {
  // רינדור שני אחרי שהגופנים נטענו — FitText מודד בטעינה, ומדידה בגופן הגיבוי
  // הייתה משאירה גדלים שגויים.
  const [mountKey, setMountKey] = useState(0);
  useEffect(() => {
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) setMountKey(1);
    });
    return () => {
      alive = false;
    };
  }, []);

  const [settleMs, setSettleMs] = useState<number | null>(null);
  useEffect(() => {
    if (mountKey !== 1 || settleMs === null) return undefined;
    const t = window.setTimeout(() => {
      document.documentElement.dataset['galleryReady'] = '1';
    }, settleMs);
    return () => window.clearTimeout(t);
  }, [mountKey, settleMs]);

  if (params.screen === '') return <Index />;
  return (
    <>
      {params.freeze && <style>{FREEZE_CSS}</style>}
      <ScreenView key={mountKey} params={params} onReady={setSettleMs} />
    </>
  );
}
