// @ts-check
/**
 * Preload עם בידוד הקשר (contextIsolation). כרגע חושף רק מידע מינימלי;
 * כאן ייכנס בעתיד גשר לקליקרים (USB HID / Serial) שיזרים הצבעות אל ה-adapter
 * שבתוך האפליקציה, מאחורי אותו VoteAdapter הקיים.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('triviaDesktop', {
  isDesktop: true,
  platform: process.platform,
});
