'use client';

import { useEffect } from 'react';
import { keepPushInSync } from '../alerts';

/** Keeps the server's list of what to alert this browser about current, on every page (nothing happens unless push alerts are on). */
export function PushSync() {
  useEffect(() => keepPushInSync(), []);
  return null;
}
