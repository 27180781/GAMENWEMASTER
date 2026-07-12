/** הצהרת טיפוסים מינימלית ל-qrcode-generator (אין types מובנים). */
declare module 'qrcode-generator' {
  interface QRCode {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
    createSvgTag(opts?: {
      cellSize?: number;
      margin?: number;
      scalable?: boolean;
    }): string;
    createDataURL(cellSize?: number, margin?: number): string;
  }
  type ErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';
  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCode;
  export default qrcode;
}
