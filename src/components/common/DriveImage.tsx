import React, { useEffect, useState } from 'react';
import {
  extractDriveFileId,
  fetchAuthorizedDrivePhotoUrl,
  isDirectPhotoUrl,
  resolvePhotoSrc,
} from '../../utils/photo.js';
import { useApp } from '../../context/AppContext.js';

export function useResolvedPhotoSrc(val?: string | null): string {
  const { googleAccessToken, appsScriptUrl, envStatus } = useApp();
  const [resolved, setResolved] = useState<string>(() => {
    const clean = (val || '').trim();
    if (!clean) return '';
    if (isDirectPhotoUrl(clean)) return clean;
    const preResolved = resolvePhotoSrc(clean);
    // Avoid synchronous unauthenticated /api/photos calls when using Apps Script or browser OAuth
    if (preResolved.startsWith('/api/photos') && (appsScriptUrl || googleAccessToken || envStatus.requiresGoogleSignIn)) {
      return '';
    }
    return preResolved;
  });

  useEffect(() => {
    let active = true;
    const clean = (val || '').trim();
    if (!clean) {
      setResolved('');
      return;
    }
    if (isDirectPhotoUrl(clean)) {
      setResolved(clean);
      return;
    }

    const fileId = extractDriveFileId(clean) || clean;
    if (!googleAccessToken && !appsScriptUrl) {
      if (envStatus.requiresGoogleSignIn) {
        setResolved('');
      } else {
        setResolved(resolvePhotoSrc(fileId));
      }
      return;
    }

    fetchAuthorizedDrivePhotoUrl(fileId)
      .then((url) => {
        if (active) setResolved(url || '');
      })
      .catch(() => {
        if (active) setResolved('');
      });

    return () => {
      active = false;
    };
  }, [val, googleAccessToken, appsScriptUrl, envStatus.requiresGoogleSignIn]);

  return resolved;
}

interface DriveImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  srcValue?: string | null;
}

export const DriveImage: React.FC<DriveImageProps> = ({ srcValue, alt = '', onError, ...rest }) => {
  const resolved = useResolvedPhotoSrc(srcValue);
  const [failedSrc, setFailedSrc] = useState<string>('');
  if (!resolved || failedSrc === resolved) return null;
  return (
    <img
      src={resolved}
      alt={alt}
      onError={(e) => {
        setFailedSrc(resolved);
        onError?.(e);
      }}
      {...rest}
    />
  );
};
