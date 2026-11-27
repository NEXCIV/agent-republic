'use client';

import { createContext } from 'react';
import type { SharedPilotProfile } from '@/lib/shared-pilot-profiles';

export const EntryCameraContext = createContext<(profile: SharedPilotProfile) => void>(() => {});
