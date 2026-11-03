import { useEffect, useState } from 'react';
import { requestBlob } from '../lib/api.js';

/** Attachment images need the bearer header in desktop/mobile shells, so fetch then object-URL. */
export function AuthedImage({
  attachmentId,
  alt,
  className,
}: {
  attachmentId: string | null;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    if (!attachmentId) return;
    void requestBlob(`/attachments/${attachmentId}`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId]);
  if (!url) {
    return <div className={`animate-pulse bg-hover ${className ?? ''}`} aria-label={alt} />;
  }
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}
