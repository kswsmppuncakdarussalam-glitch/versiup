import React, { useEffect, useState } from 'react';
import {
  extractDriveFileId,
  fetchAuthorizedDrivePhotoUrl,
  isDirectPhotoUrl,
  resolvePhotoSrc,
} from '../../utils/photo.js';
import { useApp } from '../../context/AppContext.js';

export function useResolvedPhotoSrc(val?: string | null): string {
  const { appsScriptUrl, appsScriptSecretConfigured } = useApp();
  const [resolved, setResolved] = useState<string>(() => {
    const clean = (val || '').trim();
    if (!clean) return '';
    if (isDirectPhotoUrl(clean)) return clean;
    return resolvePhotoSrc(clean);
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

    if (!appsScriptUrl || !appsScriptSecretConfigured) {
      setResolved('');
      return;
    }

    const fileId = extractDriveFileId(clean) || clean;
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
  }, [val, appsScriptUrl, appsScriptSecretConfigured]);

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
