import type { ReactNode } from 'react';
import { SharedCity } from './SharedCity';

export default function Layout({ children }: { children: ReactNode }) {
  return <SharedCity>{children}</SharedCity>;
}
