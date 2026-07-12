/**
 * קוד QR — עוטף את qrcode-generator ומרנדר SVG סקיילבילי (מודולים שחורים על
 * רקע לבן) לתוך תיבה בגודל נתון, כדי שיהיה ניתן לסריקה מטלפון.
 */

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export function QrCode({ value, size, className }: { value: string; size: number; className?: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ margin: 0, scalable: true });
  }, [value]);
  return (
    <div
      className={`qr-code${className ? ` ${className}` : ''}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
