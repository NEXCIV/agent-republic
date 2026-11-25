import type { Vector3 } from 'three';
import type { AgentPhase, PatrolCue } from './agent';

type Attendee = { phase: AgentPhase; metresRemaining: number; root: { position: Vector3 } };
type Greeting = { active: boolean; resident?: PatrolCue; visitor?: PatrolCue };

const GREETING_DURATION = 4.4;
const GREETING_APPROACH_METRES = 9;

export function createMarketGreeting() {
  let elapsed = 0;

  return (dt: number, resident?: Attendee, visitor?: Attendee): Greeting => {
    if (!resident || !visitor) {
      elapsed = 0;
      return { active: false, visitor: { hold: 'start' } };
    }
    const residentHere = resident.phase === 'arrived';
    if (!residentHere) elapsed = 0;
    const approaching = resident.phase === 'outbound' && resident.metresRemaining <= GREETING_APPROACH_METRES;
    const meeting = residentHere && visitor.phase === 'arrived';

    if (meeting && elapsed < GREETING_DURATION) {
      elapsed += dt;
      if (elapsed < GREETING_DURATION) {
        const face = elapsed < 3.5;
        return {
          active: true,
          resident: {
            hold: 'end',
            face: face ? visitor.root.position : undefined,
            gesture: elapsed >= 0.58 && elapsed < 3.16 ? 'wave' : undefined,
          },
          visitor: {
            hold: 'end',
            face: face ? resident.root.position : undefined,
            gesture: elapsed >= 1.70 && elapsed < 2.52 ? 'nod' : undefined,
          },
        };
      }
    }

    const waitingForResident = (approaching || residentHere) && elapsed < GREETING_DURATION;
    return {
      active: false,
      visitor: waitingForResident ? { hold: 'end', face: visitor.phase === 'arrived' ? resident.root.position : undefined } : { hold: 'start' },
    };
  };
}
