/**
 * איתור קובץ המשחק בתוך ה-ZIP.
 *
 * חבילה שמגיעה מהשרת (download-by-code) מכילה game.json *וגם* manifest.json.
 * הנפילה אחורה ל"כל קובץ JSON" הייתה עלולה לבחור דווקא ב-manifest, לפי סדר
 * הערכים בארכיון — ואז המשחק לא נטען. הבדיקות כאן נועלות את סדר העדיפויות.
 */
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readZipGameFile } from '../src/app/zipLoader.ts';

const sSet = {allowChangeVote:false,slideStartVoting:true,playAfterClicking:false,exitGame:false,correctlyAnsweredBefore:false,firstClicker:false,answerIsSequenceClicks:false,fullscreen:false,scoringReduction:{active:false,seconds:'',score:''},slidBackgroundMedia:{src:''},automaticSkip:{active:false,seconds:''},showInLoop:false};
const sound = {playersConnectingMediaSound:{src:null},showQuestionMediaSound:{src:null},winnersMediaSound:{src:null},winnersListMediaSound:{src:null},genericMediaSound:{src:null},timerMediaSound:{src:null},inShowAnsMediaSound:{src:null}};

function gameFile(name: string) {
  return {
    id: 'g1', name, users: '{}',
    setting: {titleThroughoutGame:'x',ansIsNumber:true,multiWinners:1,showWinnersListAfter:null,winnersListCount:5,gameMedia:{src:''},logo:{src:''},triviaMedia:{src:''},winnersMedia:{src:''},winnersListMedia:{src:''},mainColor:'#8B2FC9',secondaryColor:'#FFD23F',sound,limit:{type:'clickers'}},
    questions: [{ id:1, type:'trivia', question:{que:'ש', scoreForQue:10, timeForQue:20, src:'', answers:[1,2].map((id)=>({ans:'ת'+id, correct:id===1, id}))}, openMedia:{src:''}, endMedia:{src:''}, backgroundMedia:{src:''}, setting:sSet }],
  };
}

async function zipOf(files: Record<string, unknown>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [name, body] of Object.entries(files)) z.file(name, JSON.stringify(body));
  return z.generateAsync({ type: 'uint8array' });
}

describe('בחירת קובץ המשחק מתוך ה-ZIP', () => {
  it('חבילת השרת: game.json נבחר, ולא manifest.json', async () => {
    // manifest נכתב *ראשון* — בדיוק הסדר שהיה מפיל את הנפילה אחורה הישנה
    const bytes = await zipOf({
      'manifest.json': { files: [{ path: 'Assets/a.jpg', sha256: 'x', size: 1 }] },
      'game.json': gameFile('משחק מהשרת'),
    });
    const { game } = await readZipGameFile(bytes);
    expect(game.name).toBe('משחק מהשרת');
  });

  it('חבילת העורך: data.json גובר על game.json אם שניהם קיימים', async () => {
    const bytes = await zipOf({
      'game.json': gameFile('מהשרת'),
      'data.json': gameFile('מהעורך'),
    });
    const { game } = await readZipGameFile(bytes);
    expect(game.name).toBe('מהעורך');
  });

  it('JSON בשם אחר עדיין נתמך (חבילות ישנות)', async () => {
    const bytes = await zipOf({ 'trivia-export.json': gameFile('שם אחר') });
    const { game } = await readZipGameFile(bytes);
    expect(game.name).toBe('שם אחר');
  });

  it('קובץ עזר בלבד → שגיאה ברורה, ולא ניסיון לפרש אותו כמשחק', async () => {
    const bytes = await zipOf({ 'manifest.json': { files: [] } });
    await expect(readZipGameFile(bytes)).rejects.toThrow(/data.json/);
  });

  it('קובץ המשחק נמצא גם בתוך תיקייה', async () => {
    const bytes = await zipOf({ 'pack/manifest.json': { files: [] }, 'pack/game.json': gameFile('בתיקייה') });
    const { game } = await readZipGameFile(bytes);
    expect(game.name).toBe('בתיקייה');
  });
});
