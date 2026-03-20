"use client";

import React from "react";
import { usePathname } from "next/navigation";

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
};

class AppRouteContentBoundaryInner extends React.Component<
  Props & { pathname: string },
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("App route content boundary", {
      pathname: this.props.pathname,
      error,
    });
  }

  componentDidUpdate(prevProps: Props & { pathname: string }) {
    if (prevProps.pathname !== this.props.pathname && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="rounded-lg border bg-card p-6">
            <h2 className="text-xl font-semibold">This tab hit an error</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Try another tab or reload this page.
            </p>
            <button
              className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => this.setState({ hasError: false })}
            >
              Retry this tab
            </button>
          </div>
        </div>
      );
    }

    return <div className="flex min-h-0 flex-1 flex-col">{this.props.children}</div>;
  }
}

export function AppRouteContentBoundary({ children }: Props) {
  const pathname = usePathname();
  return (
    <AppRouteContentBoundaryInner pathname={pathname}>
      {children}
    </AppRouteContentBoundaryInner>
  );
}
