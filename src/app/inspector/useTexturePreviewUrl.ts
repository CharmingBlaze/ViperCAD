import { useEffect, useState } from 'react';
import type { EditorSession } from '@/core/editor/EditorSession';

export function useTexturePreviewUrl(session: EditorSession, textureId: string | null) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const texture = textureId ? session.document.textures.get(textureId) : null;
    const image = texture ? session.document.images.get(texture.imageAssetId) : null;
    if (!image || typeof document === 'undefined') {
      setImageUrl(null);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) {
      setImageUrl(null);
      return;
    }
    context.putImageData(
      new ImageData(new Uint8ClampedArray(image.pixels), image.width, image.height),
      0,
      0,
    );
    setImageUrl(canvas.toDataURL('image/png'));
  }, [session.document, textureId]);

  return imageUrl;
}
