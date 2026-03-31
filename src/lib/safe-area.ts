export type SafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const createEmptySafeAreaInsets = (): SafeAreaInsets => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
});

export const mergePositiveSafeAreaInsets = (
  base: SafeAreaInsets,
  next: SafeAreaInsets
): SafeAreaInsets => ({
  top: next.top > 0 ? next.top : base.top,
  right: next.right > 0 ? next.right : base.right,
  bottom: next.bottom > 0 ? next.bottom : base.bottom,
  left: next.left > 0 ? next.left : base.left,
});

const resolveInset = (
  measured: number,
  orientationStable: number,
  sessionStable: number,
  preserveOnZero: boolean
) => {
  if (measured > 0 || !preserveOnZero) {
    return measured;
  }
  if (orientationStable > 0) {
    return orientationStable;
  }
  if (sessionStable > 0) {
    return sessionStable;
  }
  return 0;
};

export const resolveSafeAreaInsets = ({
  measured,
  orientationStable,
  sessionStable,
  preserveOnZero,
}: {
  measured: SafeAreaInsets;
  orientationStable: SafeAreaInsets;
  sessionStable: SafeAreaInsets;
  preserveOnZero: boolean;
}): SafeAreaInsets => ({
  top: resolveInset(measured.top, orientationStable.top, sessionStable.top, preserveOnZero),
  right: resolveInset(measured.right, orientationStable.right, sessionStable.right, preserveOnZero),
  bottom: resolveInset(measured.bottom, orientationStable.bottom, sessionStable.bottom, preserveOnZero),
  left: resolveInset(measured.left, orientationStable.left, sessionStable.left, preserveOnZero),
});
