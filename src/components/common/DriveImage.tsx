import React, { useEffect, useState } from 'react';
import { fetchAuthorizedDrivePhotoUrl, isDirectPhotoUrl, resolvePhotoSrc } from '../../utils/photo.js';
import { useApp } from '../../context/AppContext.js';

export function useResolvedPhotoSrc(val?: string | null): string {
  const { googleAccessToken, appsScriptUrl } = useApp();
  const [resolved, setResolved] = useState<string>(() => resolvePhotoSrc(val));

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
    if (!googleAccessToken && !appsScriptUrl) {
      setResolved(resolvePhotoSrc(clean));
      return;
    }

    fetchAuthorizedDrivePhotoUrl(clean)
      .then((url) => {
        if (active && url) setResolved(url);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [val, googleAccessToken, appsScriptUrl]);

  return resolved;
}

interface DriveImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  srcValue?: string | null;
}

export const DriveImage: React.FC<DriveImageProps> = ({ srcValue, alt = '', ...rest }) => {
  const resolved = useResolvedPhotoSrc(srcValue);
  if (!resolved) return null;
  return <img src={resolved} alt={alt} {...rest} />;
};
