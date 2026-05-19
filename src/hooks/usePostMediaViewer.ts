import { useEffect, useRef, useState } from 'react';

interface UsePostMediaViewerArgs {
  readonly postId: string;
  readonly carouselLength: number;
  readonly lightboxLength: number;
}

export function usePostMediaViewer({
  postId,
  carouselLength,
  lightboxLength,
}: UsePostMediaViewerArgs) {
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [mediaViewportWidth, setMediaViewportWidth] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxViewportWidth, setLightboxViewportWidth] = useState(0);
  const [isLightboxZoomed, setIsLightboxZoomed] = useState(false);

  const mediaScrollRef = useRef<HTMLDivElement | null>(null);
  const lightboxScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveMediaIndex(0);
    const node = mediaScrollRef.current;
    if (node) {
      node.scrollTo({ left: 0, behavior: 'auto' });
    }
  }, [postId, carouselLength]);

  useEffect(() => {
    const node = mediaScrollRef.current;
    if (!node) return;

    const updateViewportWidth = () => setMediaViewportWidth(node.clientWidth);
    updateViewportWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [postId, carouselLength]);

  useEffect(() => {
    if (!isLightboxOpen || typeof document === 'undefined') return;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = priorOverflow;
    };
  }, [isLightboxOpen]);

  useEffect(() => {
    if (!isLightboxOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!lightboxLength) return;
      if (event.key === 'Escape') {
        setIsLightboxOpen(false);
      } else if (event.key === 'ArrowRight') {
        setIsLightboxZoomed(false);
        setLightboxIndex((prev) => Math.min(lightboxLength - 1, prev + 1));
      } else if (event.key === 'ArrowLeft') {
        setIsLightboxZoomed(false);
        setLightboxIndex((prev) => Math.max(0, prev - 1));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isLightboxOpen, lightboxLength]);

  useEffect(() => {
    if (!isLightboxOpen) return;
    const node = lightboxScrollRef.current;
    if (!node) return;
    const width = lightboxViewportWidth || node.clientWidth;
    if (!width) return;
    node.scrollTo({ left: lightboxIndex * width, behavior: 'smooth' });
  }, [isLightboxOpen, lightboxIndex, lightboxViewportWidth]);

  useEffect(() => {
    if (!isLightboxOpen) return;
    const node = lightboxScrollRef.current;
    if (!node) return;

    const updateViewportWidth = () => setLightboxViewportWidth(node.clientWidth);
    updateViewportWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateViewportWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isLightboxOpen]);

  return {
    activeMediaIndex,
    setActiveMediaIndex,
    mediaViewportWidth,
    mediaScrollRef,
    isLightboxOpen,
    setIsLightboxOpen,
    lightboxIndex,
    setLightboxIndex,
    lightboxViewportWidth,
    lightboxScrollRef,
    isLightboxZoomed,
    setIsLightboxZoomed,
  };
}