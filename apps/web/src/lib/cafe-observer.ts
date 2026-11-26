export const OBSERVER_TOPIC = '北岸码头傍晚要不要加灯？';
export const OBSERVER_QUESTIONS = {
  safety: '傍晚走码头时，哪里最看不清？',
  impact: '加灯会给你和附近居民带来什么影响？',
} as const;
export const OBSERVER_SPEAKERS = {
  ahe: { name: '阿禾', place: 'counter', location: '咖啡摊' },
  regular: { name: '码头常客', place: 'pier', location: '北岸码头' },
} as const;
export type ObserverSpeaker = keyof typeof OBSERVER_SPEAKERS;
export type ObserverAngle = keyof typeof OBSERVER_QUESTIONS;
export type ObserverSuggestion = 'aheFirst' | 'regularFirst' | 'askSafety' | 'askImpact';
export type ObserverSource = {
  id: string;
  at: number;
  speaker: ObserverSpeaker;
  place: (typeof OBSERVER_SPEAKERS)[ObserverSpeaker]['place'];
  angle: ObserverAngle;
  quote: string;
};
export type ObserverAssignment = {
  preferredSource?: ObserverSpeaker;
  angle: ObserverAngle;
  sources: ObserverSource[];
};
