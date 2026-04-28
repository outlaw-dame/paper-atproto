import React from 'react';

type LazyModuleBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  resetKey?: string | number;
};

type LazyModuleBoundaryState = {
  hasError: boolean;
};

export default class LazyModuleBoundary extends React.Component<
  LazyModuleBoundaryProps,
  LazyModuleBoundaryState
> {
  state: LazyModuleBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LazyModuleBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[LazyBoundary] Deferred module failed to render', error);
  }

  componentDidUpdate(prevProps: LazyModuleBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}
